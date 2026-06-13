// Demos for rush.html — wind synthesized from live airspeed.
//
//   hero  — fly (or watch the dive pilot) and HEAR the speed
//   bands — one filtered-noise band: the atom of every wind sound
//   speed — the airspeed → filter-bank mapping, sliders + spectrum
//   whump — the wingbeat layer: downstroke whumps + stall buffet

import { Shell, type Demo } from "../../lib/demoShell";
import {
  WindSynth,
  windCurves,
  stillAir,
  noiseSource,
  attachWindAudio,
  type WindTelemetry,
} from "../../lib/audio";
import { flightState } from "../../lib/flight";
import {
  SoundGate,
  Bag,
  ctx2d,
  makeAnalyser,
  drawSpectrum,
  drawFreqAxis,
  drawWaveform,
  freqToPx,
  pxToFreq,
  EAR_PAL as P,
} from "./earCommon";
import { mountFlightStage, divePilot } from "./flightStage";

// ---- hero: fly it, hear it ------------------------------------------------------

export async function mountRushHero(el: HTMLElement): Promise<Demo> {
  const bag = new Bag();
  let gate: SoundGate | null = null;
  let windMount: { update(dt: number): void; dispose(): void } | null = null;
  let hud: { g: CanvasRenderingContext2D; an: AnalyserNode } | null = null;

  const stage = await mountFlightStage(el, {
    aspect: 0.52,
    autopilot: divePilot(),
    prompt: "Click to fly — and to listen",
    info: (body) =>
      `V ${body.airspeed.toFixed(1)} m/s · wind amp ${windCurves.amp(body.airspeed).toFixed(2)}`,
    setup: (api) => {
      gate = new SoundGate(api.shell, { hint: "🔊 click for sound", level: 1 });
      bag.add(() => gate?.dispose());
      const m = attachWindAudio(gate.input);
      windMount = m;
      bag.add(() => m.dispose());

      // A small live spectrum in the corner — the voice you're hearing.
      const panel = api.focus.panel("right:.7rem;top:.7rem;");
      const c = document.createElement("canvas");
      c.width = 440;
      c.height = 200;
      c.style.cssText = "width:220px;height:100px;display:block;border-radius:8px;";
      panel.appendChild(c);
      const g = c.getContext("2d")!;
      g.scale(2, 2);
      hud = { g, an: makeAnalyser(m.synth.output, 1024) };
      bag.add(() => hud?.an.disconnect());
    },
    onFrame: (_api, dt) => {
      gate?.tick();
      windMount?.update(dt);
      if (hud) {
        hud.g.clearRect(0, 0, 220, 100);
        hud.g.fillStyle = "rgba(6,7,11,.72)";
        hud.g.fillRect(0, 0, 220, 100);
        drawSpectrum(hud.g, hud.an, 6, 6, 208, 76, P.accent);
        hud.g.fillStyle = P.muted;
        hud.g.font = "9px ui-monospace,monospace";
        hud.g.fillText(`what you're hearing · V ${flightState.airspeed.toFixed(0)} m/s`, 8, 96);
      }
    },
  });

  return {
    frame: stage.frame,
    dispose: () => {
      bag.dispose();
      stage.dispose?.();
    },
  };
}

// ---- one band: the atom -----------------------------------------------------------

export function mountBands(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.48);
  const { g, w, h } = ctx2d(shell);
  const bag = new Bag();
  const gate = new SoundGate(shell, { level: 0.8 });
  bag.add(() => gate.dispose());

  const src = noiseSource("white");
  const filter = gate.input.context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 800;
  filter.Q.value = 2;
  const voice = gate.input.context.createGain();
  voice.gain.value = 0.5;
  src.connect(filter).connect(voice).connect(gate.input);
  bag.add(() => {
    src.stop();
    src.disconnect();
    filter.disconnect();
    voice.disconnect();
  });
  const an = makeAnalyser(voice);
  bag.add(() => an.disconnect());

  shell.slider({
    label: "center (Hz)",
    min: 60,
    max: 8000,
    step: 1,
    value: 800,
    log: true,
    format: (v) => `${Math.round(v)}`,
    onInput: (v) => filter.frequency.setTargetAtTime(v, filter.context.currentTime, 0.03),
  });
  shell.slider({
    label: "resonance Q",
    min: 0.3,
    max: 18,
    step: 0.1,
    value: 2,
    onInput: (v) => filter.Q.setTargetAtTime(v, filter.context.currentTime, 0.03),
  });
  shell.slider({
    label: "gain",
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.5,
    onInput: (v) => voice.gain.setTargetAtTime(v, voice.context.currentTime, 0.03),
  });
  shell.setInfo(() => `bandpass ${Math.round(filter.frequency.value)} Hz · Q ${filter.Q.value.toFixed(1)}`);

  // The filter's ideal magnitude response, asked of the node itself.
  const freqs = new Float32Array(160);
  const mags = new Float32Array(160);
  const phases = new Float32Array(160);

  const frame = (): void => {
    gate.tick();
    g.fillStyle = P.bg;
    g.fillRect(0, 0, w, h);
    const pad = 34;
    const pw = w - pad * 2;
    const ph = h - 70;

    for (let i = 0; i < freqs.length; i++) freqs[i] = pxToFreq((i / (freqs.length - 1)) * pw, pw);
    filter.getFrequencyResponse(freqs, mags, phases);

    drawFreqAxis(g, pad, 20, pw, ph);
    drawSpectrum(g, an, pad, 20, pw, ph, P.accent);

    // Overlay the response curve (dB, −40..+20).
    g.strokeStyle = P.warm;
    g.lineWidth = 1.6;
    g.beginPath();
    for (let i = 0; i < freqs.length; i++) {
      const db = 20 * Math.log10(Math.max(mags[i], 1e-4));
      const y = 20 + ph - ((db + 40) / 60) * ph;
      const x = pad + (i / (freqs.length - 1)) * pw;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, Math.max(12, Math.min(20 + ph, y)));
    }
    g.stroke();
    g.fillStyle = P.warm;
    g.font = "11px ui-monospace,monospace";
    g.fillText("filter response", pad + 6, 16);
    g.fillStyle = P.accent;
    g.fillText("live spectrum", pad + 110, 16);
    shell.tick();
  };

  return { frame, dispose: () => bag.dispose() };
}

// ---- the speed mapping ---------------------------------------------------------------

export function mountSpeedMap(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.52);
  const { g, w, h } = ctx2d(shell);
  const bag = new Bag();
  const gate = new SoundGate(shell);
  bag.add(() => gate.dispose());

  const synth = new WindSynth(gate.input);
  bag.add(() => synth.dispose());
  const an = makeAnalyser(synth.output);
  bag.add(() => an.disconnect());

  const tel: WindTelemetry = { ...stillAir(), airspeed: 9 };
  let sweep = false;
  let sweepT = 0;

  shell.slider({
    label: "airspeed (m/s)",
    min: 0,
    max: 34,
    step: 0.5,
    value: 9,
    onInput: (v) => {
      tel.airspeed = v;
      sweep = false;
    },
  });
  shell.slider({
    label: "tuck",
    min: 0,
    max: 1,
    step: 0.05,
    value: 0,
    onInput: (v) => (tel.tuck = v),
  });
  shell.button("auto sweep: glide → dive", () => {
    sweep = !sweep;
    sweepT = 0;
  });
  shell.setInfo(
    () =>
      `V ${tel.airspeed.toFixed(1)} m/s · amp ${windCurves.amp(tel.airspeed).toFixed(2)} · scream ${windCurves
        .screamGain(tel.airspeed)
        .toFixed(2)}`,
  );

  let last = performance.now();
  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    gate.tick();
    if (sweep) {
      sweepT += dt;
      tel.airspeed = 17 + 17 * Math.sin(sweepT * 0.45 - Math.PI / 2);
    }
    synth.update(tel, dt);

    g.fillStyle = P.bg;
    g.fillRect(0, 0, w, h);
    const pad = 34;
    const pw = w - pad * 2;
    const topH = (h - 92) * 0.55;
    const botH = (h - 92) * 0.45;

    // Top: the live spectrum.
    drawFreqAxis(g, pad, 18, pw, topH);
    drawSpectrum(g, an, pad, 18, pw, topH, P.accent);
    // Markers where the three bands sit right now.
    const marks: [number, string, string][] = [
      [windCurves.lowCutoff(tel.airspeed), "body", P.good],
      [windCurves.midCenter(tel.airspeed), "hiss", P.warm],
      [windCurves.screamCenter(tel.airspeed, tel.tuck), "scream", P.red],
    ];
    g.font = "10px ui-monospace,monospace";
    for (const [f, name, col] of marks) {
      const x = pad + freqToPx(f, pw);
      g.strokeStyle = col;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(x, 18);
      g.lineTo(x, 18 + topH);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = col;
      g.fillText(name, x + 3, 28);
    }

    // Bottom: the mapping curves, V on x.
    const y0 = 18 + topH + 36;
    g.strokeStyle = P.grid;
    g.strokeRect(pad, y0, pw, botH);
    const X = (v: number): number => pad + (v / 34) * pw;
    const plots: [(v: number) => number, string, string][] = [
      [(v) => windCurves.amp(v) / 1.2, "loudness", P.accent],
      [(v) => windCurves.midGain(v), "hiss gain", P.warm],
      [(v) => windCurves.screamGain(v), "scream gain", P.red],
    ];
    for (const [fn, name, col] of plots) {
      g.strokeStyle = col;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let v = 0; v <= 34; v += 0.5) {
        const x = X(v);
        const y = y0 + botH - fn(v) * (botH - 8);
        if (v === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.fillStyle = col;
      g.fillText(name, pad + 8, y0 + 14 + plots.findIndex(([f]) => f === fn) * 12);
    }
    // Current V marker.
    g.strokeStyle = P.text;
    g.beginPath();
    g.moveTo(X(tel.airspeed), y0);
    g.lineTo(X(tel.airspeed), y0 + botH);
    g.stroke();
    g.fillStyle = P.muted;
    g.fillText("airspeed →", pad + pw - 70, y0 + botH + 14);
    shell.tick();
  };

  return { frame, dispose: () => bag.dispose() };
}

// ---- whump & buffet --------------------------------------------------------------------

export function mountWhump(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.5);
  const { g, w, h } = ctx2d(shell);
  const bag = new Bag();
  const gate = new SoundGate(shell);
  bag.add(() => gate.dispose());

  const synth = new WindSynth(gate.input);
  bag.add(() => synth.dispose());
  const an = makeAnalyser(synth.output, 4096);
  bag.add(() => an.disconnect());

  const tel: WindTelemetry = { ...stillAir(), airspeed: 9, flapping: 0.7 };
  const whumpFlashes: number[] = [];
  let prevSin = 0;

  shell.slider({
    label: "flap effort",
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.7,
    onInput: (v) => (tel.flapping = v),
  });
  shell.slider({
    label: "airspeed (m/s)",
    min: 4,
    max: 18,
    step: 0.5,
    value: 9,
    onInput: (v) => (tel.airspeed = v),
  });
  shell.slider({
    label: "stall blend",
    min: 0,
    max: 1,
    step: 0.05,
    value: 0,
    onInput: (v) => (tel.stall = v),
  });
  shell.setInfo(() => {
    const hz = tel.flapping > 0.05 ? (2.5 + 2 * tel.flapping).toFixed(1) : "0";
    return `wingbeat ${hz} Hz · buffet depth ${tel.stall.toFixed(2)}`;
  });

  let last = performance.now();
  let simT = 0;
  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    simT += dt;
    gate.tick();

    // Advance the wingbeat clock exactly like the flight model does.
    if (tel.flapping > 0.05) tel.flapPhase += (2.5 + 2 * tel.flapping) * Math.PI * 2 * dt;
    const s = Math.sin(tel.flapPhase);
    if (prevSin > 0 && s <= 0 && tel.flapping > 0.05) whumpFlashes.push(simT);
    prevSin = s;
    while (whumpFlashes.length > 0 && simT - whumpFlashes[0] > 2.4) whumpFlashes.shift();

    synth.update(tel, dt);

    g.fillStyle = P.bg;
    g.fillRect(0, 0, w, h);
    const pad = 34;
    const pw = w - pad * 2;

    // Wingbeat dial.
    const cx = pad + 50;
    const cy = 70;
    g.strokeStyle = P.grid;
    g.beginPath();
    g.arc(cx, cy, 36, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = P.warm;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(tel.flapPhase) * 36, cy + Math.sin(tel.flapPhase) * 36);
    g.stroke();
    g.fillStyle = P.muted;
    g.font = "10px ui-monospace,monospace";
    g.fillText("flapPhase", cx - 26, cy + 54);
    // Downstroke trigger mark at phase = π.
    g.fillStyle = P.red;
    g.beginPath();
    g.arc(cx - 36, cy, 3, 0, Math.PI * 2);
    g.fill();
    g.fillText("whump fires here", cx - 120, cy - 44);

    // Whump timeline.
    const tlY = 70;
    const tlX = cx + 90;
    const tlW = w - tlX - pad;
    g.strokeStyle = P.grid;
    g.beginPath();
    g.moveTo(tlX, tlY);
    g.lineTo(tlX + tlW, tlY);
    g.stroke();
    for (const t of whumpFlashes) {
      const age = simT - t;
      const x = tlX + tlW - (age / 2.4) * tlW;
      g.fillStyle = `rgba(255,184,107,${(1 - age / 2.4).toFixed(2)})`;
      g.fillRect(x - 2, tlY - 16, 4, 32);
    }
    g.fillStyle = P.muted;
    g.fillText("downstrokes, last 2.4 s →", tlX, tlY + 30);

    // The waveform: whumps + buffet are time-domain creatures.
    const wy = 140;
    const wh = h - wy - 24;
    g.strokeStyle = P.grid;
    g.strokeRect(pad, wy, pw, wh);
    drawWaveform(g, an, pad, wy, pw, wh, P.good);
    g.fillStyle = P.muted;
    g.fillText("output waveform — listen for the thump under the hiss", pad + 6, wy + 14);
    shell.tick();
  };

  return { frame, dispose: () => bag.dispose() };
}
