// Demos for waves.html — the wave equation on a GPU grid. Part 1 of The
// Splash: state (h, w), the five-point Laplacian, ping-pong integration,
// the CFL cliff, and boundary behavior.

import { Vector3 } from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { mountScrolly, PAL, label, arrow, phase, lerp } from "../../lib/scrolly";
import { createDawnSky } from "../../lib/water";
import { HeightWaveSim } from "../../lib/fluid";
import {
  addOrbit,
  makeClayTank,
  makeHeatTank,
  makeWaterTank,
  onTap,
  pickWaterPoint,
  splashCtx,
} from "./kit";

// ---- hero: rain on a computed pond ---------------------------------------------------

export async function mountWavesHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { aspect: 0.48, fov: 47 });
  const sky = createDawnSky(7.0);
  const dome = sky.makeDome();
  const sim = new HeightWaveSim(ctx.renderer, {
    resolution: 256,
    worldSize: 18,
    waveSpeed: 1.6,
    damping: 0.18,
    boundary: "absorb",
  });
  const tank = makeWaterTank(sim, sky);
  ctx.scene.add(dome, tank.mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.1, 0),
    distance: 11,
    polar: 0.34,
    azimuth: 2.2,
    drift: 0.012,
  });

  let raining = true;
  let rainTimer = 0;
  const offTap = onTap(ctx.shell.canvas, (e) => {
    const p = pickWaterPoint(e, ctx.shell.canvas, ctx.camera);
    if (p && Math.abs(p.x) < 9 && Math.abs(p.z) < 9) sim.splash(p.x, p.z, -0.16, 0.45);
  });

  ctx.shell.slider({
    label: "wave speed c (m/s)",
    min: 0.4,
    max: 3.5,
    step: 0.05,
    value: sim.waveSpeed,
    onInput: (v) => (sim.waveSpeed = v),
  });
  ctx.shell.slider({
    label: "damping (1/s)",
    min: 0,
    max: 1.2,
    step: 0.02,
    value: sim.damping,
    onInput: (v) => (sim.damping = v),
  });
  ctx.shell.button("rain on/off", () => (raining = !raining));
  ctx.shell.setInfo(() => `256×256 cells · ${sim.lastSubsteps} substeps · click to splash`);

  ctx.onDispose(() => {
    tank.dispose();
    sky.dispose();
    orbit.dispose();
    offTap();
    sim.dispose();
  });
  return ctx.finish((_t, dt) => {
    if (raining) {
      rainTimer -= dt;
      if (rainTimer <= 0) {
        rainTimer = 0.16 + Math.random() * 0.22;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * 8;
        sim.splash(Math.cos(a) * r, Math.sin(a) * r, -0.1 - Math.random() * 0.08, 0.3);
      }
    }
    sim.step(dt);
    orbit.update(dt);
  });
}

// ---- scrolly: curvature is the engine -------------------------------------------------

export function mountStencilScrolly(el: HTMLElement): void {
  // 1-D wave intuition, drawn as a pure function of scroll progress. The
  // bump is a Gaussian; after release it follows d'Alembert: half travels
  // left, half travels right.
  const gauss = (x: number, s: number): number => Math.exp((-x * x) / (s * s));
  mountScrolly(el, {
    screens: 3.4,
    aspect: 0.52,
    steps: [
      { at: 0, text: "The state: one height per cell. A pile of water, frozen mid-thought." },
      {
        at: 0.25,
        text: "Each cell compares itself to its neighbors: the five-point stencil. Sit above the neighbor average and you accelerate down; below, up. The Laplacian is that difference.",
      },
      {
        at: 0.55,
        text: "Integrate the acceleration and the pile resolves into two traveling waves — the equation discovers wave motion on its own; we never told it about waves.",
      },
      {
        at: 0.85,
        text: "That is the whole simulator: curvature → acceleration → velocity → height, every cell, every substep.",
      },
    ],
    draw(c, w, h, t) {
      const n = 33;
      const x0 = w * 0.07;
      const x1 = w * 0.93;
      const baseline = h * 0.62;
      const ampPx = h * 0.3;
      const release = phase(t, 0.55, 0.95); // 0 = held bump, 1 = fully split
      const travel = release * 9;
      const heights: number[] = [];
      for (let i = 0; i < n; i++) {
        const x = i - (n - 1) / 2;
        const held = gauss(x, 4.2);
        const split = 0.5 * gauss(x - travel, 4.2) + 0.5 * gauss(x + travel, 4.2);
        heights.push(lerp(held, split, release));
      }
      // columns
      for (let i = 0; i < n; i++) {
        const px = lerp(x0, x1, i / (n - 1));
        const hy = heights[i] * ampPx;
        c.fillStyle = PAL.dim;
        c.globalAlpha = 0.55;
        c.fillRect(px - (x1 - x0) / n / 2.6, baseline - hy, (x1 - x0) / n / 1.3, hy + h * 0.16);
        c.globalAlpha = 1;
      }
      // surface line
      c.strokeStyle = PAL.accent;
      c.lineWidth = 2;
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const px = lerp(x0, x1, i / (n - 1));
        const py = baseline - heights[i] * ampPx;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.stroke();

      // stencil highlight + acceleration arrows in the middle phase
      const stencilAmt = phase(t, 0.25, 0.4) * (1 - phase(t, 0.55, 0.7));
      if (stencilAmt > 0.02) {
        c.globalAlpha = stencilAmt;
        for (const i of [12, 16, 20]) {
          const px = lerp(x0, x1, i / (n - 1));
          const py = baseline - heights[i] * ampPx;
          const avg = (heights[i - 1] + heights[i + 1]) / 2;
          const accel = (avg - heights[i]) * ampPx;
          c.fillStyle = PAL.warm;
          c.beginPath();
          c.arc(px, py, 4, 0, Math.PI * 2);
          c.fill();
          // neighbors
          for (const k of [i - 1, i + 1]) {
            const nx = lerp(x0, x1, k / (n - 1));
            const ny = baseline - heights[k] * ampPx;
            c.fillStyle = PAL.muted;
            c.beginPath();
            c.arc(nx, ny, 3, 0, Math.PI * 2);
            c.fill();
          }
          arrow(c, px, py, px, py - Math.sign(accel) * Math.min(Math.abs(accel) * 2.2 + 8, 34), PAL.red, 2, 6);
        }
        label(c, "accel ∝ (neighbor avg − me)", w * 0.5, h * 0.12, {
          color: PAL.warm,
          align: "center",
          size: 13,
        });
        c.globalAlpha = 1;
      }
      if (release > 0.4) {
        label(c, "← half left", lerp(x0, x1, 0.5) - travel * ((x1 - x0) / (n - 1)), h * 0.2, {
          color: PAL.muted,
          align: "center",
          mono: true,
          size: 11,
        });
        label(c, "half right →", lerp(x0, x1, 0.5) + travel * ((x1 - x0) / (n - 1)), h * 0.2, {
          color: PAL.muted,
          align: "center",
          mono: true,
          size: 11,
        });
      }
    },
  });
}

// ---- Step 1: pebbles in a clay pond ---------------------------------------------------

export async function mountPebblePond(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const sim = new HeightWaveSim(ctx.renderer, {
    resolution: 192,
    worldSize: 16,
    waveSpeed: 1.4,
    damping: 0.1,
    boundary: "absorb",
  });
  const tank = makeClayTank(sim);
  tank.exaggerate.value = 2;
  ctx.scene.add(tank.mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0, 0),
    distance: 13,
    polar: 0.5,
    azimuth: 1.1,
  });

  const offTap = onTap(ctx.shell.canvas, (e) => {
    const p = pickWaterPoint(e, ctx.shell.canvas, ctx.camera);
    if (p && Math.abs(p.x) < 8 && Math.abs(p.z) < 8) sim.splash(p.x, p.z, -0.14, 0.5);
  });

  ctx.shell.slider({
    label: "wave speed c (m/s)",
    min: 0.3,
    max: 3,
    step: 0.05,
    value: sim.waveSpeed,
    onInput: (v) => (sim.waveSpeed = v),
  });
  ctx.shell.slider({
    label: "height exaggeration",
    min: 1,
    max: 6,
    step: 0.5,
    value: tank.exaggerate.value,
    onInput: (v) => (tank.exaggerate.value = v),
  });
  ctx.shell.button("pebble", () => {
    const a = Math.random() * Math.PI * 2;
    sim.splash(Math.cos(a) * 3, Math.sin(a) * 3, -0.14, 0.5);
  });
  ctx.shell.setInfo(() => "click the surface to drop a pebble");

  ctx.onDispose(() => {
    tank.dispose();
    orbit.dispose();
    offTap();
    sim.dispose();
  });
  return ctx.finish((_t, dt) => {
    sim.step(dt);
    orbit.update(dt);
  });
}

// ---- Step 2: the march, one substep at a time -----------------------------------------

export async function mountPingPong(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const sim = new HeightWaveSim(ctx.renderer, {
    resolution: 160,
    worldSize: 14,
    waveSpeed: 1.2,
    damping: 0.04,
    boundary: "reflect",
  });
  const tank = makeHeatTank(sim);
  tank.exaggerate.value = 2.5;
  ctx.scene.add(tank.mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0, 0),
    distance: 12,
    polar: 0.85,
    azimuth: 1.57,
  });

  let running = false;
  let totalSubsteps = 0;
  const dropCenter = (): void => sim.splash(0, 0, -0.18, 0.6);
  dropCenter();

  ctx.shell.button("run / pause", () => (running = !running));
  ctx.shell.button("one substep", () => {
    sim.step(sim.stableDt());
    totalSubsteps += sim.lastSubsteps;
  });
  ctx.shell.button("drop + reset", () => {
    sim.clear();
    totalSubsteps = 0;
    dropCenter();
  });
  ctx.shell.setInfo(
    () =>
      `substeps so far: ${totalSubsteps} · each one: read A whole, write B whole, swap`,
  );

  ctx.onDispose(() => {
    tank.dispose();
    orbit.dispose();
    sim.dispose();
  });
  return ctx.finish((_t, dt) => {
    if (running) {
      sim.step(dt);
      totalSubsteps += sim.lastSubsteps;
    }
    orbit.update(dt);
  });
}

// ---- Step 3: the CFL cliff -------------------------------------------------------------

export async function mountCflCliff(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const sim = new HeightWaveSim(ctx.renderer, {
    resolution: 160,
    worldSize: 14,
    waveSpeed: 1.5,
    damping: 0.06,
    boundary: "reflect",
    clampStability: false,
    cflSafety: 1,
  });
  const tank = makeClayTank(sim);
  tank.exaggerate.value = 2;
  ctx.scene.add(tank.mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0, 0),
    distance: 12,
    polar: 0.5,
    azimuth: 1.2,
  });

  let cfl = 0.7;
  let rainTimer = 0;
  ctx.shell.slider({
    label: "step size, as × the CFL limit",
    min: 0.3,
    max: 1.4,
    step: 0.01,
    value: cfl,
    onInput: (v) => (cfl = v),
  });
  ctx.shell.button("reset the pond", () => sim.clear());
  ctx.shell.setInfo(() =>
    sim.lastCfl <= 1
      ? `CFL = ${sim.lastCfl.toFixed(2)} — stable (information outruns the waves)`
      : `CFL = ${sim.lastCfl.toFixed(2)} — UNSTABLE (the waves outrun the grid)`,
  );

  ctx.onDispose(() => {
    tank.dispose();
    orbit.dispose();
    sim.dispose();
  });
  return ctx.finish((_t, dt) => {
    rainTimer -= dt;
    if (rainTimer <= 0) {
      rainTimer = 0.5;
      const a = Math.random() * Math.PI * 2;
      sim.splash(Math.cos(a) * 3.5, Math.sin(a) * 3.5, -0.1, 0.5);
    }
    // Fixed virtual step: the slider directly chooses the CFL number, the
    // frame rate doesn't matter. Three substeps a frame keeps it moving.
    for (let i = 0; i < 3; i++) sim.step(cfl * sim.stableDt());
    orbit.update(dt);
  });
}

// ---- Step 4: walls vs sponge -------------------------------------------------------------

export async function mountBoundaries(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const sky = createDawnSky(7.4);
  const dome = sky.makeDome();
  const sim = new HeightWaveSim(ctx.renderer, {
    resolution: 192,
    worldSize: 16,
    waveSpeed: 1.6,
    damping: 0.04,
    boundary: "reflect",
  });
  const tank = makeWaterTank(sim, sky);
  tank.exaggerate.value = 1.6;
  ctx.scene.add(dome, tank.mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0, 0),
    distance: 13,
    polar: 0.42,
    azimuth: 2.0,
  });

  let dripTimer = 0;
  const offTap = onTap(ctx.shell.canvas, (e) => {
    const p = pickWaterPoint(e, ctx.shell.canvas, ctx.camera);
    if (p && Math.abs(p.x) < 8 && Math.abs(p.z) < 8) sim.splash(p.x, p.z, -0.15, 0.5);
  });

  ctx.shell.button("walls ↔ sponge", () => {
    sim.boundaryMode = sim.boundaryMode > 0.5 ? 0 : 1;
  });
  ctx.shell.button("reset", () => sim.clear());
  ctx.shell.setInfo(() =>
    sim.boundaryMode > 0.5
      ? "sponge rim: outgoing waves are eaten — an open lake"
      : "clamped neighbors: every wave bounces straight back — a bathtub",
  );

  ctx.onDispose(() => {
    tank.dispose();
    sky.dispose();
    orbit.dispose();
    offTap();
    sim.dispose();
  });
  return ctx.finish((_t, dt) => {
    dripTimer -= dt;
    if (dripTimer <= 0) {
      dripTimer = 2.4;
      sim.splash(0, 0, -0.18, 0.55);
    }
    sim.step(dt);
    orbit.update(dt);
  });
}
