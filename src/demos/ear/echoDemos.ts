// Demos for echo.html — the osprey's call and the cirque's answer.
//
//   hero    — a top-down map of the basin: place the bird, call, watch the
//             pulses ride the rays out to rock and back while you hear them
//   syrinx  — the two-voice instrument: detune, contour, formant
//   delay   — one wall, one tap: d in, 2d/343 out
//   scrolly — the echo-geometry diagram (in echoScrolly.ts)

import { Shell, type Demo } from "../../lib/demoShell";
import {
  OspreyCall,
  EchoNetwork,
  computeEchoTaps,
  noiseSource,
  type EchoTap,
} from "../../lib/audio";
import {
  SoundGate,
  Bag,
  ctx2d,
  makeAnalyser,
  drawWaveform,
  EAR_PAL as P,
} from "./earCommon";
import { mountScrolly, phase, label, PAL } from "../../lib/scrolly";

const SPEED = 343;

// ---- hero: the basin answers -------------------------------------------------------

export async function mountEchoHero(el: HTMLElement): Promise<Demo> {
  const shell = new Shell(el, el.closest("header.hero") ? 0.46 : 0.58);
  const { g, w, h } = ctx2d(shell);
  const bag = new Bag();
  const gate = new SoundGate(shell, { hint: "🔊 click for sound" });
  bag.add(() => gate.dispose());

  const { terrainGrid } = await import("../../lib/terrain");
  const grid = terrainGrid();
  const heightAt = (x: number, z: number): number => grid.heightAt(x, z);

  const voice = new OspreyCall(gate.input);
  bag.add(() => voice.dispose());
  const echo = new EchoNetwork(gate.input);
  bag.add(() => echo.dispose());
  voice.output.connect(echo.input);

  // World window.
  const extent = 1250;
  const toPx = (x: number, z: number): [number, number] => [
    w / 2 + (x / extent) * (Math.min(w, h * 1.6) / 2),
    h / 2 + (z / extent) * (h / 2),
  ];

  // Pre-render the basin map once.
  const map = document.createElement("canvas");
  map.width = Math.round(w);
  map.height = Math.round(h);
  const mg = map.getContext("2d")!;
  const img = mg.createImageData(map.width, map.height);
  const sx = (Math.min(w, h * 1.6) / 2) / extent;
  const sz = (h / 2) / extent;
  for (let py = 0; py < map.height; py++) {
    for (let px = 0; px < map.width; px++) {
      const x = (px - w / 2) / sx;
      const z = (py - h / 2) / sz;
      const i = (py * map.width + px) * 4;
      const hgt = Math.abs(x) > 1600 || Math.abs(z) > 1600 ? 200 : heightAt(x, z);
      let r: number, gg: number, b: number;
      if (hgt <= 0) {
        const d = Math.min(1, -hgt / 30);
        r = 12 + 8 * (1 - d);
        gg = 28 + 14 * (1 - d);
        b = 52 + 26 * (1 - d);
      } else if (hgt < 120) {
        const t = hgt / 120;
        r = 40 + 50 * t;
        gg = 56 + 40 * t;
        b = 36 + 40 * t;
      } else {
        const t = Math.min(1, (hgt - 120) / 320);
        r = 90 + 110 * t;
        gg = 96 + 110 * t;
        b = 76 + 130 * t;
      }
      img.data[i] = r;
      img.data[i + 1] = gg;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  mg.putImageData(img, 0, 0);

  // State.
  let bird = { x: -60, z: 80 };
  let altitude = 30;
  let taps: EchoTap[] = [];
  let callAt = -1;
  let callDur = 0;
  let simT = 0;

  const refresh = (): void => {
    taps = computeEchoTaps(bird.x, altitude, bird.z, { heightAt, directions: 10 });
    echo.setTaps(taps);
  };
  refresh();

  const onClick = (ev: PointerEvent): void => {
    const rect = shell.canvas.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * w;
    const py = ((ev.clientY - rect.top) / rect.height) * h;
    bird = { x: (px - w / 2) / sx, z: (py - h / 2) / sz };
    refresh();
  };
  shell.canvas.addEventListener("pointerdown", onClick);
  shell.canvas.style.cursor = "crosshair";
  bag.add(() => shell.canvas.removeEventListener("pointerdown", onClick));

  shell.button("call", () => {
    void gate.enable();
    callDur = voice.call({ urgency: 0.45 });
    callAt = simT;
  });
  shell.slider({
    label: "flight altitude (m)",
    min: 4,
    max: 160,
    step: 2,
    value: 30,
    onInput: (v) => {
      altitude = v;
      refresh();
    },
  });
  shell.setInfo(() => {
    if (taps.length === 0) return "no walls above flight height — silence back";
    const first = taps[0];
    const last = taps[taps.length - 1];
    return `${taps.length} echoes · first ${first.delay.toFixed(2)} s (${Math.round(first.distance)} m) · last ${last.delay.toFixed(2)} s`;
  });

  let lastT = performance.now();
  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    simT += dt;
    gate.tick();

    g.clearRect(0, 0, w, h);
    g.drawImage(map, 0, 0, w, h);

    const [bx, by] = toPx(bird.x, bird.z);

    // Rays to the answering walls.
    for (const ray of taps) {
      const [hx, hy] = toPx(
        bird.x + Math.cos(ray.azimuth) * ray.distance,
        bird.z + Math.sin(ray.azimuth) * ray.distance,
      );
      g.strokeStyle = "rgba(122,162,255,0.35)";
      g.setLineDash([4, 5]);
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(hx, hy);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = P.warm;
      g.beginPath();
      g.arc(hx, hy, 3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = P.muted;
      g.font = "10px ui-monospace,monospace";
      g.fillText(`${ray.delay.toFixed(2)}s`, hx + 6, hy - 4);

      // Travelling pulses after a call: out at 343 m/s, then home again.
      if (callAt >= 0) {
        const since = simT - callAt;
        if (since < ray.delay + callDur) {
          const travelled = since * SPEED;
          let frac: number;
          if (travelled < ray.distance) frac = travelled / ray.distance;
          else frac = Math.max(0, 2 - travelled / ray.distance);
          if (frac > 0 && frac <= 1) {
            const px = bx + (hx - bx) * frac;
            const py = by + (hy - by) * frac;
            const returning = travelled >= ray.distance;
            g.fillStyle = returning ? P.warm : P.text;
            g.beginPath();
            g.arc(px, py, returning ? 2.4 : 3.2, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
    }

    // The bird.
    g.fillStyle = P.good;
    g.beginPath();
    g.arc(bx, by, 5, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(125,214,160,0.4)";
    g.beginPath();
    g.arc(bx, by, 9, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = P.text;
    g.font = "11px ui-monospace,monospace";
    g.fillText("the bird — click the map to move it", bx + 12, by + 4);

    shell.tick();
  };

  return { frame, dispose: () => bag.dispose() };
}

// ---- the two-voice instrument --------------------------------------------------------

export function mountSyrinx(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.46);
  const { g, w, h } = ctx2d(shell);
  const bag = new Bag();
  const gate = new SoundGate(shell, { button: false });
  bag.add(() => gate.dispose());

  const voice = new OspreyCall(gate.input);
  bag.add(() => voice.dispose());
  const an = makeAnalyser(gate.input, 4096);
  bag.add(() => an.disconnect());

  let detune = 30;
  let urgency = 0.35;
  let voices: 1 | 2 = 2;

  shell.button("call · one voice", () => {
    void gate.enable();
    voices = 1;
    voice.call({ urgency, detune, voices: 1, chirps: 3 });
  });
  shell.button("call · two voices", () => {
    void gate.enable();
    voices = 2;
    voice.call({ urgency, detune, voices: 2, chirps: 3 });
  });
  shell.slider({
    label: "voice-2 detune (cents)",
    min: 0,
    max: 90,
    step: 1,
    value: 30,
    onInput: (v) => (detune = v),
  });
  shell.slider({
    label: "urgency",
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.35,
    onInput: (v) => (urgency = v),
  });
  shell.setInfo(() => {
    const beat = (1900 * (Math.pow(2, detune / 1200) - 1)).toFixed(0);
    return `voices ${voices} · detune ${detune}¢ ≈ ${beat} Hz of beating at the call pitch`;
  });

  const frame = (): void => {
    gate.tick();
    g.fillStyle = P.bg;
    g.fillRect(0, 0, w, h);
    const pad = 34;
    const pw = w - pad * 2;

    // The chirp contour (the exact shape call() schedules).
    const cy = 22;
    const ch = (h - 86) * 0.45;
    g.strokeStyle = P.grid;
    g.strokeRect(pad, cy, pw, ch);
    const f0 = 1650 + 350 * urgency;
    const dur = 0.16 + 0.06 * (1 - urgency);
    const fOf = (t: number): number =>
      t < dur * 0.35 ? f0 * Math.pow(1.32, t / (dur * 0.35)) : f0 * 1.32 * Math.pow(0.82 / 1.32, (t - dur * 0.35) / (dur * 0.65));
    const Y = (f: number): number => cy + ch - ((f - 1200) / 1600) * ch;
    for (const [mult, col] of [
      [1, P.accent],
      [Math.pow(2, detune / 1200), P.warm],
    ] as const) {
      if (mult !== 1 && voices === 1) continue;
      g.strokeStyle = col;
      g.lineWidth = 1.6;
      g.beginPath();
      for (let t = 0; t <= dur; t += dur / 80) {
        const x = pad + (t / dur) * pw * 0.4;
        const y = Y(fOf(t) * mult);
        if (t === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.font = "10px ui-monospace,monospace";
    g.fillStyle = P.accent;
    g.fillText("voice 1", pad + 8, cy + 14);
    if (voices === 2) {
      g.fillStyle = P.warm;
      g.fillText(`voice 2 (+${detune}¢, lags 12 ms)`, pad + 60, cy + 14);
    }
    g.fillStyle = P.muted;
    g.fillText("chirp pitch contour — rise to ×1.32, fall to ×0.82", pad + pw * 0.45, cy + ch / 2);

    // Live waveform: the beating is visible as amplitude ripple.
    const wy = cy + ch + 24;
    const wh = h - wy - 22;
    g.strokeStyle = P.grid;
    g.strokeRect(pad, wy, pw, wh);
    drawWaveform(g, an, pad, wy, pw, wh, P.good);
    g.fillStyle = P.muted;
    g.fillText("waveform — two voices ripple (beat) against each other", pad + 6, wy + 14);
    shell.tick();
  };

  return { frame, dispose: () => bag.dispose() };
}

// ---- one wall, one tap ------------------------------------------------------------------

export function mountDelayLab(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.44);
  const { g, w, h } = ctx2d(shell);
  const bag = new Bag();
  const gate = new SoundGate(shell, { button: false });
  bag.add(() => gate.dispose());

  const ctx = gate.input.context as AudioContext;
  const delay = ctx.createDelay(8);
  const tapGain = ctx.createGain();
  const tapLp = ctx.createBiquadFilter();
  tapLp.type = "lowpass";
  const dry = ctx.createGain();
  dry.connect(gate.input);
  dry.connect(delay);
  delay.connect(tapLp).connect(tapGain).connect(gate.input);
  bag.add(() => {
    dry.disconnect();
    delay.disconnect();
    tapLp.disconnect();
    tapGain.disconnect();
  });

  let dist = 300;
  let clapAt = -1;
  let simT = 0;

  const apply = (): void => {
    const t = ctx.currentTime;
    delay.delayTime.setTargetAtTime((2 * dist) / SPEED, t, 0.05);
    tapGain.gain.setTargetAtTime(Math.min(0.5, 3 * 0.75 * Math.sqrt(1 / (2 * dist))), t, 0.05);
    tapLp.frequency.setTargetAtTime(16000 / (1 + (2 * dist) / 220), t, 0.05);
  };
  apply();

  shell.button("clap", () => {
    void gate.enable();
    const t0 = ctx.currentTime;
    const burst = noiseSource("white");
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.7, t0 + 0.003);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
    burst.connect(env).connect(dry);
    burst.stop(t0 + 0.1);
    burst.addEventListener("ended", () => {
      burst.disconnect();
      env.disconnect();
    });
    clapAt = simT;
  });
  shell.slider({
    label: "distance to the wall (m)",
    min: 40,
    max: 1000,
    step: 10,
    value: 300,
    onInput: (v) => {
      dist = v;
      apply();
    },
  });
  shell.setInfo(
    () =>
      `delay = 2·${dist} / 343 = ${((2 * dist) / SPEED).toFixed(2)} s · gain ${Math.min(
        0.5,
        3 * 0.75 * Math.sqrt(1 / (2 * dist)),
      ).toFixed(2)} · cutoff ${Math.round(16000 / (1 + (2 * dist) / 220))} Hz`,
  );

  let lastT = performance.now();
  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    simT += dt;
    gate.tick();

    g.fillStyle = P.bg;
    g.fillRect(0, 0, w, h);
    const pad = 34;
    const pw = w - pad * 2;

    // Side view: bird … wall.
    const sy = h * 0.32;
    const wallX = pad + pw * 0.86;
    const birdX = pad + 26;
    g.strokeStyle = P.grid;
    g.beginPath();
    g.moveTo(pad, sy + 36);
    g.lineTo(wallX, sy + 36);
    g.stroke();
    // wall
    g.fillStyle = "#5a5f72";
    g.beginPath();
    g.moveTo(wallX, sy + 36);
    g.lineTo(wallX + 26, sy - 64);
    g.lineTo(wallX + 30, sy + 36);
    g.closePath();
    g.fill();
    // bird
    g.fillStyle = P.good;
    g.beginPath();
    g.arc(birdX, sy, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = P.muted;
    g.font = "10px ui-monospace,monospace";
    g.fillText(`d = ${dist} m`, (birdX + wallX) / 2 - 24, sy + 52);

    // The pulse.
    if (clapAt >= 0) {
      const travelled = (simT - clapAt) * SPEED;
      const span = wallX - birdX;
      if (travelled < 2 * dist) {
        const frac = travelled < dist ? travelled / dist : 2 - travelled / dist;
        const x = birdX + span * frac;
        g.fillStyle = travelled < dist ? P.text : P.warm;
        g.beginPath();
        g.arc(x, sy, 3.4, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Timeline: dry hit and echo arrival.
    const ty = h * 0.68;
    const window = 7; // seconds shown
    g.strokeStyle = P.grid;
    g.beginPath();
    g.moveTo(pad, ty);
    g.lineTo(pad + pw, ty);
    g.stroke();
    const X = (t: number): number => pad + (t / window) * pw;
    g.fillStyle = P.text;
    g.fillRect(X(0) - 1.5, ty - 26, 3, 26);
    g.fillText("clap", X(0) - 10, ty + 16);
    const echoT = (2 * dist) / SPEED;
    const eg = Math.min(0.5, 3 * 0.75 * Math.sqrt(1 / (2 * dist)));
    g.fillStyle = P.warm;
    g.fillRect(X(echoT) - 1.5, ty - 26 * (eg / 0.5), 3, 26 * (eg / 0.5));
    g.fillText(`echo · ${echoT.toFixed(2)} s`, X(echoT) - 24, ty + 16);
    g.fillStyle = P.muted;
    g.fillText(`${window} s`, pad + pw - 18, ty + 16);
    shell.tick();
  };

  return { frame, dispose: () => bag.dispose() };
}

// ---- scrolly: the geometry of an echo ----------------------------------------------

export function mountEchoScrolly(el: HTMLElement): void {
  mountScrolly(el, {
    screens: 4,
    aspect: 0.52,
    steps: [
      { at: 0, text: "The basin in cross-section: the lake at y = 0, the cirque walls rising on both sides. The bird calls from low over the water." },
      { at: 0.16, text: "Sound leaves in every direction at 343 m/s — a sphere of pressure expanding from the beak." },
      { at: 0.42, text: "The wavefront that heads for the far wall covers the distance d, reflects off the rock, and starts back." },
      { at: 0.64, text: "It arrives home having travelled 2d, so the echo lands 2d/343 seconds after the call — at d = 500 m, about 2.9 seconds." },
      { at: 0.85, text: "Every wall at its own distance contributes its own tap: nearer rock answers early and bright, the far headwall late and dull. The valley is a delay bank wired by geometry." },
    ],
    draw(ctx, w, h, t) {
      const lakeY = h * 0.72;
      // Terrain silhouette: two walls and a lake between.
      const ground = (x: number): number => {
        const u = x / w;
        const left = Math.max(0, (0.2 - u) / 0.2);
        const right = Math.max(0, (u - 0.78) / 0.22);
        return lakeY - (left * left * h * 0.52 + right * right * h * 0.58);
      };
      ctx.fillStyle = "#1a1f2e";
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 4) ctx.lineTo(x, ground(x));
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
      // lake
      ctx.fillStyle = "rgba(18,48,78,0.9)";
      ctx.fillRect(w * 0.2, lakeY, w * 0.58, h - lakeY);
      label(ctx, "y = 0", w * 0.21, lakeY + 12, { color: PAL.muted, size: 10, mono: true });

      // bird
      const bx = w * 0.34;
      const by = lakeY - h * 0.13;
      ctx.fillStyle = PAL.good;
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, Math.PI * 2);
      ctx.fill();

      // wall hit point: where the right wall reaches bird height
      let wx = w * 0.9;
      for (let x = w * 0.6; x < w; x += 2) {
        if (ground(x) <= by) {
          wx = x;
          break;
        }
      }
      const d = wx - bx;

      // expanding call rings
      const ringT = phase(t, 0.16, 0.42);
      if (ringT > 0 && ringT < 1) {
        for (const k of [1, 0.66, 0.33]) {
          const r = ringT * d * 0.5 * k;
          if (r < 4) continue;
          ctx.strokeStyle = `rgba(215,219,230,${(0.5 * (1 - ringT * k)).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(bx, by, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // distance annotation
      const annA = phase(t, 0.42, 0.5);
      if (annA > 0.01) {
        ctx.strokeStyle = `rgba(138,145,165,${annA.toFixed(2)})`;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(bx, by - 18);
        ctx.lineTo(wx, by - 18);
        ctx.stroke();
        ctx.setLineDash([]);
        label(ctx, "d", (bx + wx) / 2, by - 26, { color: PAL.text, size: 12, mono: true, alpha: annA });
      }

      // the travelling pulse: out (0.42→0.64), back (0.64→0.85)
      const outT = phase(t, 0.42, 0.64);
      const backT = phase(t, 0.64, 0.85);
      if (outT > 0 && backT <= 0) {
        const x = bx + d * outT;
        ctx.fillStyle = PAL.text;
        ctx.beginPath();
        ctx.arc(x, by, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (backT > 0 && backT < 1) {
        const x = wx - d * backT;
        ctx.fillStyle = PAL.warm;
        ctx.beginPath();
        ctx.arc(x, by, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (backT >= 1) {
        ctx.strokeStyle = PAL.warm;
        ctx.beginPath();
        ctx.arc(bx, by, 9 + 3 * Math.sin(t * 40), 0, Math.PI * 2);
        ctx.stroke();
      }

      // tap timeline at the bottom (final beat)
      const tlA = phase(t, 0.85, 0.95);
      if (tlA > 0.01) {
        const y = h * 0.9;
        ctx.globalAlpha = tlA;
        ctx.strokeStyle = PAL.grid;
        ctx.beginPath();
        ctx.moveTo(w * 0.1, y);
        ctx.lineTo(w * 0.9, y);
        ctx.stroke();
        const taps: [number, number, string][] = [
          [0, 1, "call"],
          [0.33, 0.5, "near wall"],
          [0.62, 0.34, "far wall"],
          [0.86, 0.22, "headwall"],
        ];
        for (const [u, gNorm, name] of taps) {
          const x = w * 0.1 + u * w * 0.8;
          ctx.fillStyle = u === 0 ? PAL.text : PAL.warm;
          ctx.fillRect(x - 1.5, y - 26 * gNorm, 3, 26 * gNorm);
          label(ctx, name, x - 12, y + 12, { color: PAL.muted, size: 9, mono: true, alpha: tlA });
        }
        ctx.globalAlpha = 1;
      }

      label(ctx, "343 m/s", w * 0.62, by - 40, {
        color: PAL.muted,
        size: 10,
        mono: true,
        alpha: phase(t, 0.42, 0.5),
      });
    },
  });
}
