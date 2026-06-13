// Demos for lens.html — the camera crossing the surface. Part 1 of Under.
//
// One scene grammar throughout: the same lake rendered twice (topside
// LakeSurface, underside SurfaceCeiling, identical wave uniforms), a sky
// dome that is always there, a depth dome that exists only while the
// camera is below, and the LensOverlay deciding what the housing itself
// shows — grade, meniscus band, droplets.

import * as THREE from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { wind, waterHeightAt, waterNormalAt, disturb } from "../../lib/spine";
import { buildOsprey, type Osprey } from "../../lib/bird/build";
import { OspreyAnimator } from "../../lib/bird/animator";
import { addOrbit, buildCrossingScene, underCtx } from "./kit";

// ---- floating osprey (the hero's anchor) -----------------------------------------

interface Floater {
  osprey: Osprey;
  anim: OspreyAnimator;
  update(dt: number, t: number): void;
  dispose(): void;
}

function makeFloater(scene: THREE.Scene, x: number, z: number): Floater {
  const osprey = buildOsprey();
  osprey.group.position.set(x, 0, z);
  scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);
  anim.requestPose("float");
  anim.gait01 = 1;

  const hemi = new THREE.HemisphereLight(0x9db8d8, 0x1c2a28, 0.9);
  const sun = new THREE.DirectionalLight(0xffd9b3, 2.2);
  sun.position.set(-5, 4, 4);
  scene.add(hemi, sun);

  const n = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const lean = new THREE.Quaternion();
  let wakeTimer = 0;
  return {
    osprey,
    anim,
    update(dt: number, t: number) {
      const g = osprey.group;
      g.position.y = waterHeightAt(g.position.x, g.position.z, t) - 0.16;
      waterNormalAt(g.position.x, g.position.z, t, n);
      g.quaternion.slerp(lean.setFromUnitVectors(up, n), Math.min(1, dt * 2));
      anim.update(dt);
      wakeTimer -= dt;
      if (wakeTimer <= 0) {
        wakeTimer = 1.6;
        disturb({ kind: "wake", x: g.position.x, z: g.position.z, energy: 0.02, radius: 0.3 });
      }
    },
    dispose() {
      osprey.dispose();
    },
  };
}

// ---- hero: the full crossing, around a floating bird ------------------------------

export async function mountLensHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await underCtx(el, { aspect: 0.48, fov: 52 });
  const scene = buildCrossingScene(ctx, { hour: 7.0, bedDepth: 2.4 });
  const floater = makeFloater(ctx.scene, 0, 0);
  ctx.onDispose(() => floater.dispose());

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(0, 0.05, 0),
    distance: 2.6,
    azimuth: 0.8,
    polar: 0.3,
    drift: 0.015,
  });
  ctx.onDispose(() => orbit.dispose());

  wind.speed = 1.6;
  let bob = 1;
  ctx.shell.slider({
    label: "bob depth (m)",
    min: 0,
    max: 1.6,
    step: 0.05,
    value: bob,
    onInput: (v) => (bob = v),
  });
  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 5,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.setInfo(
    () => `${scene.crossing.state} · depth ${Math.max(0, scene.crossing.depth).toFixed(2)} m`,
  );

  return ctx.finish((t, dt) => {
    // the camera rides a slow swell down through the surface and back
    const swell = Math.sin(t * 0.32) * 0.5 + 0.5; // 0 air … 1 submerged
    const y = 0.55 - (0.55 + bob) * swell;
    const polar = Math.asin(Math.max(-0.95, Math.min(0.95, (y - 0.05) / 2.6)));
    orbit.setPolar(polar);
    orbit.update(dt);
    floater.update(dt, t);
    scene.sync(t, dt);
  });
}

// ---- Step 1: two worlds, one comparison --------------------------------------------

export async function mountTwoWorlds(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await underCtx(el, { fov: 55 });
  const scene = buildCrossingScene(ctx, {
    bedDepth: 2.8,
    overlay: { band: false, droplets: false, grade: true },
  });

  let camY = 1.2;
  ctx.shell.slider({
    label: "camera height (m)",
    min: -1.8,
    max: 1.8,
    step: 0.02,
    value: camY,
    onInput: (v) => (camY = v),
  });
  ctx.shell.setInfo(() => {
    const c = scene.crossing;
    return `state: ${c.state} · waterHeightAt(cam) − camY = ${c.depth.toFixed(2)} m · grade blend ${c.submergence.toFixed(2)}`;
  });

  const look = new THREE.Vector3(7, -0.4, 0);
  return ctx.finish((t, dt) => {
    ctx.camera.position.set(0, camY, 0);
    ctx.camera.lookAt(look.x, look.y + camY * 0.55, look.z);
    scene.sync(t, dt);
  });
}

// ---- Step 2: the meniscus band ------------------------------------------------------

export async function mountMeniscus(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await underCtx(el, { fov: 55 });
  const scene = buildCrossingScene(ctx, {
    bedDepth: 2.4,
    overlay: { band: true, droplets: false, grade: true },
  });

  wind.speed = 1.8;
  let bobAmp = 0.12;
  ctx.shell.slider({
    label: "bob amplitude (m)",
    min: 0,
    max: 0.35,
    step: 0.01,
    value: bobAmp,
    onInput: (v) => (bobAmp = v),
  });
  ctx.shell.slider({
    label: "band width",
    min: 0.004,
    max: 0.06,
    step: 0.002,
    value: scene.overlay.bandWidth.value,
    onInput: (v) => (scene.overlay.bandWidth.value = v),
  });
  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 6,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.setInfo(() => `waterline proximity ${scene.crossing.proximity.toFixed(2)}`);

  return ctx.finish((t, dt) => {
    const water = waterHeightAt(0, 0, t);
    ctx.camera.position.set(0, water + Math.sin(t * 0.9) * bobAmp, 0);
    ctx.camera.lookAt(8, water - 0.2, 0);
    scene.sync(t, dt);
  });
}

// ---- Step 3: droplet streaks on exit -------------------------------------------------

export async function mountDroplets(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await underCtx(el, { fov: 55 });
  const scene = buildCrossingScene(ctx, {
    bedDepth: 2.4,
    overlay: { band: true, droplets: true, grade: true },
  });

  let dunkAt = 1.5; // sim time of the next scripted dunk
  let manual = false;
  ctx.shell.button("dunk the camera", () => (manual = true));
  ctx.shell.setInfo(() => `state: ${scene.crossing.state}`);

  // dip profile: a fast half-cosine down to −0.6 m and back over 1.6 s
  let dipT = -1;
  return ctx.finish((t, dt) => {
    if (manual && dipT < 0) {
      dipT = 0;
      manual = false;
    }
    if (t > dunkAt && dipT < 0) {
      dipT = 0;
      dunkAt = t + 5.5;
    }
    let y = 0.55;
    if (dipT >= 0) {
      dipT += dt;
      const p = dipT / 1.6;
      if (p >= 1) dipT = -1;
      else y = 0.55 - 1.25 * Math.sin(Math.PI * Math.min(1, p));
    }
    ctx.camera.position.set(0, y, 0);
    ctx.camera.lookAt(8, 0.2, 0);
    scene.sync(t, dt);
  });
}
