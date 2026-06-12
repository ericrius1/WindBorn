// Demos for "The Forest": one conifer, a hundred thousand of them, the
// scatter rules that decide where they stand, and the snags that publish
// perch data for the rest of the game.

import {
  CircleGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three/webgpu";
import { color, float, hash, instanceIndex, mix, positionLocal, sin, time, uniform, vec3, vertexColor } from "three/tsl";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { wind } from "../../lib/spine";
import {
  defaultForest,
  makeConiferGeometry,
  makeSnagGeometry,
  makeBoulderGeometry,
  makeTuftGeometry,
  NEST_SNAG,
  perchPoints,
  scatterBoulders,
  scatterForest,
  scatterTufts,
  terrainHeightNode,
  terrainSurfaceColor,
  hash2,
  type SnagPlacement,
  type TreePlacement,
} from "../../lib/terrain";
import { makeDisplacedMaterial, makeGridGeometry, makeKit, makeWater, OrbitRig, type Kit } from "./shared";

// ---- shared bits -------------------------------------------------------------------

// position+scale+yaw → column-major Matrix4, without an Object3D middleman
const setInstance = (
  m: Matrix4,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  yaw = 0,
): Matrix4 => {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return m.set(c * sx, 0, s * sz, x, 0, sy, 0, y, -s * sx, 0, c * sz, z, 0, 0, 0, 1);
};

interface TreeMaterialKit {
  material: MeshStandardNodeMaterial;
  /** Per-frame: sync sway direction/amplitude with the spine wind field. */
  update(t: number): void;
}

// Vertex-colored conifer material with wind sway: the canopy leans along
// the wind uniform, more with height² (unit-space, so taller instances sway
// proportionally more in meters). Per-instance phase and tint come free
// from hash(instanceIndex) — no extra attributes.
function makeTreeMaterial(kit: Kit): TreeMaterialKit {
  const uDir = uniform(new Vector2(1, 0));
  const uAmp = uniform(0.012);

  const material = kit.track(new MeshStandardNodeMaterial());
  const ph = hash(float(instanceIndex).add(1234.5));
  const yy = positionLocal.y.max(0);
  const sway = sin(time.mul(1.7).add(ph.mul(6.283))).mul(0.5).add(0.5);
  const lean = uAmp.mul(yy.mul(yy)).mul(sway);
  material.positionNode = positionLocal.add(vec3(lean.mul(uDir.x), 0, lean.mul(uDir.y)));

  const tint = hash(float(instanceIndex).add(777.7));
  const bright = hash(float(instanceIndex).add(15.3)).mul(0.3).add(0.82);
  material.colorNode = vertexColor()
    .mul(mix(vec3(1.05, 1.0, 0.9), vec3(0.84, 1.02, 0.88), tint))
    .mul(bright);
  material.roughnessNode = float(0.9);
  material.metalnessNode = float(0);

  const sample = new Vector3();
  return {
    material,
    update(t: number): void {
      wind.sample(0, 25, 0, t, sample);
      const speed = Math.hypot(sample.x, sample.z);
      if (speed > 1e-4) uDir.value.set(sample.x / speed, sample.z / speed);
      uAmp.value = 0.004 * speed;
    },
  };
}

function fillTreeInstances(mesh: InstancedMesh, placements: TreePlacement[]): void {
  const m = new Matrix4();
  const count = Math.min(placements.length, mesh.instanceMatrix.count);
  for (let i = 0; i < count; i++) {
    const p = placements[i];
    const w = p.scale * (0.82 + 0.36 * p.rand);
    mesh.setMatrixAt(i, setInstance(m, p.x, p.y, p.z, w, p.scale, w));
  }
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
}

function addSnags(kit: Kit, snags: SnagPlacement[], material: MeshStandardNodeMaterial): InstancedMesh | null {
  if (snags.length === 0) return null;
  const { geometry } = makeSnagGeometry();
  kit.trackGeo(geometry);
  const mesh = new InstancedMesh(geometry, material, snags.length);
  const m = new Matrix4();
  snags.forEach((s, i) => mesh.setMatrixAt(i, setInstance(m, s.x, s.y, s.z, s.scale, s.scale, s.scale, s.yaw)));
  mesh.frustumCulled = false;
  kit.scene.add(mesh);
  return mesh;
}

function makeSnagMaterial(kit: Kit): MeshStandardNodeMaterial {
  const mat = kit.track(new MeshStandardNodeMaterial());
  mat.colorNode = vertexColor();
  mat.roughnessNode = float(0.95);
  mat.metalnessNode = float(0);
  return mat;
}

// ---- hero: the forested valley ----------------------------------------------------------

export async function mountForestHero(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { aspect: 0.5, far: 16000 });
  if (!kit) return gpuMissing(el);

  // terrain + water
  const geo = kit.trackGeo(makeGridGeometry(3000, 320));
  const terrainMat = kit.track(
    makeDisplacedMaterial({
      height: (xz) => terrainHeightNode(xz),
      eps: 5,
      makeColor: ({ world, normal }) => terrainSurfaceColor(world, normal, {}),
    }),
  );
  const terrain = new Mesh(geo, terrainMat);
  terrain.frustumCulled = false;
  kit.scene.add(terrain);
  kit.scene.add(makeWater(kit));

  // the canonical forest
  const forest = defaultForest();
  const treeGeo = kit.trackGeo(makeConiferGeometry());
  const treeMat = makeTreeMaterial(kit);
  const trees = new InstancedMesh(treeGeo, treeMat.material, forest.trees.length);
  fillTreeInstances(trees, forest.trees);
  trees.frustumCulled = false;
  kit.scene.add(trees);

  addSnags(kit, forest.snags.concat(NEST_SNAG), makeSnagMaterial(kit));

  // ground scatter: boulders on the talus, tufts in the meadows
  const boulders = scatterBoulders();
  const boulderGeo = kit.trackGeo(makeBoulderGeometry());
  const boulderMat = makeSnagMaterial(kit);
  const boulderMesh = new InstancedMesh(boulderGeo, boulderMat, boulders.length);
  {
    const m = new Matrix4();
    boulders.forEach((b, i) =>
      boulderMesh.setMatrixAt(i, setInstance(m, b.x, b.y, b.z, b.scale, b.scale * (0.7 + 0.5 * b.rand), b.scale, b.yaw)),
    );
  }
  boulderMesh.frustumCulled = false;
  kit.scene.add(boulderMesh);

  const tufts = scatterTufts();
  const tuftGeo = kit.trackGeo(makeTuftGeometry());
  const tuftMat = makeTreeMaterial(kit); // same sway, tinier amplitude via scale
  const tuftMesh = new InstancedMesh(tuftGeo, tuftMat.material, tufts.length);
  {
    const m = new Matrix4();
    tufts.forEach((g, i) => tuftMesh.setMatrixAt(i, setInstance(m, g.x, g.y, g.z, g.scale, g.scale, g.scale, g.yaw)));
  }
  tuftMesh.frustumCulled = false;
  kit.scene.add(tuftMesh);

  const total = forest.trees.length + forest.snags.length + boulders.length + tufts.length;
  kit.shell.setInfo(() => `${forest.trees.length.toLocaleString()} trees · ${total.toLocaleString()} instances in 5 draw calls`);

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(0, 50, 0),
      radius: 1250,
      polar: 0.3,
      azimuth: 1.4,
      autoSpin: 0.02,
    }),
  );
  return kit.start((dt, t) => {
    treeMat.update(t);
    tuftMat.update(t);
    orbit.update(kit.camera, dt);
  });
}

// ---- step 1: one conifer ------------------------------------------------------------------

export async function mountOneConifer(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { fog: null, far: 500 });
  if (!kit) return gpuMissing(el);

  const groundGeo = kit.trackGeo(new CircleGeometry(14, 24));
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = kit.track(new MeshStandardNodeMaterial());
  groundMat.colorNode = color("#42502f");
  kit.scene.add(new Mesh(groundGeo, groundMat));

  const mat = kit.track(new MeshStandardNodeMaterial());
  mat.colorNode = vertexColor();
  mat.roughnessNode = float(0.9);

  let geometry = makeConiferGeometry(3);
  const tree = new Mesh(geometry, mat);
  tree.scale.setScalar(10);
  kit.scene.add(tree);
  kit.track({ dispose: () => geometry.dispose() });

  kit.shell.slider({
    label: "canopy tiers",
    min: 1,
    max: 5,
    step: 1,
    value: 3,
    onInput: (v) => {
      const next = makeConiferGeometry(v);
      tree.geometry = next;
      geometry.dispose();
      geometry = next;
    },
  });
  kit.shell.slider({ label: "height (m)", min: 4, max: 16, step: 0.5, value: 10, onInput: (v) => tree.scale.setScalar(v) });
  kit.shell.button("wireframe", () => (mat.wireframe = !mat.wireframe));
  kit.shell.setInfo(() => `${(geometry.index ? geometry.index.count / 3 : 0).toFixed(0)} triangles — the whole tree`);

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, { target: new Vector3(0, 5.5, 0), radius: 26, polar: 0.25, azimuth: 0.7, autoSpin: 0.12 }),
  );
  return kit.start((dt) => orbit.update(kit.camera, dt));
}

// ---- step 2: a hundred thousand ---------------------------------------------------------------

export async function mountInstancing(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { fog: [600, 2600], far: 8000 });
  if (!kit) return gpuMissing(el);

  const groundGeo = kit.trackGeo(makeGridGeometry(1700, 2));
  const groundMat = kit.track(new MeshStandardNodeMaterial());
  groundMat.colorNode = color("#3f4a33");
  kit.scene.add(new Mesh(groundGeo, groundMat));

  const MAX = 150000;
  const treeGeo = kit.trackGeo(makeConiferGeometry());
  const treeMat = makeTreeMaterial(kit);
  const mesh = new InstancedMesh(treeGeo, treeMat.material, MAX);
  mesh.frustumCulled = false;
  kit.scene.add(mesh);

  // a jittered grid big enough for MAX trees, filled once
  {
    const m = new Matrix4();
    const side = Math.ceil(Math.sqrt(MAX));
    const pitch = 1600 / side;
    for (let i = 0; i < MAX; i++) {
      const gx = i % side;
      const gz = Math.floor(i / side);
      const x = -800 + (gx + hash2(gx, gz, 11)) * pitch;
      const z = -800 + (gz + hash2(gx, gz, 12)) * pitch;
      const s = 6 + 7 * hash2(gx, gz, 13);
      const w = s * (0.82 + 0.36 * hash2(gx, gz, 14));
      mesh.setMatrixAt(i, setInstance(m, x, 0, z, w, s, w));
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  mesh.count = 10000;
  kit.shell.slider({
    label: "trees",
    min: 1000,
    max: MAX,
    step: 1000,
    value: 10000,
    onInput: (v) => (mesh.count = v),
  });
  const trisPer = treeGeo.index ? treeGeo.index.count / 3 : 0;
  kit.shell.setInfo(
    () => `${mesh.count.toLocaleString()} trees · ${((mesh.count * trisPer) / 1e6).toFixed(1)}M triangles · 1 draw call`,
  );

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, { target: new Vector3(0, 12, 0), radius: 620, polar: 0.32, azimuth: 0.3, autoSpin: 0.03 }),
  );
  return kit.start((dt, t) => {
    treeMat.update(t);
    orbit.update(kit.camera, dt);
  });
}

// ---- step 3: where trees grow -------------------------------------------------------------------

export async function mountScatterRules(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { far: 16000 });
  if (!kit) return gpuMissing(el);

  const geo = kit.trackGeo(makeGridGeometry(2400, 300));
  const terrainMat = kit.track(
    makeDisplacedMaterial({
      height: (xz) => terrainHeightNode(xz),
      eps: 4,
      makeColor: ({ world, normal }) => terrainSurfaceColor(world, normal, {}),
    }),
  );
  const terrain = new Mesh(geo, terrainMat);
  terrain.frustumCulled = false;
  kit.scene.add(terrain);
  kit.scene.add(makeWater(kit, 6000, 0.8));

  const MAX = 170000;
  const treeGeo = kit.trackGeo(makeConiferGeometry());
  const treeMat = makeTreeMaterial(kit);
  const mesh = new InstancedMesh(treeGeo, treeMat.material, MAX);
  mesh.frustumCulled = false;
  kit.scene.add(mesh);

  const rules = { useAltitude: true, useSlope: true, useClump: true, density: 1 };
  let planted = 0;
  const replant = (): void => {
    const data = scatterForest({ cell: 5, extent: 1000, ...rules });
    fillTreeInstances(mesh, data.trees.concat(data.snags));
    planted = Math.min(MAX, data.trees.length + data.snags.length);
  };
  replant();

  const toggle = (key: "useAltitude" | "useSlope" | "useClump", label: string) => {
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
  kit.shell.setInfo(() => `${planted.toLocaleString()} trees pass the rules`);

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, { target: new Vector3(0, 40, 0), radius: 1150, polar: 0.5, azimuth: -1.1, autoSpin: 0.02 }),
  );
  return kit.start((dt, t) => {
    treeMat.update(t);
    orbit.update(kit.camera, dt);
  });
}

// ---- step 4: snags and perch data -----------------------------------------------------------------

export async function mountPerches(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { far: 9000, fog: [500, 3500] });
  if (!kit) return gpuMissing(el);

  const cx = NEST_SNAG.x;
  const cz = NEST_SNAG.z;

  const geo = kit.trackGeo(makeGridGeometry(1000, 256, cx, cz));
  const terrainMat = kit.track(
    makeDisplacedMaterial({
      height: (xz) => terrainHeightNode(xz),
      eps: 3,
      makeColor: ({ world, normal }) => terrainSurfaceColor(world, normal, {}),
    }),
  );
  const terrain = new Mesh(geo, terrainMat);
  terrain.frustumCulled = false;
  kit.scene.add(terrain);
  kit.scene.add(makeWater(kit, 4000, 0.82));

  // nearby live forest for context
  const forest = defaultForest();
  const near = (p: { x: number; z: number }, r: number): boolean => (p.x - cx) ** 2 + (p.z - cz) ** 2 < r * r;
  const localTrees = forest.trees.filter((p) => near(p, 460));
  const treeGeo = kit.trackGeo(makeConiferGeometry());
  const treeMat = makeTreeMaterial(kit);
  const trees = new InstancedMesh(treeGeo, treeMat.material, Math.max(1, localTrees.length));
  fillTreeInstances(trees, localTrees);
  trees.frustumCulled = false;
  kit.scene.add(trees);

  // snags, nest included
  const localSnags = forest.snags.filter((p) => near(p, 460)).concat(NEST_SNAG);
  addSnags(kit, localSnags, makeSnagMaterial(kit));

  // perch markers: every published perch point in range, pulsing
  const perches = perchPoints();
  const localPerches = perches.filter((p) => near(p, 460));
  const markGeo = kit.trackGeo(new SphereGeometry(0.55, 8, 6));
  const markMat = kit.track(new MeshStandardNodeMaterial());
  markMat.colorNode = color("#ffd58a");
  markMat.emissiveNode = color("#ffb86b").mul(sin(time.mul(2.4)).mul(0.5).add(1.2));
  const marks = new InstancedMesh(markGeo, markMat, Math.max(1, localPerches.length));
  {
    const m = new Matrix4();
    localPerches.forEach((p, i) => marks.setMatrixAt(i, setInstance(m, p.x, p.y + 0.5, p.z, 1, 1, 1)));
  }
  marks.frustumCulled = false;
  kit.scene.add(marks);

  kit.shell.setInfo(
    () => `${perches.length} perch points published valley-wide · ${localPerches.length} in view · big spar = the nest`,
  );

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(cx, NEST_SNAG.y + 14, cz),
      radius: 130,
      polar: 0.22,
      azimuth: 2.2,
      autoSpin: 0.05,
    }),
  );
  return kit.start((dt, t) => {
    treeMat.update(t);
    orbit.update(kit.camera, dt);
  });
}
