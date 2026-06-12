// Demos for updrafts.html — the spine wind field as gameplay: gusts, ridge
// lift, thermals, and the vario.
//
// All demos on this page share the ONE spine wind field on purpose: drag the
// wind-speed slider in any figure and the ripples, the streaks, and the bird
// in every other figure feel it too. That agreement is the whole point.

import * as THREE from "three/webgpu";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { label, PAL } from "../../lib/scrolly";
import { wind } from "../../lib/spine";
import {
  FlightBody,
  ridgeLiftInfluence,
  thermalInfluence,
  damp,
  clamp,
  type ThermalSpec,
} from "../../lib/flight";
import { Bin, createRenderer, makeCamera, makeSky, makeWater, WindStreaks } from "./common";
import { mountFlyable, waypointPilot, thermalPilot, type TerrainSpec } from "./flyable";

// ---- the stand-in ridge -------------------------------------------------------
// One long ridge downwind of the lake. Height depends on the along-wind
// coordinate s for a fixed prevailing direction, so rotating the live wind
// direction swaps windward and lee — which is exactly the experiment.
// TODO(lift): swap in src/lib/terrain's heightfield once The Basin ships.

const D0 = 0.6; // the direction the terrain was "built" for
const COS0 = Math.cos(D0);
const SIN0 = Math.sin(D0);

export function ridgeHeightAt(x: number, z: number): number {
  const s = x * COS0 + z * SIN0;
  const crest = 58 * Math.exp(-(((s - 130) / 55) * ((s - 130) / 55)));
  const bumps = 4 * Math.sin(x * 0.043 + 1.3) * Math.sin(z * 0.05);
  return Math.max(crest + bumps - 3, -6);
}

export const RIDGE_TERRAIN: TerrainSpec = { heightAt: ridgeHeightAt, size: 720, segments: 110 };

// The ridge influence is shared by every demo on this page (one wind field!),
// so it must be registered exactly once no matter how many figures wake up.
let ridgeRefs = 0;
let ridgeUnsub: (() => void) | null = null;
function acquireRidgeLift(): () => void {
  if (ridgeRefs++ === 0) ridgeUnsub = wind.addInfluence(ridgeLiftInfluence(ridgeHeightAt));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--ridgeRefs === 0) {
      ridgeUnsub?.();
      ridgeUnsub = null;
    }
  };
}

// Two thermals over the sun-warmed lower slopes (on land, not over the lake).
const HERO_THERMALS: ThermalSpec[] = [
  { x: 60, z: 20, radius: 22, strength: 3, top: 130 },
  { x: 105, z: -45, radius: 16, strength: 2.4, top: 110 },
];

// Waypoints riding the windward face of the ridge (s ≈ 95 line).
function ridgeWaypoints(alt: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (const tau of [-110, 0, 110, 0]) {
    pts.push([95 * COS0 - tau * SIN0, alt, 95 * SIN0 + tau * COS0]);
  }
  return pts;
}

// ---- hero: the whole playground ---------------------------------------------------

export async function mountUpdraftsHero(el: HTMLElement): Promise<Demo> {
  const release = acquireRidgeLift();
  const demo = await mountFlyable(el, {
    aspect: 0.5,
    terrain: RIDGE_TERRAIN,
    thermals: HERO_THERMALS,
    streaks: 900,
    hud: "vario",
    windSliders: "speed",
    trail: true,
    autopilot: waypointPilot(ridgeWaypoints(42), true),
    start: { x: -40, y: 35, z: -60, heading: 0.4, speed: 10 },
    hint: "ride the green streaks · A/D bank · W/S pitch · Space flap",
    cam: { distance: 9, height: 3 },
  });
  return {
    frame: demo.frame,
    dispose: () => {
      demo.dispose?.();
      release();
    },
  };
}

// ---- Step 1: the base field and its gusts -------------------------------------------

export async function mountGusts(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el, 0.52);
  const bin = new Bin();
  const renderer = await createRenderer(shell.canvas);
  bin.add(() => renderer.dispose());

  const scene = new THREE.Scene();
  const camera = makeCamera(shell.canvas, 50);
  makeSky(scene, bin);
  const water = makeWater(scene, bin);
  const streaks = new WindStreaks(
    750,
    new THREE.Vector3(-160, 1.5, -160),
    new THREE.Vector3(160, 14, 160),
  );
  scene.add(streaks.lines);
  bin.add(() => streaks.dispose());

  const saved = { speed: wind.speed, gust: wind.gustiness, dir: wind.direction };
  bin.add(() => {
    wind.speed = saved.speed;
    wind.gustiness = saved.gust;
    wind.direction = saved.dir;
  });
  shell.slider({
    label: "mean wind speed (m/s)",
    min: 0,
    max: 9,
    step: 0.25,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  shell.slider({
    label: "gustiness",
    min: 0,
    max: 1,
    step: 0.05,
    value: wind.gustiness,
    onInput: (v) => (wind.gustiness = v),
  });

  const probe = new THREE.Vector3();
  shell.setInfo(() => {
    wind.sample(0, 5, 0, simT, probe);
    return `wind at the buoy: ${probe.length().toFixed(1)} m/s — same field the ripples read`;
  });

  let last = performance.now();
  let simT = 0;
  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    simT += dt;
    streaks.update(dt, simT);
    water.update();
    const a = simT * 0.045;
    camera.position.set(Math.cos(a) * 130, 60, Math.sin(a) * 130);
    camera.lookAt(0, 4, 0);
    renderer.render(scene, camera);
    shell.tick();
  };
  return { frame, dispose: () => bin.dispose() };
}

// ---- Step 2: ridge lift ----------------------------------------------------------------

export async function mountRidge(el: HTMLElement): Promise<Demo> {
  const release = acquireRidgeLift();
  const demo = await mountFlyable(el, {
    terrain: RIDGE_TERRAIN,
    streaks: 900,
    hud: "vario",
    trail: true,
    windSliders: "speed+direction",
    autopilot: waypointPilot(ridgeWaypoints(40), true),
    start: { x: 0, y: 40, z: -80, heading: 0.5, speed: 10 },
    hint: "soar the windward face — then rotate the wind and watch the lift die",
    cam: { distance: 11, height: 4 },
    info: (b) =>
      `vario ${b.vel.y >= 0 ? "+" : ""}${b.vel.y.toFixed(1)} m/s · alt ${b.pos.y.toFixed(0)} m · flap ${b.flapAmp > 0.05 ? "yes" : "no — the hill is flapping for us"}`,
  });
  return {
    frame: demo.frame,
    dispose: () => {
      demo.dispose?.();
      release();
    },
  };
}

// ---- Step 3: thermals -----------------------------------------------------------------

export function mountThermal(el: HTMLElement): Promise<Demo> {
  // This demo lives far from the hero's ridge so the two influence sets
  // don't overlap in world space (one wind field — placement matters).
  const spec: ThermalSpec = { x: 0, z: -3000, radius: 20, strength: 3, top: 120 };
  return mountFlyable(el, {
    thermals: [spec],
    streaks: 700,
    hud: "vario",
    trail: true,
    autopilot: thermalPilot(spec),
    start: { x: -70, y: 25, z: -3000, heading: 0, speed: 10 },
    hint: "circle the column · tighter circles stay in stronger lift",
    cam: { distance: 12, height: 4.5 },
    setup: ({ shell }) => {
      shell.slider({
        label: "thermal strength (m/s)",
        min: 0.5,
        max: 5,
        step: 0.1,
        value: spec.strength,
        onInput: (v) => (spec.strength = v),
      });
      shell.slider({
        label: "core radius (m)",
        min: 8,
        max: 45,
        step: 1,
        value: spec.radius,
        onInput: (v) => (spec.radius = v),
      });
    },
    info: (b) =>
      `climb ${b.vel.y >= 0 ? "+" : ""}${b.vel.y.toFixed(1)} m/s · alt ${b.pos.y.toFixed(0)} m · gliding (effort ${b.flapAmp.toFixed(1)})`,
  });
}

// ---- Step 4: the vario — an instrument with a personality --------------------------------

export function mountVario(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.5);
  const ctx = shell.canvas.getContext("2d")!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.scale(dpr, dpr);
  const w = shell.canvas.width / dpr;
  const h = shell.canvas.height / dpr;

  // A private lane far from the other demos, with two thermals along it.
  const Z_LANE = 3000;
  const thermals: ThermalSpec[] = [
    { x: 130, z: Z_LANE, radius: 26, strength: 2.8, top: 150 },
    { x: 300, z: Z_LANE, radius: 16, strength: 2, top: 150 },
  ];
  const unsubs = thermals.map((t) => wind.addInfluence(thermalInfluence(t)));

  const body = new FlightBody();
  body.reset(0, 45, Z_LANE, 0, 10);

  let lag = 4; // 1/s — instrument smoothing
  let needle = 0;
  shell.slider({
    label: "vario smoothing (1/s)",
    min: 0.5,
    max: 12,
    step: 0.25,
    value: lag,
    onInput: (v) => (lag = v),
  });
  shell.setInfo(
    () => `true vertical ${body.vel.y >= 0 ? "+" : ""}${body.vel.y.toFixed(2)} m/s · needle ${needle >= 0 ? "+" : ""}${needle.toFixed(2)} m/s`,
  );

  let last = performance.now();
  let simT = 0;

  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    simT += dt;

    // autopilot: hold altitude-ish, fly straight down the lane
    const altErr = 45 - body.pos.y;
    body.commands.pitch = clamp(altErr * 0.06 - body.vel.y * 0.06, -0.5, 0.5);
    body.commands.effort = clamp(0.35 + altErr * 0.08, 0, 1);
    body.commands.bank = clamp((Z_LANE - body.pos.z) * 0.05 - body.vel.z * 0.1, -0.3, 0.3);
    body.step(dt, simT);
    if (body.pos.x > 400) body.reset(0, body.pos.y, Z_LANE, 0, 10);

    needle = damp(needle, body.vel.y, lag, dt);

    // ---- draw ----------------------------------------------------------------
    ctx.fillStyle = "#06070b";
    ctx.fillRect(0, 0, w, h);
    const lw = w * 0.66;
    const sx = (x: number): number => (x / 400) * lw;
    const sy = (y: number): number => h - 24 - (y / 130) * (h - 46);

    // thermal columns
    for (const t of thermals) {
      const x0 = sx(t.x - t.radius * 1.8);
      const x1 = sx(t.x + t.radius * 1.8);
      const grad = ctx.createLinearGradient(x0, 0, x1, 0);
      grad.addColorStop(0, "rgba(125,214,160,0)");
      grad.addColorStop(0.5, `rgba(125,214,160,${(t.strength * 0.05).toFixed(3)})`);
      grad.addColorStop(1, "rgba(125,214,160,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(x0, sy(t.top), x1 - x0, sy(0) - sy(t.top));
    }
    // water
    ctx.fillStyle = "#0d1e33";
    ctx.fillRect(0, sy(0), lw, h - sy(0));
    label(ctx, "thermal", sx(thermals[0].x), sy(thermals[0].top) + 14, {
      color: PAL.good,
      size: 10,
      align: "center",
    });

    // the bird
    const gamma = Math.atan2(body.vel.y, Math.max(Math.hypot(body.vel.x, body.vel.z), 0.01));
    ctx.save();
    ctx.translate(sx(body.pos.x), sy(body.pos.y));
    ctx.rotate(-(gamma + body.alpha));
    ctx.fillStyle = "#e9e4d8";
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(-8, -3.5);
    ctx.lineTo(-4.5, 0);
    ctx.lineTo(-8, 3.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = PAL.grid;
    ctx.beginPath();
    ctx.moveTo(lw + 1, 0);
    ctx.lineTo(lw + 1, h);
    ctx.stroke();

    // ---- the instrument -----------------------------------------------------
    const cx = lw + (w - lw) / 2;
    const cy = h * 0.42;
    const R = Math.min((w - lw) * 0.36, h * 0.3);
    ctx.strokeStyle = PAL.grid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 7);
    ctx.stroke();
    for (let v = -4; v <= 4; v += 1) {
      const ang = Math.PI / 2 + (v / 5) * Math.PI * 0.8;
      const inner = Math.abs(v) % 2 === 0 ? R - 10 : R - 6;
      ctx.strokeStyle = v === 0 ? PAL.muted : PAL.dim;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(ang) * inner, cy - Math.sin(ang) * inner);
      ctx.lineTo(cx - Math.cos(ang) * R, cy - Math.sin(ang) * R);
      ctx.stroke();
    }
    const nAng = Math.PI / 2 + (clamp(needle, -5, 5) / 5) * Math.PI * 0.8;
    ctx.strokeStyle = needle >= 0 ? PAL.good : PAL.warm;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - Math.cos(nAng) * (R - 14), cy - Math.sin(nAng) * (R - 14));
    ctx.stroke();
    label(ctx, "climb m/s", cx, cy + R + 16, { color: PAL.muted, size: 11, align: "center" });
    label(ctx, `${needle >= 0 ? "+" : ""}${needle.toFixed(1)}`, cx, cy + R + 34, {
      color: needle >= 0 ? PAL.good : PAL.warm,
      size: 15,
      align: "center",
      mono: true,
    });

    shell.tick();
  };

  return {
    frame,
    dispose: () => {
      for (const u of unsubs) u();
    },
  };
}
