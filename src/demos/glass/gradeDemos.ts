// Demos for grade.html — color grading and bloom keyed to the hour.
// Part 1 of Glass & Grain.
//
// One scene grammar throughout: the assembled lake (atmosphere + Mirror
// surface + basin backdrop), rendered through a PostProcessing chain that
// the page builds up one stage at a time — raw tone curves first, then the
// display-referred knobs, then bloom, then the whole grade keyed to the
// world clock.

import { NoToneMapping, PostProcessing, SRGBColorSpace, Vector3 } from "three/webgpu";
import type { TextureNode } from "three/webgpu";
import { float, mix, pass, renderOutput, uniform, vec4 } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { mountScrolly, PAL, label, phase, clamp01, lerp } from "../../lib/scrolly";
import { wind } from "../../lib/spine";
import { sunElevationDeg } from "../../lib/sky";
import {
  Grade,
  PostFxStack,
  clipNode,
  filmicNode,
  gradeForHour,
  neutralGrade,
  reinhardNode,
  type GradeSettings,
} from "../../lib/postfx";
import { addOrbit, fmtHour, glassCtx, makeFloater, makeLakeStage } from "./kit";

// ---- hero: the whole grade, live ---------------------------------------------------

export async function mountGradeHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { aspect: 0.48, fov: 48 });
  const stage = makeLakeStage(ctx, { hour: 6.4 });
  const floater = makeFloater(ctx.scene, 0, 0);
  ctx.onDispose(() => floater.dispose());

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.4, 0),
    distance: 7.5,
    azimuth: 2.3,
    polar: 0.1,
    minPolar: 0.03,
    drift: 0.012,
  });
  ctx.onDispose(() => orbit.dispose());

  const stack = new PostFxStack(ctx.renderer, ctx.scene, ctx.camera, {
    grade: true,
    bloom: true,
    keyGradeToClock: false,
  });
  ctx.onDispose(() => stack.dispose());

  wind.speed = 2.2;
  let hour = 6.4;
  ctx.shell.slider({
    label: "hour",
    min: 0,
    max: 24,
    step: 0.05,
    value: hour,
    format: fmtHour,
    onInput: (v) => (hour = v),
  });
  ctx.shell.slider({
    label: "grade amount",
    min: 0,
    max: 1,
    step: 0.01,
    value: 1,
    onInput: (v) => (stack.grade.amount.value = v),
  });

  const scratch = neutralGrade();
  ctx.shell.setInfo(() => {
    const s = gradeForHour(hour, scratch);
    return `sun ${sunElevationDeg(hour).toFixed(0)}° · ${s.exposure >= 0 ? "+" : ""}${s.exposure.toFixed(2)} ev · temp ${s.temperature.toFixed(2)} · sat ${s.saturation.toFixed(2)}`;
  });

  return ctx.finish(
    (t, dt) => {
      stage.setHour(hour);
      orbit.update(dt);
      floater.update(dt, t);
      stage.update(t, dt);
      stack.update(dt, { t, hour });
    },
    () => stack.render(),
  );
}

// ---- Step 1: tone curves -------------------------------------------------------------

const CURVES = ["clamp", "reinhard", "filmic"] as const;

export async function mountToneCurves(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { fov: 46 });
  const stage = makeLakeStage(ctx, { hour: 6.1 });
  wind.speed = 2.6;

  // fixed camera staring down the glitter path, straight at the low sun
  const sun = stage.atmosphere.sunDirection.value;
  ctx.camera.position.set(-sun.x * 10, 1.1, -sun.z * 10);
  ctx.camera.lookAt(sun.x * 200, 12, sun.z * 200);

  const scenePass = pass(ctx.scene, ctx.camera);
  const sceneTex = scenePass.getTextureNode("output") as TextureNode;
  const exposure = uniform(1);
  const mode = uniform(2);

  const lin = sceneTex.rgb.mul(exposure);
  const eq = (n: number) => float(1).sub(mode.sub(n).abs().min(1));
  const mapped = clipNode(lin)
    .mul(eq(0))
    .add(reinhardNode(lin).mul(eq(1)))
    .add(filmicNode(lin).mul(eq(2)));

  const post = new PostProcessing(ctx.renderer);
  post.outputColorTransform = false;
  // the curve above did the tone mapping; this just encodes for the display
  post.outputNode = renderOutput(vec4(mapped, 1), NoToneMapping, SRGBColorSpace);
  ctx.onDispose(() => {
    scenePass.dispose();
    post.dispose();
  });

  let curve = 2;
  for (let i = 0; i < CURVES.length; i++) {
    ctx.shell.button(CURVES[i], () => {
      curve = i;
      mode.value = i;
    });
  }
  let stops = 0;
  ctx.shell.slider({
    label: "exposure (stops)",
    min: -3,
    max: 3,
    step: 0.1,
    value: 0,
    onInput: (v) => {
      stops = v;
      exposure.value = Math.pow(2, v);
    },
  });
  ctx.shell.setInfo(() => `curve: ${CURVES[curve]} · gain ×${Math.pow(2, stops).toFixed(2)}`);

  return ctx.finish(
    (t) => {
      stage.update(t, 0);
    },
    () => post.render(),
  );
}

// ---- Step 2: the display-referred knobs ------------------------------------------------

export async function mountGradeKnobs(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { fov: 50 });
  const stage = makeLakeStage(ctx, { hour: 7.6 });
  const floater = makeFloater(ctx.scene, 0, 0);
  ctx.onDispose(() => floater.dispose());
  wind.speed = 2;

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.3, 0),
    distance: 5.5,
    azimuth: 1.9,
    polar: 0.16,
    drift: 0.01,
  });
  ctx.onDispose(() => orbit.dispose());

  const grade = new Grade();
  const scenePass = pass(ctx.scene, ctx.camera);
  const sceneTex = scenePass.getTextureNode("output") as TextureNode;

  const post = new PostProcessing(ctx.renderer);
  post.outputColorTransform = false;
  // linear side first, tone map + encode, then the display side
  const linear = vec4(grade.linearNode(sceneTex.rgb), 1);
  post.outputNode = vec4(grade.displayNode(renderOutput(linear).rgb), 1);
  ctx.onDispose(() => {
    scenePass.dispose();
    post.dispose();
  });

  const s: GradeSettings = neutralGrade();
  const sync = (): void => grade.apply(s);
  sync();

  ctx.shell.slider({ label: "exposure (stops)", min: -2, max: 2, step: 0.05, value: 0, onInput: (v) => ((s.exposure = v), sync()) });
  ctx.shell.slider({ label: "temperature", min: -1, max: 1, step: 0.02, value: 0, onInput: (v) => ((s.temperature = v), sync()) });
  ctx.shell.slider({ label: "contrast", min: 0.6, max: 1.6, step: 0.01, value: 1, onInput: (v) => ((s.contrast = v), sync()) });
  ctx.shell.slider({ label: "saturation", min: 0, max: 2, step: 0.02, value: 1, onInput: (v) => ((s.saturation = v), sync()) });
  ctx.shell.slider({
    label: "gamma",
    min: 0.6,
    max: 1.6,
    step: 0.01,
    value: 1,
    onInput: (v) => ((s.gamma = [v, v, v]), sync()),
  });
  ctx.shell.slider({
    label: "shadow lift (cool→warm)",
    min: -0.06,
    max: 0.06,
    step: 0.002,
    value: 0,
    onInput: (v) => ((s.lift = [v, v * 0.3, -v]), sync()),
  });
  ctx.shell.slider({ label: "vignette", min: 0, max: 1, step: 0.02, value: 0, onInput: (v) => ((s.vignette = v), sync()) });
  ctx.shell.button("reset", () => {
    Object.assign(s, neutralGrade());
    sync();
  });
  ctx.shell.setInfo(() => `pivot 0.42 · all of this runs after the tone map`);

  return ctx.finish(
    (t, dt) => {
      orbit.update(dt);
      floater.update(dt, t);
      stage.update(t, dt);
    },
    () => post.render(),
  );
}

// ---- Step 3: bloom on the glitter -------------------------------------------------------

export async function mountBloomGlitter(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { fov: 46 });
  const stage = makeLakeStage(ctx, { hour: 6.0 });
  wind.speed = 3;

  const sun = stage.atmosphere.sunDirection.value;
  ctx.camera.position.set(-sun.x * 9, 1.0, -sun.z * 9);
  ctx.camera.lookAt(sun.x * 200, 10, sun.z * 200);

  const scenePass = pass(ctx.scene, ctx.camera);
  const sceneTex = scenePass.getTextureNode("output") as TextureNode;
  const bloomNode = bloom(sceneTex, 0.55, 0.5, 0.9);
  const showOnly = uniform(0);

  const post = new PostProcessing(ctx.renderer);
  post.outputColorTransform = false;
  post.outputNode = renderOutput(mix(sceneTex.add(bloomNode), bloomNode, showOnly));
  ctx.onDispose(() => {
    scenePass.dispose();
    post.dispose();
  });

  ctx.shell.slider({
    label: "threshold (HDR)",
    min: 0,
    max: 3,
    step: 0.05,
    value: 0.9,
    onInput: (v) => (bloomNode.threshold.value = v),
  });
  ctx.shell.slider({
    label: "strength",
    min: 0,
    max: 1.5,
    step: 0.02,
    value: 0.55,
    onInput: (v) => (bloomNode.strength.value = v),
  });
  ctx.shell.slider({
    label: "radius",
    min: 0,
    max: 1,
    step: 0.02,
    value: 0.5,
    onInput: (v) => (bloomNode.radius.value = v),
  });
  let only = false;
  ctx.shell.button("bloom buffer only", () => {
    only = !only;
    showOnly.value = only ? 1 : 0;
  });
  ctx.shell.setInfo(() => (only ? "showing what passed the threshold, blurred" : "scene + bloom"));

  return ctx.finish(
    (t) => {
      stage.update(t, 0);
    },
    () => post.render(),
  );
}

// ---- Step 4: the hour key ------------------------------------------------------------------

export async function mountHourKey(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { fov: 50 });
  const stage = makeLakeStage(ctx, { hour: 5.2 });
  wind.speed = 1.8;

  ctx.camera.position.set(-26, 3.2, 14);
  ctx.camera.lookAt(30, 6, -22);

  const stack = new PostFxStack(ctx.renderer, ctx.scene, ctx.camera, {
    grade: true,
    bloom: true,
    keyGradeToClock: false,
  });
  ctx.onDispose(() => stack.dispose());

  let hour = 5.2;
  let playing = true;
  const slider = ctx.shell.slider({
    label: "hour",
    min: 0,
    max: 24,
    step: 0.05,
    value: hour,
    format: fmtHour,
    onInput: (v) => {
      hour = v;
      playing = false;
    },
  });
  ctx.shell.button("play the day", () => (playing = !playing));

  const scratch = neutralGrade();
  ctx.shell.setInfo(() => {
    const s = gradeForHour(hour, scratch);
    return `${fmtHour(hour)} · sun ${sunElevationDeg(hour).toFixed(1)}° · ev ${s.exposure >= 0 ? "+" : ""}${s.exposure.toFixed(2)} · temp ${s.temperature.toFixed(2)} · sat ${s.saturation.toFixed(2)} · bloom ${s.bloomStrength.toFixed(2)}/${s.bloomThreshold.toFixed(2)}`;
  });

  return ctx.finish(
    (t, dt) => {
      if (playing) {
        hour = (hour + dt * 0.55) % 24; // a day in ~44 s
        slider.value = String(hour);
      }
      stage.setHour(hour);
      stage.update(t, dt);
      stack.update(dt, { t, hour });
    },
    () => stack.render(),
  );
}

// ---- scrolly: from light to looks ------------------------------------------------------------

export function mountGradeScrolly(el: HTMLElement): void {
  // The figure: input luminance (0..4, linear HDR) on x, output (0..1) on y.
  // Steps walk one frame's values through clamp → reinhard → filmic → LGG.

  const filmic = (x: number): number =>
    Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
  const reinhard = (x: number): number => x / (1 + x);
  const clip = (x: number): number => Math.min(1, x);

  // a fake frame histogram: mostly mids, a dark ridge, a hot glint tail
  const bars: { x: number; w: number }[] = [];
  for (let i = 0; i < 36; i++) {
    const x = (i / 36) * 4;
    const mids = Math.exp(-Math.pow((x - 0.55) / 0.45, 2));
    const shadows = 0.5 * Math.exp(-Math.pow((x - 0.08) / 0.1, 2));
    const glints = 0.22 * Math.exp(-Math.pow((x - 3.2) / 0.55, 2));
    bars.push({ x, w: mids + shadows + glints });
  }

  mountScrolly(el, {
    screens: 4,
    aspect: 0.56,
    steps: [
      {
        at: 0,
        text: "A rendered frame is measured light, and light has no ceiling: these are one frame's pixel values. The sun glint on the right is 20× brighter than the mids. The display can only show 0 to 1.",
      },
      {
        at: 0.25,
        text: "The naive answer is to clamp. Everything past 1.0 lands on 1.0 — the glint, the sky around the sun, the bright cloud edge all become the same flat white. That clipped plateau is information gone forever.",
      },
      {
        at: 0.5,
        text: "A tone curve compresses instead. Reinhard, c/(1+c), never clips — but it never reaches white either, and it flattens contrast everywhere. The filmic S-curve keeps the mids nearly linear, eases shadows in with a toe, and rolls highlights off with a shoulder: bright things stay distinct.",
      },
      {
        at: 0.75,
        text: "Everything after the curve is display-referred — the values are paint now, not light. Lift raises the curve's left end (shadows), gamma bends its middle, gain scales its right end (highlights). Three handles, one per region: that is the whole grammar of a look.",
      },
    ],
    draw(c, w, h, t) {
      const mL = 56;
      const mB = 36;
      const mT = 18;
      const gw = w - mL - 24;
      const gh = h - mB - mT;
      const X = (v: number): number => mL + (v / 4) * gw;
      const Y = (v: number): number => mT + (1 - v) * gh;

      // axes
      c.strokeStyle = PAL.grid;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(mL, mT);
      c.lineTo(mL, Y(0));
      c.lineTo(X(4), Y(0));
      c.stroke();
      // the display ceiling
      c.setLineDash([4, 4]);
      c.strokeStyle = PAL.dim;
      c.beginPath();
      c.moveTo(mL, Y(1));
      c.lineTo(X(4), Y(1));
      c.stroke();
      c.setLineDash([]);
      label(c, "scene light (linear)", mL + gw * 0.5, h - 12, { color: PAL.muted, align: "center" });
      label(c, "display 1.0", mL + 6, Y(1) - 8, { color: PAL.muted, size: 11 });
      c.save();
      c.translate(16, mT + gh * 0.5);
      c.rotate(-Math.PI / 2);
      label(c, "what the screen shows", 0, 0, { color: PAL.muted, align: "center" });
      c.restore();

      const p1 = phase(t, 0.0, 0.2); // histogram in
      const p2 = phase(t, 0.25, 0.45); // clamp
      const p3 = phase(t, 0.5, 0.7); // curves
      const p4 = phase(t, 0.75, 0.95); // LGG

      // histogram
      for (const b of bars) {
        const bh = b.w * gh * 0.5 * p1;
        c.fillStyle = b.x > 1 ? PAL.warm : PAL.dot;
        c.globalAlpha = 0.5;
        c.fillRect(X(b.x) - 2, Y(0) - bh, 4, bh);
      }
      c.globalAlpha = 1;
      if (p1 > 0.6 && t < 0.45) {
        label(c, "glints, 3–4× white", X(3.2), Y(0) - gh * 0.14, { color: PAL.warm, align: "center", size: 11 });
      }

      const drawCurve = (fn: (x: number) => number, color: string, alpha: number, width = 2): void => {
        if (alpha <= 0.01) return;
        c.globalAlpha = alpha;
        c.strokeStyle = color;
        c.lineWidth = width;
        c.beginPath();
        for (let i = 0; i <= 120; i++) {
          const x = (i / 120) * 4;
          const y = fn(x);
          if (i === 0) c.moveTo(X(x), Y(y));
          else c.lineTo(X(x), Y(y));
        }
        c.stroke();
        c.globalAlpha = 1;
      };

      // clamp, then fading as better curves arrive
      drawCurve(clip, PAL.red, p2 * (1 - p3 * 0.7));
      if (p2 > 0.5 && p3 < 0.3) {
        label(c, "clipped: every value past 1 → the same white", X(2.4), Y(1.04), {
          color: PAL.red,
          align: "center",
          size: 11,
        });
      }

      // reinhard + filmic
      drawCurve(reinhard, PAL.dim, p3 * 0.9);
      drawCurve(filmic, PAL.accent, p3, 2.5);
      if (p3 > 0.6 && p4 < 0.3) {
        label(c, "toe", X(0.16), Y(filmic(0.16)) + 14, { color: PAL.accent, size: 11 });
        label(c, "shoulder", X(2.6), Y(filmic(2.6)) - 10, { color: PAL.accent, size: 11 });
        label(c, "reinhard", X(3.4), Y(reinhard(3.4)) + 14, { color: PAL.muted, size: 11 });
      }

      // LGG bending the filmic curve (display side)
      if (p4 > 0.01) {
        const lift = 0.06 * p4;
        const gamma = 1 / lerp(1, 0.85, p4);
        const gain = lerp(1, 0.92, p4);
        const lgg = (x: number): number => {
          const v = filmic(x);
          return Math.pow(Math.max(0, gain * (v + lift * (1 - v))), gamma);
        };
        drawCurve(lgg, PAL.good, p4, 2.5);
        if (p4 > 0.6) {
          label(c, "lift: floor up", X(0.32), Y(lgg(0.05)) - 10, { color: PAL.good, size: 11 });
          label(c, "gain: ceiling down", X(3.0), Y(lgg(3.0)) + 14, { color: PAL.good, size: 11 });
          label(c, "gamma: mids bend", X(1.1), Y(lgg(1.1)) - 12, { color: PAL.good, size: 11 });
        }
      }

      // a tracked sample pixel: the glint
      const gx = 3.2;
      const fn = t < 0.25 ? null : t < 0.5 ? clip : filmic;
      if (fn) {
        const gy = clamp01(fn(gx));
        c.fillStyle = PAL.warm;
        c.beginPath();
        c.arc(X(gx), Y(gy), 4, 0, Math.PI * 2);
        c.fill();
      }
    },
  });
}
