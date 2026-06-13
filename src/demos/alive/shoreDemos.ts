// Demos for "The Shore": one blade and its bend, the wind connection (one
// field moves water and meadow alike), the placement rules, and the
// assembled golden-hour shoreline.

import { CircleGeometry, InstancedMesh, Mesh, MeshStandardNodeMaterial, Vector3 } from "three/webgpu";
import { color } from "three/tsl";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { wind } from "../../lib/spine";
import {
  fillVegetationInstances,
  makeGrassBladeGeometry,
  makeReedGeometry,
  makeSwayMaterial,
  scatterReeds,
  scatterShoreGrass,
} from "../../lib/life";
import { addDusk, addLake, addTerrain, makeKit, OrbitRig, type Kit } from "./shared";

// The reed flats: where the north-shore meadow walks into the water.
const SHORE_X = 60;
const SHORE_Z = 372;

/** Sliders write the page-shared wind; put it back when the demo dies. */
function guardWind(kit: Kit): void {
  const speed = wind.speed;
  const gustiness = wind.gustiness;
  kit.track({
    dispose: () => {
      wind.speed = speed;
      wind.gustiness = gustiness;
    },
  });
}

interface VegLayerOpts {
  compliance?: number;
  exponent?: number;
  strawiness?: number;
}

function addGrassLayer(
  kit: Kit,
  placements: ReturnType<typeof scatterShoreGrass>,
  opts: VegLayerOpts = {},
): { mesh: InstancedMesh; update(t: number): void } {
  const geo = kit.trackGeo(makeGrassBladeGeometry());
  const sway = makeSwayMaterial({
    compliance: opts.compliance ?? 0.045,
    exponent: opts.exponent ?? 2,
    strawiness: opts.strawiness ?? 0.5,
    probeX: SHORE_X,
    probeZ: SHORE_Z,
  });
  kit.track(sway.material);
  const mesh = new InstancedMesh(geo, sway.material, Math.max(1, placements.length));
  fillVegetationInstances(mesh, placements);
  mesh.frustumCulled = false;
  kit.scene.add(mesh);
  return { mesh, update: sway.update };
}

function addReedLayer(
  kit: Kit,
  placements: ReturnType<typeof scatterReeds>,
): { mesh: InstancedMesh; update(t: number): void } {
  const geo = kit.trackGeo(makeReedGeometry());
  const sway = makeSwayMaterial({
    compliance: 0.016,
    exponent: 1.6,
    strawiness: 0.25,
    probeX: SHORE_X,
    probeZ: SHORE_Z,
  });
  kit.track(sway.material);
  const mesh = new InstancedMesh(geo, sway.material, Math.max(1, placements.length));
  fillVegetationInstances(mesh, placements);
  mesh.frustumCulled = false;
  kit.scene.add(mesh);
  return { mesh, update: sway.update };
}

// ---- hero: the shoreline assembled ---------------------------------------------------------

export async function mountShoreHero(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { aspect: 0.5, fog: [120, 1500], far: 6000 });
  if (!kit) return gpuMissing(el);

  const dusk = addDusk(kit, 18.6);
  const lakeKit = addLake(kit, dusk, 600, 220);
  addTerrain(kit, 700, 240, SHORE_X, SHORE_Z - 30, 3);

  const grassPlacements = scatterShoreGrass();
  const grass = addGrassLayer(kit, grassPlacements);
  const reedPlacements = scatterReeds();
  const reeds = addReedLayer(kit, reedPlacements);

  kit.shell.slider({
    label: "wind (m/s)",
    min: 0.5,
    max: 9,
    step: 0.25,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  guardWind(kit);
  kit.shell.setInfo(
    () =>
      `${grassPlacements.length.toLocaleString()} blades · ${reedPlacements.length.toLocaleString()} reeds · 2 draw calls of plants`,
  );

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(SHORE_X, 2, SHORE_Z),
      radius: 42,
      polar: 0.16,
      azimuth: -1.8,
      autoSpin: 0.025,
      minPolar: 0.06,
      maxPolar: 0.8,
    }),
  );

  return kit.start((dt, t) => {
    grass.update(t);
    reeds.update(t);
    lakeKit.update(t);
    orbit.update(kit.camera, dt);
  });
}

// ---- step 1: one blade, then ten thousand ----------------------------------------------------

export async function mountBlade(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { fog: null, far: 400 });
  if (!kit) return gpuMissing(el);
  kit.scene.background = null;
  kit.sun.position.set(-80, 60, 40);
  kit.sun.color.set("#ffe2b0");

  const groundGeo = kit.trackGeo(new CircleGeometry(16, 28));
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = kit.track(new MeshStandardNodeMaterial());
  groundMat.colorNode = color("#4a4434");
  kit.scene.add(new Mesh(groundGeo, groundMat));

  // a dense local patch on flat ground: jittered grid, deterministic
  const placements: { x: number; y: number; z: number; scale: number; yaw: number; rand: number }[] = [];
  const side = 100;
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
      const r = h - Math.floor(h);
      const x = -14 + (i + r) * (28 / side);
      const z = -14 + (j + (r * 7) % 1) * (28 / side);
      if (x * x + z * z > 15 * 15) continue;
      placements.push({ x, y: 0, z, scale: 0.22 + 0.3 * r, yaw: r * Math.PI * 2, rand: r });
    }
  }
  const grass = addGrassLayer(kit, placements);

  kit.shell.slider({
    label: "wind (m/s)",
    min: 0,
    max: 10,
    step: 0.25,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  kit.shell.slider({
    label: "gustiness",
    min: 0,
    max: 1,
    step: 0.05,
    value: wind.gustiness,
    onInput: (v) => (wind.gustiness = v),
  });
  guardWind(kit);
  kit.shell.setInfo(() => `${placements.length.toLocaleString()} blades · 1 draw call · bend ∝ height²`);

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(0, 0.4, 0),
      radius: 9,
      polar: 0.18,
      azimuth: 0.7,
      autoSpin: 0.05,
      maxPolar: 1.0,
    }),
  );

  return kit.start((dt, t) => {
    grass.update(t);
    orbit.update(kit.camera, dt);
  });
}

// ---- step 2: the placement rules ----------------------------------------------------------------

export async function mountShorePlacement(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { fog: [120, 1200], far: 5000 });
  if (!kit) return gpuMissing(el);

  const dusk = addDusk(kit, 17.5);
  const lakeKit = addLake(kit, dusk, 500, 160);
  addTerrain(kit, 600, 220, SHORE_X, SHORE_Z - 30, 3);

  const MAX = 90000;
  const grassGeo = kit.trackGeo(makeGrassBladeGeometry());
  const grassSway = makeSwayMaterial({ probeX: SHORE_X, probeZ: SHORE_Z });
  kit.track(grassSway.material);
  const grassMesh = new InstancedMesh(grassGeo, grassSway.material, MAX);
  grassMesh.frustumCulled = false;
  kit.scene.add(grassMesh);

  const reedGeo = kit.trackGeo(makeReedGeometry());
  const reedSway = makeSwayMaterial({ compliance: 0.016, exponent: 1.6, probeX: SHORE_X, probeZ: SHORE_Z });
  kit.track(reedSway.material);
  const reedMesh = new InstancedMesh(reedGeo, reedSway.material, 30000);
  reedMesh.frustumCulled = false;
  kit.scene.add(reedMesh);

  const rules = { useAltitude: true, useSlope: true, useClump: true, density: 1 };
  let grassCount = 0;
  let reedCount = 0;
  const replant = (): void => {
    const g = scatterShoreGrass({ ...rules, extent: 80 });
    fillVegetationInstances(grassMesh, g);
    grassCount = Math.min(g.length, MAX);
    const r = scatterReeds({ density: rules.density, extent: 80 });
    fillVegetationInstances(reedMesh, r);
    reedCount = r.length;
  };
  replant();

  const toggle = (key: "useAltitude" | "useSlope" | "useClump", label: string): void => {
    kit.shell.button(`${label}: on`, () => {
      rules[key] = !rules[key];
      const btn = [...el.querySelectorAll<HTMLButtonElement>(".demo-button")].find((b) =>
        b.textContent?.startsWith(label),
      );
      if (btn) btn.textContent = `${label}: ${rules[key] ? "on" : "off"}`;
      replant();
    });
  };
  toggle("useAltitude", "altitude band");
  toggle("useSlope", "slope limit");
  toggle("useClump", "clumping");
  kit.shell.slider({
    label: "density",
    min: 0.1,
    max: 1,
    step: 0.05,
    value: 1,
    onInput: (v) => {
      rules.density = v;
      replant();
    },
  });
  kit.shell.setInfo(() => `${grassCount.toLocaleString()} blades on land · ${reedCount.toLocaleString()} reeds in the shallows`);

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(SHORE_X, 3, SHORE_Z - 10),
      radius: 90,
      polar: 0.35,
      azimuth: -1.6,
      autoSpin: 0.02,
      maxPolar: 1.0,
    }),
  );

  return kit.start((dt, t) => {
    grassSway.update(t);
    reedSway.update(t);
    lakeKit.update(t);
    orbit.update(kit.camera, dt);
  });
}

// ---- step 3: one weather ---------------------------------------------------------------------------

export async function mountOneWeather(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { fog: [100, 1200], far: 5000 });
  if (!kit) return gpuMissing(el);

  const dusk = addDusk(kit, 18.2);
  const lakeKit = addLake(kit, dusk, 400, 220);
  addTerrain(kit, 450, 200, SHORE_X, SHORE_Z - 20, 3);

  const grass = addGrassLayer(kit, scatterShoreGrass({ extent: 60 }));
  const reeds = addReedLayer(kit, scatterReeds({ extent: 60 }));

  kit.shell.slider({
    label: "wind (m/s)",
    min: 0.5,
    max: 10,
    step: 0.25,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  kit.shell.slider({
    label: "direction (°)",
    min: 0,
    max: 360,
    step: 5,
    value: (wind.direction * 180) / Math.PI,
    onInput: (v) => (wind.direction = (v * Math.PI) / 180),
  });
  guardWind(kit);
  kit.track({
    dispose: (() => {
      const dir = wind.direction;
      return () => (wind.direction = dir);
    })(),
  });
  kit.shell.setInfo(() => `wind ${wind.speed.toFixed(1)} m/s — ripples and meadow read the same field`);

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(SHORE_X, 1.5, SHORE_Z - 4),
      radius: 30,
      polar: 0.2,
      azimuth: -2.0,
      autoSpin: 0.03,
      minPolar: 0.08,
      maxPolar: 0.9,
    }),
  );

  return kit.start((dt, t) => {
    grass.update(t);
    reeds.update(t);
    lakeKit.update(t);
    orbit.update(kit.camera, dt);
  });
}
