// Demos for stick.html — commands, the banked turn, and the chase camera.

import { Shell, type Demo } from "../../lib/demoShell";
import { label, PAL } from "../../lib/scrolly";
import { StickControls, clamp, damp, G } from "../../lib/flight";
import { FocusOverlay } from "./common";
import { mountFlyable, circlePilot } from "./flyable";

const DEG = 180 / Math.PI;

// ---- hero: fully flyable ---------------------------------------------------

export function mountStickHero(el: HTMLElement): Promise<Demo> {
  return mountFlyable(el, {
    aspect: 0.5,
    windScale: 0,
    autopilot: circlePilot(0, -20, 60, 32),
    hint: "A/D or ←/→ bank · W/S or ↑/↓ pitch · Space flap · Shift tuck · gamepad works too",
  });
}

// ---- Step 1: commands, not positions -----------------------------------------

export function mountCommands(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.5);
  const ctx = shell.canvas.getContext("2d")!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.scale(dpr, dpr);
  const w = shell.canvas.width / dpr;
  const h = shell.canvas.height / dpr;

  const controls = new StickControls();
  controls.attach(shell.canvas);
  const overlay = new FocusOverlay(shell.canvas, "hold A/D and W/S — watch raw vs smoothed");

  shell.slider({
    label: "rise rate (1/s)",
    min: 1,
    max: 20,
    step: 0.5,
    value: controls.riseRate,
    onInput: (v) => (controls.riseRate = v),
  });
  shell.slider({
    label: "fall rate (1/s)",
    min: 1,
    max: 20,
    step: 0.5,
    value: controls.fallRate,
    onInput: (v) => (controls.fallRate = v),
  });
  shell.setInfo(() =>
    controls.gamepadActive ? "input: gamepad (analog passthrough)" : "input: keyboard (ramped)",
  );

  const history: { raw: number; smooth: number }[] = [];
  let last = performance.now();

  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    controls.update(dt);
    history.push({ raw: controls.rawBank, smooth: controls.bank });
    if (history.length > 360) history.shift();

    ctx.fillStyle = "#06070b";
    ctx.fillRect(0, 0, w, h);

    // ---- left: the stick cross ------------------------------------------
    const cx = w * 0.22;
    const cy = h * 0.46;
    const R = Math.min(w * 0.17, h * 0.34);
    ctx.strokeStyle = PAL.grid;
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - R, cy - R, R * 2, R * 2);
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();
    label(ctx, "bank →", cx + R - 44, cy + 14, { color: PAL.muted, size: 10 });
    label(ctx, "pitch", cx + 6, cy - R + 10, { color: PAL.muted, size: 10 });
    // raw target: hollow
    ctx.strokeStyle = PAL.warm;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx + controls.rawBank * R, cy - controls.rawPitch * R, 7, 0, 7);
    ctx.stroke();
    // smoothed command: filled
    ctx.fillStyle = PAL.accent;
    ctx.beginPath();
    ctx.arc(cx + controls.bank * R, cy - controls.pitch * R, 5, 0, 7);
    ctx.fill();
    label(ctx, "raw key target", cx - R, cy + R + 16, { color: PAL.warm, size: 11 });
    label(ctx, "smoothed command", cx - R, cy + R + 32, { color: PAL.accent, size: 11 });

    // ---- right: six seconds of bank command --------------------------------
    const gx = w * 0.45;
    const gw = w * 0.5;
    const gy = h * 0.46;
    const gh = h * 0.3;
    ctx.strokeStyle = PAL.grid;
    ctx.strokeRect(gx, gy - gh, gw, gh * 2);
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + gw, gy);
    ctx.stroke();
    const plot = (key: "raw" | "smooth", color: string): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = key === "raw" ? 1 : 2;
      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const x = gx + (i / 359) * gw;
        const y = gy - history[i][key] * gh * 0.92;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    plot("raw", "rgba(255,184,107,.55)");
    plot("smooth", PAL.accent);
    label(ctx, "bank command, last 6 s", gx, gy - gh - 8, { color: PAL.muted, size: 11 });
    label(ctx, "+1", gx - 18, gy - gh * 0.92, { color: PAL.dim, size: 10, mono: true });
    label(ctx, "−1", gx - 18, gy + gh * 0.92, { color: PAL.dim, size: 10, mono: true });

    // effort bar
    label(ctx, "flap (Space)", gx, gy + gh + 22, { color: PAL.muted, size: 11 });
    ctx.fillStyle = PAL.grid;
    ctx.fillRect(gx + 90, gy + gh + 15, 140, 8);
    ctx.fillStyle = PAL.good;
    ctx.fillRect(gx + 90, gy + gh + 15, 140 * controls.effort, 8);

    shell.tick();
  };

  return {
    frame,
    dispose: () => {
      controls.detach();
      overlay.dispose();
    },
  };
}

// ---- Step 2: bank → turn -------------------------------------------------------

export function mountBankTurn(el: HTMLElement): Promise<Demo> {
  let bankDeg = 30;
  let headingPrev = 0;
  let omega = 0;
  let lastInfo = performance.now();
  return mountFlyable(el, {
    aspect: 0.56,
    noControls: true,
    windScale: 0,
    arrows: true,
    trail: true,
    start: { x: 0, y: 30, z: -35, heading: 0, speed: 10 },
    fixedCamera: { pos: [-70, 62, 0], lookAt: [0, 22, 0] },
    autopilot: (body) => {
      body.commands.bank = bankDeg / DEG / body.maxBank;
      const altErr = 30 - body.pos.y;
      body.commands.pitch = clamp(altErr * 0.1 - body.vel.y * 0.12, -0.6, 0.8);
      body.commands.effort = clamp(0.35 + altErr * 0.12 + (10 - body.airspeed) * 0.12, 0, 1);
    },
    setup: ({ shell }) => {
      shell.slider({
        label: "bank angle φ (°)",
        min: 12,
        max: 55,
        step: 1,
        value: bankDeg,
        onInput: (v) => (bankDeg = v),
      });
    },
    info: (body) => {
      const now = performance.now();
      const dtI = Math.max((now - lastInfo) / 1000, 1e-3);
      lastInfo = now;
      const heading = Math.atan2(body.vel.z, body.vel.x);
      let dh = heading - headingPrev;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      headingPrev = heading;
      omega = damp(omega, dh / dtI, 1.5, dtI);
      const v = Math.hypot(body.vel.x, body.vel.z);
      const measured = Math.abs(omega) > 0.02 ? v / Math.abs(omega) : Infinity;
      const predicted = (v * v) / (G * Math.tan(Math.abs(body.bank) + 1e-4));
      return `r predicted ${predicted.toFixed(0)} m · r measured ${
        isFinite(measured) ? measured.toFixed(0) : "—"
      } m · φ ${(body.bank * DEG).toFixed(0)}°`;
    },
  });
}

// ---- Step 3: the chase camera ----------------------------------------------------

export function mountChaseCam(el: HTMLElement): Promise<Demo> {
  return mountFlyable(el, {
    windScale: 0,
    autopilot: circlePilot(0, 0, 50, 28),
    camSliders: true,
    hint: "fly it — then drag the stiffness down and feel the camera go seasick",
  });
}

// ---- Step 4: speed in the lens ------------------------------------------------------

export function mountFovSpeed(el: HTMLElement): Promise<Demo> {
  return mountFlyable(el, {
    windScale: 0,
    fovSliders: true,
    allowTuck: true,
    cam: { fovKickGain: 0 },
    start: { x: -60, y: 55, z: 0, heading: 0, speed: 11 },
    autopilot: (body) => {
      // a lazy oscillation between cruise and shallow dive, to sweep the FOV
      const phase = (performance.now() / 1000) % 12;
      body.commands.effort = phase < 5 ? 0.5 : 0;
      body.commands.tuck = phase >= 6 && phase < 9 ? 1 : 0;
      body.commands.pitch = phase >= 6 && phase < 9 ? -0.5 : 0.25;
      body.commands.bank = 0.18;
      if (body.pos.y < 12) body.commands.pitch = 0.7;
      if (body.pos.y < 8) {
        body.commands.tuck = 0;
        body.commands.effort = 1;
      }
    },
    hint: "Shift to tuck and dive · watch the edges of the frame",
    info: (b) => `V ${b.airspeed.toFixed(1)} m/s · alt ${b.pos.y.toFixed(0)} m`,
  });
}
