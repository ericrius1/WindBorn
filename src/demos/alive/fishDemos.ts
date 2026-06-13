// Demos for "The Fish": the underwater school over real bathymetry, the
// three boids rules in a clean tank, depth preference against the shore
// profile, and the payoff — glints on the surface where fish cruise shallow.

import {
  Color,
  DoubleSide,
  InstancedMesh,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Vector2,
  Vector3,
} from "three/webgpu";
import { color, mix, positionWorld, smoothstep } from "three/tsl";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { terrainGrid } from "../../lib/terrain";
import { createWaveUniforms, waveSlopeNode } from "../../lib/water";
import {
  FishSchool,
  GlintField,
  fillFishInstances,
  makeFishGeometry,
  makeFishMaterial,
  type BottomSampler,
} from "../../lib/life";
import { addDusk, addLake, addTerrain, makeKit, OrbitRig, type Kit } from "./shared";

// The school's home bay: north shore, off the reed flats, where the bed
// shelves from 0 to ~12 m inside a hundred meters.
const BAY_X = 60;
const BAY_Z = 300;

// ---- underwater dressing -------------------------------------------------------

/** Blue-green water haze + a shimmering ceiling seen from below. */
function dressUnderwater(kit: Kit): { update(t: number): void } {
  kit.scene.fog!.color.set("#1c4045");
  (kit.scene.fog as { near: number }).near = 4;
  (kit.scene.fog as { far: number }).far = 60;
  kit.scene.background = new Color("#173a40");
  kit.sun.intensity = 2.2;
  kit.sun.position.set(80, 300, 40);
  kit.hemi.intensity = 1.1;
  kit.hemi.color.set("#7fb6c0");
  kit.hemi.groundColor.set("#13282b");

  // the surface from below: bright sky through the water, broken by the
  // same ambient wave table the spine reports — light bands slide as waves do
  const u = createWaveUniforms();
  const geo = kit.trackGeo(new PlaneGeometry(600, 600, 1, 1));
  geo.rotateX(Math.PI / 2); // normal points down: visible from below
  const mat = kit.track(new MeshBasicNodeMaterial());
  mat.side = DoubleSide;
  mat.fog = false;
  const slope = waveSlopeNode(positionWorld.xz, u);
  const shimmer = slope.x.add(slope.y).mul(30).add(1).clamp(0.4, 2.4);
  const base = mix(
    color("#2a6570"),
    color("#bfe5e2"),
    smoothstep(0, 140, positionWorld.xz.length()).oneMinus(),
  );
  mat.colorNode = base.mul(shimmer);
  const ceiling = new Mesh(geo, mat);
  ceiling.position.y = -0.02;
  kit.scene.add(ceiling);

  return {
    update(t: number): void {
      u.time.value = t;
    },
  };
}

function addSchoolMesh(kit: Kit, school: FishSchool): InstancedMesh {
  const geo = kit.trackGeo(makeFishGeometry());
  const matKit = makeFishMaterial();
  kit.track(matKit.material);
  const mesh = new InstancedMesh(geo, matKit.material, school.fish.length);
  mesh.frustumCulled = false;
  kit.scene.add(mesh);
  return mesh;
}

// ---- hero: the school in the bay ----------------------------------------------------

export async function mountFishHero(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { aspect: 0.5, fog: [4, 60], far: 1000 });
  if (!kit) return gpuMissing(el);

  const water = dressUnderwater(kit);
  addTerrain(kit, 500, 220, BAY_X, BAY_Z, 2);

  const school = new FishSchool({ count: 260, homeX: BAY_X, homeZ: BAY_Z, homeRadius: 50 });
  const mesh = addSchoolMesh(kit, school);

  kit.shell.setInfo(() => `${school.fish.length} fish · 3 rules + 1 lakebed`);

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(BAY_X, -4, BAY_Z),
      radius: 28,
      polar: 0.02,
      azimuth: 2.2,
      autoSpin: 0.04,
      minPolar: -0.28,
      maxPolar: 0.1,
    }),
  );

  return kit.start((dt, t) => {
    school.update(dt, t);
    fillFishInstances(mesh, school.fish);
    water.update(t);
    orbit.update(kit.camera, dt);
    // keep the camera below the film — this scene lives underwater
    if (kit.camera.position.y > -0.6) kit.camera.position.y = -0.6;
  });
}

// ---- step 1: the three rules in a tank -----------------------------------------------

/** A flat 10 m deep tank: no bathymetry, no shore — only the rules. */
const FLAT_TANK: BottomSampler = {
  heightAt: () => -10,
  gradientAt: (_x: number, _z: number, target = new Vector2()) => target.set(0, 0),
};

export async function mountBoidsTank(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { fog: [10, 90], far: 400 });
  if (!kit) return gpuMissing(el);

  const water = dressUnderwater(kit);

  const school = new FishSchool(
    {
      count: 140,
      homeX: 0,
      homeZ: 0,
      homeRadius: 14,
      homeWeight: 0.5,
      swimDepth: -4,
      minColumnDepth: 0,
      maxColumnDepth: 100,
    },
    FLAT_TANK,
  );
  const mesh = addSchoolMesh(kit, school);

  const p = school.params;
  kit.shell.slider({
    label: "separation",
    min: 0,
    max: 3,
    step: 0.1,
    value: p.separationWeight,
    onInput: (v) => (p.separationWeight = v),
  });
  kit.shell.slider({
    label: "alignment",
    min: 0,
    max: 3,
    step: 0.1,
    value: p.alignmentWeight,
    onInput: (v) => (p.alignmentWeight = v),
  });
  kit.shell.slider({
    label: "cohesion",
    min: 0,
    max: 3,
    step: 0.1,
    value: p.cohesionWeight,
    onInput: (v) => (p.cohesionWeight = v),
  });
  kit.shell.button("scatter", () => {
    for (const f of school.fish) {
      f.position.x += (Math.random() - 0.5) * 24;
      f.position.z += (Math.random() - 0.5) * 24;
      f.position.y = -2 - Math.random() * 6;
    }
  });
  kit.shell.setInfo(() => {
    // mean nearest-neighbor distance: the school's "grip"
    let sum = 0;
    const fs = school.fish;
    for (let i = 0; i < fs.length; i += 4) {
      let best = Infinity;
      for (let j = 0; j < fs.length; j++) {
        if (i === j) continue;
        const d = fs[i].position.distanceToSquared(fs[j].position);
        if (d < best) best = d;
      }
      sum += Math.sqrt(best);
    }
    return `${fs.length} fish · mean nearest neighbor ${(sum / Math.ceil(fs.length / 4)).toFixed(2)} m`;
  });

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(0, -4.5, 0),
      radius: 24,
      polar: 0.04,
      azimuth: 0.6,
      autoSpin: 0.05,
      minPolar: -0.3,
      maxPolar: 0.12,
    }),
  );

  return kit.start((dt, t) => {
    school.update(dt, t);
    fillFishInstances(mesh, school.fish);
    water.update(t);
    orbit.update(kit.camera, dt);
    if (kit.camera.position.y > -0.6) kit.camera.position.y = -0.6;
  });
}

// ---- step 2: depth preference over the shelf ---------------------------------------------

export async function mountDepthPreference(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { fog: [6, 110], far: 1000 });
  if (!kit) return gpuMissing(el);

  const water = dressUnderwater(kit);
  addTerrain(kit, 420, 200, BAY_X, BAY_Z + 40, 2);

  const school = new FishSchool({
    count: 180,
    homeX: BAY_X,
    homeZ: BAY_Z,
    homeRadius: 70,
    homeWeight: 0.15,
  });
  const mesh = addSchoolMesh(kit, school);
  const p = school.params;

  kit.shell.slider({
    label: "comfort: shallow edge (m)",
    min: 0.5,
    max: 8,
    step: 0.5,
    value: p.minColumnDepth,
    onInput: (v) => (p.minColumnDepth = Math.min(v, p.maxColumnDepth - 0.5)),
  });
  kit.shell.slider({
    label: "comfort: deep edge (m)",
    min: 3,
    max: 26,
    step: 0.5,
    value: p.maxColumnDepth,
    onInput: (v) => (p.maxColumnDepth = Math.max(v, p.minColumnDepth + 0.5)),
  });
  kit.shell.slider({
    label: "depth steering",
    min: 0,
    max: 2,
    step: 0.1,
    value: p.depthWeight,
    onInput: (v) => (p.depthWeight = v),
  });

  const grid = terrainGrid();
  kit.shell.setInfo(() => {
    let inBand = 0;
    for (const f of school.fish) {
      const column = -grid.heightAt(f.position.x, f.position.z);
      if (column >= p.minColumnDepth && column <= p.maxColumnDepth) inBand++;
    }
    return `${inBand}/${school.fish.length} fish over comfortable bottom — they hold the contour, not a point`;
  });

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(BAY_X, -5, BAY_Z + 20),
      radius: 62,
      polar: 0.02,
      azimuth: -1.2,
      autoSpin: 0.03,
      minPolar: -0.2,
      maxPolar: 0.07,
    }),
  );

  return kit.start((dt, t) => {
    school.update(dt, t);
    fillFishInstances(mesh, school.fish);
    water.update(t);
    orbit.update(kit.camera, dt);
    if (kit.camera.position.y > -0.6) kit.camera.position.y = -0.6;
  });
}

// ---- step 3: glints — the telegraph -----------------------------------------------------------

export async function mountGlints(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { fog: [200, 1800], far: 6000 });
  if (!kit) return gpuMissing(el);

  const dusk = addDusk(kit, 19.0);
  const lakeKit = addLake(kit, dusk, 500, 220);
  addTerrain(kit, 900, 200, BAY_X, BAY_Z, 4);

  // shallow cruisers: the school pushed up the water column
  const school = new FishSchool({
    count: 160,
    homeX: BAY_X,
    homeZ: BAY_Z,
    homeRadius: 45,
    swimDepth: -0.45,
    surfaceMargin: 0.12,
    minColumnDepth: 1,
    maxColumnDepth: 7,
  });
  const glints = kit.track(new GlintField(200));
  kit.scene.add(glints.mesh);

  kit.shell.slider({
    label: "cruise depth (m)",
    min: 0.2,
    max: 3,
    step: 0.05,
    value: 0.45,
    onInput: (v) => (school.params.swimDepth = -v),
  });
  kit.shell.slider({
    label: "hour",
    min: 17,
    max: 20.4,
    step: 0.1,
    value: 19.0,
    onInput: (v) => {
      dusk.setHour(v);
      dusk.apply(kit.sun, kit.hemi, null);
    },
  });
  kit.shell.setInfo(
    () => `${glints.mesh.count} glints on the surface — every one is a fish you could hunt`,
  );

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(BAY_X, 0, BAY_Z),
      radius: 75,
      polar: 0.14,
      azimuth: 2.5,
      autoSpin: 0.03,
      minPolar: 0.06,
      maxPolar: 0.7,
    }),
  );

  return kit.start((dt, t) => {
    school.update(dt, t);
    glints.update(school.fish, t);
    lakeKit.update(t);
    orbit.update(kit.camera, dt);
  });
}
