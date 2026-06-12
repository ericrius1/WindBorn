// Demos for "Action Poses" — raw pose targets, the damped spring as the only
// easing, springs layered over the gait, and the scripted strike sequence.

import * as THREE from "three/webgpu";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { PAL } from "../../lib/scrolly";
import { buildOsprey } from "../../lib/bird/build";
import { POSE_NAMES, type PoseName } from "../../lib/bird/poses";
import { Spring1D } from "../../lib/bird/springs";
import { OspreyAnimator } from "../../lib/bird/animator";
import { createStage, makeTimer } from "./stage";

// ---- hero: the repertoire on a loop -----------------------------------------------

export async function mountHeroPoses(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    water: true,
    orbit: { target: [0, 0.7, 0], radius: 2.2, azimuth: 0.55, polar: 0.16, autoSpin: 0.05 },
  });
  const osprey = buildOsprey();
  osprey.group.position.y = 0.45;
  stage.scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);
  anim.gait01 = 0.55;
  anim.flapRateHz = 2.7;

  const script: (PoseName | null)[] = [null, "tuck", "brake", "strike", "float", null];
  let current = "cruising";
  shell.setInfo(() => current);

  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      const slot = Math.floor(stage.time / 2.6) % script.length;
      const pose = script[slot];
      anim.requestPose(pose);
      current = pose ?? "cruising";
      anim.update(h);
      osprey.group.position.y = 0.45 + Math.sin(stage.time * 0.8) * 0.025;
      stage.update(h);
      stage.render();
      shell.tick();
    },
    dispose() {
      osprey.dispose();
      stage.dispose();
    },
  };
}

// ---- step 1: the raw targets, snapped to ---------------------------------------------

export async function mountTargets(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    orbit: { target: [0, 0.42, 0], radius: 1.8, azimuth: 0.5, polar: 0.22, autoSpin: 0.06 },
  });
  const osprey = buildOsprey();
  stage.scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);
  anim.gait01 = 1; // hold the glide so the pose is the only thing moving
  anim.flapRateHz = 2.4;

  let label = "neutral glide";
  const pick = (name: PoseName | null): void => {
    anim.requestPose(name);
    anim.snap(); // no springs in this demo — the point is the raw table row
    label = name ?? "neutral glide";
  };
  shell.button("neutral", () => pick(null));
  for (const n of POSE_NAMES) shell.button(n, () => pick(n));
  shell.setInfo(() => `target: ${label} (snapped, no easing)`);

  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      anim.update(h);
      stage.update(h);
      stage.render();
      shell.tick();
    },
    dispose() {
      osprey.dispose();
      stage.dispose();
    },
  };
}

// ---- step 2: one spring, on the bench -------------------------------------------------

export function mountSpringLab(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.5);
  const canvas = shell.canvas;
  const ctx = canvas.getContext("2d")!;

  let freq = 2.4;
  let zeta = 0.95;
  shell.slider({ label: "frequency Hz", min: 0.4, max: 8, step: 0.1, value: freq, onInput: (v) => (freq = v) });
  shell.slider({ label: "damping ζ", min: 0.1, max: 2, step: 0.01, value: zeta, onInput: (v) => (zeta = v) });
  shell.setInfo(() =>
    zeta < 0.95 ? "ζ < 1: overshoots and rings — flesh and feathers" : zeta <= 1.05 ? "ζ = 1: critical — fastest, no overshoot" : "ζ > 1: overdamped — crawls home",
  );

  const spring = new Spring1D(0.25);
  let target = 0.75;
  let pointerY: number | null = null;
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    pointerY = 1 - (e.clientY - r.top) / r.height;
  });
  canvas.addEventListener("pointerleave", () => (pointerY = null));

  const N = 360;
  const histT: number[] = [];
  const histV: number[] = [];
  let t = 0;

  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      t += h;
      if (pointerY !== null) target = Math.min(0.92, Math.max(0.08, pointerY));
      else target = Math.floor(t / 1.7) % 2 === 0 ? 0.72 : 0.28;
      spring.step(target, h, freq, zeta);
      histT.push(target);
      histV.push(spring.value);
      if (histT.length > N) {
        histT.shift();
        histV.shift();
      }

      const w = canvas.width;
      const hh = canvas.height;
      ctx.clearRect(0, 0, w, hh);
      ctx.fillStyle = PAL.bg;
      ctx.fillRect(0, 0, w, hh);
      const plotY = (v: number): number => hh * (0.92 - v * 0.84);

      ctx.strokeStyle = PAL.dim;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < histT.length; i++) {
        const x = (i / (N - 1)) * w * 0.86;
        if (i === 0) ctx.moveTo(x, plotY(histT[i]));
        else ctx.lineTo(x, plotY(histT[i]));
      }
      ctx.stroke();

      ctx.strokeStyle = PAL.accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < histV.length; i++) {
        const x = (i / (N - 1)) * w * 0.86;
        if (i === 0) ctx.moveTo(x, plotY(histV[i]));
        else ctx.lineTo(x, plotY(histV[i]));
      }
      ctx.stroke();

      // the live dot and target marker at the right edge
      const x0 = ((histV.length - 1) / (N - 1)) * w * 0.86;
      ctx.fillStyle = PAL.warm;
      ctx.fillRect(x0 + 14, plotY(target) - 1.5, 26, 3);
      ctx.fillStyle = PAL.text;
      ctx.beginPath();
      ctx.arc(x0, plotY(spring.value), 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PAL.muted;
      ctx.font = `${Math.round(hh * 0.045)}px ui-monospace, monospace`;
      ctx.fillText("target", x0 + 14, plotY(target) - 8);
      ctx.fillText("hover the canvas to drive the target yourself", 14, 22);

      shell.tick();
    },
  };
}

// ---- step 3: springs blending poses over the gait ----------------------------------------

export async function mountBlend(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    orbit: { target: [0, 0.45, 0], radius: 1.9, azimuth: 0.7, polar: 0.2, autoSpin: 0 },
  });
  const osprey = buildOsprey();
  stage.scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);
  anim.gait01 = 0.5;
  anim.flapRateHz = 2.7;

  shell.button("neutral", () => anim.requestPose(null));
  for (const n of POSE_NAMES) shell.button(n, () => anim.requestPose(n));
  shell.slider({ label: "spring Hz", min: 0.6, max: 7, step: 0.1, value: anim.poseFreqHz, onInput: (v) => (anim.poseFreqHz = v) });
  shell.slider({ label: "damping ζ", min: 0.3, max: 1.5, step: 0.01, value: anim.poseZeta, onInput: (v) => (anim.poseZeta = v) });
  shell.setInfo(() =>
    POSE_NAMES.map((n) => `${n} ${anim.poseWeight(n).toFixed(2)}`).join(" · "),
  );

  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      anim.update(h);
      stage.update(h);
      stage.render();
      shell.tick();
    },
    dispose() {
      osprey.dispose();
      stage.dispose();
    },
  };
}

// ---- step 4: the strike sequence, scripted ------------------------------------------------

interface SeqPoint {
  t: number;
  pos: [number, number, number];
  pose: PoseName | null;
  gait: number;
}

const SEQUENCE: SeqPoint[] = [
  { t: 0.0, pos: [0, 2.4, -5.0], pose: null, gait: 1 },
  { t: 2.0, pos: [0, 1.7, -2.2], pose: "tuck", gait: 1 },
  { t: 3.4, pos: [0, 0.72, -0.2], pose: "brake", gait: 0.9 },
  { t: 4.2, pos: [0, 0.4, 0.7], pose: "strike", gait: 0.9 },
  { t: 5.0, pos: [0, 0.55, 1.7], pose: null, gait: 0.15 },
  { t: 7.0, pos: [0, 2.1, 4.6], pose: null, gait: 0.8 },
];
const SEQ_END = 7.6;

export async function mountSequence(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    water: true,
    orbit: { target: [0, 1.2, 0], radius: 4.6, azimuth: 1.25, polar: 0.12, autoSpin: 0, drag: true },
  });
  const osprey = buildOsprey();
  stage.scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);
  anim.flapRateHz = 3.0;

  const curve = new THREE.CatmullRomCurve3(
    SEQUENCE.map((s) => new THREE.Vector3(...s.pos)),
    false,
    "catmullrom",
    0.5,
  );
  const pathGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(80));
  const pathMat = new THREE.LineBasicMaterial({ color: 0x4a5470, transparent: true, opacity: 0.6 });
  stage.scene.add(new THREE.Line(pathGeo, pathMat));

  let clock = 0;
  let speed = 1;
  shell.slider({ label: "time scale", min: 0.15, max: 1, step: 0.05, value: speed, onInput: (v) => (speed = v) });
  shell.button("replay", () => (clock = 0));
  let phaseName = "glide approach";
  shell.setInfo(() => phaseName);

  const pos = new THREE.Vector3();
  const ahead = new THREE.Vector3();

  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      clock += h * speed;
      if (clock > SEQ_END) clock = 0;
      const t = Math.min(clock, SEQUENCE[SEQUENCE.length - 1].t - 1e-3);

      // which segment are we in
      let i = 0;
      while (i < SEQUENCE.length - 2 && t >= SEQUENCE[i + 1].t) i++;
      const a = SEQUENCE[i];
      const b = SEQUENCE[i + 1];
      const local = (t - a.t) / (b.t - a.t);
      const u = (i + Math.min(1, Math.max(0, local))) / (SEQUENCE.length - 1);
      curve.getPoint(u, pos);
      curve.getPoint(Math.min(1, u + 0.012), ahead);

      anim.requestPose(a.pose);
      anim.gait01 += (a.gait - anim.gait01) * Math.min(1, h * 3);
      phaseName = a.pose ? `${a.pose}` : i >= 4 ? "flap out and away" : "glide approach";

      anim.update(h);
      osprey.group.position.copy(pos);
      // pitch the whole bird along the path; posture rides on top
      const dy = ahead.y - pos.y;
      const dxz = Math.hypot(ahead.x - pos.x, ahead.z - pos.z) || 1e-4;
      osprey.group.rotation.x = -Math.atan2(dy, dxz) * 0.8;
      stage.orbit.target.lerp(pos, Math.min(1, h * 2.5));

      stage.update(h);
      stage.render();
      shell.tick();
    },
    dispose() {
      pathGeo.dispose();
      pathMat.dispose();
      osprey.dispose();
      stage.dispose();
    },
  };
}
