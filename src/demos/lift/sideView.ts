// A 2D side-view wind-tunnel for the flight model: the same FlightBody,
// constrained to a vertical plane, drawn with plain canvas so the force
// vectors and the numbers stay perfectly legible. forces.html and
// envelope.html teach with this view.

import { Shell, type Demo } from "../../lib/demoShell";
import { arrow, label, PAL } from "../../lib/scrolly";
import { FlightBody, ALPHA_TRIM, damp, clamp } from "../../lib/flight";
import { waterHeightAt } from "../../lib/spine";

const DEG = 180 / Math.PI;

export interface SideViewOptions {
  aspect?: number;
  // slider config
  alphaSlider?: { min: number; max: number; value: number }; // degrees
  effortSlider?: boolean;
  windScale?: number; // 0 = still air (default here — wind is a later post)
  startAlt?: number;
  startSpeed?: number;
  alphaRange?: number; // widen α authority (the stall demo needs to reach 24°)
  forceScale?: number; // px per newton
  showBuffet?: boolean;
  info?: (body: FlightBody) => string;
}

export function mountSideView(el: HTMLElement, opts: SideViewOptions = {}): Demo {
  const shell = new Shell(el, opts.aspect ?? 0.52);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.scale(dpr, dpr);
  const w = W / dpr;
  const h = H / dpr;

  const body = new FlightBody();
  body.windScale = opts.windScale ?? 0;
  if (opts.alphaRange) body.alphaRange = opts.alphaRange;
  const startAlt = opts.startAlt ?? 40;
  const startSpeed = opts.startSpeed ?? 10;
  body.reset(0, startAlt, 0, 0, startSpeed);

  let alphaCmdDeg = opts.alphaSlider?.value ?? ALPHA_TRIM * DEG;
  let effort = 0;

  if (opts.alphaSlider) {
    shell.slider({
      label: "angle of attack α (°)",
      min: opts.alphaSlider.min,
      max: opts.alphaSlider.max,
      step: 0.5,
      value: opts.alphaSlider.value,
      onInput: (v) => (alphaCmdDeg = v),
    });
  }
  if (opts.effortSlider) {
    shell.slider({
      label: "flap effort",
      min: 0,
      max: 1,
      step: 0.05,
      value: 0,
      onInput: (v) => (effort = v),
    });
  }
  shell.button("reset", () => body.reset(0, startAlt, 0, 0, startSpeed));

  shell.setInfo(
    () =>
      opts.info?.(body) ??
      `V ${body.airspeed.toFixed(1)} m/s · sink ${(-body.vel.y).toFixed(2)} m/s · L/D ${(
        body.liftForce.length() / Math.max(body.dragForce.length(), 0.01)
      ).toFixed(1)}`,
  );

  const scale = 7; // px per meter
  let camY = startAlt;
  let camX = 0;
  let last = performance.now();
  let simT = 0;
  const trail: [number, number][] = [];

  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    simT += dt;

    // drive the model from the sliders
    body.commands.pitch = clamp((alphaCmdDeg / DEG - ALPHA_TRIM) / body.alphaRange, -1, 1);
    body.commands.effort = effort;
    body.commands.bank = 0;
    body.step(dt, simT);
    body.pos.z = 0;
    body.vel.z = 0;

    // wrap horizontally so the run never ends; respawn from altitude if parked
    if (body.pos.y < 0.6 && body.airspeed < 2) body.reset(camX, startAlt, 0, 0, startSpeed);

    camX = damp(camX, body.pos.x, 3, dt);
    camY = damp(camY, Math.max(body.pos.y, 8), 2, dt);
    const sx = (x: number): number => w * 0.42 + (x - camX) * scale;
    const sy = (y: number): number => h * 0.48 - (y - camY) * scale;

    trail.push([body.pos.x, body.pos.y]);
    if (trail.length > 240) trail.shift();

    // ---- draw -------------------------------------------------------------
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#0b1322");
    grad.addColorStop(1, "#16263e");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // distance ticks every 20 m
    ctx.strokeStyle = "rgba(42,47,66,.6)";
    ctx.lineWidth = 1;
    const first = Math.floor((camX - w / scale) / 20) * 20;
    for (let gx = first; gx < camX + w / scale; gx += 20) {
      ctx.beginPath();
      ctx.moveTo(sx(gx), 0);
      ctx.lineTo(sx(gx), h);
      ctx.stroke();
    }
    // altitude ticks every 10 m
    for (let gy = 0; gy <= 120; gy += 10) {
      const yy = sy(gy);
      if (yy < 0 || yy > h) continue;
      ctx.strokeStyle = "rgba(42,47,66,.35)";
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(w, yy);
      ctx.stroke();
      label(ctx, `${gy} m`, 6, yy - 7, { color: PAL.dim, size: 10, mono: true });
    }

    // water surface (the spine's ambient waves, exaggerated to be visible)
    const wy = sy(0);
    if (wy < h + 40) {
      ctx.fillStyle = "#0d1e33";
      ctx.fillRect(0, wy, w, h - wy);
      ctx.strokeStyle = "#3d5a7a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let px = 0; px <= w; px += 6) {
        const wx = camX + (px - w * 0.42) / scale;
        const yy = sy(waterHeightAt(wx, 0, simT) * 6);
        if (px === 0) ctx.moveTo(px, yy);
        else ctx.lineTo(px, yy);
      }
      ctx.stroke();
    }

    // trail
    ctx.strokeStyle = "rgba(122,162,255,.45)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < trail.length; i++) {
      const p = trail[i];
      if (i === 0) ctx.moveTo(sx(p[0]), sy(p[1]));
      else ctx.lineTo(sx(p[0]), sy(p[1]));
    }
    ctx.stroke();

    // the bird: a dart aligned with body pitch (flight path + α)
    const bx = sx(body.pos.x);
    let by = sy(body.pos.y);
    if (opts.showBuffet && body.stall > 0.02) by += (Math.random() - 0.5) * 5 * body.stall;
    const gamma = Math.atan2(body.vel.y, Math.max(body.vel.x, 0.01));
    const theta = -(gamma + body.alpha); // screen y is flipped
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(theta);
    ctx.fillStyle = "#e9e4d8";
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-12, -5);
    ctx.lineTo(-7, 0);
    ctx.lineTo(-12, 5);
    ctx.closePath();
    ctx.fill();
    // wing chord line, flapped by the wingbeat
    const flap = Math.sin(body.flapPhase) * (0.1 + 0.6 * body.flapAmp);
    ctx.strokeStyle = "#aab4d4";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(-6, -10 * (0.4 + flap));
    ctx.stroke();
    ctx.restore();

    // force arrows (screen px per N)
    const fs = opts.forceScale ?? 3.2;
    const F = [
      { v: body.liftForce, c: PAL.good, n: "L" },
      { v: body.dragForce, c: PAL.red, n: "D" },
      { v: body.weightForce, c: PAL.dot, n: "W" },
      { v: body.thrustForce, c: PAL.warm, n: "T" },
    ];
    for (const f of F) {
      const fx = f.v.x * fs;
      const fy = -f.v.y * fs;
      if (Math.hypot(fx, fy) < 4) continue;
      arrow(ctx, bx, by, bx + fx, by + fy, f.c, 2, 7);
      label(ctx, f.n, bx + fx * 1.12, by + fy * 1.12, { color: f.c, size: 12 });
    }

    // stall meter
    if (opts.showBuffet) {
      const sw = 110;
      ctx.fillStyle = "rgba(6,7,11,.7)";
      ctx.fillRect(w - sw - 12, 10, sw, 36);
      label(ctx, `stall ${(body.stall * 100).toFixed(0)}%`, w - sw - 4, 22, {
        color: body.stall > 0.4 ? PAL.red : PAL.muted,
        size: 11,
        mono: true,
      });
      ctx.fillStyle = PAL.grid;
      ctx.fillRect(w - sw - 4, 30, sw - 16, 6);
      ctx.fillStyle = body.stall > 0.4 ? PAL.red : PAL.warm;
      ctx.fillRect(w - sw - 4, 30, (sw - 16) * body.stall, 6);
    }

    shell.tick();
  };

  return { frame };
}
