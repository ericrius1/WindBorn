// Demos for "The Dusk Event": the whole chain on screen at once, the hour
// as conductor, the food chain actually coupled (toggle predators and watch
// the mayfly population answer), and the budget that keeps it all at sixty.

import { InstancedMesh, Matrix4, Vector3 } from "three/webgpu";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { WorldClock, onDisturbance } from "../../lib/spine";
import {
  EaglePatrol,
  FLYING,
  FishSchool,
  GlintField,
  GooseSkein,
  HatchSwarm,
  SWALLOW_HINGE,
  SwallowFlock,
  fillFishInstances,
  fillMayflyInstances,
  fillVegetationInstances,
  goldenness,
  hatchIntensity,
  makeFishGeometry,
  makeFishMaterial,
  makeFlapMaterial,
  makeGrassBladeGeometry,
  makeMayflyGeometry,
  makeMayflyMaterial,
  makeReedGeometry,
  makeSwallowGeometry,
  makeSwayMaterial,
  scatterReeds,
  scatterShoreGrass,
  setBirdMatrix,
} from "../../lib/life";
import {
  addDusk,
  addEagleMesh,
  addGooseMesh,
  addLake,
  addTerrain,
  makeKit,
  OrbitRig,
  setDuskHour,
  type Kit,
} from "./shared";

const BAY_X = 60;
const BAY_Z = 330;
const _m = new Matrix4();

// ---- the full assembly, reusable by hero and budget demos -----------------------------------

interface DuskWorld {
  school: FishSchool;
  hatch: HatchSwarm;
  swallows: SwallowFlock;
  skein: GooseSkein;
  eagle: EaglePatrol;
  meshes: {
    fish: InstancedMesh;
    flies: InstancedMesh;
    swallows: InstancedMesh;
    geese: InstancedMesh;
    eagle: InstancedMesh;
    grass: InstancedMesh;
    reeds: InstancedMesh;
  };
  glints: GlintField;
  setGlow(a: number): void;
  updatePlants(t: number): void;
  counts(): string;
}

function buildDuskWorld(kit: Kit, fishCount: number, flyCapacity: number): DuskWorld {
  const school = new FishSchool({
    count: fishCount,
    homeX: BAY_X,
    homeZ: BAY_Z,
    homeRadius: 45,
    swimDepth: -1.0,
  });
  const fishGeo = kit.trackGeo(makeFishGeometry());
  const fishMat = makeFishMaterial();
  kit.track(fishMat.material);
  const fish = new InstancedMesh(fishGeo, fishMat.material, fishCount);
  fish.frustumCulled = false;
  kit.scene.add(fish);

  const glints = kit.track(new GlintField(fishCount));
  kit.scene.add(glints.mesh);

  const hatch = new HatchSwarm({ centerX: BAY_X, centerZ: BAY_Z, radius: 45, capacity: flyCapacity });
  const flyGeo = kit.trackGeo(makeMayflyGeometry());
  const flyMat = makeMayflyMaterial();
  kit.track(flyMat.material);
  const flies = new InstancedMesh(flyGeo, flyMat.material, flyCapacity);
  flies.frustumCulled = false;
  flies.count = 0;
  kit.scene.add(flies);

  const swallows = new SwallowFlock({ count: 14, centerX: BAY_X, centerZ: BAY_Z, radius: 55, activity: 0.8 });
  const swallowGeo = kit.trackGeo(makeSwallowGeometry());
  const swallowFlap = makeFlapMaterial(SWALLOW_HINGE);
  kit.track(swallowFlap.material);
  swallowFlap.frequency.value = 9;
  swallowFlap.amplitude.value = 1.1;
  swallowFlap.glide.value = 0.6;
  const swallowMesh = new InstancedMesh(swallowGeo, swallowFlap.material, swallows.birds.length);
  swallowMesh.frustumCulled = false;
  kit.scene.add(swallowMesh);

  const skein = new GooseSkein({ centerX: BAY_X, centerZ: BAY_Z - 60, range: 420, altitude: 45 });
  const geese = addGooseMesh(kit, skein.geese.length);

  const eagle = new EaglePatrol({ centerX: BAY_X - 90, centerZ: BAY_Z - 120 });
  const eagleMesh = addEagleMesh(kit);

  const grassPlacements = scatterShoreGrass({ extent: 70, cell: 0.7 });
  const grassGeo = kit.trackGeo(makeGrassBladeGeometry());
  const grassSway = makeSwayMaterial({ probeX: BAY_X, probeZ: BAY_Z + 40 });
  kit.track(grassSway.material);
  const grass = new InstancedMesh(grassGeo, grassSway.material, Math.max(1, grassPlacements.length));
  fillVegetationInstances(grass, grassPlacements);
  grass.frustumCulled = false;
  kit.scene.add(grass);

  const reedPlacements = scatterReeds({ extent: 70 });
  const reedGeo = kit.trackGeo(makeReedGeometry());
  const reedSway = makeSwayMaterial({ compliance: 0.016, exponent: 1.6, probeX: BAY_X, probeZ: BAY_Z + 40 });
  kit.track(reedSway.material);
  const reeds = new InstancedMesh(reedGeo, reedSway.material, Math.max(1, reedPlacements.length));
  fillVegetationInstances(reeds, reedPlacements);
  reeds.frustumCulled = false;
  kit.scene.add(reeds);

  return {
    school,
    hatch,
    swallows,
    skein,
    eagle,
    meshes: { fish, flies, swallows: swallowMesh, geese, eagle: eagleMesh, grass, reeds },
    glints,
    setGlow: flyMat.setGlow,
    updatePlants: (t: number) => {
      grassSway.update(t);
      reedSway.update(t);
    },
    counts: () =>
      `${fishCount} fish · ${hatch.flies.length} mayflies · ${swallows.birds.length + skein.geese.length + 1} birds · ${(
        grassPlacements.length + reedPlacements.length
      ).toLocaleString()} plants`,
  };
}

function stepDuskWorld(world: DuskWorld, dt: number, t: number, hour: number): void {
  const intensity = hatchIntensity(hour);
  world.hatch.update(dt, t, hour);
  const food = world.hatch.surfaceFood();
  world.school.update(dt, t, {
    hunger: intensity,
    food,
    onEat: (i) => world.hatch.eat(food[i]),
  });
  world.swallows.params.activity = 0.25 + 0.75 * intensity;
  world.swallows.update(dt, t);
  world.skein.update(dt, t);
  world.eagle.update(dt, t);

  fillFishInstances(world.meshes.fish, world.school.fish);
  fillMayflyInstances(world.meshes.flies, world.hatch.flies, 6);
  world.swallows.birds.forEach((b, i) => {
    // wide shots: real swallows are sub-pixel at this range, draw them 2×
    world.meshes.swallows.setMatrixAt(i, setBirdMatrix(_m, b.position, b.velocity, -b.bank, 2));
  });
  world.meshes.swallows.instanceMatrix.needsUpdate = true;
  world.skein.geese.forEach((g, i) => {
    world.meshes.geese.setMatrixAt(i, setBirdMatrix(_m, g.position, g.velocity, -g.bank, 1));
  });
  world.meshes.geese.instanceMatrix.needsUpdate = true;
  world.meshes.eagle.setMatrixAt(0, setBirdMatrix(_m, world.eagle.position, world.eagle.velocity, -world.eagle.bank, 1));
  world.meshes.eagle.instanceMatrix.needsUpdate = true;
  world.glints.update(world.school.fish, t);
  world.setGlow(0.4 + 1.6 * intensity);
  world.updatePlants(t);
}

// ---- hero: the dusk event ----------------------------------------------------------------------

export async function mountDuskHero(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { aspect: 0.5, fog: [180, 1800], far: 7000 });
  if (!kit) return gpuMissing(el);

  const dusk = addDusk(kit, 17.8);
  const lakeKit = addLake(kit, dusk, 700, 240);
  addTerrain(kit, 1300, 240, BAY_X, BAY_Z, 5);

  const world = buildDuskWorld(kit, 180, 1800);

  const clock = new WorldClock(17.6);
  clock.speed = 12; // the whole evening in about two minutes

  let rises = 0;
  kit.track({ dispose: onDisturbance((d) => d.kind === "rise" && rises++) });

  kit.shell.setInfo(() => {
    const h = clock.hour;
    const hh = `${Math.floor(h)}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
    return `${hh} · hatch ${(hatchIntensity(h) * 100).toFixed(0)}% · ${rises} rises · ${world.hatch.flies.length} mayflies`;
  });

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(BAY_X, 2.5, BAY_Z),
      radius: 65,
      polar: 0.1,
      azimuth: 2.6,
      autoSpin: 0.015,
      minPolar: 0.04,
      maxPolar: 0.6,
    }),
  );

  return kit.start((dt, t) => {
    clock.advance(dt);
    if (clock.hour > 21.7 || clock.hour < 17.4) clock.setHour(17.6);
    const hour = clock.hour;
    setDuskHour(kit, dusk, hour);
    stepDuskWorld(world, dt, t, hour);
    lakeKit.update(t);
    orbit.update(kit.camera, dt);
  });
}

// ---- step 1: the conductor (plain canvas) -----------------------------------------------------------

export function mountConductor(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.52);
  const ctx = shell.canvas.getContext("2d")!;
  let hour = 18.4;

  shell.slider({
    label: "hour",
    min: 16,
    max: 22,
    step: 0.05,
    value: hour,
    format: (v) => `${Math.floor(v)}:${String(Math.floor((v % 1) * 60)).padStart(2, "0")}`,
    onInput: (v) => (hour = v),
  });
  shell.setInfo(() => `one input — clock.hour — four systems listening`);

  interface Track {
    label: string;
    color: string;
    fn(h: number): number;
  }
  const tracks: Track[] = [
    { label: "hatch intensity", color: "#e8b46a", fn: hatchIntensity },
    { label: "fish hunger", color: "#7fb6a0", fn: hatchIntensity },
    { label: "swallow activity", color: "#9aa6d0", fn: (h) => 0.25 + 0.75 * hatchIntensity(h) },
    { label: "golden light", color: "#e88a5a", fn: goldenness },
  ];

  return {
    frame: () => {
      const w = shell.canvas.width;
      const h = shell.canvas.height;
      ctx.clearRect(0, 0, w, h);
      const pad = w * 0.16;
      const plotW = w - pad - w * 0.05;
      const rowH = (h * 0.8) / tracks.length;
      const xAt = (hr: number): number => pad + ((hr - 16) / 6) * plotW;

      ctx.font = `${Math.round(h * 0.034)}px system-ui, sans-serif`;
      tracks.forEach((tr, row) => {
        const y0 = h * 0.08 + row * rowH;
        const y1 = y0 + rowH * 0.72;
        // curve
        ctx.beginPath();
        for (let i = 0; i <= 180; i++) {
          const hr = 16 + (i / 180) * 6;
          const x = xAt(hr);
          const y = y1 - tr.fn(hr) * (y1 - y0);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = tr.color;
        ctx.lineWidth = 2;
        ctx.stroke();
        // label + live value
        ctx.fillStyle = tr.color;
        ctx.textAlign = "right";
        ctx.fillText(tr.label, pad - 10, (y0 + y1) / 2);
        const v = tr.fn(hour);
        ctx.beginPath();
        ctx.arc(xAt(hour), y1 - v * (y1 - y0), 4, 0, Math.PI * 2);
        ctx.fill();
      });

      // the cursor
      ctx.strokeStyle = "rgba(240, 235, 220, 0.6)";
      ctx.beginPath();
      ctx.moveTo(xAt(hour), h * 0.05);
      ctx.lineTo(xAt(hour), h * 0.92);
      ctx.stroke();
      ctx.fillStyle = "rgba(200, 210, 225, 0.7)";
      ctx.textAlign = "center";
      for (let hr = 16; hr <= 22; hr++) ctx.fillText(`${hr}:00`, xAt(hr), h * 0.97);
      shell.tick();
    },
  };
}

// ---- step 2: the chain, coupled -------------------------------------------------------------------

export async function mountFoodChain(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { fog: [120, 1400], far: 5000 });
  if (!kit) return gpuMissing(el);

  const dusk = addDusk(kit, 19.4);
  const lakeKit = addLake(kit, dusk, 400, 200);
  addTerrain(kit, 600, 180, BAY_X, BAY_Z, 4);

  const hatch = new HatchSwarm({ centerX: BAY_X, centerZ: BAY_Z, radius: 35, capacity: 1400 });
  const flyGeo = kit.trackGeo(makeMayflyGeometry());
  const flyMat = makeMayflyMaterial();
  kit.track(flyMat.material);
  flyMat.setGlow(1.6);
  const flies = new InstancedMesh(flyGeo, flyMat.material, 1400);
  flies.frustumCulled = false;
  kit.scene.add(flies);

  const school = new FishSchool({ count: 120, homeX: BAY_X, homeZ: BAY_Z, homeRadius: 35, swimDepth: -1.0, riseRate: 0.05 });
  const fishGeo = kit.trackGeo(makeFishGeometry());
  const fishMat = makeFishMaterial();
  kit.track(fishMat.material);
  const fishMesh = new InstancedMesh(fishGeo, fishMat.material, school.fish.length);
  fishMesh.frustumCulled = false;
  kit.scene.add(fishMesh);

  const swallows = new SwallowFlock({ count: 10, centerX: BAY_X, centerZ: BAY_Z, radius: 40, activity: 0.9, loftHigh: 8 });
  const swallowGeo = kit.trackGeo(makeSwallowGeometry());
  const swallowFlap = makeFlapMaterial(SWALLOW_HINGE);
  kit.track(swallowFlap.material);
  swallowFlap.frequency.value = 9;
  swallowFlap.amplitude.value = 1.1;
  const swallowMesh = new InstancedMesh(swallowGeo, swallowFlap.material, swallows.birds.length);
  swallowMesh.frustumCulled = false;
  kit.scene.add(swallowMesh);

  let fishOn = true;
  let swallowsOn = true;
  let eatenByFish = 0;
  let eatenBySwallows = 0;

  const toggleBtn = (label: string, get: () => boolean, set: (v: boolean) => void): void => {
    kit.shell.button(`${label}: on`, () => {
      set(!get());
      const btn = [...el.querySelectorAll<HTMLButtonElement>(".demo-button")].find((b) =>
        b.textContent?.startsWith(label),
      );
      if (btn) btn.textContent = `${label}: ${get() ? "on" : "off"}`;
    });
  };
  toggleBtn("fish", () => fishOn, (v) => (fishOn = v));
  toggleBtn("swallows", () => swallowsOn, (v) => (swallowsOn = v));
  kit.shell.setInfo(
    () =>
      `${hatch.flies.length} mayflies · fish ate ${eatenByFish} · swallows ate ${eatenBySwallows} — turn a predator off and watch the swarm bloom`,
  );

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(BAY_X, 1.5, BAY_Z),
      radius: 42,
      polar: 0.16,
      azimuth: 2.1,
      autoSpin: 0.025,
      minPolar: 0.06,
      maxPolar: 0.7,
    }),
  );

  return kit.start((dt, t) => {
    hatch.update(dt, t, 19.4);

    if (fishOn) {
      const food = hatch.surfaceFood();
      school.update(dt, t, {
        hunger: 0.9,
        food,
        onEat: (i) => {
          hatch.eat(food[i]);
          eatenByFish++;
        },
      });
    } else {
      school.update(dt, t);
    }
    fishMesh.visible = fishOn;

    swallowMesh.visible = swallowsOn;
    if (swallowsOn) {
      swallows.update(dt, t);
      // hawking: any swallow takes fliers it passes within a wing's reach
      for (const b of swallows.birds) {
        for (const f of hatch.flies) {
          if (f.stage !== FLYING) continue;
          const dx = f.x - b.position.x;
          const dy = f.y - b.position.y;
          const dz = f.z - b.position.z;
          if (dx * dx + dy * dy + dz * dz < 0.36) {
            hatch.eat(f);
            eatenBySwallows++;
            break;
          }
        }
      }
      swallows.birds.forEach((b, i) => {
        swallowMesh.setMatrixAt(i, setBirdMatrix(_m, b.position, b.velocity, -b.bank, 1.5));
      });
      swallowMesh.instanceMatrix.needsUpdate = true;
    }

    fillMayflyInstances(flies, hatch.flies, 5);
    fillFishInstances(fishMesh, school.fish);
    lakeKit.update(t);
    orbit.update(kit.camera, dt);
  });
}

// ---- step 3: holding sixty ---------------------------------------------------------------------------

export async function mountBudget(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { fog: [180, 1800], far: 7000 });
  if (!kit) return gpuMissing(el);

  const dusk = addDusk(kit, 19.0);
  const lakeKit = addLake(kit, dusk, 600, 220);
  addTerrain(kit, 1100, 220, BAY_X, BAY_Z, 5);

  const world = buildDuskWorld(kit, 200, 2200);

  const live = { fish: true, hatch: true, birds: true, plants: true };
  const toggle = (key: keyof typeof live, label: string): void => {
    kit.shell.button(`${label}: on`, () => {
      live[key] = !live[key];
      const btn = [...el.querySelectorAll<HTMLButtonElement>(".demo-button")].find((b) =>
        b.textContent?.startsWith(label),
      );
      if (btn) btn.textContent = `${label}: ${live[key] ? "on" : "off"}`;
      world.meshes.fish.visible = live.fish;
      world.glints.mesh.visible = live.fish;
      world.meshes.flies.visible = live.hatch;
      world.meshes.swallows.visible = live.birds;
      world.meshes.geese.visible = live.birds;
      world.meshes.eagle.visible = live.birds;
      world.meshes.grass.visible = live.plants;
      world.meshes.reeds.visible = live.plants;
    });
  };
  toggle("fish", "fish");
  toggle("hatch", "hatch");
  toggle("birds", "birds");
  toggle("plants", "plants");
  kit.shell.setInfo(world.counts);

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(BAY_X, 2, BAY_Z),
      radius: 70,
      polar: 0.13,
      azimuth: 2.5,
      autoSpin: 0.02,
      minPolar: 0.05,
      maxPolar: 0.7,
    }),
  );

  return kit.start((dt, t) => {
    stepDuskWorld(world, dt, t, 19.2);
    lakeKit.update(t);
    orbit.update(kit.camera, dt);
  });
}
