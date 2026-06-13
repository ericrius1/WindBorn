// Demos for score.html — the adaptive score.
//
//   hero      — the full engine: altitude / hour / weather sliders, live
//               layer meters, the actual music
//   harmony   — a piano that explains the pentatonic contract
//   crossfade — linear vs equal-power, with a meter catching the −3 dB hole
//   layers    — the layer-weight map across a whole day (pure math, silent)

import { Shell, type Demo } from "../../lib/demoShell";
import {
  AdaptiveScore,
  layerWeights,
  equalPowerWeights,
  noteHz,
  audioContext,
  type ScoreInputs,
} from "../../lib/audio";
import { SoundGate, Bag, ctx2d, makeAnalyser, EAR_PAL as P } from "./earCommon";

const LAYER_NAMES = ["drone", "meadow", "aloft", "night", "storm"] as const;
const LAYER_COLORS: Record<(typeof LAYER_NAMES)[number], string> = {
  drone: P.muted,
  meadow: P.good,
  aloft: P.accent,
  night: "#9a86d8",
  storm: P.red,
};

function weightsArray(inp: ScoreInputs): number[] {
  const w = layerWeights(inp);
  return [w.drone, w.meadow, w.aloft, w.night, w.storm];
}

// ---- hero: the engine --------------------------------------------------------------

export function mountScoreHero(el: HTMLElement): Demo {
  const shell = new Shell(el, el.closest("header.hero") ? 0.42 : 0.52);
  const { g, w, h } = ctx2d(shell);
  const bag = new Bag();
  const gate = new SoundGate(shell, { hint: "🔊 click for music" });
  bag.add(() => gate.dispose());

  const score = new AdaptiveScore(gate.input);
  bag.add(() => score.dispose());

  const inp: ScoreInputs = { altitude: 12, hour: 9, storm: 0 };
  let liveDay = true;

  shell.slider({
    label: "altitude (m)",
    min: 0,
    max: 120,
    step: 1,
    value: 12,
    onInput: (v) => (inp.altitude = v),
  });
  shell.slider({
    label: "hour",
    min: 0,
    max: 24,
    step: 0.1,
    value: 9,
    onInput: (v) => {
      inp.hour = v;
      liveDay = false;
    },
  });
  shell.slider({
    label: "weather (storm)",
    min: 0,
    max: 1,
    step: 0.05,
    value: 0,
    onInput: (v) => (inp.storm = v),
  });
  shell.button("let the day run", () => (liveDay = !liveDay));
  shell.setInfo(() => {
    const hh = Math.floor(inp.hour);
    const mm = Math.floor((inp.hour - hh) * 60);
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")} · alt ${inp.altitude.toFixed(0)} m · storm ${inp.storm.toFixed(2)}`;
  });

  let last = performance.now();
  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    gate.tick();
    if (liveDay) inp.hour = (inp.hour + dt * 0.25) % 24; // ~96 s per day
    score.update(inp, dt);

    g.fillStyle = P.bg;
    g.fillRect(0, 0, w, h);
    const pad = 34;

    // Sun arc: a clock you can read at a glance.
    const cx = w * 0.22;
    const cy = h * 0.52;
    const R = Math.min(w * 0.16, h * 0.34);
    g.strokeStyle = P.grid;
    g.beginPath();
    g.arc(cx, cy, R, Math.PI, 0);
    g.stroke();
    g.beginPath();
    g.moveTo(cx - R - 14, cy);
    g.lineTo(cx + R + 14, cy);
    g.stroke();
    const sunA = Math.PI + ((inp.hour - 6) / 12) * Math.PI; // 6h → rise, 18h → set
    const sx = cx + Math.cos(sunA) * R;
    const sy = cy + Math.sin(sunA) * R;
    const day = sy <= cy;
    g.fillStyle = day ? P.warm : "#9a86d8";
    g.beginPath();
    g.arc(sx, sy, 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = P.muted;
    g.font = "10px ui-monospace,monospace";
    g.fillText(day ? "sun" : "(below horizon)", sx - 16, sy - 12);
    g.fillText("the day", cx - 20, cy + 18);

    // Layer meters: the exact gains feeding the five GainNodes.
    const gains = equalPowerWeights(weightsArray(inp));
    const mx = w * 0.42;
    const mw = w - mx - pad;
    const rowH = (h - 60) / LAYER_NAMES.length;
    for (let i = 0; i < LAYER_NAMES.length; i++) {
      const y = 26 + i * rowH;
      const name = LAYER_NAMES[i];
      g.fillStyle = LAYER_COLORS[name];
      g.font = "11px ui-monospace,monospace";
      g.fillText(name, mx, y + rowH * 0.45);
      g.fillStyle = "rgba(42,47,66,0.8)";
      g.fillRect(mx + 58, y + rowH * 0.18, mw - 58, rowH * 0.4);
      g.fillStyle = LAYER_COLORS[name];
      g.fillRect(mx + 58, y + rowH * 0.18, (mw - 58) * gains[i], rowH * 0.4);
      g.fillStyle = P.muted;
      g.fillText(gains[i].toFixed(2), mx + 58 + (mw - 58) + 4 - 30, y + rowH * 0.45);
    }
    g.fillStyle = P.muted;
    g.fillText("layer gains gᵢ = √(wᵢ / max(1, Σw)) — live", mx, h - 14);
    shell.tick();
  };

  return { frame, dispose: () => bag.dispose() };
}

// ---- harmony: the pentatonic contract -------------------------------------------------

const SCALE_MIDI = new Set([62, 64, 66, 69, 71, 74, 76, 78, 81, 83]); // D maj pent, two octaves
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function mountHarmony(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.34);
  const { g, w, h } = ctx2d(shell);
  const bag = new Bag();
  const gate = new SoundGate(shell, { button: false });
  bag.add(() => gate.dispose());

  // Build the piano: two octaves, D4 (62) to D6 (86).
  const piano = document.createElement("div");
  piano.className = "piano";
  shell.controls.parentElement?.insertBefore(piano, shell.controls);
  bag.add(() => piano.remove());

  const lo = 62;
  const hi = 86;
  const whites: number[] = [];
  for (let m = lo; m <= hi; m++) if (![1, 3, 6, 8, 10].includes(m % 12)) whites.push(m);
  const wKeyW = 100 / whites.length;

  const held: number[] = []; // most recent notes, newest last

  const play = (midi: number): void => {
    void gate.enable();
    const ctx = audioContext();
    const t0 = ctx.currentTime;
    const f = noteHz(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2200;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.22, t0 + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 1.6);
    lp.connect(env).connect(gate.input);
    for (const det of [-5, 5]) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      osc.detune.value = det;
      osc.connect(lp);
      osc.start(t0);
      osc.stop(t0 + 1.7);
      osc.addEventListener("ended", () => osc.disconnect());
    }
    window.setTimeout(() => {
      lp.disconnect();
      env.disconnect();
    }, 1900);
    held.push(midi);
    if (held.length > 2) held.shift();
  };

  let wIdx = 0;
  for (let m = lo; m <= hi; m++) {
    const isBlack = [1, 3, 6, 8, 10].includes(m % 12);
    const key = document.createElement("div");
    key.className = `piano-key ${isBlack ? "piano-black" : "piano-white"}`;
    if (isBlack) {
      key.style.left = `${wIdx * wKeyW - wKeyW * 0.28}%`;
      key.style.width = `${wKeyW * 0.56}%`;
    } else {
      key.style.left = `${wIdx * wKeyW}%`;
      key.style.width = `${wKeyW}%`;
      wIdx++;
    }
    const cap = document.createElement("span");
    cap.className = "piano-cap";
    const inScale = SCALE_MIDI.has(m);
    const isRoot = m % 12 === 2;
    cap.textContent = inScale ? (isRoot ? "D●" : NOTE_NAMES[m % 12]) : "";
    key.appendChild(cap);
    if (isRoot && inScale) key.classList.add("is-root");
    const midi = m;
    key.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      play(midi);
      key.classList.add("is-held");
      window.setTimeout(() => key.classList.remove("is-held"), 250);
    });
    piano.appendChild(key);
  }

  shell.setInfo(() => {
    if (held.length < 2) return "labeled keys = D major pentatonic · play any two";
    const [a, b] = held;
    const semis = Math.abs(a - b) % 12;
    const name =
      ["unison", "min 2nd", "maj 2nd", "min 3rd", "maj 3rd", "4th", "tritone", "5th", "min 6th", "maj 6th", "min 7th", "maj 7th"][semis] ?? "";
    const both = SCALE_MIDI.has(a) && SCALE_MIDI.has(b);
    return `${NOTE_NAMES[a % 12]} + ${NOTE_NAMES[b % 12]} = ${name} ${both ? "· in the scale: no semitone clashes possible" : "· off-scale"}`;
  });

  let t = 0;
  let last = performance.now();
  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    t += dt;
    gate.tick();

    // Draw the two most recent notes as summed sines — beats are visible.
    g.fillStyle = P.bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = P.grid;
    g.strokeRect(8, 8, w - 16, h - 16);
    if (held.length > 0) {
      g.strokeStyle = P.accent;
      g.lineWidth = 1.4;
      g.beginPath();
      const fA = noteHz(held[0]);
      const fB = held.length > 1 ? noteHz(held[1]) : 0;
      for (let x = 0; x < w - 24; x++) {
        const tt = x / (w - 24) * 0.03; // 30 ms window
        let v = Math.sin(2 * Math.PI * fA * (tt + t * 0.0));
        if (fB) v = (v + Math.sin(2 * Math.PI * fB * tt)) / 2;
        const y = h / 2 + v * (h / 2 - 16);
        if (x === 0) g.moveTo(12 + x, y);
        else g.lineTo(12 + x, y);
      }
      g.stroke();
      g.fillStyle = P.muted;
      g.font = "10px ui-monospace,monospace";
      g.fillText("the last two notes, summed — 30 ms", 14, 22);
    } else {
      g.fillStyle = P.muted;
      g.font = "11px ui-monospace,monospace";
      g.fillText("play the keys below", w / 2 - 60, h / 2);
    }
    shell.tick();
  };

  return { frame, dispose: () => bag.dispose() };
}

// ---- crossfade: linear vs equal power ---------------------------------------------------

export function mountCrossfade(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.46);
  const { g, w, h } = ctx2d(shell);
  const bag = new Bag();
  const gate = new SoundGate(shell);
  bag.add(() => gate.dispose());

  const ctx = audioContext();
  // Two pads a fifth apart, same loudness.
  const mkPad = (midis: number[]): { out: GainNode; stop: () => void } => {
    const out = ctx.createGain();
    out.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    lp.connect(out).connect(gate.input);
    const oscs: OscillatorNode[] = [];
    for (const m of midis) {
      for (const det of [-5, 5]) {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = noteHz(m);
        osc.detune.value = det;
        const vg = ctx.createGain();
        vg.gain.value = 0.12;
        osc.connect(vg).connect(lp);
        osc.start();
        oscs.push(osc);
      }
    }
    return {
      out,
      stop: () => {
        for (const o of oscs) {
          o.stop();
          o.disconnect();
        }
        lp.disconnect();
        out.disconnect();
      },
    };
  };
  const padA = mkPad([50, 57, 64]); // D3 A3 E4
  const padB = mkPad([47, 54, 62]); // B2 F#3 D4
  bag.add(() => padA.stop());
  bag.add(() => padB.stop());
  const an = makeAnalyser(gate.input, 2048);
  bag.add(() => an.disconnect());

  let u = 0.5;
  let equalPower = true;
  let auto = true;
  let autoT = 0;

  shell.slider({
    label: "blend A → B",
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.5,
    onInput: (v) => {
      u = v;
      auto = false;
    },
  });
  shell.button("law: equal-power / linear", () => (equalPower = !equalPower));
  shell.button("auto sweep", () => {
    auto = !auto;
  });

  const rmsHist = new Float32Array(240);
  let head = 0;
  const data = new Float32Array(2048);

  shell.setInfo(() => {
    const [gA, gB] = gains();
    return `${equalPower ? "equal-power" : "linear"} · gA ${gA.toFixed(2)} gB ${gB.toFixed(2)} · power ${(gA * gA + gB * gB).toFixed(2)}`;
  });

  const gains = (): [number, number] =>
    equalPower
      ? [Math.cos((u * Math.PI) / 2), Math.sin((u * Math.PI) / 2)]
      : [1 - u, u];

  let last = performance.now();
  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    gate.tick();
    if (auto) {
      autoT += dt;
      u = 0.5 - 0.5 * Math.cos(autoT * 0.7);
    }
    const [gA, gB] = gains();
    padA.out.gain.setTargetAtTime(gA, ctx.currentTime, 0.05);
    padB.out.gain.setTargetAtTime(gB, ctx.currentTime, 0.05);

    // Measured RMS of the mix.
    an.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    rmsHist[head] = Math.sqrt(sum / data.length);
    head = (head + 1) % rmsHist.length;

    g.fillStyle = P.bg;
    g.fillRect(0, 0, w, h);
    const pad = 34;
    const pw = w - pad * 2;
    const ph = (h - 92) * 0.55;

    // The two laws.
    g.strokeStyle = P.grid;
    g.strokeRect(pad, 20, pw, ph);
    const plot = (fn: (x: number) => number, col: string, dash: boolean): void => {
      g.strokeStyle = col;
      g.lineWidth = 1.5;
      if (dash) g.setLineDash([4, 4]);
      g.beginPath();
      for (let x = 0; x <= 1; x += 0.01) {
        const px = pad + x * pw;
        const py = 20 + ph - fn(x) * (ph - 8);
        if (x === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
      g.setLineDash([]);
    };
    if (equalPower) {
      plot((x) => Math.cos((x * Math.PI) / 2), P.accent, false);
      plot((x) => Math.sin((x * Math.PI) / 2), P.warm, false);
      plot((x) => Math.cos((x * Math.PI) / 2) ** 2 + Math.sin((x * Math.PI) / 2) ** 2, P.good, true);
    } else {
      plot((x) => 1 - x, P.accent, false);
      plot((x) => x, P.warm, false);
      plot((x) => (1 - x) ** 2 + x ** 2, P.good, true);
    }
    g.font = "10px ui-monospace,monospace";
    g.fillStyle = P.accent;
    g.fillText("gain A", pad + 6, 34);
    g.fillStyle = P.warm;
    g.fillText("gain B", pad + pw - 46, 34);
    g.fillStyle = P.good;
    g.fillText("total POWER gA²+gB² (dashed)", pad + pw / 2 - 80, 34);
    // marker
    g.strokeStyle = P.text;
    g.beginPath();
    g.moveTo(pad + u * pw, 20);
    g.lineTo(pad + u * pw, 20 + ph);
    g.stroke();

    // Measured loudness strip.
    const ry = 20 + ph + 26;
    const rh = h - ry - 24;
    g.strokeStyle = P.grid;
    g.strokeRect(pad, ry, pw, rh);
    g.strokeStyle = P.good;
    g.beginPath();
    for (let i = 0; i < rmsHist.length; i++) {
      const v = rmsHist[(head + i) % rmsHist.length];
      const x = pad + (i / (rmsHist.length - 1)) * pw;
      const y = ry + rh - Math.min(1, v * 6) * (rh - 6);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = P.muted;
    g.fillText("measured RMS of the mix — flat on equal-power, dipping on linear", pad + 6, ry + 14);
    shell.tick();
  };

  return { frame, dispose: () => bag.dispose() };
}

// ---- the day map (silent) ------------------------------------------------------------

export function mountLayerMap(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.46);
  const { g, w, h } = ctx2d(shell);

  let altitude = 12;
  let storm = 0;
  shell.slider({
    label: "altitude (m)",
    min: 0,
    max: 120,
    step: 1,
    value: 12,
    onInput: (v) => (altitude = v),
  });
  shell.slider({
    label: "weather (storm)",
    min: 0,
    max: 1,
    step: 0.05,
    value: 0,
    onInput: (v) => (storm = v),
  });
  shell.setInfo(() => "the same layerWeights() the engine runs, plotted over 24 hours");

  const frame = (): void => {
    g.fillStyle = P.bg;
    g.fillRect(0, 0, w, h);
    const pad = 38;
    const pw = w - pad * 2;
    const ph = h - 78;

    g.strokeStyle = P.grid;
    g.strokeRect(pad, 20, pw, ph);
    g.font = "10px ui-monospace,monospace";
    g.fillStyle = P.muted;
    for (const hr of [0, 6, 12, 18, 24]) {
      const x = pad + (hr / 24) * pw;
      g.beginPath();
      g.moveTo(x, 20);
      g.lineTo(x, 20 + ph);
      g.strokeStyle = "#1c2030";
      g.stroke();
      g.fillText(`${hr}h`, x - 8, 20 + ph + 14);
    }

    const gainsAt = (hour: number): number[] =>
      equalPowerWeights(weightsArray({ altitude, hour, storm }));

    for (let li = 0; li < LAYER_NAMES.length; li++) {
      const name = LAYER_NAMES[li];
      g.strokeStyle = LAYER_COLORS[name];
      g.lineWidth = 1.6;
      g.beginPath();
      for (let i = 0; i <= 96; i++) {
        const hour = (i / 96) * 24;
        const v = gainsAt(hour)[li];
        const x = pad + (i / 96) * pw;
        const y = 20 + ph - v * (ph - 10);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.fillStyle = LAYER_COLORS[name];
      g.fillText(name, pad + 8 + li * 64, 34);
    }
    shell.tick();
  };

  return { frame, dispose: () => undefined };
}
