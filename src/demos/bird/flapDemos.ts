// Demos for "The Flap Cycle" — the warped wingbeat clock, the stroke applied
// to wing targets, gait blending, and feather secondary motion.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { PAL } from "../../lib/scrolly";
import { buildOsprey } from "../../lib/bird/build";
import { strokeAt, type StrokeSample } from "../../lib/bird/flap";
import { OspreyAnimator } from "../../lib/bird/animator";
import { createStage, makeTimer } from "./stage";

// ---- hero: the cruise beat over water --------------------------------------------

export async function mountHeroFlap(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    water: true,
    orbit: { target: [0, 0.7, 0], radius: 2.2, azimuth: 0.8, polar: 0.18, autoSpin: 0.05 },
  });
  const osprey = buildOsprey();
  osprey.group.position.y = 0.42;
  stage.scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);
  anim.gait01 = 0.5;
  anim.flapRateHz = 2.8;

  shell.setInfo(() => `cruise · ${(anim.flapRateHz * anim.gp.rateMul).toFixed(1)} beats/s`);

  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      anim.update(h);
      osprey.group.position.y = 0.42 + Math.sin(stage.time * 0.9) * 0.03;
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

// ---- step 1: the warped clock, flat ------------------------------------------------

export function mountClock(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.52);
  const canvas = shell.canvas;
  const ctx = canvas.getContext("2d")!;

  let downFrac = 0.57;
  let rate = 1.2; // beats per second, slow enough to watch
  shell.slider({ label: "downstroke share", min: 0.35, max: 0.72, step: 0.01, value: downFrac, onInput: (v) => (downFrac = v) });
  shell.slider({ label: "rate (beats/s)", min: 0.2, max: 3, step: 0.05, value: rate, onInput: (v) => (rate = v) });

  const s: StrokeSample = { theta: 0, down: true, vert: 1, sweep: 0, upAmount: 0 };
  shell.setInfo(() => `${s.down ? "downstroke" : "upstroke"} · θ ${(s.theta * 57.3).toFixed(0)}°`);

  let phase = 0;
  const dt = makeTimer();
  return {
    frame() {
      phase += dt() * rate;
      strokeAt(phase, downFrac, s);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = PAL.bg;
      ctx.fillRect(0, 0, w, h);

      // left: the clock face. The downstroke owns `downFrac` of the dial.
      const cx = w * 0.24;
      const cy = h * 0.52;
      const R = Math.min(w, h) * 0.3;
      ctx.lineWidth = 10;
      ctx.strokeStyle = PAL.warm;
      ctx.beginPath();
      ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + downFrac * Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = PAL.dim;
      ctx.beginPath();
      ctx.arc(cx, cy, R, -Math.PI / 2 + downFrac * Math.PI * 2, -Math.PI / 2 + Math.PI * 2);
      ctx.stroke();
      const p = phase - Math.floor(phase);
      const ang = -Math.PI / 2 + p * Math.PI * 2;
      ctx.fillStyle = PAL.text;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PAL.muted;
      ctx.font = `${Math.round(R * 0.16)}px ui-monospace, monospace`;
      ctx.fillText("down", cx - R * 0.32, cy - R * 0.45);
      ctx.fillText("up", cx + R * 0.18, cy + R * 0.6);

      // right: tip height vs real time — warped cosine vs honest cosine
      const gx = w * 0.46;
      const gw = w * 0.5;
      const gy = h * 0.18;
      const gh = h * 0.64;
      ctx.strokeStyle = PAL.grid;
      ctx.lineWidth = 1;
      ctx.strokeRect(gx, gy, gw, gh);
      const sTmp: StrokeSample = { theta: 0, down: true, vert: 1, sweep: 0, upAmount: 0 };
      // honest cosine, dim
      ctx.strokeStyle = PAL.dim;
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const x = gx + (i / 120) * gw;
        const y = gy + gh * (0.5 - 0.42 * Math.cos((i / 120) * Math.PI * 2));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // warped clock, bright
      ctx.strokeStyle = PAL.accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        strokeAt(i / 120, downFrac, sTmp);
        const x = gx + (i / 120) * gw;
        const y = gy + gh * (0.5 - 0.42 * sTmp.vert);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // the moving dot
      ctx.fillStyle = PAL.text;
      ctx.beginPath();
      ctx.arc(gx + p * gw, gy + gh * (0.5 - 0.42 * s.vert), 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PAL.muted;
      ctx.fillText("tip height over one period", gx + 8, gy - 8);

      shell.tick();
    },
  };
}

// ---- step 2: the stroke on the bird ---------------------------------------------------

export async function mountBeat(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    orbit: { target: [0, 0.45, 0], radius: 1.9, azimuth: Math.PI / 2, polar: 0.1, autoSpin: 0 },
  });
  const osprey = buildOsprey();
  stage.scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);
  anim.gait01 = 0.5;
  anim.flapRateHz = 2.2;
  anim.overrideAmp = 0.21;
  anim.overrideDownFrac = 0.57;
  anim.overrideFoldUp = 0.65;

  shell.slider({ label: "rate Hz", min: 0.5, max: 5, step: 0.1, value: anim.flapRateHz, onInput: (v) => (anim.flapRateHz = v) });
  shell.slider({ label: "amplitude m", min: 0.04, max: 0.34, step: 0.01, value: anim.overrideAmp, onInput: (v) => (anim.overrideAmp = v) });
  shell.slider({ label: "downstroke share", min: 0.35, max: 0.72, step: 0.01, value: anim.overrideDownFrac, onInput: (v) => (anim.overrideDownFrac = v) });
  shell.slider({ label: "upstroke fold", min: 0, max: 1, step: 0.01, value: anim.overrideFoldUp, onInput: (v) => (anim.overrideFoldUp = v) });
  shell.setInfo(() => (anim.stroke.down ? "downstroke — span out, blade biting" : "upstroke — wrist folding home"));

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

// ---- step 3: gaits — one number, three flight modes -------------------------------------

export async function mountGaits(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    orbit: { target: [0, 0.5, 0], radius: 2.0, azimuth: 0.5, polar: 0.18, autoSpin: 0.04 },
  });
  const osprey = buildOsprey();
  stage.scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);
  anim.flapRateHz = 2.8;
  anim.gait01 = 0.5;

  let target = 0.5;
  const slider = shell.slider({
    label: "gait",
    min: 0,
    max: 1,
    step: 0.01,
    value: target,
    format: (v) => (v < 0.25 ? "hover" : v < 0.45 ? "hover→cruise" : v < 0.62 ? "cruise" : v < 0.85 ? "cruise→glide" : "glide"),
    onInput: (v) => (target = v),
  });
  const preset = (v: number): void => {
    target = v;
    slider.value = String(v);
    slider.dispatchEvent(new Event("input"));
  };
  shell.button("hover", () => preset(0));
  shell.button("cruise", () => preset(0.5));
  shell.button("glide", () => preset(1));
  shell.setInfo(
    () =>
      `amp ${anim.gp.amp.toFixed(2)} m · down ${(anim.gp.downFrac * 100).toFixed(0)}% · tail ${(anim.gp.tailSpread * 100).toFixed(0)}%`,
  );

  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      // ease the gait knob so the morph itself reads
      anim.gait01 += (target - anim.gait01) * Math.min(1, h * 3);
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

// ---- step 4: feather lag — the secondary motion ------------------------------------------

export async function mountFeathers(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    orbit: { target: [0.45, 0.42, -0.05], radius: 1.05, azimuth: 0.9, polar: 0.3, autoSpin: 0 },
  });
  const osprey = buildOsprey();
  stage.scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);
  anim.gait01 = 0.45;
  anim.flapRateHz = 2.4;

  shell.slider({ label: "feather stiffness Hz", min: 1.5, max: 12, step: 0.1, value: anim.featherFreqHz, onInput: (v) => (anim.featherFreqHz = v) });
  shell.slider({ label: "lag gain", min: 0, max: 2, step: 0.05, value: anim.featherGain, onInput: (v) => (anim.featherGain = v) });
  shell.slider({ label: "damping ζ", min: 0.15, max: 1.2, step: 0.01, value: anim.featherZeta, onInput: (v) => (anim.featherZeta = v) });
  shell.button("springs on/off", () => (anim.feathersEnabled = !anim.feathersEnabled));
  shell.setInfo(() => (anim.feathersEnabled ? "feathers chasing the stroke" : "rigid feathers — compare"));

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
