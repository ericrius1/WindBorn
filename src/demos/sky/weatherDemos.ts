// Demos for weather.html — the calm/breezy/storm machine, whitecaps, rain on
// the disturbance bus, and storm light. Part 4 of Air & Light.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicNodeMaterial,
  LineSegments,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Vector3,
} from "three/webgpu";
import {
  cameraPosition,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  reflect,
  smoothstep,
  time,
  uniform,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { disturb, onDisturbance, wind } from "../../lib/spine";
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
  WEATHER_TARGETS,
  WeatherSystem,
  createAtmosphere,
  createSkyPalette,
  fbm3,
  skyColors,
  sunDirection,
  CloudLayer,
  type WeatherKind,
} from "../../lib/sky";
import { addOrbit, makeCalmWater, makeTerrainMesh, skyCtx } from "./kit";

type NodeV3 = Node<"vec3">;

// ---- storm water: the calm recipe + whitecaps + rings -----------------------------------
// Same wave table as everywhere on the site, with two storm-era additions:
// choppiness follows the wind, and crests past a wind-gated threshold break
// into foam.

interface StormWaterOptions {
  env: {
    sunDirection: { value: Vector3 };
    sunColor: { value: Color };
    skyColor(dir: NodeV3): NodeV3;
  };
  rings?: RippleRings | null;
  size?: number;
  segments?: number;
}

function makeStormWater(options: StormWaterOptions) {
  const { env, rings = null, size = 1600, segments = 220 } = options;
  const geometry = new PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const waves = createWaveUniforms({ windSpeed: wind.speed });
  const overcast = uniform(0);
  const material = new MeshBasicNodeMaterial();

  // Vertices: long waves + any disturbance rings.
  let height = waveHeightNode(positionLocal.xz, waves, 3);
  if (rings) height = height.add(rings.contributionNode(positionLocal.xz, waves.time).x);
  material.positionNode = positionLocal.add(vec3(0, height, 0));

  // Fragment: analytic normal from the full table (+ rings).
  let slope = waveSlopeNode(positionWorld.xz, waves);
  if (rings) slope = slope.add(rings.contributionNode(positionWorld.xz, waves.time).yz);
  const nrm = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));
  const view = normalize(cameraPosition.sub(positionWorld));
  const fresnel = fresnelSchlick(nrm.dot(view).clamp(0, 1), f0FromIor(uniform(1.333)));

  const sunDir = uniform(env.sunDirection.value);
  const sunC = uniform(env.sunColor.value);
  const r = reflect(view.negate(), nrm);
  const reflected = env.skyColor(normalize(vec3(r.x, r.y.max(0.02), r.z)));
  // The water body greens and darkens as the sky goes to storm.
  const body = mix(vec3(0.039, 0.145, 0.192), vec3(0.045, 0.085, 0.092), overcast);
  const glint = sunGlint(nrm, view, sunDir, uniform(0.1)).mul(fresnel.clamp(0.02, 1)).mul(sunC.rgb);
  let shaded: NodeV3 = mix(body, reflected, fresnel).add(glint);

  // ---- whitecaps -------------------------------------------------------------
  // Normalize crest height by the wind-scaled base amplitude, add slope (a
  // breaking crest is high AND steep), gate by wind speed — caps appear near
  // 4 m/s and multiply with the wind — and rough up the mask with animated
  // noise so foam is patches, not contour lines.
  const baseAmp = waves.windSpeed.mul(0.035).max(0.004);
  const hNorm = height.div(baseAmp); // ≈ −1..1 in table units
  const steep = slope.length().mul(2.2);
  const crest = hNorm.mul(0.55).add(steep);
  const gate = smoothstep(3.5, 9.5, waves.windSpeed);
  const foamNoise = fbm3(vec3(positionWorld.x.mul(0.21), time.mul(0.35), positionWorld.z.mul(0.21)), 2, 17);
  const foam = smoothstep(0.55, 1.05, crest)
    .mul(gate)
    .mul(foamNoise.mul(0.75).add(0.25))
    .clamp(0, 0.9);
  shaded = mix(shaded, vec3(0.92, 0.95, 0.97), foam);

  material.colorNode = shaded;

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    waves,
    overcast,
    update(t: number) {
      waves.time.value = t;
      waves.windDirection.value = wind.direction;
      waves.windSpeed.value = wind.speed;
      // Spectrum tilt: gusty wind piles energy into the short waves.
      waves.choppiness.value = 1 + Math.min(wind.speed * 0.09, 1.1);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ---- rain streaks ---------------------------------------------------------------------
// A pool of line segments falling through a box around the focus. The bus is
// the contract; these streaks are the garnish that makes the contract
// visible. `emitOnLand` makes each landing an honest disturb() — used by the
// rain demo, off in the hero (where the WeatherSystem already emits).

const MAX_DROPS = 600;

function makeRainRig(focus: { x: number; z: number; radius: number }, emitOnLand: boolean) {
  const positions = new Float32Array(MAX_DROPS * 2 * 3);
  const geometry = new BufferGeometry();
  const attr = new BufferAttribute(positions, 3);
  geometry.setAttribute("position", attr);
  const material = new LineBasicNodeMaterial({ transparent: true, opacity: 0.32 });
  material.color = new Color(0x9fb4c8);
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;

  const drops = Array.from({ length: MAX_DROPS }, () => ({
    x: 0,
    y: -1, // below water = dormant
    z: 0,
    alive: false,
  }));
  let landed = 0;

  const spawn = (d: (typeof drops)[number]): void => {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * focus.radius;
    d.x = focus.x + Math.cos(a) * r;
    d.z = focus.z + Math.sin(a) * r;
    d.y = 6 + Math.random() * 10;
    d.alive = true;
  };

  const windV = new Vector3();

  return {
    lines,
    get landed(): number {
      return landed;
    },
    /** `rate` in drops/s; the pool keeps roughly rate·fallTime drops alive. */
    update(dt: number, t: number, rate: number): void {
      const fallSpeed = 9.5;
      const want = Math.min(MAX_DROPS, Math.ceil((rate * 14) / fallSpeed));
      wind.sample(focus.x, 8, focus.z, t, windV);

      let alive = 0;
      for (const d of drops) {
        if (!d.alive) {
          if (alive < want && Math.random() < dt * 4) spawn(d);
          continue;
        }
        alive++;
        d.y -= fallSpeed * dt;
        d.x += windV.x * dt;
        d.z += windV.z * dt;
        if (d.y <= 0.02) {
          if (emitOnLand) {
            disturb({ kind: "rain", x: d.x, z: d.z, energy: 0.0008 + Math.random() * 0.0022, radius: 0.05 });
          }
          landed++;
          d.alive = false;
          d.y = -1;
          if (alive <= want) spawn(d);
        }
      }

      // Write segments: a streak is the drop's last ~0.45 m of travel.
      let p = 0;
      for (const d of drops) {
        const y0 = d.alive ? d.y : -10;
        positions[p] = d.x;
        positions[p + 1] = y0;
        positions[p + 2] = d.z;
        positions[p + 3] = d.x - windV.x * 0.05;
        positions[p + 4] = y0 + 0.45;
        positions[p + 5] = d.z - windV.z * 0.05;
        p += 6;
      }
      attr.needsUpdate = true;
      material.opacity = Math.min(0.4, rate / 320 + 0.08);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ---- hero: the front arrives ---------------------------------------------------------------

export async function mountWeatherHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { aspect: 0.5, fov: 46, far: 9000, renderScale: 0.66 });

  const hour = 13.2;
  const atm = createAtmosphere(hour, { stars: false });
  ctx.scene.add(atm.makeDome());

  const clouds = new CloudLayer({ steps: 16, lightSteps: 4 });
  ctx.scene.add(clouds.makeDome());
  const pal = createSkyPalette();
  skyColors(hour, pal);
  sunDirection(hour, clouds.sunDirection.value);

  const rings = new RippleRings();
  const water = makeStormWater({ env: atm, rings });
  ctx.scene.add(water.mesh);

  const weather = new WeatherSystem({ focusRadius: 26 });
  weather.auto = true;

  const rain = makeRainRig({ x: 0, z: 0, radius: 26 }, false);
  ctx.scene.add(rain.lines);

  let now = 0;
  let busEvents = 0;
  const offBus = onDisturbance((d) => {
    busEvents++;
    rings.add(d, now);
  });

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 2.5, 0),
    distance: 30,
    polar: 0.18,
    azimuth: -2.3,
    maxPolar: 0.9,
    drift: 0.003,
  });

  const force = (k: WeatherKind): void => {
    weather.set(k);
    weather.auto = false;
  };
  ctx.shell.button("calm", () => force("calm"));
  ctx.shell.button("breezy", () => force("breezy"));
  ctx.shell.button("storm", () => force("storm"));
  ctx.shell.button("auto cycle", () => (weather.auto = true));
  ctx.shell.setInfo(
    () =>
      `${weather.state}${weather.auto ? " (auto)" : ""} · wind ${weather.windSpeed.toFixed(1)} m/s · ` +
      `overcast ${(weather.overcast * 100).toFixed(0)}% · rain ${weather.rainRate.toFixed(0)}/s · bus ${busEvents}`,
  );

  ctx.onDispose(() => {
    offBus();
    atm.dispose();
    clouds.dispose();
    water.dispose();
    rain.dispose();
    orbit.dispose();
    wind.speed = 3;
    wind.gustiness = 0.45;
  });
  return ctx.finish((t, dt) => {
    now = t;
    weather.update(dt);
    atm.overcast.value = weather.overcast;
    atm.flash.value = weather.flash;
    clouds.coverage.value = weather.cloudCover;
    clouds.sunColor.value.copy(atm.sunColor.value);
    clouds.ambient.value
      .copy(pal.ambient)
      .multiplyScalar((0.55 + pal.ambientIntensity * 1.3) * (1 - weather.overcast * 0.55));
    clouds.update(dt, t);
    water.overcast.value = weather.overcast;
    water.update(t);
    rain.update(dt, t, weather.rainRate);
    orbit.update(dt);
  });
}

// ---- Step 1: the machine itself (canvas 2D — no GPU needed) -----------------------------------

export function mountStateMachine(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.5);
  const c = shell.canvas.getContext("2d");
  const weather = new WeatherSystem({ driveWind: false });
  weather.auto = true;

  const force = (k: WeatherKind): void => {
    weather.set(k);
    weather.auto = false;
  };
  shell.button("calm", () => force("calm"));
  shell.button("breezy", () => force("breezy"));
  shell.button("storm", () => force("storm"));
  shell.button("auto cycle", () => (weather.auto = true));
  shell.setInfo(() => `${weather.state}${weather.auto ? " (auto)" : ""} · targets ease, never snap`);

  let last = performance.now();

  const states: WeatherKind[] = ["calm", "breezy", "storm"];

  return {
    frame() {
      const nowMs = performance.now();
      const dt = Math.min((nowMs - last) / 1000, 0.1);
      last = nowMs;
      weather.update(dt);
      if (!c) return;

      const w = shell.canvas.width;
      const h = shell.canvas.height;
      const s = w / 900; // design units
      c.clearRect(0, 0, w, h);
      c.fillStyle = "#06070b";
      c.fillRect(0, 0, w, h);

      // State nodes.
      const y = h * 0.3;
      const xs = [0.22, 0.5, 0.78].map((f) => f * w);
      c.strokeStyle = "#2a2f42";
      c.lineWidth = 2 * s;
      c.beginPath();
      c.moveTo(xs[0] + 54 * s, y);
      c.lineTo(xs[2] - 54 * s, y);
      c.stroke();

      states.forEach((k, i) => {
        const active = weather.state === k;
        c.beginPath();
        c.arc(xs[i], y, 44 * s, 0, Math.PI * 2);
        c.fillStyle = active ? "#1c2742" : "#0e1320";
        c.fill();
        c.strokeStyle = active ? "#7aa2ff" : "#3a4054";
        c.lineWidth = (active ? 3 : 1.5) * s;
        c.stroke();
        c.fillStyle = active ? "#d7dbe6" : "#8a91a5";
        c.font = `600 ${15 * s}px ui-sans-serif, system-ui`;
        c.textAlign = "center";
        c.fillText(k, xs[i], y + 5 * s);
      });

      // Eased value bars vs their targets.
      const target = WEATHER_TARGETS[weather.state];
      const rows: [string, number, number, number][] = [
        ["wind m/s", weather.windSpeed, target.windSpeed, 14],
        ["gustiness", weather.gustiness, target.gustiness, 1],
        ["overcast", weather.overcast, target.overcast, 1],
        ["rain /s", weather.rainRate, target.rainRate, 300],
      ];
      const bx = w * 0.14;
      const bw = w * 0.72;
      rows.forEach(([name, value, tgt, max], i) => {
        const by = h * (0.52 + i * 0.11);
        c.fillStyle = "#8a91a5";
        c.font = `${12 * s}px ui-monospace, Menlo, monospace`;
        c.textAlign = "left";
        c.fillText(name, bx, by - 6 * s);
        c.fillStyle = "#1a1e2c";
        c.fillRect(bx, by, bw, 10 * s);
        // Target tick.
        c.fillStyle = "#ffb86b";
        c.fillRect(bx + (tgt / max) * bw - 1.5 * s, by - 3 * s, 3 * s, 16 * s);
        // Live value.
        c.fillStyle = "#7aa2ff";
        c.fillRect(bx, by, (Math.min(value, max) / max) * bw, 10 * s);
        c.fillStyle = "#d7dbe6";
        c.textAlign = "right";
        c.fillText(value.toFixed(value < 10 ? 2 : 0), bx + bw + 6 * s + 40 * s, by + 9 * s);
      });

      shell.tick();
    },
  };
}

// ---- Step 2: whitecaps --------------------------------------------------------------------------

const BEAUFORT: [number, string][] = [
  [0.5, "calm — glassy"],
  [1.5, "light air — ripples"],
  [3.3, "light breeze — small wavelets"],
  [5.5, "gentle breeze — scattered whitecaps"],
  [7.9, "moderate breeze — frequent whitecaps"],
  [10.7, "fresh breeze — many whitecaps, some spray"],
  [13.8, "strong breeze — streaking foam"],
];

export async function mountWhitecaps(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { fov: 48, far: 9000 });

  const atm = createAtmosphere(11.5, { stars: false });
  ctx.scene.add(atm.makeDome());

  const water = makeStormWater({ env: atm, size: 1200, segments: 220 });
  ctx.scene.add(water.mesh);

  wind.speed = 7;

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.6, 0),
    distance: 16,
    polar: 0.2,
    azimuth: -2.4,
    maxPolar: 1.0,
  });

  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 14,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.setInfo(() => {
    const name = BEAUFORT.find(([cap]) => wind.speed <= cap)?.[1] ?? "near gale";
    return `${wind.speed.toFixed(1)} m/s · ${name}`;
  });

  ctx.onDispose(() => {
    atm.dispose();
    water.dispose();
    orbit.dispose();
    wind.speed = 3;
  });
  return ctx.finish((t, dt) => {
    water.update(t);
    orbit.update(dt);
  });
}

// ---- Step 3: rain on the bus ----------------------------------------------------------------------

export async function mountRainRings(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { fov: 48, far: 9000 });

  const atm = createAtmosphere(7.6, { stars: false });
  ctx.scene.add(atm.makeDome());

  const rings = new RippleRings();
  const water = makeStormWater({ env: atm, rings, size: 1200, segments: 200 });
  ctx.scene.add(water.mesh);
  wind.speed = 1.2; // near-calm, so the rings read

  const rain = makeRainRig({ x: 0, z: 0, radius: 18 }, true);
  ctx.scene.add(rain.lines);

  let now = 0;
  let busEvents = 0;
  const offBus = onDisturbance((d) => {
    busEvents++;
    rings.add(d, now);
  });

  let rate = 60;
  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.8, 0),
    distance: 14,
    polar: 0.3,
    azimuth: -2.4,
    maxPolar: 1.1,
  });

  ctx.shell.slider({
    label: "rain rate (drops/s)",
    min: 0,
    max: 300,
    step: 5,
    value: rate,
    onInput: (v) => (rate = v),
  });
  ctx.shell.setInfo(() => `bus events: ${busEvents} · landed: ${rain.landed} · two readers, one channel`);

  ctx.onDispose(() => {
    offBus();
    atm.dispose();
    water.dispose();
    rain.dispose();
    orbit.dispose();
    wind.speed = 3;
  });
  return ctx.finish((t, dt) => {
    now = t;
    water.update(t);
    rain.update(dt, t, rate);
    orbit.update(dt);
  });
}

// ---- Step 4: storm light ----------------------------------------------------------------------------

export async function mountStormLight(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { fov: 46, far: 9000 });

  const hour = 14.5;
  const atm = createAtmosphere(hour, { stars: false });
  ctx.scene.add(atm.makeDome());

  const pal = createSkyPalette();
  skyColors(hour, pal);
  const ambient = new Color().copy(pal.ambient).multiplyScalar(0.45 + pal.ambientIntensity);
  const terrain = makeTerrainMesh({
    size: 3400,
    segments: 160,
    sunDirection: atm.sunDirection,
    sunColor: atm.sunColor,
    ambient: { value: ambient },
  });
  ctx.scene.add(terrain.mesh);

  const water = makeCalmWater({ env: atm, size: 1000, segments: 128 });
  ctx.scene.add(water.mesh);

  let overcast = 0;
  let flash = 0;
  const baseSun = atm.sunColor.value.clone();
  const baseAmbient = ambient.clone();

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 3, 0),
    distance: 28,
    polar: 0.16,
    azimuth: -2.5,
    maxPolar: 0.8,
  });

  ctx.shell.slider({
    label: "overcast",
    min: 0,
    max: 1,
    step: 0.01,
    value: 0,
    onInput: (v) => (overcast = v),
  });
  ctx.shell.button("lightning", () => (flash = 1));
  ctx.shell.setInfo(
    () => `direct sun ×${(1 - 0.88 * overcast).toFixed(2)} · the world flattens before it darkens`,
  );

  ctx.onDispose(() => {
    atm.dispose();
    terrain.dispose();
    water.dispose();
    orbit.dispose();
  });
  return ctx.finish((t, dt) => {
    flash = Math.max(0, flash - dt * 2.4);
    atm.overcast.value = overcast;
    atm.flash.value = flash;
    // Overcast also starves the direct light the terrain and glints read.
    atm.sunColor.value.copy(baseSun).multiplyScalar(1 - 0.88 * overcast + flash * 1.5);
    ambient.copy(baseAmbient).multiplyScalar(1 - 0.45 * overcast + flash * 2);
    water.update(t, false);
    orbit.update(dt);
  });
}
