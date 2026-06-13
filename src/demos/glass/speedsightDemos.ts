// Demos for speedsight.html — the camera communicating airspeed.
// Part 2 of Glass & Grain.
//
// Three pixel-moving effects (velocity blur, radial streaks, gathered DOF)
// plus the FOV law, each isolated in a step demo, then all of them wired to
// the published FlightState by a scripted dive circuit — the hero and the
// bridge demo own a bird the way any scene that owns the bird would.

import {
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PostProcessing,
  Vector2,
  Vector3,
} from "three/webgpu";
import type { Scene, TextureNode } from "three/webgpu";
import { mrt, output, pass, renderOutput, uniform, velocity } from "three/tsl";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { wind } from "../../lib/spine";
import { flightState } from "../../lib/flight";
import { PostFxStack, cocDofNode, radialStreakNode, velocityBlurNode } from "../../lib/postfx";
import { glassCtx, makeDiveFlier, makeFloater, makeLakeStage } from "./kit";

// ---- a soft chase camera ------------------------------------------------------------

interface Chase {
  update(dt: number, target: Vector3, vel: Vector3, fovDeg: number): void;
}

function makeChase(camera: PerspectiveCamera, back = 7, height = 2.2): Chase {
  const pos = new Vector3(-back, height + 20, 0);
  const desired = new Vector3();
  const dirH = new Vector3(1, 0, 0);
  const look = new Vector3();
  let fov = camera.fov;
  return {
    update(dt, target, vel, fovDeg) {
      if (vel.x * vel.x + vel.z * vel.z > 0.5) {
        dirH.set(vel.x, 0, vel.z).normalize();
      }
      desired.copy(target).addScaledVector(dirH, -back);
      desired.y = Math.max(target.y + height, 0.6);
      const k = 1 - Math.exp(-3.4 * dt);
      pos.lerp(desired, k);
      camera.position.copy(pos);
      look.copy(target).addScaledVector(vel, 0.1);
      camera.lookAt(look);
      fov += (fovDeg - fov) * (1 - Math.exp(-4 * dt));
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    },
  };
}

// ---- hero: the full circuit through the full chain --------------------------------------

export async function mountSpeedHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { aspect: 0.48, fov: 55, renderScale: 0.8 });
  const stage = makeLakeStage(ctx, { hour: 7.8 });
  const flier = makeDiveFlier(ctx.scene);
  ctx.onDispose(() => flier.dispose());
  wind.speed = 2.4;

  const stack = new PostFxStack(ctx.renderer, ctx.scene, ctx.camera, {
    grade: true,
    bloom: true,
    speed: true,
    keyGradeToClock: false,
  });
  ctx.onDispose(() => stack.dispose());
  const chase = makeChase(ctx.camera, 7.5, 2.4);

  ctx.shell.slider({
    label: "streak strength",
    min: 0,
    max: 1,
    step: 0.02,
    value: stack.speed!.streakMax,
    onInput: (v) => (stack.speed!.streakMax = v),
  });
  ctx.shell.slider({
    label: "dive focus (max CoC)",
    min: 0,
    max: 0.03,
    step: 0.001,
    value: stack.speed!.diveCoc,
    onInput: (v) => (stack.speed!.diveCoc = v),
  });
  ctx.shell.setInfo(
    () =>
      `airspeed ${flightState.airspeed.toFixed(1)} m/s · sink ${(-flightState.verticalSpeed).toFixed(1)} m/s · tuck ${flightState.tuck.toFixed(2)} · fov ${ctx.camera.fov.toFixed(0)}°`,
  );

  return ctx.finish(
    (t, dt) => {
      flier.update(dt, t);
      stage.update(t, dt);
      const focusDist = ctx.camera.position.distanceTo(flier.position);
      stack.update(dt, { t, hour: stage.hour, focusDistance: focusDist });
      chase.update(dt, flier.position, flier.velocity, stack.speed!.fov);
    },
    () => stack.render(),
  );
}

// ---- Step 1: velocity-buffer motion blur ---------------------------------------------------

export async function mountVelocityBlur(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { fov: 50 });
  const stage = makeLakeStage(ctx, { hour: 9 });
  wind.speed = 2;

  // three gliders on rings — rigid bodies with clean motion vectors
  const mat = new MeshStandardMaterial({ color: 0x2b3140, roughness: 0.7 });
  const geo = new CylinderGeometry(0.0, 0.32, 1.1, 4);
  geo.rotateX(Math.PI / 2);
  const gliders: { mesh: Mesh; r: number; w: number; y: number; p: number }[] = [];
  for (const [r, w, y, p] of [
    [7, 1.4, 3.2, 0],
    [10, -1.0, 4.6, 2.1],
    [13.5, 0.7, 2.4, 4.4],
  ]) {
    const mesh = new Mesh(geo, mat);
    ctx.scene.add(mesh);
    gliders.push({ mesh, r, w, y, p });
  }
  ctx.onDispose(() => {
    geo.dispose();
    mat.dispose();
  });

  ctx.camera.position.set(0, 3.4, 22);
  ctx.camera.lookAt(0, 3.4, 0);

  const scenePass = pass(ctx.scene, ctx.camera);
  scenePass.setMRT(mrt({ output, velocity }));
  const sceneTex = scenePass.getTextureNode("output") as TextureNode;
  const velocityTex = scenePass.getTextureNode("velocity") as TextureNode;
  const shutter = uniform(0.8);

  const post = new PostProcessing(ctx.renderer);
  post.outputColorTransform = false;
  post.outputNode = renderOutput(velocityBlurNode(sceneTex, velocityTex, shutter, 12));
  ctx.onDispose(() => {
    scenePass.dispose();
    post.dispose();
  });

  let paused = false;
  ctx.shell.slider({
    label: "shutter (fraction of frame)",
    min: 0,
    max: 1.5,
    step: 0.05,
    value: 0.8,
    onInput: (v) => (shutter.value = v),
  });
  ctx.shell.button("freeze the world", () => (paused = !paused));
  ctx.shell.setInfo(() =>
    paused
      ? "frozen: zero motion between frames → zero velocity → zero blur"
      : "blur = average along each pixel's frame-to-frame motion vector",
  );

  let simT = 0;
  return ctx.finish(
    (_t, dt) => {
      if (!paused) simT += dt;
      for (const g of gliders) {
        const a = g.p + simT * g.w;
        g.mesh.position.set(Math.cos(a) * g.r, g.y + Math.sin(simT * 0.7 + g.p) * 0.4, Math.sin(a) * g.r);
        g.mesh.rotation.y = -a - (g.w > 0 ? 0 : Math.PI);
      }
      stage.update(simT, dt);
    },
    () => post.render(),
  );
}

// ---- Step 2: radial streaks -------------------------------------------------------------------

export async function mountRadialStreaks(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { fov: 60 });
  const stage = makeLakeStage(ctx, { hour: 7.2 });
  wind.speed = 2;

  // the dive view: nose-down toward the water, mountains in the periphery
  ctx.camera.position.set(-20, 14, 8);
  ctx.camera.lookAt(8, 0, -4);

  const scenePass = pass(ctx.scene, ctx.camera);
  const sceneTex = scenePass.getTextureNode("output") as TextureNode;
  const amount = uniform(0.55);
  const fringe = uniform(0.4);

  const post = new PostProcessing(ctx.renderer);
  post.outputColorTransform = false;
  post.outputNode = renderOutput(
    radialStreakNode(sceneTex, sceneTex, {
      amount,
      center: new Vector2(0.5, 0.45),
      fringe,
    }),
  );
  ctx.onDispose(() => {
    scenePass.dispose();
    post.dispose();
  });

  ctx.shell.slider({ label: "streak amount", min: 0, max: 1, step: 0.02, value: 0.55, onInput: (v) => (amount.value = v) });
  ctx.shell.slider({ label: "chromatic fringe", min: 0, max: 1, step: 0.02, value: 0.4, onInput: (v) => (fringe.value = v) });
  ctx.shell.setInfo(() => "pull grows with distance from the aim point — the center stays readable");

  return ctx.finish(
    (t, dt) => {
      stage.update(t, dt);
    },
    () => post.render(),
  );
}

// ---- Step 3: circle-of-confusion DOF ------------------------------------------------------------

function addReeds(scene: Scene, dists: number[]): () => void {
  const mat = new MeshStandardMaterial({ color: 0x7a6a42, roughness: 0.9 });
  const geo = new CylinderGeometry(0.025, 0.045, 2.2, 6);
  const meshes: Mesh[] = [];
  for (let i = 0; i < dists.length; i++) {
    const m = new Mesh(geo, mat);
    m.position.set((i % 2 === 0 ? -1 : 1) * (0.4 + i * 0.35), 0.7, -dists[i]);
    scene.add(m);
    meshes.push(m);
  }
  return () => {
    geo.dispose();
    mat.dispose();
    for (const m of meshes) scene.remove(m);
  };
}

export async function mountDiveDof(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { fov: 46 });
  const stage = makeLakeStage(ctx, { hour: 8.4 });
  const floater = makeFloater(ctx.scene, 0.4, -7);
  ctx.onDispose(() => floater.dispose());
  ctx.onDispose(addReeds(ctx.scene, [2.5, 4, 6.5, 11, 18, 30]));
  wind.speed = 1.6;

  ctx.camera.position.set(0, 1.1, 3);
  ctx.camera.lookAt(0.2, 0.6, -8);

  const scenePass = pass(ctx.scene, ctx.camera);
  const sceneTex = scenePass.getTextureNode("output") as TextureNode;
  const depthTex = scenePass.getTextureNode("depth") as TextureNode;
  const focusDistance = uniform(10);
  const focalRange = uniform(4);
  const maxCoc = uniform(0.016);

  const post = new PostProcessing(ctx.renderer);
  post.outputColorTransform = false;
  post.outputNode = renderOutput(
    cocDofNode(sceneTex, depthTex, {
      focusDistance,
      focalRange,
      maxCoc,
      near: ctx.camera.near,
      far: ctx.camera.far,
    }),
  );
  ctx.onDispose(() => {
    scenePass.dispose();
    post.dispose();
  });

  ctx.shell.slider({
    label: "focus distance (m)",
    min: 1.5,
    max: 60,
    step: 0.1,
    value: 10,
    log: true,
    format: (v) => v.toFixed(1),
    onInput: (v) => (focusDistance.value = v),
  });
  ctx.shell.slider({ label: "focal range (m)", min: 0.5, max: 40, step: 0.5, value: 4, onInput: (v) => (focalRange.value = v) });
  ctx.shell.slider({ label: "max CoC (screen heights)", min: 0, max: 0.035, step: 0.001, value: 0.016, onInput: (v) => (maxCoc.value = v) });
  ctx.shell.setInfo(() => `coc(z) = maxCoC · clamp(|z − focus| / range, 0, 1) — the bird floats at ~10 m`);

  return ctx.finish(
    (t, dt) => {
      floater.update(dt, t);
      stage.update(t, dt);
    },
    () => post.render(),
  );
}

// ---- Step 4: the FlightState bridge ----------------------------------------------------------------

export async function mountFlightBridge(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { fov: 55 });
  const stage = makeLakeStage(ctx, { hour: 9.5 });
  const flier = makeDiveFlier(ctx.scene);
  ctx.onDispose(() => flier.dispose());
  wind.speed = 2.4;

  const stack = new PostFxStack(ctx.renderer, ctx.scene, ctx.camera, {
    grade: true,
    bloom: false,
    speed: true,
    keyGradeToClock: false,
  });
  ctx.onDispose(() => stack.dispose());
  const chase = makeChase(ctx.camera, 8.5, 2.8);

  const speed = stack.speed!;
  const baseStreak = speed.streakMax;
  const baseCoc = speed.diveCoc;
  let streaksOn = true;
  let dofOn = true;
  let fovOn = true;
  ctx.shell.button("streaks on/off", () => {
    streaksOn = !streaksOn;
    speed.streakMax = streaksOn ? baseStreak : 0;
  });
  ctx.shell.button("dive DOF on/off", () => {
    dofOn = !dofOn;
    speed.diveCoc = dofOn ? baseCoc : 0;
  });
  ctx.shell.button("FOV kick on/off", () => (fovOn = !fovOn));
  ctx.shell.setInfo(() => {
    const tags = [streaksOn ? "streaks" : null, dofOn ? "dof" : null, fovOn ? "fov" : null].filter(Boolean);
    return `${tags.join(" + ") || "all off"} · v ${flightState.airspeed.toFixed(1)} m/s → streak ${speed.streak.value.toFixed(2)} · coc ${speed.maxCoc.value.toFixed(4)}`;
  });

  return ctx.finish(
    (t, dt) => {
      flier.update(dt, t);
      stage.update(t, dt);
      const focusDist = ctx.camera.position.distanceTo(flier.position);
      stack.update(dt, { t, hour: stage.hour, focusDistance: focusDist });
      chase.update(dt, flier.position, flier.velocity, fovOn ? speed.fov : speed.fovBase);
    },
    () => stack.render(),
  );
}
