// Demos for "Other Wings": the full evening airspace, a swallow's skim run
// up close, the V deriving itself from wingtip vortices, and the eagle's
// patrol — circle, climb, glide, repeat.

import { InstancedMesh, Matrix4, Vector3 } from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import {
  EAGLE_CIRCLE,
  EAGLE_HINGE,
  EaglePatrol,
  GOOSE_HINGE,
  GooseSkein,
  SWALLOW_HINGE,
  SWALLOW_SKIM,
  SwallowFlock,
  makeEagleGeometry,
  makeFlapMaterial,
  makeGooseGeometry,
  makeSwallowGeometry,
  setBirdMatrix,
  upwashOffset,
} from "../../lib/life";
import { addDusk, addLake, addTerrain, makeKit, OrbitRig, type Kit } from "./shared";

const BAY_X = 60;
const BAY_Z = 290;
const _m = new Matrix4();

// ---- builders ------------------------------------------------------------------------

function addSwallows(kit: Kit, flock: SwallowFlock): InstancedMesh {
  const geo = kit.trackGeo(makeSwallowGeometry());
  const flap = makeFlapMaterial(SWALLOW_HINGE);
  kit.track(flap.material);
  flap.frequency.value = 9;
  flap.amplitude.value = 1.1;
  flap.glide.value = 0.6; // swallows flap in bursts
  const mesh = new InstancedMesh(geo, flap.material, flock.birds.length);
  mesh.frustumCulled = false;
  kit.scene.add(mesh);
  return mesh;
}

function fillSwallows(mesh: InstancedMesh, flock: SwallowFlock, scale = 1): void {
  flock.birds.forEach((b, i) => {
    mesh.setMatrixAt(i, setBirdMatrix(_m, b.position, b.velocity, -b.bank, scale));
  });
  mesh.instanceMatrix.needsUpdate = true;
}

function addGeese(kit: Kit, skein: GooseSkein): InstancedMesh {
  const geo = kit.trackGeo(makeGooseGeometry());
  const flap = makeFlapMaterial(GOOSE_HINGE);
  kit.track(flap.material);
  flap.frequency.value = 3.4;
  flap.amplitude.value = 0.55;
  flap.glide.value = 0.1;
  const mesh = new InstancedMesh(geo, flap.material, skein.geese.length);
  mesh.frustumCulled = false;
  kit.scene.add(mesh);
  return mesh;
}

function fillGeese(mesh: InstancedMesh, skein: GooseSkein): void {
  skein.geese.forEach((g, i) => {
    mesh.setMatrixAt(i, setBirdMatrix(_m, g.position, g.velocity, -g.bank, 1));
  });
  mesh.instanceMatrix.needsUpdate = true;
}

function addEagle(kit: Kit): { mesh: InstancedMesh } {
  const geo = kit.trackGeo(makeEagleGeometry());
  const flap = makeFlapMaterial(EAGLE_HINGE);
  kit.track(flap.material);
  flap.frequency.value = 1.2;
  flap.amplitude.value = 0.05; // a soarer rocks, it doesn't row
  const mesh = new InstancedMesh(geo, flap.material, 1);
  mesh.frustumCulled = false;
  kit.scene.add(mesh);
  return { mesh };
}

function fillEagle(mesh: InstancedMesh, eagle: EaglePatrol): void {
  mesh.setMatrixAt(0, setBirdMatrix(_m, eagle.position, eagle.velocity, -eagle.bank, 1));
  mesh.instanceMatrix.needsUpdate = true;
}

// ---- hero: the evening airspace ---------------------------------------------------------

export async function mountFlocksHero(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { aspect: 0.5, fog: [250, 2400], far: 8000 });
  if (!kit) return gpuMissing(el);

  const dusk = addDusk(kit, 18.8);
  const lakeKit = addLake(kit, dusk, 700, 240);
  addTerrain(kit, 1400, 240, BAY_X, BAY_Z, 5);

  const swallows = new SwallowFlock({ count: 18, centerX: BAY_X, centerZ: BAY_Z, radius: 60, activity: 0.7 });
  const swallowMesh = addSwallows(kit, swallows);

  const skein = new GooseSkein({ centerX: BAY_X, centerZ: BAY_Z, range: 420, altitude: 42 });
  const gooseMesh = addGeese(kit, skein);

  const eagle = new EaglePatrol({ centerX: BAY_X - 80, centerZ: BAY_Z - 60 });
  const eagleKit = addEagle(kit);

  kit.shell.setInfo(
    () =>
      `${swallows.birds.length} swallows · ${skein.geese.length} geese · 1 eagle at ${eagle.position.y.toFixed(0)} m · 3 draw calls of birds`,
  );

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(BAY_X, 8, BAY_Z),
      radius: 110,
      polar: 0.16,
      azimuth: 2.3,
      autoSpin: 0.02,
      minPolar: 0.05,
      maxPolar: 0.7,
    }),
  );

  return kit.start((dt, t) => {
    swallows.update(dt, t);
    skein.update(dt, t);
    eagle.update(dt, t);
    // wide shot: a real 32 cm swallow is sub-pixel at 100 m — draw them 2.5×
    fillSwallows(swallowMesh, swallows, 2.5);
    fillGeese(gooseMesh, skein);
    fillEagle(eagleKit.mesh, eagle);
    lakeKit.update(t);
    orbit.update(kit.camera, dt);
  });
}

// ---- step 1: the skim run ------------------------------------------------------------------

export async function mountSkim(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { fog: [80, 900], far: 4000 });
  if (!kit) return gpuMissing(el);

  const dusk = addDusk(kit, 18.4);
  const lakeKit = addLake(kit, dusk, 300, 220);
  addTerrain(kit, 500, 160, BAY_X, BAY_Z, 4);

  const flock = new SwallowFlock({
    count: 6,
    centerX: BAY_X,
    centerZ: BAY_Z,
    radius: 30,
    activity: 1,
    loftHigh: 7,
  });
  const mesh = addSwallows(kit, flock);

  kit.shell.slider({
    label: "skim clearance (cm)",
    min: 3,
    max: 30,
    step: 1,
    value: 7,
    onInput: (v) => (flock.params.skimHeight = v / 100),
  });
  kit.shell.slider({
    label: "touch spacing (m)",
    min: 0.6,
    max: 5,
    step: 0.2,
    value: 1.7,
    onInput: (v) => (flock.params.touchSpacing = v),
  });
  kit.shell.setInfo(() => {
    const skimming = flock.birds.filter((b) => b.state === SWALLOW_SKIM).length;
    return `${skimming}/${flock.birds.length} on a run — each touch is a skim event on the bus`;
  });

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(BAY_X, 1, BAY_Z),
      radius: 26,
      polar: 0.14,
      azimuth: 1.2,
      autoSpin: 0.04,
      minPolar: 0.05,
      maxPolar: 0.8,
    }),
  );

  return kit.start((dt, t) => {
    flock.update(dt, t);
    fillSwallows(mesh, flock, 1.5);
    lakeKit.update(t);
    orbit.update(kit.camera, dt);
  });
}

// ---- step 2: the V derives itself -----------------------------------------------------------

export async function mountVee(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { fog: [200, 2200], far: 8000 });
  if (!kit) return gpuMissing(el);

  const dusk = addDusk(kit, 18.0);
  const lakeKit = addLake(kit, dusk, 800, 160);
  addTerrain(kit, 1400, 200, 0, 120, 5);

  const skein = new GooseSkein({ centerX: 0, centerZ: 120, range: 380, altitude: 40 });
  const mesh = addGeese(kit, skein);

  kit.shell.slider({
    label: "wingspan b (m)",
    min: 1.0,
    max: 2.2,
    step: 0.05,
    value: skein.params.span,
    onInput: (v) => (skein.params.span = v),
  });
  kit.shell.slider({
    label: "gap behind (m)",
    min: 1.2,
    max: 6,
    step: 0.2,
    value: skein.params.backStep,
    onInput: (v) => (skein.params.backStep = v),
  });
  kit.shell.button("vortex seeking: on", () => {
    skein.params.seekUpwash = !skein.params.seekUpwash;
    const btn = [...el.querySelectorAll<HTMLButtonElement>(".demo-button")].find((b) =>
      b.textContent?.startsWith("vortex seeking"),
    );
    if (btn) btn.textContent = `vortex seeking: ${skein.params.seekUpwash ? "on" : "off"}`;
  });
  kit.shell.setInfo(() => {
    const off = upwashOffset(skein.params);
    const half = Math.atan2(off, skein.params.backStep) * (180 / Math.PI);
    return skein.params.seekUpwash
      ? `slot: ${off.toFixed(2)} m outboard (πb/8 + b/2) → V half-angle ≈ ${half.toFixed(0)}°`
      : `no upwash seeking — just a queue`;
  });

  // chase the skein from above and behind
  const target = new Vector3();
  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target,
      radius: 42,
      polar: 0.5,
      azimuth: 1.0,
      autoSpin: 0.015,
      maxPolar: 1.3,
    }),
  );

  return kit.start((dt, t) => {
    skein.update(dt, t);
    fillGeese(mesh, skein);
    const lead = skein.geese[0].position;
    target.lerp(lead, Math.min(1, dt * 3));
    lakeKit.update(t);
    orbit.update(kit.camera, dt);
  });
}

// ---- step 3: the patrol -----------------------------------------------------------------------

export async function mountEagle(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { fog: [200, 2400], far: 8000 });
  if (!kit) return gpuMissing(el);

  const dusk = addDusk(kit, 18.5);
  const lakeKit = addLake(kit, dusk, 800, 160);
  addTerrain(kit, 1400, 220, 0, 120, 5);

  const eagle = new EaglePatrol({ centerX: 0, centerZ: 120, territory: 220 });
  const eagleKit = addEagle(kit);

  kit.shell.slider({
    label: "circle radius (m)",
    min: 20,
    max: 90,
    step: 2,
    value: eagle.params.circleRadius,
    onInput: (v) => (eagle.params.circleRadius = v),
  });
  kit.shell.setInfo(() => {
    const bankDeg = (eagle.bank * 180) / Math.PI;
    return eagle.state === EAGLE_CIRCLE
      ? `circling at ${eagle.position.y.toFixed(0)} m, bank ${bankDeg.toFixed(0)}° (tan φ = v²/gr)`
      : `gliding to the next thermal, ${eagle.position.y.toFixed(0)} m and falling`;
  });

  const target = new Vector3();
  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target,
      radius: 55,
      polar: 0.25,
      azimuth: 0.4,
      autoSpin: 0.02,
      maxPolar: 1.0,
    }),
  );

  return kit.start((dt, t) => {
    eagle.update(dt, t);
    fillEagle(eagleKit.mesh, eagle);
    target.lerp(eagle.position, Math.min(1, dt * 2));
    lakeKit.update(t);
    orbit.update(kit.camera, dt);
  });
}
