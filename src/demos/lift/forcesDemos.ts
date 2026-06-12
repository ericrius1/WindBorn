// Demos for forces.html — the four-force point mass.

import { Shell, type Demo } from "../../lib/demoShell";
import { mountScrolly, arrow, label, phase, PAL } from "../../lib/scrolly";
import {
  liftCoefficient,
  dragCoefficient,
  ALPHA_STALL,
  AIR_DENSITY,
  OSPREY,
  G,
} from "../../lib/flight";
import { mountFlyable, circlePilot } from "./flyable";
import { mountSideView } from "./sideView";

const DEG = 180 / Math.PI;
const WEIGHT = OSPREY.mass * G;

// ---- hero: the finished system, circling ------------------------------------

export function mountForcesHero(el: HTMLElement): Promise<Demo> {
  return mountFlyable(el, {
    aspect: 0.5,
    windScale: 0,
    arrows: true,
    autopilot: circlePilot(0, -10, 55, 30),
    hint: "A/D bank · W/S pitch · Space flap — or just watch",
    cam: { distance: 9, height: 3.2 },
    info: (b) =>
      `L ${b.liftForce.length().toFixed(1)} N · D ${b.dragForce.length().toFixed(1)} N · ` +
      `W ${WEIGHT.toFixed(1)} N · T ${b.thrustForce.length().toFixed(1)} N · V ${b.airspeed.toFixed(1)} m/s`,
  });
}

// ---- Step 1: the lift curve, interactive --------------------------------------

export function mountLiftCurve(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.52);
  const ctx = shell.canvas.getContext("2d")!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.scale(dpr, dpr);
  const w = shell.canvas.width / dpr;
  const h = shell.canvas.height / dpr;

  let alphaDeg = 6;
  let speed = 10;
  shell.slider({
    label: "angle of attack α (°)",
    min: -6,
    max: 26,
    step: 0.5,
    value: alphaDeg,
    onInput: (v) => (alphaDeg = v),
  });
  shell.slider({
    label: "airspeed V (m/s)",
    min: 4,
    max: 30,
    step: 0.5,
    value: speed,
    onInput: (v) => (speed = v),
  });
  shell.setInfo(() => {
    const a = alphaDeg / DEG;
    const q = 0.5 * AIR_DENSITY * speed * speed * OSPREY.wingArea;
    return `C_L ${liftCoefficient(a).toFixed(2)} · C_D ${dragCoefficient(a).toFixed(3)} · L ${(
      q * liftCoefficient(a)
    ).toFixed(1)} N vs W ${WEIGHT.toFixed(1)} N`;
  });

  const frame = (): void => {
    ctx.fillStyle = "#06070b";
    ctx.fillRect(0, 0, w, h);
    const plotW = w * 0.62;
    const X = (aDeg: number): number => 46 + ((aDeg + 8) / 36) * (plotW - 60);
    const Y = (c: number): number => h - 40 - ((c + 0.5) / 2.2) * (h - 70);

    // axes
    ctx.strokeStyle = PAL.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(-8), Y(0));
    ctx.lineTo(X(28), Y(0));
    ctx.moveTo(X(0), Y(-0.5));
    ctx.lineTo(X(0), Y(1.7));
    ctx.stroke();
    label(ctx, "α →", X(26), Y(0) + 14, { color: PAL.muted, size: 11 });
    label(ctx, "coefficient", X(0) + 6, Y(1.7) + 8, { color: PAL.muted, size: 11 });

    // stall band
    ctx.fillStyle = "rgba(255,133,133,.08)";
    ctx.fillRect(X(ALPHA_STALL * DEG), Y(1.7), X(28) - X(ALPHA_STALL * DEG), Y(-0.5) - Y(1.7));
    label(ctx, "stall", X(ALPHA_STALL * DEG) + 6, Y(1.6), { color: PAL.red, size: 11 });

    // curves
    const curve = (fn: (a: number) => number, color: string): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let a = -8; a <= 28; a += 0.4) {
        const x = X(a);
        const y = Y(fn(a / DEG));
        if (a === -8) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    curve(liftCoefficient, PAL.accent);
    curve(dragCoefficient, PAL.red);
    label(ctx, "C_L", X(11), Y(liftCoefficient(11 / DEG)) - 12, { color: PAL.accent, size: 12 });
    label(ctx, "C_D", X(20), Y(dragCoefficient(20 / DEG)) + 14, { color: PAL.red, size: 12 });

    // operating point
    const a = alphaDeg / DEG;
    ctx.fillStyle = PAL.warm;
    ctx.beginPath();
    ctx.arc(X(alphaDeg), Y(liftCoefficient(a)), 4.5, 0, 7);
    ctx.fill();

    // right panel: force bars at this α and V
    const q = 0.5 * AIR_DENSITY * speed * speed * OSPREY.wingArea;
    const L = q * liftCoefficient(a);
    const D = q * dragCoefficient(a);
    const bx = plotW + 30;
    const bw = (w - bx - 30) / 2.6;
    const maxN = 40;
    const bar = (x: number, val: number, color: string, name: string): void => {
      const bh = Math.min(val / maxN, 1) * (h - 90);
      ctx.fillStyle = color;
      ctx.fillRect(x, h - 50 - bh, bw, bh);
      label(ctx, name, x + bw / 2, h - 36, { color: PAL.muted, size: 11, align: "center" });
      label(ctx, `${val.toFixed(1)} N`, x + bw / 2, h - 58 - bh, {
        color,
        size: 11,
        align: "center",
        mono: true,
      });
    };
    bar(bx, L, PAL.good, "lift");
    bar(bx + bw * 1.5, D, PAL.red, "drag");
    // the weight line to beat
    const wy = h - 50 - (WEIGHT / maxN) * (h - 90);
    ctx.strokeStyle = PAL.dot;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(bx - 10, wy);
    ctx.lineTo(bx + bw * 2.5 + 10, wy);
    ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, `weight ${WEIGHT.toFixed(1)} N`, bx + bw * 1.25, wy - 9, {
      color: PAL.dot,
      size: 10,
      align: "center",
      mono: true,
    });

    shell.tick();
  };
  return { frame };
}

// ---- Step 2: the glide --------------------------------------------------------

export function mountGlide(el: HTMLElement): Demo {
  return mountSideView(el, {
    alphaSlider: { min: -2, max: 14, value: 5 },
    windScale: 0,
    startAlt: 60,
    info: (b) => {
      const gr = b.vel.x / Math.max(-b.vel.y, 0.01);
      return `V ${b.airspeed.toFixed(1)} m/s · sink ${Math.max(0, -b.vel.y).toFixed(2)} m/s · glide ratio ${
        b.vel.y < -0.02 ? gr.toFixed(1) : "—"
      }`;
    },
  });
}

// ---- Step 3: flap thrust --------------------------------------------------------

export function mountFlapClimb(el: HTMLElement): Demo {
  return mountSideView(el, {
    alphaSlider: { min: -2, max: 14, value: 6 },
    effortSlider: true,
    windScale: 0,
    startAlt: 30,
    info: (b) => {
      const power = b.thrustForce.length() * b.airspeed;
      return `climb ${b.vel.y >= 0 ? "+" : ""}${b.vel.y.toFixed(2)} m/s · thrust ${b.thrustForce
        .length()
        .toFixed(1)} N · power ${power.toFixed(0)} W`;
    },
  });
}

// ---- Step 4: free flight, integrated -------------------------------------------

export function mountFreeFlight(el: HTMLElement): Promise<Demo> {
  return mountFlyable(el, {
    windScale: 0,
    arrows: true,
    lockBank: true,
    trail: true,
    hint: "W/S or ↑/↓ pitch · Space flap (steering arrives next post)",
    autopilot: (body) => {
      // hands-off: hold a gentle cruise
      body.commands.pitch = 0.05;
      body.commands.effort = body.pos.y < 22 ? 0.6 : 0.25;
    },
  });
}

// ---- scrolly: assembling the four-force diagram ----------------------------------

export function mountForcesScrolly(el: HTMLElement): void {
  mountScrolly(el, {
    screens: 4,
    steps: [
      { at: 0, text: "A gliding osprey, seen from the side. Treat the whole bird as a single point with mass 1.5 kg — a point mass." },
      { at: 0.18, text: "Weight first: W = mg ≈ 14.7 N, always straight down. Alone, it is free fall." },
      { at: 0.38, text: "Moving through air creates lift — perpendicular to the airflow, not to the ground. L = ½ρV²·S·C_L." },
      { at: 0.58, text: "Nothing is free: drag points straight back along the airflow. D = ½ρV²·S·C_D." },
      { at: 0.76, text: "Flapping adds thrust along the flight path. Gliding birds leave it at zero and spend altitude instead." },
      { at: 0.9, text: "Sum the four vectors, divide by mass, integrate: that residual arrow is the acceleration that bends the flight path. That's the whole flight model." },
    ],
    draw(ctx, w, h, t) {
      const cx = w * 0.46;
      const cy = h * 0.45;
      // airflow lines
      const flow = phase(t, 0.3, 0.45);
      ctx.strokeStyle = `rgba(122,162,255,${(0.25 * flow).toFixed(3)})`;
      ctx.lineWidth = 1;
      for (let i = -2; i <= 2; i++) {
        const y = cy + i * 26 + 6;
        ctx.beginPath();
        ctx.moveTo(cx - 170, y - 24);
        ctx.lineTo(cx + 150, y + 14);
        ctx.stroke();
      }
      // the bird dart, on a shallow glide (path ~ -7°)
      const glide = -0.12;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-glide + 0.06);
      ctx.fillStyle = "#e9e4d8";
      ctx.beginPath();
      ctx.moveTo(26, 0);
      ctx.lineTo(-20, -8);
      ctx.lineTo(-12, 0);
      ctx.lineTo(-20, 8);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#aab4d4";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.lineTo(-8, -14);
      ctx.stroke();
      ctx.restore();
      label(ctx, "1.5 kg", cx + 4, cy + 24, { color: PAL.muted, size: 11, mono: true });

      const fscale = 6;
      const Wn = 14.7;
      // weight
      const pw = phase(t, 0.14, 0.26);
      if (pw > 0.01) {
        arrow(ctx, cx, cy, cx, cy + Wn * fscale * pw, PAL.dot, 2.5, 8);
        if (pw > 0.6) label(ctx, "W = mg", cx + 8, cy + Wn * fscale * pw - 6, { color: PAL.dot, size: 12 });
      }
      // airflow direction: bird glides down-forward, so air comes up-back at it
      const fx = Math.cos(glide);
      const fy = -Math.sin(glide);
      // lift ⊥ airflow
      const pl = phase(t, 0.36, 0.5);
      if (pl > 0.01) {
        const Ln = 14.2 * fscale * pl;
        arrow(ctx, cx, cy, cx + -fy * Ln, cy - fx * Ln, PAL.good, 2.5, 8);
        if (pl > 0.6)
          label(ctx, "L ⊥ airflow", cx + -fy * Ln + 8, cy - fx * Ln + 2, { color: PAL.good, size: 12 });
      }
      // drag along -airflow
      const pd = phase(t, 0.56, 0.7);
      if (pd > 0.01) {
        const Dn = 1.6 * fscale * 4 * pd; // exaggerated ×4 to stay visible
        arrow(ctx, cx, cy, cx - fx * Dn, cy + fy * Dn, PAL.red, 2.5, 8);
        if (pd > 0.6) label(ctx, "D (×4)", cx - fx * Dn - 40, cy + fy * Dn, { color: PAL.red, size: 12 });
      }
      // thrust
      const pt = phase(t, 0.74, 0.86);
      if (pt > 0.01) {
        const Tn = 5 * fscale * pt;
        arrow(ctx, cx, cy, cx + fx * Tn, cy - fy * Tn, PAL.warm, 2.5, 8);
        if (pt > 0.6) label(ctx, "T (flap)", cx + fx * Tn + 8, cy - fy * Tn - 6, { color: PAL.warm, size: 12 });
      }
      // resultant
      const pr = phase(t, 0.88, 0.985);
      if (pr > 0.01) {
        // rough vector sum (lift slightly less than weight on a steady glide + thrust)
        const rx = (fx * 5 - fx * 6.4 + -fy * 14.2) * fscale;
        const ry = (Wn - fx * 14.2 - fy * 0.8) * fscale;
        arrow(ctx, cx, cy, cx + rx * 0.35 * pr, cy + ry * 0.35 * pr, "#ffffff", 2, 7);
        if (pr > 0.6)
          label(ctx, "ΣF → a = ΣF/m", cx + rx * 0.4 * pr + 8, cy + ry * 0.4 * pr, {
            color: PAL.text,
            size: 12,
          });
      }
    },
  });
}
