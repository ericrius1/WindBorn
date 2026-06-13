// Demos for blind.html — the finale: fly the lake by ear.
//
//   hero     — the full soundscape over the real basin, with a sight slider
//              that fades the screen to black; C calls, echoes answer
//   stems    — the one-call audio API driven by a headless flight model,
//              each stem metered and mutable
//   earcheck — find the fish: a localization game played on pan + distance

import { Shell, type Demo } from "../../lib/demoShell";
import { disturb } from "../../lib/spine";
import {
  attachWindAudio,
  attachWaterAudio,
  attachCallAudio,
  attachScoreAudio,
  WaterAudio,
  type AudioMount,
} from "../../lib/audio";
import { FlightBody, publishFlightState } from "../../lib/flight";
import { SoundGate, Bag, ctx2d, makeAnalyser, EAR_PAL as P } from "./earCommon";
import { mountFlightStage, divePilot } from "./flightStage";

// ---- hero: lights out ---------------------------------------------------------------

export async function mountBlindHero(el: HTMLElement): Promise<Demo> {
  const bag = new Bag();
  let gate: SoundGate | null = null;
  let parts: AudioMount[] = [];
  let veil: HTMLDivElement | null = null;
  let sight = 1;
  let nextRise = 6;
  let callsMount: (AudioMount & { call(urgency?: number): number }) | null = null;

  const stage = await mountFlightStage(el, {
    aspect: 0.52,
    terrain: true,
    autopilot: divePilot(0, 0),
    start: { x: -120, y: 45, z: 60, heading: 0.4, speed: 11 },
    hint: "A/D bank · W/S pitch · Space flap · Shift tuck · C call",
    prompt: "Click to fly — then take the sight away",
    info: (body) =>
      `V ${body.airspeed.toFixed(1)} m/s · alt ${body.pos.y.toFixed(0)} m · sight ${(sight * 100).toFixed(0)}%`,
    setup: (api) => {
      gate = new SoundGate(api.shell, { hint: "🔊 click for sound" });
      bag.add(() => gate?.dispose());

      const windM = attachWindAudio(gate.input);
      const waterM = attachWaterAudio(gate.input);
      const scoreM = attachScoreAudio(gate.input);
      callsMount = attachCallAudio({ destination: gate.input });
      parts = [windM, waterM, scoreM, callsMount];
      for (const m of parts) bag.add(() => m.dispose());

      // The veil: a black layer whose opacity is (1 − sight).
      veil = api.focus.panel("inset:0;background:#000;opacity:0;transition:opacity .6s;");

      api.shell.slider({
        label: "sight",
        min: 0,
        max: 1,
        step: 0.01,
        value: 1,
        onInput: (v) => {
          sight = v;
          if (veil) veil.style.opacity = String(1 - v);
        },
      });
      api.shell.button("call (C)", () => {
        void gate?.enable();
        callsMount?.call(0.5);
      });

      const onKey = (ev: KeyboardEvent): void => {
        if (ev.code === "KeyC") {
          callsMount?.call(0.5);
          ev.preventDefault();
        }
      };
      api.shell.canvas.addEventListener("keydown", onKey);
      bag.add(() => api.shell.canvas.removeEventListener("keydown", onKey));
    },
    onFrame: (api, dt, t) => {
      gate?.tick();
      for (const m of parts) m.update(dt);

      // The lake stays alive: fish rise within earshot every few seconds,
      // as real bus events the water synth localizes for you.
      if (t > nextRise) {
        nextRise = t + 4 + Math.random() * 6;
        const az = Math.random() * Math.PI * 2;
        const r = 12 + Math.random() * 45;
        disturb({
          kind: "rise",
          x: api.body.pos.x + Math.cos(az) * r,
          z: api.body.pos.z + Math.sin(az) * r,
          energy: 0.03 + Math.random() * 0.05,
          radius: 0.3,
        });
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

// ---- the stems: one call each ----------------------------------------------------------

export function mountStems(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.5);
  const { g, w, h } = ctx2d(shell);
  const bag = new Bag();
  const gate = new SoundGate(shell);
  bag.add(() => gate.dispose());

  const ctx = gate.input.context as AudioContext;

  // One gain per stem so each can be muted and metered independently.
  interface Stem {
    name: string;
    color: string;
    gain: GainNode;
    an: AnalyserNode;
    mount: AudioMount;
    on: boolean;
  }
  const mkStem = (name: string, color: string, make: (dest: AudioNode) => AudioMount): Stem => {
    const gain = ctx.createGain();
    gain.connect(gate.input);
    const mount = make(gain);
    const an = makeAnalyser(gain, 1024);
    bag.add(() => {
      mount.dispose();
      an.disconnect();
      gain.disconnect();
    });
    return { name, color, gain, an, mount, on: true };
  };

  const stems: Stem[] = [
    mkStem("wind", P.accent, (d) => attachWindAudio(d)),
    mkStem("water", P.good, (d) => attachWaterAudio(d)),
    mkStem("calls", P.warm, (d) => attachCallAudio({ destination: d })),
    mkStem("score", "#9a86d8", (d) => attachScoreAudio(d)),
  ];

  for (const s of stems) {
    shell.button(`${s.name}: on/off`, () => {
      s.on = !s.on;
      s.gain.gain.setTargetAtTime(s.on ? 1 : 0, ctx.currentTime, 0.05);
    });
  }
  const callStem = stems[2].mount as AudioMount & { call(urgency?: number): number };
  shell.button("call", () => {
    void gate.enable();
    callStem.call(0.45);
  });
  shell.setInfo(() => "a headless FlightBody is flying this — no renderer, just physics and ears");

  // The headless bird: real physics, no graphics. It publishes flightState,
  // which is all four attach* mounts ever read.
  const body = new FlightBody();
  body.reset(-80, 40, 30, 0.5, 10);
  const pilot = divePilot(0, 0);
  const trail: { x: number; y: number }[] = [];
  let nextSplashCheck = 0;

  const data = new Float32Array(1024);
  const rms = (an: AnalyserNode): number => {
    an.getFloatTimeDomainData(data);
    let s = 0;
    for (let i = 0; i < data.length; i++) s += data[i] * data[i];
    return Math.sqrt(s / data.length);
  };

  let last = performance.now();
  let simT = 0;
  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    simT += dt;
    gate.tick();

    pilot(body, simT, dt);
    body.step(dt, simT);
    publishFlightState(body);
    for (const s of stems) s.mount.update(dt);

    if (simT > nextSplashCheck) {
      nextSplashCheck = simT + 0.12;
      trail.push({ x: body.pos.x, y: body.pos.y });
      if (trail.length > 160) trail.shift();
    }

    // -- draw -----------------------------------------------------------
    g.fillStyle = P.bg;
    g.fillRect(0, 0, w, h);
    const pad = 34;

    // Left: side view of the headless flight.
    const vw = w * 0.46;
    const vh = h - 56;
    g.strokeStyle = P.grid;
    g.strokeRect(pad, 20, vw, vh);
    // water line
    const Y = (alt: number): number => 20 + vh - 10 - (alt / 110) * (vh - 24);
    const X = (x: number): number => pad + 8 + ((x + 260) / 520) * (vw - 16);
    g.strokeStyle = "rgba(122,162,255,0.5)";
    g.beginPath();
    g.moveTo(pad, Y(0));
    g.lineTo(pad + vw, Y(0));
    g.stroke();
    g.strokeStyle = P.muted;
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < trail.length; i++) {
      const px = X(trail[i].x);
      const py = Y(trail[i].y);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
    g.fillStyle = P.good;
    g.beginPath();
    g.arc(X(body.pos.x), Y(body.pos.y), 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = P.muted;
    g.font = "10px ui-monospace,monospace";
    g.fillText("the headless bird (side view)", pad + 6, 34);
    g.fillText(`V ${body.airspeed.toFixed(1)} m/s  alt ${body.pos.y.toFixed(0)} m`, pad + 6, 48);

    // Right: stem meters.
    const mx = pad + vw + 24;
    const mw = w - mx - pad;
    const rowH = vh / stems.length;
    for (let i = 0; i < stems.length; i++) {
      const s = stems[i];
      const y = 20 + i * rowH;
      const level = Math.min(1, rms(s.an) * 5);
      g.fillStyle = s.on ? s.color : P.grid;
      g.font = "11px ui-monospace,monospace";
      g.fillText(s.name + (s.on ? "" : " (muted)"), mx, y + rowH * 0.36);
      g.fillStyle = "rgba(42,47,66,0.8)";
      g.fillRect(mx, y + rowH * 0.46, mw, rowH * 0.3);
      g.fillStyle = s.color;
      g.fillRect(mx, y + rowH * 0.46, mw * level, rowH * 0.3);
    }
    shell.tick();
  };

  return { frame, dispose: () => bag.dispose() };
}

// ---- earcheck: find the fish -------------------------------------------------------------

export function mountEarcheck(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.52);
  const { g, w, h } = ctx2d(shell);
  const bag = new Bag();
  const gate = new SoundGate(shell, { button: false });
  bag.add(() => gate.dispose());

  // Water audio with ears fixed at the center of the dark (NOT the shared
  // flightState listener — another demo's bird may be far away).
  const water = new WaterAudio({ destination: gate.input, listener: () => ({ x: 0, z: 0 }) });
  bag.add(() => water.dispose());

  const extent = 40;
  const toPx = (x: number, z: number): [number, number] => [
    w / 2 + (x / extent) * (w / 2),
    h / 2 + (z / extent) * (h / 2),
  ];

  let target: { x: number; z: number } | null = null;
  let revealed: { x: number; z: number; gx: number; gz: number; err: number } | null = null;
  let rounds = 0;
  let totalErr = 0;
  let replayTimer = 0;

  const newRound = (): void => {
    void gate.enable();
    const az = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 28;
    target = { x: Math.cos(az) * r, z: Math.sin(az) * r };
    revealed = null;
    replayTimer = 0;
    ring();
  };
  const ring = (): void => {
    if (!target) return;
    disturb({ kind: "rise", x: target.x, z: target.z, energy: 0.05, radius: 0.3 });
  };

  shell.button("play a rise", () => (target ? ring() : newRound()));
  shell.button("new fish", newRound);
  shell.setInfo(() =>
    rounds === 0
      ? "press play, listen with headphones, click where the fish rose"
      : `rounds ${rounds} · mean error ${(totalErr / rounds).toFixed(1)} m`,
  );

  const onClick = (ev: PointerEvent): void => {
    if (!target || revealed) return;
    const rect = shell.canvas.getBoundingClientRect();
    const gx = ((ev.clientX - rect.left) / rect.width - 0.5) * 2 * extent;
    const gz = ((ev.clientY - rect.top) / rect.height - 0.5) * 2 * extent;
    const err = Math.hypot(gx - target.x, gz - target.z);
    revealed = { x: target.x, z: target.z, gx, gz, err };
    rounds += 1;
    totalErr += err;
    target = null;
  };
  shell.canvas.addEventListener("pointerdown", onClick);
  shell.canvas.style.cursor = "crosshair";
  bag.add(() => shell.canvas.removeEventListener("pointerdown", onClick));

  let last = performance.now();
  let simT = 0;
  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    simT += dt;
    gate.tick();
    water.update(simT, dt);

    // Re-ring every few seconds while the fish is hidden.
    if (target) {
      replayTimer += dt;
      if (replayTimer > 3.5) {
        replayTimer = 0;
        ring();
      }
    }

    g.fillStyle = "#05080d";
    g.fillRect(0, 0, w, h);
    // The ear.
    g.fillStyle = P.warm;
    g.beginPath();
    g.arc(w / 2, h / 2, 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = P.muted;
    g.font = "10px ui-monospace,monospace";
    g.fillText("you (the ear)", w / 2 + 8, h / 2 + 4);
    // Range rings, barely visible — this is a dark demo on purpose.
    g.strokeStyle = "rgba(42,47,66,0.5)";
    for (const r of [10, 20, 30]) {
      g.beginPath();
      g.ellipse(w / 2, h / 2, (r / extent) * (w / 2), (r / extent) * (h / 2), 0, 0, Math.PI * 2);
      g.stroke();
      g.fillText(`${r} m`, w / 2 + (r / extent) * (w / 2) - 18, h / 2 - 4);
    }

    if (target) {
      g.fillStyle = P.text;
      g.fillText("…listening… click where you heard it", 14, h - 12);
    }
    if (revealed) {
      const [tx, ty] = toPx(revealed.x, revealed.z);
      const [gx2, gy2] = toPx(revealed.gx, revealed.gz);
      g.strokeStyle = P.muted;
      g.setLineDash([3, 4]);
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(gx2, gy2);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = P.good;
      g.beginPath();
      g.arc(tx, ty, 5, 0, Math.PI * 2);
      g.fill();
      g.fillText("the fish", tx + 8, ty);
      g.fillStyle = P.red;
      g.beginPath();
      g.arc(gx2, gy2, 4, 0, Math.PI * 2);
      g.fill();
      g.fillText("your guess", gx2 + 8, gy2);
      g.fillStyle = P.text;
      g.fillText(`${revealed.err.toFixed(1)} m off — press "new fish"`, 14, h - 12);
    }
    void simT;
    shell.tick();
  };

  return { frame, dispose: () => bag.dispose() };
}
