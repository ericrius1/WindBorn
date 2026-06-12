// Demos for "The Osprey" — direct-mesh modeling. Rings along a spine curve,
// a wing lofted from an airfoil section and dressed with feather planes, the
// detail passes, and the painted silhouette.

import * as THREE from "three/webgpu";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import {
  buildOsprey,
  buildBodyGeometry,
  buildWingMembraneGeometry,
  bodyStations,
  wingFeatherPlacements,
  featherQuaternion,
  triangleCount,
} from "../../lib/bird/build";
import { featherGeometry, facetGeometry } from "../../lib/bird/loft";
import { WINGS, applyWingTip, tipFromParams, unfoldTarget } from "../../lib/bird/wing";
import { OspreyAnimator } from "../../lib/bird/animator";
import { createStage, makeTimer } from "./stage";

const POLE_GLIDE = new THREE.Vector3(0, 0.85, -0.4).normalize();

// Hold the glide: wrists high, tips a touch below — the M every birder knows.
function holdGlide(osprey: ReturnType<typeof buildOsprey>, breathe = 0): void {
  const tip = new THREE.Vector3();
  for (const side of [WINGS.L, WINGS.R]) {
    tipFromParams(side, 0.97, -0.012 + breathe, -0.05, tip);
    applyWingTip(osprey.rig, side, tip, { twist: 0.04, pole: POLE_GLIDE });
  }
  osprey.setTailSpread(0.18);
  osprey.rig.bone("tailFan").rotation.x = 0.06;
  osprey.rig.setEulerDeg("thighL", 62, 0, 6);
  osprey.rig.setEulerDeg("thighR", 62, 0, -6);
  osprey.rig.setEulerDeg("tarsusL", 30, 0, 0);
  osprey.rig.setEulerDeg("tarsusR", 30, 0, 0);
  osprey.rig.setEulerDeg("footL", 22, 0, 0);
  osprey.rig.setEulerDeg("footR", 22, 0, 0);
}

// ---- hero: the assembled bird over water ---------------------------------------

export async function mountHeroOsprey(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    water: true,
    orbit: { target: [0, 0.62, 0], radius: 2.1, azimuth: 0.6, polar: 0.16, autoSpin: 0.07 },
  });
  const osprey = buildOsprey();
  osprey.group.position.y = 0.32;
  stage.scene.add(osprey.group);

  const anim = new OspreyAnimator(osprey);
  anim.gait01 = 1; // glide
  anim.flapRateHz = 2.6;

  const tris = triangleCount(osprey.group);
  shell.setInfo(() => `${tris} triangles · glide`);

  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      anim.update(h);
      osprey.group.position.y = 0.32 + Math.sin(stage.time * 0.7) * 0.025;
      osprey.group.rotation.z = Math.sin(stage.time * 0.43) * 0.05;
      stage.update(h);
      stage.render();
      shell.tick();
    },
    dispose() {
      osprey.dispose();
      stage.dispose();
    },
  };
}

// ---- step 1: rings along a spine curve -------------------------------------------

export async function mountRings(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    orbit: { target: [0, 0.36, 0.02], radius: 0.85, azimuth: 0.7, polar: 0.15, autoSpin: 0.1 },
  });

  // the spine curve and its stations, drawn as construction lines
  const sts = bodyStations();
  const curve = new THREE.CatmullRomCurve3(
    sts.map((s) => new THREE.Vector3(...s.pos)),
    false,
    "catmullrom",
    0.5,
  );
  const construction = new THREE.Group();
  const spineGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(72));
  const spineMat = new THREE.LineBasicMaterial({ color: 0xffb86b, transparent: true, opacity: 0.9 });
  construction.add(new THREE.Line(spineGeo, spineMat));
  const ringMat = new THREE.LineBasicMaterial({ color: 0x7aa2ff, transparent: true, opacity: 0.85 });
  const ringGeos: THREE.BufferGeometry[] = [];
  const tangent = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  for (let i = 0; i < sts.length; i++) {
    const u = i / (sts.length - 1);
    curve.getTangent(u, tangent).normalize();
    yAxis.crossVectors(tangent, new THREE.Vector3(1, 0, 0)).normalize();
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 40; k++) {
      const th = (k / 40) * Math.PI * 2;
      pts.push(
        new THREE.Vector3(...sts[i].pos)
          .addScaledVector(new THREE.Vector3(1, 0, 0), Math.cos(th) * sts[i].rx)
          .addScaledVector(yAxis, Math.sin(th) * sts[i].ry + (sts[i].yOff ?? 0)),
      );
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    ringGeos.push(g);
    construction.add(new THREE.Line(g, ringMat));
  }
  stage.scene.add(construction);

  // the loft itself, rebuilt when the sliders move
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  let mesh: THREE.Mesh | null = null;
  let rings = 26;
  let segments = 18;
  let painted = false;
  let dirty = true;
  let tris = 0;

  const rebuild = (): void => {
    if (mesh) {
      stage.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    const geo = buildBodyGeometry({ rings, segments, painted });
    mesh = new THREE.Mesh(geo, mat);
    stage.scene.add(mesh);
    tris = Math.round(geo.getAttribute("position").count / 3);
  };

  shell.slider({ label: "rings", min: 6, max: 40, step: 1, value: rings, onInput: (v) => { rings = v; dirty = true; } });
  shell.slider({ label: "segments", min: 6, max: 28, step: 1, value: segments, onInput: (v) => { segments = v; dirty = true; } });
  shell.button("clay ↔ painted", () => { painted = !painted; dirty = true; });
  shell.button("wireframe", () => { mat.wireframe = !mat.wireframe; });
  shell.setInfo(() => `${tris} triangles · ${rings} rings × ${segments} segments`);

  const dt = makeTimer();
  return {
    frame() {
      if (dirty) {
        dirty = false;
        rebuild();
      }
      const h = dt();
      stage.update(h);
      stage.render();
      shell.tick();
    },
    dispose() {
      mesh?.geometry.dispose();
      mat.dispose();
      spineGeo.dispose();
      spineMat.dispose();
      ringMat.dispose();
      for (const g of ringGeos) g.dispose();
      stage.dispose();
    },
  };
}

// ---- step 2: one wing, membrane plus feathers --------------------------------------

export async function mountWingStrip(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    orbit: { target: [0.42, 0.34, 0.0], radius: 1.0, azimuth: 0.35, polar: 0.5, autoSpin: 0.08 },
  });

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const membraneGeo = buildWingMembraneGeometry({});
  const membrane = new THREE.Mesh(membraneGeo, mat);
  stage.scene.add(membrane);

  const groups: Record<string, THREE.Group> = {
    primary: new THREE.Group(),
    secondary: new THREE.Group(),
    tertial: new THREE.Group(),
  };
  const featherGeos: THREE.BufferGeometry[] = [];
  for (const pl of wingFeatherPlacements("L")) {
    const raw = featherGeometry(pl.spec);
    const geo = facetGeometry(raw, { jitter: 0.045 });
    raw.dispose();
    featherGeos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pl.position);
    m.quaternion.copy(featherQuaternion(pl.direction, pl.up));
    groups[pl.kind].add(m);
  }
  for (const g of Object.values(groups)) stage.scene.add(g);

  let stageN = 3;
  const apply = (): void => {
    groups.primary.visible = stageN >= 1;
    groups.secondary.visible = stageN >= 2;
    groups.tertial.visible = stageN >= 3;
  };
  apply();
  const names = ["membrane only", "+ primaries", "+ secondaries", "+ tertials"];
  shell.slider({
    label: "build stage",
    min: 0,
    max: 3,
    step: 1,
    value: stageN,
    format: (v) => names[Math.round(v)],
    onInput: (v) => {
      stageN = Math.round(v);
      apply();
    },
  });
  shell.button("wireframe", () => { mat.wireframe = !mat.wireframe; });
  shell.setInfo(() => names[stageN]);

  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      stage.update(h);
      stage.render();
      shell.tick();
    },
    dispose() {
      membraneGeo.dispose();
      for (const g of featherGeos) g.dispose();
      mat.dispose();
      stage.dispose();
    },
  };
}

// ---- step 3: head, tail fan, feet — the detail pass ---------------------------------

export async function mountDetails(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    ground: true,
    orbit: { target: [0, 0.3, 0.05], radius: 0.78, azimuth: 0.5, polar: 0.2, autoSpin: 0.09 },
  });
  const osprey = buildOsprey();
  stage.scene.add(osprey.group);

  // perched: the rest pose already stands; fold the wings home
  const tip = new THREE.Vector3();
  const foldPole = new THREE.Vector3(0, 0.5, -1).normalize();
  for (const side of [WINGS.L, WINGS.R]) {
    unfoldTarget(side, 0.04, 0, tip);
    applyWingTip(osprey.rig, side, tip, { pole: foldPole });
  }
  osprey.rig.bone("tailFan").rotation.x = 0.12;

  let tailSpread = 0.15;
  let toeSpread = 0;
  shell.slider({ label: "tail fan", min: 0, max: 1, step: 0.01, value: tailSpread, onInput: (v) => (tailSpread = v) });
  shell.slider({ label: "outer toe", min: 0, max: 1, step: 0.01, value: toeSpread, onInput: (v) => (toeSpread = v) });
  shell.setInfo(() => (toeSpread > 0.5 ? "two toes forward, two back" : "three forward, one back"));

  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      osprey.setTailSpread(tailSpread);
      osprey.rig.bone("toeOutL").rotation.y = 2.1 * toeSpread;
      osprey.rig.bone("toeOutR").rotation.y = -2.1 * toeSpread;
      osprey.rig.bone("toeInL").rotation.y = -0.25 * toeSpread;
      osprey.rig.bone("toeInR").rotation.y = 0.25 * toeSpread;
      // a small alive head: slow scanning
      osprey.rig.bone("head").rotation.y = Math.sin(stage.time * 0.5) * 0.5;
      stage.update(h);
      stage.render();
      shell.tick();
    },
    dispose() {
      osprey.dispose();
      stage.dispose();
    },
  };
}

// ---- step 4: the painter and the silhouette -----------------------------------------

export async function mountSilhouette(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    orbit: { target: [0, 0.42, 0], radius: 2.0, azimuth: 0.0, polar: 0.42, autoSpin: 0.1 },
    fog: false,
  });

  const painted = buildOsprey({ painted: true });
  const clay = buildOsprey({ painted: false });
  stage.scene.add(painted.group, clay.group);
  clay.group.visible = false;
  holdGlide(painted);
  holdGlide(clay);

  let span = 0;
  {
    painted.rig.root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(painted.group);
    span = box.max.x - box.min.x;
  }

  let showPaint = true;
  let backlit = false;
  shell.button("clay ↔ painted", () => {
    showPaint = !showPaint;
    painted.group.visible = showPaint;
    clay.group.visible = !showPaint;
  });
  shell.button("backlight", () => {
    backlit = !backlit;
    (stage.scene.background as THREE.Color).setHex(backlit ? 0xb9c9d8 : 0x0b0f16);
    stage.sun.intensity = backlit ? 0.25 : 2.4;
  });
  shell.setInfo(() => `span ${span.toFixed(2)} m · ${showPaint ? "field marks" : "clay"}`);

  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      const breathe = Math.sin(stage.time * 1.2) * 0.006;
      holdGlide(showPaint ? painted : clay, breathe);
      stage.update(h);
      stage.render();
      shell.tick();
    },
    dispose() {
      painted.dispose();
      clay.dispose();
      stage.dispose();
    },
  };
}
