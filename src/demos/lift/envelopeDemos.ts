// Demos for envelope.html — stall, mush, dive, flare, and the picture that
// holds them all.

import { Shell, type Demo } from "../../lib/demoShell";
import { label, PAL } from "../../lib/scrolly";
import {
  FlightBody,
  liftCoefficient,
  dragCoefficient,
  stallBlend,
  ALPHA_STALL,
  AIR_DENSITY,
  OSPREY,
  G,
  clamp,
} from "../../lib/flight";
import { mountFlyable } from "./flyable";
import { mountSideView } from "./sideView";

const DEG = 180 / Math.PI;
const WEIGHT = OSPREY.mass * G;

// ---- hero: flyable with the live envelope inset --------------------------------

export function mountEnvelopeHero(el: HTMLElement): Promise<Demo> {
  return mountFlyable(el, {
    aspect: 0.5,
    windScale: 0,
    hud: "envelope",
    allowTuck: true,
    start: { x: -50, y: 45, z: 0, heading: 0, speed: 10 },
    hint: "W/S pitch · hold W to stall · Shift to tuck and dive · Space flap",
    setup: ({ body }) => {
      body.alphaRange = 0.24; // this post is about the edges — let us reach them
    },
    autopilot: (body) => {
      // attract mode: wander the envelope so the inset draws itself
      const phase = (performance.now() / 1000) % 16;
      body.commands.bank = 0.15;
      if (phase < 6) {
        body.commands.pitch = 0.1;
        body.commands.effort = 0.45;
        body.commands.tuck = 0;
      } else if (phase < 9) {
        body.commands.pitch = 0.95;
        body.commands.effort = 0.1;
        body.commands.tuck = 0;
      } else if (phase < 12.5) {
        body.commands.pitch = -0.5;
        body.commands.effort = 0;
        body.commands.tuck = 1;
      } else {
        body.commands.pitch = 0.8;
        body.commands.effort = 0.3;
        body.commands.tuck = 0;
      }
      if (body.pos.y < 12) {
        body.commands.pitch = 0.8;
        body.commands.tuck = 0;
        body.commands.effort = 1;
      }
      if (body.pos.y > 60) body.commands.pitch = Math.min(body.commands.pitch, 0);
    },
    info: (b) =>
      `α ${(b.alpha * DEG).toFixed(1)}° · V ${b.airspeed.toFixed(1)} m/s · stall ${(b.stall * 100).toFixed(0)}% · n ${(
        b.liftForce.length() / WEIGHT
      ).toFixed(1)} g`,
  });
}

// ---- Step 1: the stall curve, up close --------------------------------------------

export function mountStallCurve(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.5);
  const ctx = shell.canvas.getContext("2d")!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.scale(dpr, dpr);
  const w = shell.canvas.width / dpr;
  const h = shell.canvas.height / dpr;

  let alphaDeg = 10;
  shell.slider({
    label: "angle of attack α (°)",
    min: 0,
    max: 28,
    step: 0.25,
    value: alphaDeg,
    onInput: (v) => (alphaDeg = v),
  });
  shell.setInfo(() => {
    const a = alphaDeg / DEG;
    const cl = liftCoefficient(a);
    const vLevel = Math.sqrt((2 * WEIGHT) / (AIR_DENSITY * OSPREY.wingArea * Math.max(cl, 0.05)));
    return `C_L ${cl.toFixed(2)} · C_D ${dragCoefficient(a).toFixed(3)} · separation ${(stallBlend(a) * 100).toFixed(0)}% · level-flight speed ${vLevel.toFixed(1)} m/s`;
  });

  const frame = (): void => {
    ctx.fillStyle = "#06070b";
    ctx.fillRect(0, 0, w, h);
    const X = (aDeg: number): number => 50 + (aDeg / 28) * (w - 80);
    const Y = (c: number): number => h - 44 - (c / 1.6) * (h - 78);

    // separation shading under the blend
    for (let a = 0; a <= 28; a += 0.5) {
      const s = stallBlend(a / DEG);
      if (s <= 0.005) continue;
      ctx.fillStyle = `rgba(255,133,133,${(s * 0.16).toFixed(3)})`;
      ctx.fillRect(X(a), Y(1.6), X(a + 0.5) - X(a) + 1, Y(0) - Y(1.6));
    }

    ctx.strokeStyle = PAL.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    ctx.lineTo(X(28), Y(0));
    ctx.moveTo(X(0), Y(0));
    ctx.lineTo(X(0), Y(1.6));
    ctx.stroke();
    for (const a of [5, 10, 15, 20, 25])
      label(ctx, `${a}°`, X(a), Y(0) + 12, { color: PAL.dim, size: 10, align: "center", mono: true });

    // the two regimes, shown separately…
    const dashed = (fn: (a: number) => number, color: string): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      for (let a = 0; a <= 28; a += 0.4) {
        const y = Y(Math.max(0, Math.min(1.6, fn(a / DEG))));
        if (a === 0) ctx.moveTo(X(a), y);
        else ctx.lineTo(X(a), y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    dashed((a) => 5.0 * a, "rgba(122,162,255,.45)"); // attached line continued
    dashed((a) => 1.1 * Math.sin(2 * a), "rgba(255,133,133,.5)"); // flat plate

    // …and the blend we actually fly
    ctx.strokeStyle = PAL.accent;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let a = 0; a <= 28; a += 0.25) {
      const y = Y(liftCoefficient(a / DEG));
      if (a === 0) ctx.moveTo(X(a), y);
      else ctx.lineTo(X(a), y);
    }
    ctx.stroke();

    label(ctx, "attached: C_L = 5.0·α", X(8.2), Y(5 * (10 / DEG)) - 26, { color: "rgba(122,162,255,.8)", size: 11 });
    label(ctx, "separated: 1.1·sin 2α", X(20), Y(1.1 * Math.sin(2 * (24 / DEG))) + 22, {
      color: "rgba(255,133,133,.85)",
      size: 11,
    });
    label(ctx, "stall begins", X(ALPHA_STALL * DEG), Y(1.55), { color: PAL.red, size: 11 });

    // operating point
    const a = alphaDeg / DEG;
    ctx.fillStyle = PAL.warm;
    ctx.beginPath();
    ctx.arc(X(alphaDeg), Y(liftCoefficient(a)), 5, 0, 7);
    ctx.fill();

    shell.tick();
  };
  return { frame };
}

// ---- Step 2: the mush ---------------------------------------------------------------

export function mountMush(el: HTMLElement): Demo {
  return mountSideView(el, {
    alphaSlider: { min: 2, max: 24, value: 6 },
    effortSlider: true,
    alphaRange: 0.32, // enough authority to fly past the stall on purpose
    windScale: 0,
    startAlt: 70,
    showBuffet: true,
    info: (b) =>
      `α ${(b.alpha * DEG).toFixed(1)}° · stall ${(b.stall * 100).toFixed(0)}% · sink ${Math.max(0, -b.vel.y).toFixed(2)} m/s · V ${b.airspeed.toFixed(1)} m/s`,
  });
}

// ---- Step 3: the dive -----------------------------------------------------------------

export function mountDive(el: HTMLElement): Promise<Demo> {
  let peak = 0;
  return mountFlyable(el, {
    windScale: 0,
    allowTuck: true,
    trail: true,
    start: { x: -80, y: 75, z: 0, heading: 0, speed: 10 },
    hint: "hold Shift to tuck · release and hold W to flare",
    cam: { distance: 8, height: 2.2, fovSpeedGain: 1.2 },
    setup: ({ body }) => {
      body.alphaRange = 0.2; // extra flare authority for the pullout
    },
    autopilot: (body) => {
      const phase = (performance.now() / 1000) % 13;
      body.commands.bank = 0.1;
      if (phase < 4) {
        body.commands.effort = 0.7;
        body.commands.pitch = 0.45;
        body.commands.tuck = 0;
      } else if (phase < 8 && body.pos.y > 14) {
        body.commands.effort = 0;
        body.commands.pitch = -0.65;
        body.commands.tuck = 1;
      } else {
        body.commands.tuck = 0;
        body.commands.pitch = 0.9;
        body.commands.effort = body.pos.y < 25 ? 0.8 : 0.2;
      }
    },
    info: (b) => {
      peak = Math.max(peak, b.airspeed) * 0.9999;
      return `V ${b.airspeed.toFixed(1)} m/s · peak ${peak.toFixed(1)} m/s · n ${(
        b.liftForce.length() / WEIGHT
      ).toFixed(1)} g · alt ${b.pos.y.toFixed(0)} m`;
    },
  });
}

// ---- Step 4: the whole envelope, traced -------------------------------------------------

export function mountEnvelopeChart(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.54);
  const ctx = shell.canvas.getContext("2d")!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.scale(dpr, dpr);
  const w = shell.canvas.width / dpr;
  const h = shell.canvas.height / dpr;

  const body = new FlightBody();
  body.windScale = 0;
  body.alphaRange = 0.24;
  body.reset(0, 70, 0, 0, 10);

  let simT = 0;
  let loopT = 0;
  let last = performance.now();
  const trail2d: [number, number][] = [];
  const envTrail: [number, number][] = [];

  const PHASES: { until: number; name: string; pitch: number; effort: number; tuck: number }[] = [
    { until: 5, name: "cruise", pitch: 0.12, effort: 0.42, tuck: 0 },
    { until: 9, name: "pull up → stall", pitch: 0.95, effort: 0.12, tuck: 0 },
    { until: 12.5, name: "nose down, recover", pitch: -0.45, effort: 0.25, tuck: 0 },
    { until: 16.5, name: "tuck and dive", pitch: -0.55, effort: 0, tuck: 1 },
    { until: 19, name: "flare", pitch: 0.75, effort: 0.25, tuck: 0 },
    { until: 24, name: "level out", pitch: 0.1, effort: 0.5, tuck: 0 },
  ];

  shell.button("restart", () => {
    loopT = 0;
    body.reset(0, 70, 0, 0, 10);
    trail2d.length = 0;
    envTrail.length = 0;
  });
  shell.setInfo(
    () =>
      `α ${(body.alpha * DEG).toFixed(1)}° · V ${body.airspeed.toFixed(1)} m/s · n ${(
        body.liftForce.length() / WEIGHT
      ).toFixed(1)} g`,
  );

  let phaseName = "cruise";

  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    simT += dt;
    loopT += dt;
    if (loopT >= 24) {
      loopT = 0;
      body.reset(body.pos.x, 70, 0, 0, 10);
      trail2d.length = 0;
    }
    const ph = PHASES.find((p) => loopT < p.until) ?? PHASES[0];
    phaseName = ph.name;
    body.commands.pitch = ph.pitch;
    body.commands.effort = ph.effort;
    body.commands.tuck = ph.tuck;
    body.commands.bank = 0;
    if (body.pos.y < 10 && ph.tuck > 0) {
      body.commands.tuck = 0;
      body.commands.pitch = 1;
    }
    body.step(dt, simT);
    body.pos.z = 0;
    body.vel.z = 0;

    trail2d.push([body.pos.x, body.pos.y]);
    if (trail2d.length > 700) trail2d.shift();
    envTrail.push([body.airspeed, body.alpha * DEG]);
    if (envTrail.length > 400) envTrail.shift();

    // ---- left: side profile ------------------------------------------------
    ctx.fillStyle = "#06070b";
    ctx.fillRect(0, 0, w, h);
    const lw = w * 0.46;
    const scale = (lw - 30) / 260;
    const sx = (x: number): number => 14 + (x - (body.pos.x - 130)) * scale;
    const sy = (y: number): number => h - 30 - y * scale * 1.0;
    ctx.fillStyle = "#0d1e33";
    ctx.fillRect(0, sy(0), lw, h - sy(0));
    ctx.strokeStyle = "rgba(122,162,255,.5)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < trail2d.length; i++) {
      const p = trail2d[i];
      const x = sx(p[0]);
      if (x < 0) continue;
      if (i === 0) ctx.moveTo(x, sy(p[1]));
      else ctx.lineTo(x, sy(p[1]));
    }
    ctx.stroke();
    // the bird
    const gamma = Math.atan2(body.vel.y, Math.max(body.vel.x, 0.01));
    ctx.save();
    ctx.translate(sx(body.pos.x), sy(body.pos.y));
    ctx.rotate(-(gamma + body.alpha));
    ctx.fillStyle = "#e9e4d8";
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-9, -4);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-9, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    label(ctx, phaseName, 14, 18, { color: PAL.warm, size: 13 });
    ctx.strokeStyle = PAL.grid;
    ctx.beginPath();
    ctx.moveTo(lw, 0);
    ctx.lineTo(lw, h);
    ctx.stroke();

    // ---- right: the envelope ------------------------------------------------
    const X = (v: number): number => lw + 44 + (clamp(v, 0, 32) / 32) * (w - lw - 64);
    const Y = (aDeg: number): number => h - 36 - ((clamp(aDeg, -8, 28) + 8) / 36) * (h - 62);
    // stall region
    ctx.fillStyle = "rgba(255,133,133,.1)";
    ctx.fillRect(X(0), Y(28), X(32) - X(0), Y(ALPHA_STALL * DEG) - Y(28));
    // slow region: below min level-flight speed at C_Lmax
    const vMin = Math.sqrt((2 * WEIGHT) / (AIR_DENSITY * OSPREY.wingArea * 1.4));
    ctx.fillStyle = "rgba(255,184,107,.07)";
    ctx.fillRect(X(0), Y(28), X(vMin) - X(0), Y(-8) - Y(28));
    // trim curve
    ctx.strokeStyle = PAL.accent;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let started = false;
    for (let v = 5; v <= 32; v += 0.4) {
      const clNeed = (2 * WEIGHT) / (AIR_DENSITY * v * v * OSPREY.wingArea);
      const aDeg = (clNeed / 5) * DEG;
      if (aDeg > 28) continue;
      if (!started) {
        ctx.moveTo(X(v), Y(aDeg));
        started = true;
      } else ctx.lineTo(X(v), Y(aDeg));
    }
    ctx.stroke();
    ctx.strokeStyle = PAL.red;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(X(0), Y(ALPHA_STALL * DEG));
    ctx.lineTo(X(32), Y(ALPHA_STALL * DEG));
    ctx.stroke();
    ctx.setLineDash([]);
    // axes labels
    label(ctx, "α (deg)", lw + 8, 16, { color: PAL.muted, size: 11 });
    label(ctx, "airspeed (m/s) →", w - 130, h - 10, { color: PAL.muted, size: 11 });
    label(ctx, "stall line", X(24), Y(ALPHA_STALL * DEG) - 7, { color: PAL.red, size: 10 });
    label(ctx, "level-flight trim", X(13), Y(6) + 16, { color: PAL.accent, size: 10 });
    label(ctx, "too slow", X(1.4), Y(4), { color: PAL.warm, size: 10 });
    // trace
    for (let i = 0; i < envTrail.length; i++) {
      ctx.fillStyle = `rgba(255,184,107,${((i / envTrail.length) * 0.55).toFixed(3)})`;
      ctx.fillRect(X(envTrail[i][0]) - 1, Y(envTrail[i][1]) - 1, 2.4, 2.4);
    }
    ctx.fillStyle = PAL.warm;
    ctx.beginPath();
    ctx.arc(X(body.airspeed), Y(body.alpha * DEG), 4.4, 0, 7);
    ctx.fill();

    shell.tick();
  };
  return { frame };
}
