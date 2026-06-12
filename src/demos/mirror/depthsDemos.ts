// Demos for depths.html — Beer–Lambert absorption, refraction, and the
// lakebed in the shallows. Part 4 of The Mirror.

import { Vector3 } from "three/webgpu";
import { mix, mx_noise_float, mx_worley_noise_float, smoothstep, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { mountScrolly, PAL, label, lerp } from "../../lib/scrolly";
import { wind } from "../../lib/spine";
import { LakeSurface, createDawnSky, type LakeBed } from "../../lib/water";
import { addOrbit, makeMountainRing, mirrorCtx } from "./kit";
import type { MeshBasicNodeMaterial } from "three/webgpu";

type NodeV3 = Node<"vec3">;

// ---- analytic lakebeds ----------------------------------------------------------------
// TODO(basin): The Basin's bathymetry replaces these little functions; the
// LakeBed interface (heightNode + colorNode) is the seam.

/** Sandy albedo with mottling and scattered darker stones. */
function sandColor(p: NodeV3): NodeV3 {
  const mottle = mx_noise_float(p.xz.mul(0.55)).mul(0.5).add(0.5);
  const fine = mx_noise_float(p.xz.mul(4.3)).mul(0.5).add(0.5);
  const base = mix(vec3(0.4, 0.34, 0.22), vec3(0.58, 0.5, 0.34), mottle);
  const stoneField = mx_worley_noise_float(p.xz.mul(0.8), 1);
  const stone = smoothstep(0.16, 0.04, stoneField);
  const speckled = base.mul(fine.mul(0.35).add(0.75));
  return mix(speckled, vec3(0.21, 0.19, 0.16), stone.mul(0.85));
}

/** A linear ramp: depth 0 at x = −half … `depth` at x = +half, with contour
 *  lines every meter painted into the albedo so depth is legible. */
function rampBed(half: number, depth: number): LakeBed {
  return {
    heightNode: (xz) => xz.x.add(half).div(2 * half).clamp(0, 1).mul(-depth),
    colorNode: (p) => {
      const d = p.y.negate();
      const f = d.fract();
      const line = smoothstep(0.06, 0.0, f.min(f.oneMinus()));
      return sandColor(p).mul(line.mul(-0.45).add(1));
    },
  };
}

/** Gentle dunes around a constant depth — for watching refraction work. */
function duneBed(depth: number): LakeBed {
  return {
    heightNode: (xz) => mx_noise_float(xz.mul(0.35)).mul(0.45).sub(depth),
    colorNode: sandColor,
  };
}

/** A shoreline: dry-ish at x = −shore, deepening toward +x, dunes on top. */
function shoreBed(shore: number, slope: number): LakeBed {
  return {
    heightNode: (xz) => {
      const dunes = mx_noise_float(xz.mul(0.3)).mul(0.4);
      return xz.x.add(shore).mul(-slope).add(dunes).min(-0.05);
    },
    colorNode: sandColor,
  };
}

// ---- hero: the shallows ------------------------------------------------------------------

export async function mountDepthsHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { aspect: 0.48, fov: 48 });
  const sky = createDawnSky(7.6);
  const dome = sky.makeDome();
  const mountains = makeMountainRing({ radius: 460, height: 110, crestColor: 0x33415e });
  const lake = new LakeSurface({
    env: sky,
    size: 700,
    segments: 288,
    bed: shoreBed(14, 0.16),
    waves: { choppiness: 1.1 },
  });
  ctx.scene.add(dome, mountains, lake.mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(-6, 0.3, 0),
    distance: 13,
    polar: 0.3,
    azimuth: Math.PI,
    maxPolar: 1.25,
    drift: 0.006,
  });

  wind.speed = 1.4;
  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 6,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.slider({
    label: "water clarity (×)",
    min: 0.2,
    max: 3,
    step: 0.05,
    value: lake.clarity.value,
    onInput: (v) => (lake.clarity.value = v),
  });
  ctx.shell.setInfo(() => "sand → teal → black: that gradient is the bathymetry");

  ctx.onDispose(() => {
    lake.dispose();
    sky.dispose();
    mountains.geometry.dispose();
    (mountains.material as MeshBasicNodeMaterial).dispose();
    orbit.dispose();
  });
  return ctx.finish((t, dt) => {
    lake.update(t);
    orbit.update(dt);
  });
}

// ---- the scrolly: light dying by channel ---------------------------------------------------

export function mountAbsorbScrolly(el: HTMLElement): void {
  // Absorption coefficients used site-wide (1/m): red, green, blue.
  const A = [0.42, 0.09, 0.035];
  const CH = ["#ff8585", "#7dd6a0", "#7aa2ff"];
  const NAMES = ["red", "green", "blue"];
  mountScrolly(el, {
    screens: 3.2,
    aspect: 0.52,
    steps: [
      { at: 0, text: "White sunlight enters the water carrying all three channels at full strength." },
      {
        at: 0.3,
        text: "Each meter multiplies every channel by its own survival factor, e^(−a·d). Red's coefficient is ten times blue's — it pays the steepest toll.",
      },
      {
        at: 0.6,
        text: "By 2 m, red is down to ~43%. By 5 m it's ~12%, while blue still has 84%. Anything down there looks blue-green because that's all the light that's left.",
      },
      {
        at: 0.85,
        text: "Light reflecting off the lakebed pays the toll twice — down and back up. The deep end of a lake isn't painted darker; it's further away through the filter.",
      },
    ],
    draw(c, w, h, t) {
      const maxDepth = 8;
      const depth = lerp(0.01, maxDepth, Math.min(1, t * 1.25));
      const gx = w * 0.5;
      const gw = w * 0.45;
      const gy = h * 0.1;
      const gh = h * 0.78;
      // left: the water column with sinking light bars
      const colX = w * 0.06;
      const colW = w * 0.32;
      c.fillStyle = "rgba(30, 60, 86, 0.4)";
      c.fillRect(colX, gy, colW, gh);
      for (let ch = 0; ch < 3; ch++) {
        const bx = colX + colW * (0.18 + ch * 0.3);
        const grad = c.createLinearGradient(0, gy, 0, gy + gh);
        for (let s = 0; s <= 10; s++) {
          const d = (s / 10) * maxDepth;
          const alpha = Math.exp(-A[ch] * d) * (d <= depth ? 1 : 0);
          grad.addColorStop(s / 10, `${CH[ch]}${Math.round(Math.max(alpha, 0.02) * 255).toString(16).padStart(2, "0")}`);
        }
        c.fillStyle = grad;
        const yEnd = gy + (Math.min(depth, maxDepth) / maxDepth) * gh;
        c.fillRect(bx, gy, colW * 0.16, yEnd - gy);
      }
      label(c, "0 m", colX - 4, gy + 6, { color: PAL.muted, mono: true, align: "right" });
      label(c, `${maxDepth} m`, colX - 4, gy + gh, { color: PAL.muted, mono: true, align: "right" });
      label(c, `depth ${depth.toFixed(1)} m`, colX, gy + gh + 16, { color: PAL.text, mono: true });

      // right: transmittance curves
      c.strokeStyle = PAL.grid;
      c.strokeRect(gx, gy, gw, gh);
      label(c, "T = e^(−a·d)", gx + 6, gy - 10, { color: PAL.muted, mono: true });
      for (let ch = 0; ch < 3; ch++) {
        c.strokeStyle = CH[ch];
        c.lineWidth = 2;
        c.beginPath();
        for (let i = 0; i <= 60; i++) {
          const d = (i / 60) * maxDepth;
          const T = Math.exp(-A[ch] * d);
          const px = gx + (d / maxDepth) * gw;
          const py = gy + (1 - T) * gh;
          if (i === 0) c.moveTo(px, py);
          else c.lineTo(px, py);
        }
        c.stroke();
        const Tn = Math.exp(-A[ch] * depth);
        const mx = gx + (Math.min(depth, maxDepth) / maxDepth) * gw;
        const my = gy + (1 - Tn) * gh;
        c.fillStyle = CH[ch];
        c.beginPath();
        c.arc(mx, my, 4, 0, Math.PI * 2);
        c.fill();
        label(c, `${NAMES[ch]} ${(Tn * 100).toFixed(0)}%`, mx + 8, my, { color: CH[ch], mono: true, size: 11 });
      }
    },
  });
}

// ---- Step 1: absorption on a depth ramp -----------------------------------------------------

export async function mountAbsorbRamp(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { fov: 45 });
  const sky = createDawnSky(7.8);
  const dome = sky.makeDome();
  const lake = new LakeSurface({
    env: sky,
    size: 44,
    segments: 200,
    bed: rampBed(22, 8),
    waves: { ampScale: 0.12 },
  });
  ctx.scene.add(dome, lake.mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0, 0),
    distance: 30,
    polar: 1.15,
    azimuth: -Math.PI / 2,
    minPolar: 0.3,
  });

  ctx.shell.slider({
    label: "water clarity (×)",
    min: 0.2,
    max: 3,
    step: 0.05,
    value: 1,
    onInput: (v) => (lake.clarity.value = v),
  });
  ctx.shell.setInfo(() => {
    const halfRed = Math.log(2) / (0.42 * lake.clarity.value);
    return `red loses half its light every ${halfRed.toFixed(1)} m of path`;
  });

  ctx.onDispose(() => {
    lake.dispose();
    sky.dispose();
    orbit.dispose();
  });
  return ctx.finish((t, dt) => {
    lake.update(t);
    orbit.update(dt);
  });
}

// ---- Step 2: refraction, on and off ----------------------------------------------------------

export async function mountRefractionBend(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { fov: 46 });
  const sky = createDawnSky(7.8);
  const dome = sky.makeDome();
  const lake = new LakeSurface({
    env: sky,
    size: 50,
    segments: 256,
    bed: duneBed(1.7),
  });
  ctx.scene.add(dome, lake.mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0, 0),
    distance: 14,
    polar: 0.55,
    azimuth: 1.0,
    minPolar: 0.15,
  });

  wind.speed = 1.5;
  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 5,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.button("toggle Snell refraction on ↔ off", () => {
    lake.refraction.value = lake.refraction.value > 0.5 ? 0 : 1;
  });
  ctx.shell.setInfo(() =>
    lake.refraction.value > 0.5
      ? "bent rays: stones displaced and swimming"
      : "straight-down rays: a painted floor",
  );

  ctx.onDispose(() => {
    lake.dispose();
    sky.dispose();
    orbit.dispose();
  });
  return ctx.finish((t, dt) => {
    lake.update(t);
    orbit.update(dt);
  });
}

// ---- Step 3: the assembled shallows ------------------------------------------------------------

export async function mountShallows(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { fov: 48 });
  const sky = createDawnSky(7.5);
  const dome = sky.makeDome();
  const lake = new LakeSurface({
    env: sky,
    size: 500,
    segments: 256,
    bed: shoreBed(10, 0.14),
  });
  ctx.scene.add(dome, lake.mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(-4, 0.2, 0),
    distance: 12,
    polar: 0.35,
    azimuth: Math.PI,
    maxPolar: 1.25,
  });

  wind.speed = 1.2;
  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 6,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.slider({
    label: "water clarity (×)",
    min: 0.2,
    max: 3,
    step: 0.05,
    value: 1,
    onInput: (v) => (lake.clarity.value = v),
  });
  ctx.shell.setInfo(() => "body = bed·T + scatter·(1−T), then mix(body, sky, F) + glint");

  ctx.onDispose(() => {
    lake.dispose();
    sky.dispose();
    orbit.dispose();
  });
  return ctx.finish((t, dt) => {
    lake.update(t);
    orbit.update(dt);
  });
}
