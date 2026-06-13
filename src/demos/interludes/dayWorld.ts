// The day, assembled — the world side of A Day at the Lake. One function
// builds the whole subscriber list for the world clock:
//
//   sky      Air & Light's atmosphere, fog/mist schedule, cloud layer,
//            weather machine, moon, stars — every one keyed to the hour
//   water    an ambient lake that the same hour re-keys: sky reflection,
//            sun glint, a boosted moon glint, whitecaps from the weather,
//            disturbance-bus rings, and height fog with the last word
//   life     Alive's ecosystem: the school, the hatch, the swallows, geese
//            in transit, the patrolling eagle — hunger and activity all
//            slaved to hatchIntensity(hour)
//
// The caller owns the clock (and the player); this module owns everything
// the clock conducts. update(dt, t) reads the hour once and pushes it into
// every system, which is the entire thesis of the essay it appears in.

import {
  Color,
  DirectionalLight,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  Scene,
  Vector3,
} from "three/webgpu";
import {
  cameraPosition,
  length,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  reflect,
  smoothstep,
  uniform,
  vec3,
} from "three/tsl";
import { onDisturbance, wind } from "../../lib/spine";
import { makeGradedSheetGeometry } from "../../lib/fluid";
import {
  RippleRings,
  createWaveUniforms,
  f0FromIor,
  fresnelSchlick,
  sunGlint,
  waveHeightNode,
  waveSlopeNode,
} from "../../lib/water";
import {
  CloudLayer,
  Moon,
  WeatherSystem,
  createAtmosphere,
  createSkyPalette,
  createHeightFog,
  mistAmountForHour,
  moonElevationDeg,
  skyColors,
  type Atmosphere,
  type HeightFog,
  type WeatherKind,
} from "../../lib/sky";
import {
  EAGLE_HINGE,
  EaglePatrol,
  FishSchool,
  GOOSE_HINGE,
  GlintField,
  GooseSkein,
  HatchSwarm,
  SWALLOW_HINGE,
  SwallowFlock,
  fillFishInstances,
  fillMayflyInstances,
  goldenness,
  hatchIntensity,
  makeEagleGeometry,
  makeFishGeometry,
  makeFishMaterial,
  makeFlapMaterial,
  makeGooseGeometry,
  makeMayflyGeometry,
  makeMayflyMaterial,
  makeSwallowGeometry,
  setBirdMatrix,
} from "../../lib/life";
import { makeValleyTerrain, type ValleyTerrain } from "./valley";

// ---- the schedule -----------------------------------------------------------------
// The afternoon front is level design, not dice: a breeze builds after one,
// the squall line crosses mid-afternoon, and the sky is rinsed clean in
// time for the hatch. (The weather machine still does all the easing.)

export function scheduledWeather(hour: number): WeatherKind {
  if (hour >= 13.4 && hour < 14.3) return "breezy";
  if (hour >= 14.3 && hour < 16.1) return "storm";
  if (hour >= 16.1 && hour < 17.3) return "breezy";
  return "calm";
}

// ---- the fogged lake -----------------------------------------------------------------

interface DayWater {
  mesh: Mesh;
  rings: RippleRings;
  /** Scales the deep-water body color (night drains it). */
  bodyLight: { value: number };
  /** 0..1 whitecap weight; the weather drives it. */
  whitecaps: { value: number };
  update(t: number): void;
  dispose(): void;
}

function makeDayWater(
  env: Atmosphere,
  fog: HeightFog,
  dims: { coreSize: number; coreCells: number; extent: number },
): DayWater {
  const rings = new RippleRings();
  const geometry = makeGradedSheetGeometry(dims.coreSize, dims.coreCells, dims.extent, 1.4);
  const material = new MeshBasicNodeMaterial();
  const u = createWaveUniforms();

  const ior = uniform(1.333);
  const rough = uniform(0.08);
  const scatter = uniform(new Color(0x0a2531));
  const bodyLight = uniform(0.6);
  const whitecaps = uniform(0);
  /** The honest moon glint is ~1/250 of the sun's; this is the playable one. */
  const moonBoost = uniform(26);

  // -- vertex: long waves + bus rings (mesh sits at the origin, local == world)
  const heightV = waveHeightNode(positionLocal.xz, u, 2).add(rings.contributionNode(positionLocal.xz, u.time).x);
  material.positionNode = positionLocal.add(vec3(0, heightV, 0));

  // -- fragment: the Mirror's skin, re-lit by whatever hour the sky holds ------
  const ringC = rings.contributionNode(positionWorld.xz, u.time);
  const slope = waveSlopeNode(positionWorld.xz, u).add(ringC.yz);
  const nrm = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));
  const view = normalize(cameraPosition.sub(positionWorld));
  const fres = fresnelSchlick(nrm.dot(view).clamp(0, 1), f0FromIor(ior));

  const r = reflect(view.negate(), nrm);
  const reflected = env.skyColor(normalize(vec3(r.x, r.y.max(0.02), r.z)));
  const body = scatter.rgb.mul(bodyLight);

  const sunG = sunGlint(nrm, view, env.sunDirection, rough).mul(fres.clamp(0.02, 1)).mul(env.sunColor);
  const moonG = sunGlint(nrm, view, env.moonDirection, rough)
    .mul(fres.clamp(0.02, 1))
    .mul(env.moonColor)
    .mul(moonBoost);

  let shaded = mix(body, reflected, fres).add(sunG).add(moonG);

  // Whitecaps: steep composite slope breaks white once the wind says so.
  const cap = smoothstep(0.3, 0.62, length(slope)).mul(whitecaps);
  shaded = mix(shaded, vec3(0.85, 0.92, 0.98).mul(bodyLight.add(0.4)), cap);

  // Height fog gets the last word — the same fog the terrain wears.
  material.colorNode = fog.applyNode(shaded, cameraPosition, positionWorld, {
    direction: env.sunDirection,
    color: env.sunColor.rgb,
  });

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    rings,
    bodyLight,
    whitecaps,
    update(t: number) {
      u.time.value = t;
      u.windDirection.value = wind.direction;
      u.windSpeed.value = wind.speed;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ---- the ecosystem -------------------------------------------------------------------

export interface DayLifeOptions {
  fish: number;
  hatch: number;
  swallows: number;
  geese: boolean;
  eagle: boolean;
}

interface DayLife {
  school: FishSchool;
  hatch: HatchSwarm;
  swallows: SwallowFlock;
  update(dt: number, t: number, hour: number, sunIntensity: number): void;
  dispose(): void;
}

const _m = new Matrix4();

function buildDayLife(
  scene: Scene,
  center: { x: number; z: number },
  opts: DayLifeOptions,
): DayLife {
  const school = new FishSchool({ count: opts.fish, homeX: center.x, homeZ: center.z, homeRadius: 60 });
  const fishGeo = makeFishGeometry();
  const fishKit = makeFishMaterial();
  const fishMesh = new InstancedMesh(fishGeo, fishKit.material, opts.fish);
  fishMesh.frustumCulled = false;
  const glints = new GlintField(Math.min(200, opts.fish + 40));

  const hatch = new HatchSwarm({ centerX: center.x, centerZ: center.z + 30, capacity: opts.hatch });
  const mayGeo = makeMayflyGeometry();
  const mayKit = makeMayflyMaterial();
  const mayMesh = new InstancedMesh(mayGeo, mayKit.material, opts.hatch);
  mayMesh.frustumCulled = false;

  const swallows = new SwallowFlock({ count: opts.swallows, centerX: center.x, centerZ: center.z });
  const swallowGeo = makeSwallowGeometry();
  const swallowKit = makeFlapMaterial(SWALLOW_HINGE);
  swallowKit.frequency.value = 9;
  const swallowMesh = new InstancedMesh(swallowGeo, swallowKit.material, opts.swallows);
  swallowMesh.frustumCulled = false;

  scene.add(fishMesh, glints.mesh, mayMesh, swallowMesh);

  let skein: GooseSkein | null = null;
  let gooseMesh: InstancedMesh | null = null;
  let gooseGeo: ReturnType<typeof makeGooseGeometry> | null = null;
  let gooseKit: ReturnType<typeof makeFlapMaterial> | null = null;
  if (opts.geese) {
    skein = new GooseSkein({ centerX: 0, centerZ: 120, range: 420, altitude: 42 });
    gooseGeo = makeGooseGeometry();
    gooseKit = makeFlapMaterial(GOOSE_HINGE);
    gooseKit.frequency.value = 3.4;
    gooseKit.glide.value = 0.25;
    gooseMesh = new InstancedMesh(gooseGeo, gooseKit.material, skein.geese.length);
    gooseMesh.frustumCulled = false;
    scene.add(gooseMesh);
  }

  let eagle: EaglePatrol | null = null;
  let eagleMesh: InstancedMesh | null = null;
  let eagleGeo: ReturnType<typeof makeEagleGeometry> | null = null;
  let eagleKit: ReturnType<typeof makeFlapMaterial> | null = null;
  if (opts.eagle) {
    eagle = new EaglePatrol();
    eagleGeo = makeEagleGeometry();
    eagleKit = makeFlapMaterial(EAGLE_HINGE);
    eagleKit.frequency.value = 1.4;
    eagleKit.glide.value = 0.85;
    eagleMesh = new InstancedMesh(eagleGeo, eagleKit.material, 1);
    eagleMesh.frustumCulled = false;
    scene.add(eagleMesh);
  }

  return {
    school,
    hatch,
    swallows,
    update(dt, t, hour, sunIntensity) {
      const hi = hatchIntensity(hour);

      hatch.update(dt, t, hour);
      const food = hatch.surfaceFood();
      school.update(dt, t, {
        hunger: Math.max(0.06, hi),
        food,
        onEat: (i) => hatch.eat(food[i]),
      });
      swallows.params.activity = 0.12 + 0.85 * hi;
      swallows.update(dt, t);
      skein?.update(dt, t);
      eagle?.update(dt, t);

      fillFishInstances(fishMesh, school.fish);
      fillMayflyInstances(mayMesh, hatch.flies, 5);
      for (let i = 0; i < swallows.birds.length; i++) {
        const b = swallows.birds[i];
        swallowMesh.setMatrixAt(i, setBirdMatrix(_m, b.position, b.velocity, b.bank));
      }
      swallowMesh.count = swallows.birds.length;
      swallowMesh.instanceMatrix.needsUpdate = true;
      if (skein && gooseMesh) {
        for (let i = 0; i < skein.geese.length; i++) {
          const g = skein.geese[i];
          gooseMesh.setMatrixAt(i, setBirdMatrix(_m, g.position, g.velocity, g.bank));
        }
        gooseMesh.count = skein.geese.length;
        gooseMesh.instanceMatrix.needsUpdate = true;
      }
      if (eagle && eagleMesh) {
        eagleMesh.setMatrixAt(0, setBirdMatrix(_m, eagle.position, eagle.velocity, eagle.bank));
        eagleMesh.instanceMatrix.needsUpdate = true;
      }

      glints.intensity = Math.max(0.2, sunIntensity);
      glints.update(school.fish, t, -0.9);
      mayKit.setGlow(0.25 + goldenness(hour) * 0.9);
    },
    dispose() {
      scene.remove(fishMesh, glints.mesh, mayMesh, swallowMesh);
      fishGeo.dispose();
      fishKit.material.dispose();
      fishMesh.dispose();
      glints.dispose();
      mayGeo.dispose();
      mayKit.material.dispose();
      mayMesh.dispose();
      swallowGeo.dispose();
      swallowKit.material.dispose();
      swallowMesh.dispose();
      if (gooseMesh) {
        scene.remove(gooseMesh);
        gooseGeo?.dispose();
        gooseKit?.material.dispose();
        gooseMesh.dispose();
      }
      if (eagleMesh) {
        scene.remove(eagleMesh);
        eagleGeo?.dispose();
        eagleKit?.material.dispose();
        eagleMesh.dispose();
      }
    },
  };
}

// ---- the whole day -----------------------------------------------------------------------

export interface DayWorldOptions {
  /** Where the world reads its hour. Defaults to the spine clock outside. */
  hour: () => number;
  /** Where weather rain falls and mist drifts (usually the player). */
  focus?: () => { x: number; z: number };
  /** Run the hour-keyed front schedule (off = caller drives weather.set). */
  conductWeather?: boolean;
  /** Cloud raymarch steps; 0 skips the layer entirely. */
  cloudSteps?: number;
  terrain?: { coreSize: number; coreCells: number; extent: number } | null;
  water?: { coreSize: number; coreCells: number; extent: number };
  life?: DayLifeOptions | null;
  lifeCenter?: { x: number; z: number };
}

export interface DayWorld {
  atmosphere: Atmosphere;
  fog: HeightFog;
  weather: WeatherSystem;
  clouds: CloudLayer | null;
  moon: Moon;
  rings: RippleRings;
  school: FishSchool | null;
  hatch: HatchSwarm | null;
  swallows: SwallowFlock | null;
  /** hatchIntensity at the last update — readouts key off this. */
  hatchNow: number;
  update(dt: number, t: number): void;
  dispose(): void;
}

export function buildDayWorld(scene: Scene, options: DayWorldOptions): DayWorld {
  const hourFn = options.hour;
  const focus = options.focus ?? ((): { x: number; z: number } => ({ x: 0, z: 0 }));
  const conduct = options.conductWeather ?? true;
  const cloudSteps = options.cloudSteps ?? 14;
  const lifeCenter = options.lifeCenter ?? { x: 60, z: 300 };

  const startHour = hourFn();

  // -- sky stack -------------------------------------------------------------------
  const atmosphere = createAtmosphere(startHour);
  scene.add(atmosphere.makeDome(3800));
  const fog = createHeightFog({ airDensity: 1.05e-4, airHeight: 900, mistDensity: 0, mistHeight: 6.5 });
  const weather = new WeatherSystem({ focusRadius: 30 });
  const moon = new Moon({ distance: 3300 });
  scene.add(moon.group);

  let clouds: CloudLayer | null = null;
  if (cloudSteps > 0) {
    clouds = new CloudLayer({ steps: cloudSteps, lightSteps: 3, base: 700, top: 1500 });
    scene.add(clouds.makeDome());
  }

  // -- ground + water -----------------------------------------------------------------
  let terrain: ValleyTerrain | null = null;
  if (options.terrain !== null) {
    const td = options.terrain ?? { coreSize: 900, coreCells: 170, extent: 2800 };
    terrain = makeValleyTerrain({
      ...td,
      env: atmosphere,
      tint: (lit, world) =>
        fog.applyNode(lit, cameraPosition, world, {
          direction: atmosphere.sunDirection,
          color: atmosphere.sunColor.rgb,
        }),
    });
    scene.add(terrain.mesh);
  }

  const water = makeDayWater(
    atmosphere,
    fog,
    options.water ?? { coreSize: 600, coreCells: 200, extent: 2800 },
  );
  scene.add(water.mesh);

  let now = 0;
  const offBus = onDisturbance((d) => water.rings.add(d, now));

  // -- creature lights ------------------------------------------------------------------
  const sun = new DirectionalLight(0xffffff, 2);
  const hemi = new HemisphereLight(0x90a8c8, 0x222820, 0.6);
  scene.add(sun, hemi);

  // -- life --------------------------------------------------------------------------------
  const life = options.life ? buildDayLife(scene, lifeCenter, options.life) : null;

  const palette = createSkyPalette();
  const windAt = new Vector3();
  const moonFill = new Color(0x93a7d8);

  const world: DayWorld = {
    atmosphere,
    fog,
    weather,
    clouds,
    moon,
    rings: water.rings,
    school: life?.school ?? null,
    hatch: life?.hatch ?? null,
    swallows: life?.swallows ?? null,
    hatchNow: 0,

    update(dt: number, t: number) {
      now = t;
      const hour = hourFn();
      const f = focus();

      // one hour, pushed everywhere
      atmosphere.setHour(hour);
      moon.update(hour);
      skyColors(hour, palette);

      // weather: schedule → machine → sky + wind + rain
      if (conduct) weather.set(scheduledWeather(hour));
      weather.focusX = f.x;
      weather.focusZ = f.z;
      weather.update(dt);
      atmosphere.overcast.value = weather.overcast;
      atmosphere.flash.value = weather.flash;

      // fog: the palette's color, plus the dawn-mist schedule
      fog.fogColor.value.copy(palette.fog);
      fog.mistDensity.value = mistAmountForHour(hour) * 0.1;
      wind.sample(f.x, 3, f.z, t, windAt);
      fog.mistDrift.value.x -= windAt.x * dt;
      fog.mistDrift.value.y -= windAt.z * dt;

      // clouds ride the same wind and wear the same light
      if (clouds) {
        clouds.coverage.value = weather.cloudCover;
        const sc = atmosphere.sunColor.value;
        const sunLum = sc.r + sc.g + sc.b;
        if (sunLum > 0.05) {
          clouds.sunDirection.value.copy(atmosphere.sunDirection.value);
          clouds.sunColor.value.copy(sc);
        } else {
          clouds.sunDirection.value.copy(atmosphere.moonDirection.value);
          clouds.sunColor.value.copy(atmosphere.moonColor.value).multiplyScalar(30);
        }
        clouds.ambient.value.copy(palette.ambient).multiplyScalar(0.4 + palette.ambientIntensity);
        clouds.update(dt, t);
      }

      // creature lights from the palette (moonlight stands in after dark)
      const dim = 1 - 0.72 * weather.overcast;
      if (palette.sunIntensity > 0.03) {
        sun.color.copy(palette.sun);
        sun.intensity = (0.1 + palette.sunIntensity * 2.4) * dim;
        sun.position.copy(atmosphere.sunDirection.value).multiplyScalar(700);
        if (sun.position.y < 40) sun.position.y = 40;
      } else if (moonElevationDeg(hour) > 2) {
        sun.color.copy(moonFill);
        sun.intensity = 0.28 * dim;
        sun.position.copy(atmosphere.moonDirection.value).multiplyScalar(700);
      } else {
        sun.intensity = 0.04;
      }
      hemi.color.copy(palette.ambient);
      hemi.intensity = 0.18 + palette.ambientIntensity * 0.85;
      if (terrain) terrain.ambient.copy(palette.ambient).multiplyScalar(1.1);

      // water: drained body at night, whitecaps from the live wind
      water.bodyLight.value = 0.22 + palette.ambientIntensity * 1.3;
      water.whitecaps.value = Math.min(1, Math.max(0, (weather.windSpeed - 5) / 5));
      water.update(t);

      // the food chain, slaved to the hour
      world.hatchNow = hatchIntensity(hour);
      life?.update(dt, t, hour, palette.sunIntensity);
    },

    dispose() {
      offBus();
      life?.dispose();
      water.dispose();
      terrain?.dispose();
      clouds?.dispose();
      moon.dispose();
      atmosphere.dispose();
      scene.remove(sun, hemi, moon.group, water.mesh);
      sun.dispose();
      hemi.dispose();
    },
  };

  return world;
}
