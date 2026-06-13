// Demos for coupling.html — two-way coupling. Part 4 of The Splash: momentum
// injection from the bus, the CPU mirror readback, Archimedes on a sphere
// cap, and bodies shoved around by the waves they make.

import { Group, Mesh, Vector2, Vector3 } from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { mountScrolly, PAL, label, arrow, phase, lerp } from "../../lib/scrolly";
import { createDawnSky } from "../../lib/water";
import { disturb } from "../../lib/spine";
import { FluidSim, Floater, SimSurface, SimWaterProvider } from "../../lib/fluid";
import { addOrbit, makeBall, onTap, pickWaterPoint, splashCtx } from "./kit";

const UP = new Vector3(0, 1, 0);

// Each demo on this page runs its own sim, so bodies read their own
// window's provider instance directly (the page-wide swap was simbubble's
// showcase; stacking four of them would have them fighting over the slot).
type WaterFn = (x: number, z: number, t: number) => number;

function providerFn(sim: FluidSim): WaterFn {
  sim.enableMirror();
  const provider = new SimWaterProvider(sim);
  return (x, z, t) => provider.heightAt(x, z, t);
}

// ---- a floater with a mesh -------------------------------------------------------------

function makeFloatBall(radius: number, hex: number, sunDir: Vector3, sim: FluidSim, waterAt: WaterFn) {
  const floater = new Floater({ radius, density: 0.42, sim, waterAt });
  const ball = makeBall(radius, hex, sunDir);
  return {
    floater,
    mesh: ball.mesh,
    sync() {
      ball.mesh.position.copy(floater.pos);
      ball.mesh.quaternion.setFromUnitVectors(UP, floater.up);
    },
    dispose: ball.dispose,
  };
}

// ---- hero: a pond full of pushable things ----------------------------------------------

export async function mountCouplingHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { aspect: 0.48, fov: 47 });
  const sky = createDawnSky(7.2);
  const dome = sky.makeDome();
  const sim = new FluidSim(ctx.renderer, { resolution: 192, worldSize: 22, depth: 6, mirror: true });
  const waterAt = providerFn(sim);
  const detach = sim.attachToBus();
  const surface = new SimSurface(sim, { env: sky, extent: 900, waves: { windSpeed: 1.6 } });
  ctx.scene.add(dome, surface.mesh);

  const sun = sky.sunDirection.value as Vector3;
  const balls = [
    makeFloatBall(0.24, 0xc25b2a, sun, sim, waterAt),
    makeFloatBall(0.3, 0xb8902f, sun, sim, waterAt),
    makeFloatBall(0.2, 0x90332a, sun, sim, waterAt),
    makeFloatBall(0.26, 0x6b86a8, sun, sim, waterAt),
    makeFloatBall(0.22, 0x7a995c, sun, sim, waterAt),
  ];
  const group = new Group();
  for (let i = 0; i < balls.length; i++) {
    const a = (i / balls.length) * Math.PI * 2;
    balls[i].floater.place(Math.cos(a) * 3.4, 0.3, Math.sin(a) * 3.4);
    group.add(balls[i].mesh);
  }
  ctx.scene.add(group);

  let energy = 1.2;
  const offTap = onTap(ctx.shell.canvas, (e) => {
    const p = pickWaterPoint(e, ctx.shell.canvas, ctx.camera);
    if (p) disturb({ kind: "splash", x: p.x, z: p.z, energy, radius: 0.6 });
  });

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.2, 0),
    distance: 14,
    polar: 0.34,
    azimuth: 2.1,
    drift: 0.01,
  });

  ctx.shell.slider({
    label: "splash energy",
    min: 0.1,
    max: 4,
    step: 0.1,
    value: energy,
    onInput: (v) => (energy = v),
  });
  ctx.shell.setInfo(() => "click between the floats — momentum in, buoyancy out");

  ctx.onDispose(() => {
    detach();
    surface.dispose();
    for (const b of balls) b.dispose();
    sky.dispose();
    orbit.dispose();
    offTap();
    sim.dispose();
  });
  return ctx.finish((t, dt) => {
    sim.step(dt);
    surface.update(t);
    for (const b of balls) {
      b.floater.update(dt, t);
      b.sync();
    }
    orbit.update(dt);
  });
}

// ---- Step 1: what an impact actually injects -----------------------------------------------

export async function mountImpulseModes(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const sky = createDawnSky(7.5);
  const dome = sky.makeDome();
  const sim = new FluidSim(ctx.renderer, { resolution: 176, worldSize: 18, depth: 6 });
  const surface = new SimSurface(sim, { env: sky, extent: 0, waves: { ampScale: 0 } });
  ctx.scene.add(dome, surface.mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0, 0),
    distance: 14,
    polar: 0.38,
    azimuth: 1.3,
  });

  let momentum = true;
  let energy = 1.5;
  let auto = 0;
  const strike = (): void => {
    const e = Math.sqrt(energy);
    if (momentum) {
      sim.impulse({ x: 0, z: 0, radius: 0.6, down: 0.12 * e, radial: 1.6 * e });
    } else {
      sim.impulse({ x: 0, z: 0, radius: 0.6, down: 0.45 * e });
    }
  };

  ctx.shell.button("strike", strike);
  ctx.shell.button("mode: cavity ↔ momentum", () => {
    momentum = !momentum;
  });
  ctx.shell.slider({
    label: "impact energy",
    min: 0.2,
    max: 5,
    step: 0.1,
    value: energy,
    onInput: (v) => (energy = v),
  });
  ctx.shell.setInfo(() =>
    momentum
      ? "momentum: shallow cavity + outward kick — rebound jet, then rings"
      : "cavity only: a dent that relaxes — rings, but no rebound",
  );

  ctx.onDispose(() => {
    surface.dispose();
    sky.dispose();
    orbit.dispose();
    sim.dispose();
  });
  return ctx.finish((t, dt) => {
    auto -= dt;
    if (auto <= 0) {
      auto = 3.4;
      strike();
    }
    sim.step(dt);
    surface.update(t);
    orbit.update(dt);
  });
}

// ---- Step 2: the mirror probe -----------------------------------------------------------------

export async function mountMirrorProbe(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const sky = createDawnSky(7.0);
  const dome = sky.makeDome();
  const sim = new FluidSim(ctx.renderer, { resolution: 176, worldSize: 18, depth: 6, mirror: true });
  const waterAt = providerFn(sim);
  const detach = sim.attachToBus();
  const surface = new SimSurface(sim, { env: sky, extent: 300, waves: { windSpeed: 1.8 } });
  ctx.scene.add(dome, surface.mesh);

  // the probe: a small ring of balls glued to CPU-read heights
  const probe = new Group();
  const sun = sky.sunDirection.value as Vector3;
  const probeBalls: { mesh: Mesh; dispose(): void }[] = [];
  for (let i = 0; i < 7; i++) {
    const b = makeBall(0.07, 0xffb86b, sun);
    probeBalls.push(b);
    probe.add(b.mesh);
  }
  ctx.scene.add(probe);
  const probePos = new Vector2(0, 0);

  const canvas = ctx.shell.canvas;
  const moveProbe = (e: PointerEvent): void => {
    const p = pickWaterPoint(e, canvas, ctx.camera);
    if (p && Math.abs(p.x) < 8.6 && Math.abs(p.z) < 8.6) probePos.set(p.x, p.z);
  };
  canvas.addEventListener("pointermove", moveProbe);
  ctx.onDispose(() => canvas.removeEventListener("pointermove", moveProbe));

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.1, 0),
    distance: 13,
    polar: 0.4,
    azimuth: 2.2,
  });

  let dripTimer = 0;
  ctx.shell.setInfo(
    () =>
      `mirror staleness: ${sim.mirrorAge} frame${sim.mirrorAge === 1 ? "" : "s"} · bead y from provider.heightAt — CPU numbers, GPU picture`,
  );

  ctx.onDispose(() => {
    detach();
    surface.dispose();
    for (const b of probeBalls) b.dispose();
    sky.dispose();
    orbit.dispose();
    sim.dispose();
  });
  return ctx.finish((t, dt) => {
    dripTimer -= dt;
    if (dripTimer <= 0) {
      dripTimer = 1.1;
      const a = Math.random() * Math.PI * 2;
      disturb({ kind: "rise", x: Math.cos(a) * 4, z: Math.sin(a) * 4, energy: 0.5, radius: 0.5 });
    }
    sim.step(dt);
    surface.update(t);
    for (let i = 0; i < probeBalls.length; i++) {
      const a = (i / probeBalls.length) * Math.PI * 2 + t * 0.4;
      const x = probePos.x + Math.cos(a) * 0.8;
      const z = probePos.y + Math.sin(a) * 0.8;
      probeBalls[i].mesh.position.set(x, waterAt(x, z, t) + 0.02, z);
    }
    orbit.update(dt);
  });
}

// ---- scrolly: Archimedes on a sphere cap -------------------------------------------------------

export function mountBuoyancyScrolly(el: HTMLElement): void {
  mountScrolly(el, {
    screens: 3.2,
    aspect: 0.52,
    steps: [
      {
        at: 0,
        text: "A floating sphere. The water line cuts it somewhere — the wet part is a spherical cap of height e.",
      },
      {
        at: 0.3,
        text: "Archimedes: the upward force equals the weight of the displaced water — ρ·g·V(e), with V(e) = π e² (3R − e)/3 for a cap.",
      },
      {
        at: 0.6,
        text: "Weight is constant; buoyancy grows as the sphere sinks. Where they cross, the body floats at rest — that's the equilibrium waterline.",
      },
      {
        at: 0.85,
        text: "Push it under and the surplus buoyancy shoves it back; lift it and gravity wins. A floating body IS a spring — which is why everything on water bobs.",
      },
    ],
    draw(c, w, h, t) {
      const cx = w * 0.32;
      const waterY = h * 0.5;
      const R = h * 0.17;
      // the sphere bobs through the phases: starts shallow, sinks to equilibrium, gets dunked
      const sink = lerp(0.45, 1.0, phase(t, 0.25, 0.55)) + phase(t, 0.85, 1) * 0.5 * Math.sin(t * 40) * Math.exp(-(t - 0.85) * 9);
      const centerY = waterY - R + R * sink * 1.1;
      // water
      c.fillStyle = "#143247";
      c.fillRect(w * 0.05, waterY, w * 0.9, h * 0.42);
      // sphere
      c.fillStyle = "#b8902f";
      c.beginPath();
      c.arc(cx, centerY, R, 0, Math.PI * 2);
      c.fill();
      // waterline across the sphere
      c.strokeStyle = PAL.accent;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(w * 0.05, waterY);
      c.lineTo(w * 0.95, waterY);
      c.stroke();
      // cap height annotation
      const e = Math.max(0, Math.min(2 * R, centerY + R - waterY));
      if (e > 4) {
        const bx = cx + R + 18;
        arrow(c, bx, waterY + e, bx, waterY, PAL.warm, 2, 6);
        label(c, "cap e", bx + 8, waterY + e / 2, { color: PAL.warm, size: 12 });
      }
      // forces
      const fb = phase(t, 0.3, 0.45);
      if (fb > 0.02) {
        c.globalAlpha = fb;
        const vol = (e * e * (3 * R - e)) / 3 / (R * R * R); // relative
        arrow(c, cx, centerY, cx, centerY - 30 - vol * 55, PAL.good, 3, 8);
        label(c, "buoyancy ρ·g·V(e)", cx + 14, centerY - 40, { color: PAL.good, size: 12 });
        arrow(c, cx, centerY, cx, centerY + 64, PAL.red, 3, 8);
        label(c, "weight m·g", cx + 14, centerY + 56, { color: PAL.red, size: 12 });
        c.globalAlpha = 1;
      }
      // V(e) curve on the right
      const curve = phase(t, 0.55, 0.75);
      if (curve > 0.02) {
        c.globalAlpha = curve;
        const gx = w * 0.62;
        const gy = h * 0.18;
        const gw = w * 0.3;
        const gh = h * 0.5;
        c.strokeStyle = PAL.dim;
        c.strokeRect(gx, gy, gw, gh);
        c.strokeStyle = PAL.good;
        c.beginPath();
        for (let k = 0; k <= 40; k++) {
          const ee = (k / 40) * 2; // e in units of R
          const v = (ee * ee * (3 - ee)) / 4; // normalized cap volume
          const px = gx + (k / 40) * gw;
          const py = gy + gh - v * gh * 0.95;
          if (k === 0) c.moveTo(px, py);
          else c.lineTo(px, py);
        }
        c.stroke();
        // the weight line
        c.strokeStyle = PAL.red;
        c.setLineDash([4, 4]);
        c.beginPath();
        c.moveTo(gx, gy + gh - 0.42 * gh * 0.95);
        c.lineTo(gx + gw, gy + gh - 0.42 * gh * 0.95);
        c.stroke();
        c.setLineDash([]);
        label(c, "V(e)", gx + gw - 34, gy + 16, { color: PAL.good, size: 12 });
        label(c, "weight", gx + 8, gy + gh - 0.42 * gh * 0.95 - 10, { color: PAL.red, size: 11 });
        label(c, "equilibrium where they cross", gx + gw / 2, gy + gh + 16, {
          color: PAL.muted,
          align: "center",
          size: 11,
        });
        c.globalAlpha = 1;
      }
    },
  });
}

// ---- Step 3: the dunk test -----------------------------------------------------------------------

export async function mountFloatDunk(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const sky = createDawnSky(7.3);
  const dome = sky.makeDome();
  const sim = new FluidSim(ctx.renderer, { resolution: 160, worldSize: 16, depth: 6, mirror: true });
  const waterAt = providerFn(sim);
  const detach = sim.attachToBus();
  const surface = new SimSurface(sim, { env: sky, extent: 200, waves: { windSpeed: 1.4 } });
  ctx.scene.add(dome, surface.mesh);

  let density = 0.42;
  let floater = new Floater({ radius: 0.42, density, sim, waterAt });
  floater.place(0, 0.4, 0);
  const ball = makeBall(0.42, 0xb8902f, sky.sunDirection.value as Vector3);
  ctx.scene.add(ball.mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.1, 0),
    distance: 7,
    polar: 0.22,
    azimuth: 1.9,
  });

  ctx.shell.slider({
    label: "density (water = 1)",
    min: 0.08,
    max: 0.95,
    step: 0.01,
    value: density,
    onInput: (v) => {
      density = v;
      const pos = floater.pos.clone();
      floater = new Floater({ radius: 0.42, density, sim, waterAt });
      floater.place(pos.x, pos.y, pos.z);
    },
  });
  ctx.shell.button("dunk it", () => {
    floater.vel.y = -2.6;
  });
  ctx.shell.button("splash next to it", () =>
    disturb({ kind: "splash", x: 1.6, z: 0, energy: 1.4, radius: 0.55 }),
  );
  ctx.shell.setInfo(
    () => `submerged: ${(floater.submerged * 100).toFixed(0)}% of the sphere (equilibrium ≈ density)`,
  );

  ctx.onDispose(() => {
    detach();
    surface.dispose();
    ball.dispose();
    sky.dispose();
    orbit.dispose();
    sim.dispose();
  });
  return ctx.finish((t, dt) => {
    sim.step(dt);
    surface.update(t);
    floater.update(dt, t);
    ball.mesh.position.copy(floater.pos);
    ball.mesh.quaternion.setFromUnitVectors(UP, floater.up);
    orbit.update(dt);
  });
}

// ---- Step 4: the loop, closed ----------------------------------------------------------------------

export async function mountWakeCircle(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const sky = createDawnSky(6.8);
  const dome = sky.makeDome();
  const sim = new FluidSim(ctx.renderer, { resolution: 192, worldSize: 20, depth: 6, mirror: true });
  const waterAt = providerFn(sim);
  const detach = sim.attachToBus();
  const surface = new SimSurface(sim, { env: sky, extent: 400, waves: { windSpeed: 1.2 } });
  ctx.scene.add(dome, surface.mesh);

  const sun = sky.sunDirection.value as Vector3;
  // the tug: a kinematic floater dragged in a circle, announcing wake events
  const tug = makeBall(0.26, 0xc25b2a, sun);
  ctx.scene.add(tug.mesh);
  // free floats inside and outside the tug's circle
  const balls = [
    makeFloatBall(0.2, 0xb8902f, sun, sim, waterAt),
    makeFloatBall(0.24, 0x6b86a8, sun, sim, waterAt),
    makeFloatBall(0.18, 0x7a995c, sun, sim, waterAt),
  ];
  balls[0].floater.place(0, 0.2, 0);
  balls[1].floater.place(2.1, 0.2, 1.2);
  balls[2].floater.place(-1.4, 0.2, -2.2);
  for (const b of balls) ctx.scene.add(b.mesh);

  let speed = 2.4;
  let angle = 0;
  let wakeTimer = 0;
  const R = 4.2;

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.1, 0),
    distance: 13,
    polar: 0.42,
    azimuth: 1.1,
    drift: 0.008,
  });

  ctx.shell.slider({
    label: "tug speed (m/s)",
    min: 0.5,
    max: 5,
    step: 0.1,
    value: speed,
    onInput: (v) => (speed = v),
  });
  ctx.shell.setInfo(() => "the tug writes wake events; the free floats read the water — full circle");

  ctx.onDispose(() => {
    detach();
    surface.dispose();
    tug.dispose();
    for (const b of balls) b.dispose();
    sky.dispose();
    orbit.dispose();
    sim.dispose();
  });
  return ctx.finish((t, dt) => {
    angle += (speed / R) * dt;
    const x = Math.cos(angle) * R;
    const z = Math.sin(angle) * R;
    const vx = -Math.sin(angle) * speed;
    const vz = Math.cos(angle) * speed;
    tug.mesh.position.set(x, waterAt(x, z, t) - 0.04, z);
    wakeTimer -= dt;
    if (wakeTimer <= 0) {
      wakeTimer = 0.1;
      disturb({ kind: "wake", x, z, energy: 0.045 * speed * speed, radius: 0.5, vx, vz });
    }
    sim.step(dt);
    surface.update(t);
    for (const b of balls) {
      b.floater.update(dt, t);
      b.sync();
    }
    orbit.update(dt);
  });
}
