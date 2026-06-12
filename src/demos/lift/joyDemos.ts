// Demos for joy.html — the tuning pass: response curves, camera breathing,
// the FOV kick, and the FlightState telemetry contract.

import { Shell, type Demo } from "../../lib/demoShell";
import { label, PAL } from "../../lib/scrolly";
import { StickControls, expoCurve, applyDeadzone } from "../../lib/flight";
import { FocusOverlay } from "./common";
import { mountFlyable, circlePilot } from "./flyable";

// ---- hero: the thesis, toggleable ----------------------------------------------

export function mountJoyHero(el: HTMLElement): Promise<Demo> {
  return mountFlyable(el, {
    aspect: 0.5,
    joyToggle: true,
    publishState: true,
    allowTuck: true,
    autopilot: circlePilot(0, -20, 55, 30),
    hint: "fly a lap · hit the feel button · fly the same lap again",
  });
}

// ---- Step 1: response curves -------------------------------------------------------

export function mountCurves(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.5);
  const ctx = shell.canvas.getContext("2d")!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.scale(dpr, dpr);
  const w = shell.canvas.width / dpr;
  const h = shell.canvas.height / dpr;

  const controls = new StickControls();
  controls.attach(shell.canvas);
  const overlay = new FocusOverlay(shell.canvas, "hold A/D (or a gamepad stick) — the dot rides the curve");

  let expo = 0.45;
  let deadzone = 0.12;
  shell.slider({
    label: "expo",
    min: 0,
    max: 0.9,
    step: 0.05,
    value: expo,
    onInput: (v) => (expo = v),
  });
  shell.slider({
    label: "deadzone",
    min: 0,
    max: 0.3,
    step: 0.01,
    value: deadzone,
    onInput: (v) => {
      deadzone = v;
      controls.deadzone = v;
    },
  });
  shell.setInfo(() =>
    controls.gamepadActive ? "input: gamepad" : "input: keyboard (ramped to ±1)",
  );

  const history: { x: number; y: number }[] = [];
  let last = performance.now();

  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    controls.update(dt);

    const input = controls.gamepadActive ? controls.rawBank : controls.bank;
    const output = expoCurve(applyDeadzone(input, controls.gamepadActive ? 0 : deadzone), expo);
    history.push({ x: input, y: output });
    if (history.length > 240) history.shift();

    ctx.fillStyle = "#06070b";
    ctx.fillRect(0, 0, w, h);

    // ---- left: the curve ---------------------------------------------------
    const cx = w * 0.27;
    const cy = h * 0.48;
    const R = Math.min(w * 0.2, h * 0.37);
    ctx.strokeStyle = PAL.grid;
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - R, cy - R, 2 * R, 2 * R);
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();
    // linear reference
    ctx.strokeStyle = "rgba(170,180,212,.3)";
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(cx - R, cy + R);
    ctx.lineTo(cx + R, cy - R);
    ctx.stroke();
    ctx.setLineDash([]);
    // deadzone band
    ctx.fillStyle = "rgba(255,133,133,.08)";
    ctx.fillRect(cx - deadzone * R, cy - R, deadzone * 2 * R, 2 * R);
    // the curve
    ctx.strokeStyle = PAL.accent;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = -100; i <= 100; i++) {
      const x = i / 100;
      const y = expoCurve(applyDeadzone(x, deadzone), expo);
      const px = cx + x * R;
      const py = cy - y * R;
      if (i === -100) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // live dot
    ctx.fillStyle = PAL.warm;
    ctx.beginPath();
    ctx.arc(cx + input * R, cy - output * R, 5.5, 0, 7);
    ctx.fill();
    label(ctx, "stick in →", cx + R - 64, cy + 14, { color: PAL.muted, size: 10 });
    label(ctx, "command out", cx + 5, cy - R + 10, { color: PAL.muted, size: 10 });

    // ---- right: the same signal over time ------------------------------------
    const gx = w * 0.55;
    const gw = w * 0.4;
    const gh = h * 0.3;
    const gy = h * 0.48;
    ctx.strokeStyle = PAL.grid;
    ctx.strokeRect(gx, gy - gh, gw, gh * 2);
    const plot = (key: "x" | "y", color: string, lw: number): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const px = gx + (i / 239) * gw;
        const py = gy - history[i][key] * gh * 0.9;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    };
    plot("x", "rgba(255,184,107,.5)", 1);
    plot("y", PAL.accent, 2);
    label(ctx, "input", gx + 6, gy - gh + 12, { color: PAL.warm, size: 10 });
    label(ctx, "after expo + deadzone", gx + 6, gy - gh + 26, { color: PAL.accent, size: 10 });

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

// ---- Step 2: camera breathing -----------------------------------------------------

export function mountBreathing(el: HTMLElement): Promise<Demo> {
  return mountFlyable(el, {
    feelSliders: true,
    cam: { breathe: 0.6, flapBob: 0.6 },
    autopilot: circlePilot(0, 0, 50, 28),
    hint: "watch the horizon at zero, then at full — the camera starts to be alive",
  });
}

// ---- Step 3: the FOV kick -----------------------------------------------------------

export function mountFovKick(el: HTMLElement): Promise<Demo> {
  return mountFlyable(el, {
    fovSliders: true,
    allowTuck: true,
    cam: { fovSpeedGain: 1.1, fovKickGain: 0.5 },
    start: { x: -70, y: 60, z: 0, heading: 0, speed: 10 },
    autopilot: (body) => {
      const phase = (performance.now() / 1000) % 11;
      body.commands.bank = 0.12;
      if (phase < 4) {
        body.commands.effort = 0.6;
        body.commands.pitch = 0.4;
        body.commands.tuck = 0;
      } else if (phase < 7.5 && body.pos.y > 14) {
        body.commands.effort = 0;
        body.commands.pitch = -0.6;
        body.commands.tuck = 1;
      } else {
        body.commands.tuck = 0;
        body.commands.pitch = 0.85;
        body.commands.effort = body.pos.y < 25 ? 0.8 : 0.2;
      }
    },
    hint: "Shift to dive · the kick answers acceleration, not just speed",
  });
}

// ---- Step 4: the FlightState contract --------------------------------------------------

export function mountTelemetry(el: HTMLElement): Promise<Demo> {
  return mountFlyable(el, {
    hud: "telemetry",
    publishState: true,
    allowTuck: true,
    autopilot: circlePilot(0, 0, 55, 32),
    hint: "everything on the panel is read from flightState — the same object audio will read",
  });
}
