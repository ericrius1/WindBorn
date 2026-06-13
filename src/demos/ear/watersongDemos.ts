// Demos for watersong.html — the water's voice, driven by the disturbance bus.
//
//   hero    — a top-down lake wired to the real bus: click to splash, rain
//             on demand, fish rising on their own; every ring you see is a
//             bus event and every sound is the same event heard
//   anatomy — the three parts of a splash, isolated and reassembled
//   lapping — the shore wash driven by waterHeightAt — wind in, lap out
//   rain    — one drop is a plink; a thousand drops are a texture

import { Shell, type Demo } from "../../lib/demoShell";
import { disturb, onDisturbance, waterHeightAt, wind, type Disturbance } from "../../lib/spine";
import { WaterAudio, scheduleSplash, scheduleRainGrain } from "../../lib/audio";
import {
  SoundGate,
  Bag,
  ctx2d,
  makeAnalyser,
  drawWaveform,
  drawSpectrum,
  drawFreqAxis,
  EAR_PAL as P,
} from "./earCommon";

interface Ring {
  x: number;
  z: number;
  r: number;
  max: number;
  energy: number;
  kind: Disturbance["kind"];
}

// ---- hero: the lake answers ------------------------------------------------------

export function mountWatersongHero(el: HTMLElement): Demo {
  const shell = new Shell(el, el.closest("header.hero") ? 0.42 : 0.55);
  const { g, w, h } = ctx2d(shell);
  const bag = new Bag();
  const gate = new SoundGate(shell, { hint: "🔊 click the water" });
  bag.add(() => gate.dispose());

  // Ears at the center of the view.
  const water = new WaterAudio({ destination: gate.input, listener: () => ({ x: 0, z: 0 }) });
  bag.add(() => water.dispose());

  // World window: ±extent meters maps to the canvas.
  const extent = 42;
  const toPx = (x: number, z: number): [number, number] => [
    w / 2 + (x / extent) * (w / 2),
    h / 2 + (z / extent) * (h / 2),
  ];

  const rings: Ring[] = [];
  bag.add(
    onDisturbance((d) => {
      if (Math.abs(d.x) > extent || Math.abs(d.z) > extent) return;
      if (rings.length > 220) rings.shift();
      rings.push({
        x: d.x,
        z: d.z,
        r: d.radius,
        max: d.kind === "rain" ? 2.5 : 4 + 14 * Math.cbrt(d.energy),
        energy: d.energy,
        kind: d.kind,
      });
    }),
  );

  let splashEnergy = 0.6;
  let rainRate = 0;
  let simT = 0;
  let nextRise = 4;

  // Click → a real bus event at that world point. The audio doesn't know the
  // click happened — it hears the bus, same as the rings.
  const onClick = (ev: PointerEvent): void => {
    const rect = shell.canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width - 0.5) * 2 * extent;
    const z = ((ev.clientY - rect.top) / rect.height - 0.5) * 2 * extent;
    disturb({ kind: "splash", x, z, energy: splashEnergy, radius: 0.5 + Math.cbrt(splashEnergy) });
  };
  shell.canvas.addEventListener("pointerdown", onClick);
  shell.canvas.style.cursor = "crosshair";
  bag.add(() => shell.canvas.removeEventListener("pointerdown", onClick));

  shell.slider({
    label: "click energy (J-ish)",
    min: 0.02,
    max: 1,
    step: 0.02,
    value: 0.6,
    onInput: (v) => (splashEnergy = v),
  });
  shell.slider({
    label: "rain (drops/s)",
    min: 0,
    max: 160,
    step: 5,
    value: 0,
    onInput: (v) => (rainRate = v),
  });
  const savedWind = wind.speed;
  bag.add(() => (wind.speed = savedWind));
  shell.slider({
    label: "wind (m/s)",
    min: 0,
    max: 9,
    step: 0.5,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  shell.setInfo(() => `${rings.length} live rings · lap follows |∂h/∂t| at the ear`);

  let last = performance.now();
  let rainCarry = 0;
  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    simT += dt;
    gate.tick();
    water.update(simT, dt);

    // Rain: Poisson-ish event stream onto the bus.
    rainCarry += rainRate * dt;
    while (rainCarry >= 1) {
      rainCarry -= 1;
      disturb({
        kind: "rain",
        x: (Math.random() * 2 - 1) * extent,
        z: (Math.random() * 2 - 1) * extent,
        energy: 0.0005 + Math.random() * 0.0015,
        radius: 0.05,
      });
    }

    // The lake's own life: a fish rises every few seconds.
    if (simT > nextRise) {
      nextRise = simT + 2.5 + Math.random() * 6;
      disturb({
        kind: "rise",
        x: (Math.random() * 2 - 1) * extent * 0.8,
        z: (Math.random() * 2 - 1) * extent * 0.8,
        energy: 0.03 + Math.random() * 0.05,
        radius: 0.3,
      });
    }

    // -- draw ------------------------------------------------------------
    g.fillStyle = "#0a1422";
    g.fillRect(0, 0, w, h);
    // Wind-streaked water texture: faint moving stipple.
    g.fillStyle = "rgba(122,162,255,0.05)";
    const dx = Math.cos(wind.direction);
    const dz = Math.sin(wind.direction);
    for (let i = 0; i < 70; i++) {
      const px = (i * 137.5 + simT * wind.speed * 6 * dx) % w;
      const pz = (i * 91.3 + simT * wind.speed * 6 * dz) % h;
      g.fillRect((px + w) % w, (pz + h) % h, 7, 1);
    }

    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.r += dt * (r.kind === "rain" ? 3.5 : 2.2 + 2.5 * Math.cbrt(r.energy));
      if (r.r > r.max) {
        rings.splice(i, 1);
        continue;
      }
      const a = (1 - r.r / r.max) * (r.kind === "rain" ? 0.35 : 0.8);
      const [px, pz] = toPx(r.x, r.z);
      g.strokeStyle =
        r.kind === "rise"
          ? `rgba(125,214,160,${a.toFixed(3)})`
          : r.kind === "rain"
            ? `rgba(170,180,212,${a.toFixed(3)})`
            : `rgba(122,162,255,${a.toFixed(3)})`;
      g.lineWidth = r.kind === "rain" ? 1 : 1.6;
      g.beginPath();
      g.ellipse(px, pz, (r.r / extent) * (w / 2), (r.r / extent) * (h / 2) * 0.96, 0, 0, Math.PI * 2);
      g.stroke();
    }

    // The ear at center.
    g.fillStyle = P.warm;
    g.beginPath();
    g.arc(w / 2, h / 2, 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = P.muted;
    g.font = "10px ui-monospace,monospace";
    g.fillText("the ear (listener)", w / 2 + 8, h / 2 - 8);
    g.fillText("click anywhere — distance sets loudness, side sets pan", 12, h - 10);
    shell.tick();
  };

  return { frame, dispose: () => bag.dispose() };
}

// ---- the anatomy of a splash --------------------------------------------------------

export function mountSplashAnatomy(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.48);
  const { g, w, h } = ctx2d(shell);
  const bag = new Bag();
  const gate = new SoundGate(shell, { button: false });
  bag.add(() => gate.dispose());
  const an = makeAnalyser(gate.input, 4096);
  bag.add(() => an.disconnect());

  let energy = 0.5;
  let lastPart = "—";

  const fire = (name: string, opts: { slap?: number; body?: number; tail?: number }): void => {
    void gate.enable(); // button press is a gesture; arm the audio with it
    scheduleSplash(gate.input, energy, opts);
    lastPart = name;
  };
  shell.button("1 · slap", () => fire("slap", { slap: 1, body: 0, tail: 0 }));
  shell.button("2 · body", () => fire("body", { slap: 0, body: 1, tail: 0 }));
  shell.button("3 · tail", () => fire("tail", { slap: 0, body: 0, tail: 1 }));
  shell.button("full splash", () => fire("slap + body + tail", {}));
  shell.slider({
    label: "energy (J-ish)",
    min: 0.001,
    max: 1.2,
    step: 0.001,
    value: 0.5,
    log: true,
    format: (v) => v.toFixed(3),
    onInput: (v) => (energy = v),
  });
  shell.setInfo(() => {
    const R = 0.0015 + 0.05 * Math.cbrt(energy);
    return `cavity R ≈ ${(R * 100).toFixed(1)} cm → Minnaert f ≈ ${Math.round(3.26 / R)} Hz · last: ${lastPart}`;
  });

  const frame = (): void => {
    gate.tick();
    g.fillStyle = P.bg;
    g.fillRect(0, 0, w, h);
    const pad = 34;
    const pw = w - pad * 2;

    // Schematic: the three envelopes on a shared timeline.
    const sy = 24;
    const sh = (h - 90) * 0.42;
    g.strokeStyle = P.grid;
    g.strokeRect(pad, sy, pw, sh);
    const T = (t: number): number => pad + (t / 1.0) * pw; // 1 s window
    const env = (t0: number, a: number, d: number, t: number): number =>
      t < t0 ? 0 : t < t0 + a ? (t - t0) / a : Math.exp(-(t - t0 - a) / d);
    const size = Math.cbrt(energy);
    const parts: [string, string, (t: number) => number][] = [
      ["slap", P.accent, (t) => env(0, 0.004, 0.03 + 0.07 * size, t)],
      ["body (bloop)", P.warm, (t) => 0.8 * env(0.012, 0.015, 0.1 + 0.25 * size, t)],
      ["droplet tail", P.good, (t) => 0.35 * env(0.05, 0.05, 0.15 + 0.4 * size, t) * (0.6 + 0.4 * Math.sin(t * 60))],
    ];
    for (const [, col, fn] of parts) {
      g.strokeStyle = col;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let t = 0; t <= 1; t += 0.004) {
        const x = T(t);
        const y = sy + sh - fn(t) * (sh - 8);
        if (t === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.font = "10px ui-monospace,monospace";
    let lx = pad + 8;
    for (const [name, col] of parts) {
      g.fillStyle = col;
      g.fillText(name, lx, sy + 14);
      lx += name.length * 6.4 + 18;
    }
    g.fillStyle = P.muted;
    g.fillText("0 s", pad, sy + sh + 12);
    g.fillText("1 s", pad + pw - 18, sy + sh + 12);

    // Live waveform of whatever you fire.
    const wy = sy + sh + 30;
    const wh = h - wy - 22;
    g.strokeStyle = P.grid;
    g.strokeRect(pad, wy, pw, wh);
    drawWaveform(g, an, pad, wy, pw, wh, P.text);
    g.fillStyle = P.muted;
    g.fillText("live output — press the buttons", pad + 6, wy + 14);
    shell.tick();
  };

  return { frame, dispose: () => bag.dispose() };
}

// ---- lapping from the wave state -----------------------------------------------------

export function mountLapping(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.5);
  const { g, w, h } = ctx2d(shell);
  const bag = new Bag();
  const gate = new SoundGate(shell);
  bag.add(() => gate.dispose());

  // Lapping only: no bus events, just the wave-driven wash.
  const water = new WaterAudio({ destination: gate.input, bus: false });
  bag.add(() => water.dispose());

  const savedWind = wind.speed;
  bag.add(() => (wind.speed = savedWind));
  shell.slider({
    label: "wind (m/s)",
    min: 0,
    max: 9,
    step: 0.25,
    value: Math.max(wind.speed, 3),
    onInput: (v) => (wind.speed = v),
  });
  wind.speed = Math.max(wind.speed, 3);
  shell.setInfo(() => `h(0,0,t) from the spine wave table · wind ${wind.speed.toFixed(1)} m/s`);

  // Histories for the scrolling traces.
  const N = 360;
  const hHist = new Float32Array(N);
  const eHist = new Float32Array(N);
  let head = 0;
  let prevH = 0;
  let env = 0;
  let simT = 0;
  let last = performance.now();

  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    simT += dt;
    gate.tick();
    water.update(simT, dt);

    // Mirror of the synth's envelope follower, for the plot.
    const hgt = waterHeightAt(0, 0, simT);
    const dhdt = dt > 0 ? (hgt - prevH) / dt : 0;
    prevH = hgt;
    const drive = Math.min(1, Math.abs(dhdt) * 6);
    env += (drive - env) * Math.min(1, (drive > env ? 10 : 1.6) * dt);
    hHist[head] = hgt;
    eHist[head] = env;
    head = (head + 1) % N;

    g.fillStyle = P.bg;
    g.fillRect(0, 0, w, h);
    const pad = 34;
    const pw = w - pad * 2;
    const rowH = (h - 80) / 2;

    // Row 1: surface height at the ear.
    g.strokeStyle = P.grid;
    g.strokeRect(pad, 20, pw, rowH);
    g.strokeStyle = P.accent;
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i < N; i++) {
      const v = hHist[(head + i) % N];
      const x = pad + (i / (N - 1)) * pw;
      const y = 20 + rowH / 2 - v * rowH * 1.4;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = P.accent;
    g.font = "10px ui-monospace,monospace";
    g.fillText("surface height h(t) at the listener — waterHeightAt(0, 0, t)", pad + 6, 34);

    // Row 2: the envelope that gates the wash.
    const y2 = 20 + rowH + 18;
    g.strokeStyle = P.grid;
    g.strokeRect(pad, y2, pw, rowH);
    g.fillStyle = "rgba(255,184,107,0.25)";
    g.beginPath();
    g.moveTo(pad, y2 + rowH);
    for (let i = 0; i < N; i++) {
      const v = eHist[(head + i) % N];
      g.lineTo(pad + (i / (N - 1)) * pw, y2 + rowH - v * (rowH - 6));
    }
    g.lineTo(pad + pw, y2 + rowH);
    g.closePath();
    g.fill();
    g.strokeStyle = P.warm;
    g.beginPath();
    for (let i = 0; i < N; i++) {
      const v = eHist[(head + i) % N];
      const x = pad + (i / (N - 1)) * pw;
      const y = y2 + rowH - v * (rowH - 6);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = P.warm;
    g.fillText("lap envelope — |∂h/∂t| with fast attack, slow release → noise gain", pad + 6, y2 + 14);
    shell.tick();
  };

  return { frame, dispose: () => bag.dispose() };
}

// ---- rain: one drop, then a thousand --------------------------------------------------

export function mountRain(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.48);
  const { g, w, h } = ctx2d(shell);
  const bag = new Bag();
  const gate = new SoundGate(shell, { button: false });
  bag.add(() => gate.dispose());
  const an = makeAnalyser(gate.input);
  bag.add(() => an.disconnect());

  let rate = 0;
  let carry = 0;
  const drops: { x: number; y: number; age: number }[] = [];

  shell.button("one drop", () => {
    void gate.enable();
    // A raindrop IS a splash — energy ~a millijoule, millimeter bubble, plink.
    scheduleSplash(gate.input, 0.001, { slap: 0.5, body: 1, tail: 0 });
    drops.push({ x: Math.random() * w, y: Math.random() * (h - 90), age: 0 });
  });
  shell.slider({
    label: "rain rate (drops/s)",
    min: 0,
    max: 220,
    step: 5,
    value: 0,
    onInput: (v) => {
      rate = v;
      if (v > 0) void gate.enable();
    },
  });
  shell.setInfo(() => `${rate} grains/s scheduled · 1 in 6 carries a bubble plink`);

  let last = performance.now();
  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    gate.tick();

    carry += rate * dt;
    while (carry >= 1) {
      carry -= 1;
      scheduleRainGrain(gate.input, 0.0005 + Math.random() * 0.0015);
      if (drops.length < 400) drops.push({ x: Math.random() * w, y: Math.random() * (h - 90), age: 0 });
    }

    g.fillStyle = P.bg;
    g.fillRect(0, 0, w, h);
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.age += dt;
      if (d.age > 0.7) {
        drops.splice(i, 1);
        continue;
      }
      const a = 1 - d.age / 0.7;
      g.strokeStyle = `rgba(170,180,212,${(a * 0.6).toFixed(3)})`;
      g.beginPath();
      g.arc(d.x, d.y, 1 + d.age * 16, 0, Math.PI * 2);
      g.stroke();
    }

    const pad = 34;
    const pw = w - pad * 2;
    const sy = h - 86;
    drawFreqAxis(g, pad, sy, pw, 60);
    drawSpectrum(g, an, pad, sy, pw, 60, P.accent);
    g.fillStyle = P.muted;
    g.font = "10px ui-monospace,monospace";
    g.fillText("spectrum — individual plinks blur into broadband patter as density rises", pad, sy - 6);
    shell.tick();
  };

  return { frame, dispose: () => bag.dispose() };
}
