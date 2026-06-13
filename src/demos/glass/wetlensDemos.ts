// Demos for wetlens.html — the dive transition as a post-process.
// Part 3 of Glass & Grain.
//
// One stage grammar throughout: makeCrossingStage renders the lake twice
// (topside surface + underside ceiling, a mottled bed, a depth dome) with NO
// overlay quads anywhere — every wet thing the housing shows is owned by the
// post chain's WetLensFx. A scripted camera plunges and breaches; the
// crossing state machine flips, drives the meniscus + grade, and reseeds the
// droplets on each exit. Each step pins the camera to the part of the dive it
// is explaining and hands the page one slider.

import { Vector3 } from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { wind } from "../../lib/spine";
import { PostFxStack } from "../../lib/postfx";
import { fmtHour, glassCtx, makeCrossingStage } from "./kit";

// A scripted plunge: the camera dives nose-first through the surface, holds
// underwater for a beat, then breaches and climbs out. y(t) is the only thing
// the crossing machine reads, so this one curve drives the whole transition.
// Returns camera y for a phase in [0,1) of a `period`-second cycle.
function plungeY(phase: number, peakDepth: number, airHeight: number): number {
  // 0.00–0.30 descend through the line to peakDepth (ease-in)
  // 0.30–0.55 hold near the bottom
  // 0.55–0.78 climb back out, breaching the surface (ease-out)
  // 0.78–1.00 cruise in the air
  if (phase < 0.3) {
    const k = phase / 0.3;
    const e = k * k; // gathers speed into the water
    return airHeight + (-peakDepth - airHeight) * e;
  }
  if (phase < 0.55) {
    const k = (phase - 0.3) / 0.25;
    return -peakDepth + Math.sin(k * Math.PI) * 0.25; // a small drift at depth
  }
  if (phase < 0.78) {
    const k = (phase - 0.55) / 0.23;
    const e = 1 - (1 - k) * (1 - k); // ease-out climb
    return -peakDepth + (airHeight + peakDepth) * e;
  }
  return airHeight;
}

// ---- hero: the whole crossing through the whole chain ------------------------------

export async function mountWetLensHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { aspect: 0.48, fov: 56, near: 0.05, renderScale: 0.85 });

  const stack = new PostFxStack(ctx.renderer, ctx.scene, ctx.camera, {
    grade: true,
    bloom: true,
    wetLens: true,
    keyGradeToClock: false,
  });
  ctx.onDispose(() => stack.dispose());

  const HOUR = 7.4;
  const stage = makeCrossingStage(ctx, {
    hour: HOUR,
    bedDepth: 3.0,
    onCrossing: (event, t) => stack.wetLens?.notify(event, t),
  });
  wind.speed = 2.6;

  // a slow look-around so the underwater world reads as a place, not a tint
  let yaw = 0.4;
  const look = new Vector3();
  let period = 9;
  let depth = 2.0;
  ctx.shell.slider({
    label: "dive period (s)",
    min: 5,
    max: 16,
    step: 0.5,
    value: period,
    onInput: (v) => (period = v),
  });
  ctx.shell.slider({
    label: "plunge depth (m)",
    min: 0.6,
    max: 2.6,
    step: 0.1,
    value: depth,
    onInput: (v) => (depth = v),
  });

  const c = stage.crossing;
  ctx.shell.setInfo(
    () =>
      `${c.state} · depth ${c.depth >= 0 ? "+" : ""}${c.depth.toFixed(2)} m · submerge ${c.submergence.toFixed(2)} · ${fmtHour(HOUR)}`,
  );

  return ctx.finish(
    (t, dt) => {
      const phase = (t % period) / period;
      const cam = ctx.camera.position;
      cam.set(Math.sin(t * 0.18) * 1.2, plungeY(phase, depth, 1.6), Math.cos(t * 0.18) * 1.2);
      yaw += dt * 0.12;
      // aim slightly downward into the dive, level off in the air
      const pitch = cam.y < 0 ? -0.35 : -0.12;
      look.set(cam.x + Math.cos(yaw), cam.y + Math.sin(pitch) * 4, cam.z + Math.sin(yaw));
      ctx.camera.lookAt(look);

      stage.sync(t, dt);
      stack.update(dt, { t, hour: HOUR, crossing: stage.crossing, waterY: stage.waterY });
    },
    () => stack.render(),
  );
}

// ---- Step 1: droplets — the frame is a texture we can bend -------------------------
// Camera surfaces from a shallow plunge on a tight loop so the droplet film
// reseeds and runs often. Only the refraction strength is exposed.

export async function mountDropRefract(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { fov: 54, near: 0.05 });

  const stack = new PostFxStack(ctx.renderer, ctx.scene, ctx.camera, {
    grade: true,
    bloom: false,
    wetLens: true,
    keyGradeToClock: false,
  });
  ctx.onDispose(() => stack.dispose());
  // isolate the droplets: no underwater grade, no band magnification
  stack.wetLens!.bandWidth.value = 0.0;

  const HOUR = 8.6;
  const stage = makeCrossingStage(ctx, {
    hour: HOUR,
    bedDepth: 2.2,
    onCrossing: (event, t) => stack.wetLens?.notify(event, t),
  });
  wind.speed = 2.2;

  ctx.shell.slider({
    label: "refraction strength",
    min: 0,
    max: 0.09,
    step: 0.002,
    value: stack.wetLens!.refraction.value,
    onInput: (v) => (stack.wetLens!.refraction.value = v),
  });
  ctx.shell.setInfo(
    () => "each droplet is a height bump; its gradient bends the frame behind it",
  );

  const look = new Vector3();
  const period = 4.2;
  return ctx.finish(
    (t, dt) => {
      const phase = (t % period) / period;
      const cam = ctx.camera.position;
      // a brisk shallow dip — mostly above the line, so we read the wet glass
      cam.set(0, plungeY(phase, 0.7, 1.3), 0);
      look.set(0.3, cam.y + 0.6, -6);
      ctx.camera.lookAt(look);
      stage.sync(t, dt);
      stack.update(dt, { t, hour: HOUR, crossing: stage.crossing, waterY: stage.waterY });
    },
    () => stack.render(),
  );
}

// ---- Step 2: the two color worlds — the depth-keyed grade --------------------------
// Hold the camera below the surface and scrub its depth. The band and droplets
// are muted so the underwater filter is the only thing the slider touches.

export async function mountDepthGrade(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { fov: 58, near: 0.05 });

  const stack = new PostFxStack(ctx.renderer, ctx.scene, ctx.camera, {
    grade: true,
    bloom: true,
    wetLens: true,
    keyGradeToClock: false,
  });
  ctx.onDispose(() => stack.dispose());
  stack.wetLens!.bandWidth.value = 0.006;

  const HOUR = 9.5;
  const stage = makeCrossingStage(ctx, {
    hour: HOUR,
    bedDepth: 3.4,
    onCrossing: (event, t) => stack.wetLens?.notify(event, t),
  });
  wind.speed = 1.8;

  let depth = 1.2;
  ctx.shell.slider({
    label: "camera depth (m)",
    min: 0.05,
    max: 3.2,
    step: 0.05,
    value: depth,
    format: (v) => `${v.toFixed(2)} m`,
    onInput: (v) => (depth = v),
  });
  ctx.shell.slider({
    label: "filter (blue ←→ teal)",
    min: 0.5,
    max: 1,
    step: 0.02,
    value: stack.wetLens!.tint.value.y,
    onInput: (v) => stack.wetLens!.tint.value.set(0.52 + (v - 0.78) * 0.4, v, v + 0.07),
  });
  ctx.shell.setInfo(
    () =>
      `depth ${stage.crossing.depth.toFixed(2)} m · red drops fastest (Beer–Lambert), the medium pulls the rest toward teal`,
  );

  const look = new Vector3();
  return ctx.finish(
    (t, dt) => {
      const cam = ctx.camera.position;
      // ease the camera to the requested depth and look out into the gloom
      const targetY = -depth;
      cam.set(Math.sin(t * 0.2) * 0.6, cam.y + (targetY - cam.y) * Math.min(1, dt * 4), 0);
      look.set(cam.x + Math.cos(t * 0.2), cam.y - 0.6, cam.z + Math.sin(t * 0.2) - 8);
      ctx.camera.lookAt(look);
      stage.sync(t, dt);
      stack.update(dt, { t, hour: HOUR, crossing: stage.crossing, waterY: stage.waterY });
    },
    () => stack.render(),
  );
}

// ---- Step 3: the meniscus band — magnify just below the line -----------------------
// Pin the camera so the waterline crosses the middle of the frame and hold it
// there. The band width is the slider; droplets are off so the line is the
// only event on screen.

export async function mountMeniscusBand(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { fov: 50, near: 0.05 });

  const stack = new PostFxStack(ctx.renderer, ctx.scene, ctx.camera, {
    grade: true,
    bloom: false,
    wetLens: true,
    keyGradeToClock: false,
  });
  ctx.onDispose(() => stack.dispose());

  const HOUR = 7.0;
  const stage = makeCrossingStage(ctx, {
    hour: HOUR,
    bedDepth: 2.4,
    onCrossing: (event, t) => stack.wetLens?.notify(event, t),
  });
  wind.speed = 2.0;

  ctx.shell.slider({
    label: "band half-width (screen heights)",
    min: 0.003,
    max: 0.05,
    step: 0.001,
    value: stack.wetLens!.bandWidth.value,
    format: (v) => v.toFixed(3),
    onInput: (v) => (stack.wetLens!.bandWidth.value = v),
  });
  ctx.shell.setInfo(
    () =>
      `proximity ${stage.crossing.proximity.toFixed(2)} — the band lives only while the line is near the lens`,
  );

  const look = new Vector3();
  return ctx.finish(
    (t, dt) => {
      const cam = ctx.camera.position;
      // hover the lens right on the surface, bobbing a few centimetres so the
      // waterline drifts across the band and back
      cam.set(Math.sin(t * 0.25) * 0.5, Math.sin(t * 0.6) * 0.05, 1.0);
      look.set(cam.x + 0.2, 0, cam.z - 9);
      ctx.camera.lookAt(look);
      stage.sync(t, dt);
      stack.update(dt, { t, hour: HOUR, crossing: stage.crossing, waterY: stage.waterY });
    },
    () => stack.render(),
  );
}

// ---- Step 4: the whole crossing, assembled -----------------------------------------
// Everything on, a slower scripted dive than the hero so the reader can watch
// each stage hand off: descend (grade deepens), hold (full underwater), breach
// (band sweeps up, droplets seed, grade drains away).

export async function mountTheCrossing(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { fov: 56, near: 0.05 });

  const stack = new PostFxStack(ctx.renderer, ctx.scene, ctx.camera, {
    grade: true,
    bloom: true,
    wetLens: true,
    keyGradeToClock: false,
  });
  ctx.onDispose(() => stack.dispose());

  const HOUR = 6.8;
  const stage = makeCrossingStage(ctx, {
    hour: HOUR,
    bedDepth: 2.8,
    onCrossing: (event, t) => stack.wetLens?.notify(event, t),
  });
  wind.speed = 2.4;

  let playing = true;
  let phaseHold = 0;
  ctx.shell.button("play / pause the dive", () => (playing = !playing));
  const slider = ctx.shell.slider({
    label: "scrub the dive",
    min: 0,
    max: 1,
    step: 0.005,
    value: 0,
    onInput: (v) => {
      phaseHold = v;
      playing = false;
    },
  });

  const stageName = (p: number): string =>
    p < 0.3 ? "descending" : p < 0.55 ? "holding" : p < 0.78 ? "breaching" : "in the air";
  ctx.shell.setInfo(
    () =>
      `${stageName(phaseHold)} · ${stage.crossing.state} · submerge ${stage.crossing.submergence.toFixed(2)}`,
  );

  const look = new Vector3();
  const period = 13;
  return ctx.finish(
    (t, dt) => {
      if (playing) {
        phaseHold = (phaseHold + dt / period) % 1;
        slider.value = String(phaseHold);
      }
      const cam = ctx.camera.position;
      cam.set(Math.sin(t * 0.1) * 0.8, plungeY(phaseHold, 1.8, 1.5), Math.cos(t * 0.1) * 0.8);
      const pitch = cam.y < 0 ? -0.3 : -0.1;
      look.set(cam.x + 1, cam.y + Math.sin(pitch) * 4, cam.z - 8);
      ctx.camera.lookAt(look);
      stage.sync(t, dt);
      stack.update(dt, { t, hour: HOUR, crossing: stage.crossing, waterY: stage.waterY });
    },
    () => stack.render(),
  );
}
