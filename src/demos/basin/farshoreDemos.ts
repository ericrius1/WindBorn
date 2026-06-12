// Demos for "The Far Shore": the vertex-budget problem, clipmap rings,
// seam morphing, snapping, and a flight across kilometers of valley.

import { Mesh, MeshStandardNodeMaterial, SphereGeometry, Vector3 } from "three/webgpu";
import { color, float, mix, positionLocal, uniform, vec3 } from "three/tsl";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { ClipmapTerrain, terrainHeightAt, terrainHeightNode, terrainNormalNode } from "../../lib/terrain";
import { elevationTint, makeGridGeometry, makeKit, makeWater, OrbitRig } from "./shared";
import { transformNormalToView, varying } from "three/tsl";

// ---- hero: the flight to the far shore --------------------------------------------

export async function mountFarshoreHero(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { aspect: 0.5, fog: [1600, 7500], far: 20000, fov: 55 });
  if (!kit) return gpuMissing(el);

  const clipmap = kit.track(
    new ClipmapTerrain({
      cells: 96,
      baseCell: 1.5,
      levels: 7,
      makeColor: ({ world, normal }) => elevationTint(world, normal),
    }),
  );
  kit.scene.add(clipmap.group);
  kit.scene.add(makeWater(kit, 16000));

  const halfExtent = (96 * 1.5 * 2 ** 6) / 2;
  kit.shell.setInfo(
    () => `${(clipmap.vertexCount / 1000).toFixed(0)}k verts cover ±${(halfExtent / 1000).toFixed(1)} km`,
  );

  // A slow circuit: out over the rim, back across the lake.
  const pos = new Vector3();
  const ahead = new Vector3();
  return kit.start((_dt, t) => {
    const a = t * 0.045;
    const r = 760 + 420 * Math.sin(a * 0.7);
    const alt = 200 + 120 * Math.sin(a * 1.3 + 1.0);
    pos.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    pos.y = Math.max(terrainHeightAt(pos.x, pos.z) + 60, alt);
    const a2 = a + 0.22;
    const r2 = 760 + 420 * Math.sin((a + 0.22) * 0.7);
    ahead.set(Math.cos(a2) * r2, pos.y - 60, Math.sin(a2) * r2);
    kit.camera.position.copy(pos);
    kit.camera.lookAt(ahead);
    clipmap.update(pos.x, pos.z);
  });
}

// ---- step 1: the budget problem ------------------------------------------------------

export async function mountBudget(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { far: 20000, fog: [2000, 12000] });
  if (!kit) return gpuMissing(el);

  const SEGS = 192;
  const uExtent = uniform(900);

  const mat = kit.track(new MeshStandardNodeMaterial());
  const xz = positionLocal.xz.mul(uExtent).toVar();
  const h = terrainHeightNode(xz);
  mat.positionNode = vec3(xz.x, h, xz.y);
  const eps = uExtent.div(SEGS); // one cell — shading honesty at every extent
  const vNormal = varying(terrainNormalNode(xz, eps));
  mat.normalNode = transformNormalToView(vNormal.normalize());
  mat.colorNode = vec3(0.6, 0.6, 0.62);
  mat.roughnessNode = float(0.95);
  mat.metalnessNode = float(0);

  const geo = kit.trackGeo(makeGridGeometry(1, SEGS));
  const terrain = new Mesh(geo, mat);
  terrain.frustumCulled = false;
  kit.scene.add(terrain);
  kit.scene.add(makeWater(kit, 16000, 0.75));

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, { target: new Vector3(0, 30, 0), radius: 900, polar: 0.42, azimuth: 1.9, autoSpin: 0.02 }),
  );

  kit.shell.slider({
    label: "covered extent (m)",
    min: 300,
    max: 6400,
    step: 50,
    value: 900,
    onInput: (v) => {
      uExtent.value = v;
      orbit.radius = Math.max(500, v * 0.62);
    },
  });
  kit.shell.button("wireframe", () => (mat.wireframe = !mat.wireframe));

  const vertCount = (SEGS + 1) ** 2;
  kit.shell.setInfo(() => {
    const ext = uExtent.value;
    const cell = ext / SEGS;
    const needed = (ext / 1.5) ** 2;
    return `${(vertCount / 1000).toFixed(0)}k verts · cell ${cell.toFixed(1)} m · uniform 1.5 m cells would need ${(needed / 1e6).toFixed(1)}M`;
  });

  return kit.start((dt) => orbit.update(kit.camera, dt));
}

// ---- step 2: rings of detail -----------------------------------------------------------

export async function mountRings(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { far: 16000, fog: null });
  if (!kit) return gpuMissing(el);

  const clipmap = kit.track(
    new ClipmapTerrain({
      cells: 64,
      baseCell: 3,
      levels: 5,
      makeColor: ({ levelTint }) => levelTint,
    }),
  );
  kit.scene.add(clipmap.group);

  // the focus marker the rings chase
  const markerGeo = kit.trackGeo(new SphereGeometry(10, 12, 8));
  const markerMat = kit.track(new MeshStandardNodeMaterial());
  markerMat.colorNode = color("#ffffff");
  markerMat.emissiveNode = color("#ffd58a").mul(1.4);
  const marker = new Mesh(markerGeo, markerMat);
  kit.scene.add(marker);

  let follow = true;
  kit.shell.button("hold / follow", () => (follow = !follow));
  kit.shell.button("wireframe", () => {
    wire = !wire;
    clipmap.setWireframe(wire);
  });
  let wire = false;

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, { target: new Vector3(0, 0, 0), radius: 1500, polar: 0.95, azimuth: 0.6, autoSpin: 0.015 }),
  );
  kit.shell.setInfo(
    () => `${clipmap.levels} levels · ${(clipmap.vertexCount / 1000).toFixed(0)}k verts · each ring doubles its cells`,
  );

  let cx = 0;
  let cz = 0;
  return kit.start((dt, t) => {
    if (follow) {
      cx = Math.sin(t * 0.12) * 540;
      cz = Math.cos(t * 0.085) * 420;
    }
    clipmap.update(cx, cz);
    marker.position.set(cx, terrainHeightAt(cx, cz) + 24, cz);
    orbit.target.set(cx, 0, cz);
    orbit.update(kit.camera, dt);
  });
}

// ---- step 3: seams, morphing, and skirts --------------------------------------------------

export async function mountSeams(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { far: 8000, fog: null });
  if (!kit) return gpuMissing(el);

  const clipmap = kit.track(
    new ClipmapTerrain({
      cells: 32,
      baseCell: 3,
      levels: 4,
      makeColor: ({ levelTint, normal }) => levelTint.mul(normal.y.mul(0.35).add(0.65)),
    }),
  );
  kit.scene.add(clipmap.group);

  // crack detector: a hot plane under the terrain — any pinhole flashes warm
  const detectorMat = kit.track(new MeshStandardNodeMaterial());
  detectorMat.colorNode = color("#000000");
  detectorMat.emissiveNode = color("#ff8585").mul(2);
  const detector = new Mesh(kit.trackGeo(makeGridGeometry(2000, 1)), detectorMat);
  detector.position.y = -60;
  kit.scene.add(detector);

  clipmap.morph.value = 0;
  clipmap.skirtDrop.value = 0;
  let morphOn = false;
  let skirtOn = false;
  kit.shell.button("morph: off", () => {
    morphOn = !morphOn;
    clipmap.morph.value = morphOn ? 1 : 0;
    relabel();
  });
  kit.shell.button("skirts: off", () => {
    skirtOn = !skirtOn;
    clipmap.skirtDrop.value = skirtOn ? 4 : 0;
    relabel();
  });
  const relabel = (): void => {
    const btns = el.querySelectorAll<HTMLButtonElement>(".demo-button");
    if (btns[0]) btns[0].textContent = `morph: ${morphOn ? "on" : "off"}`;
    if (btns[1]) btns[1].textContent = `skirts: ${skirtOn ? "on" : "off"}`;
  };

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, { target: new Vector3(48, 10, 0), radius: 190, polar: 0.18, azimuth: 2.9, autoSpin: 0.04, minPolar: 0.04 }),
  );
  kit.shell.setInfo(() => `grazing light over a level boundary · red pinholes = cracks`);

  let drift = 0;
  return kit.start((dt) => {
    drift += dt * 1.2;
    clipmap.update(Math.sin(drift * 0.11) * 14, 0);
    orbit.update(kit.camera, dt);
  });
}

// ---- step 4: standing still while moving ----------------------------------------------------

export async function mountSnap(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { far: 9000, fog: [400, 2400] });
  if (!kit) return gpuMissing(el);

  const clipmap = kit.track(
    new ClipmapTerrain({
      cells: 64,
      baseCell: 1.5,
      levels: 5,
      makeColor: ({ levelTint }) => mix(vec3(0.75, 0.75, 0.78), levelTint, 0.45),
    }),
  );
  clipmap.setWireframe(true);
  kit.scene.add(clipmap.group);
  kit.scene.add(makeWater(kit, 12000, 0.8));

  let speed = 8;
  let snapLevel = 0;
  kit.shell.slider({ label: "glide speed (m/s)", min: 0, max: 40, step: 1, value: speed, onInput: (v) => (speed = v) });
  kit.shell.slider({
    label: "snap to level",
    min: 0,
    max: 4,
    step: 1,
    value: 0,
    onInput: (v) => {
      snapLevel = v;
      clipmap.setSnapLevel(v);
    },
  });
  kit.shell.setInfo(() => `snap step ${(2 * 1.5 * 2 ** snapLevel).toFixed(0)} m — coarser = rarer, bigger jumps`);

  let cx = -600;
  const look = new Vector3();
  return kit.start((dt) => {
    cx += speed * dt;
    if (cx > 900) cx = -900;
    const cz = 120;
    clipmap.update(cx, cz);
    const ground = terrainHeightAt(cx, cz);
    kit.camera.position.set(cx - 40, ground + 38, cz + 60);
    look.set(cx + 60, ground + 4, cz - 20);
    kit.camera.lookAt(look);
  });
}
