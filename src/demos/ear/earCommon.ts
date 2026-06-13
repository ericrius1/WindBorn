// Shared plumbing for The Ear's demos: the sound gate (click-to-listen +
// auto-mute when a demo leaves the screen), analyser drawing helpers, a
// minimal keyboard-focus overlay for flyable demos, and a disposal bag.

import type { Shell } from "../../lib/demoShell";
import { audioContext, audioRunning, masterBus, onAudioStateChange, resumeAudio } from "../../lib/audio";

// Everything that needs undoing, undone in reverse order.
export class Bag {
  private fns: (() => void)[] = [];
  add(fn: () => void): void {
    this.fns.push(fn);
  }
  dispose(): void {
    for (let i = this.fns.length - 1; i >= 0; i--) this.fns[i]();
    this.fns.length = 0;
  }
}

/**
 * The sound gate — every audio demo's outermost gain node, and the answer to
 * three browser realities at once:
 *
 *  1. autoplay policy: audio can only start from a user gesture, so the gate
 *     starts closed and a click on the canvas (or the sound button) resumes
 *     the shared context and opens it;
 *  2. lazy mounting: demos build while offscreen, so their graphs exist and
 *     run before anyone should hear them;
 *  3. teardown: when a demo scrolls away, frame() stops being called — a
 *     watchdog notices the silence of tick() and closes the gate within
 *     ~0.4 s, so sound never plays from a demo you can't see.
 *
 * Connect synth outputs to `gate.input`; call `gate.tick()` once per frame.
 */
export class SoundGate {
  readonly input: GainNode;
  enabled = false;

  private level: number;
  private lastTick = performance.now();
  private readonly watchdog: number;
  private readonly pill: HTMLSpanElement;
  private readonly unsubState: () => void;
  private readonly canvas: HTMLCanvasElement;
  private readonly onClick = (): void => {
    if (!this.enabled) void this.enable();
  };
  private disposed = false;

  constructor(shell: Shell, opts: { hint?: string; level?: number; button?: boolean } = {}) {
    const ctx = audioContext();
    this.level = opts.level ?? 1;
    this.input = ctx.createGain();
    this.input.gain.value = 0;
    this.input.connect(masterBus());
    this.canvas = shell.canvas;

    // The hint pill, floated over the canvas.
    const host = shell.canvas.parentElement ?? shell.canvas;
    if (host instanceof HTMLElement && getComputedStyle(host).position === "static")
      host.style.position = "relative";
    this.pill = document.createElement("span");
    this.pill.className = "sound-hint";
    this.pill.textContent = opts.hint ?? "🔊 click for sound";
    host.appendChild(this.pill);

    shell.canvas.addEventListener("pointerdown", this.onClick);
    if (opts.button !== false) {
      shell.button("sound on / off", () => {
        if (this.enabled) this.disable();
        else void this.enable();
      });
    }

    // If the context resumes/suspends elsewhere, keep the UI honest.
    this.unsubState = onAudioStateChange(() => this.sync());

    this.watchdog = window.setInterval(() => {
      if (this.disposed) return;
      if (performance.now() - this.lastTick > 600) {
        this.input.gain.setTargetAtTime(0, audioContext().currentTime, 0.06);
      }
    }, 200);
  }

  /** Mark the demo alive and (if enabled) keep the gate open. */
  tick(): void {
    this.lastTick = performance.now();
    if (this.enabled && audioRunning()) {
      this.input.gain.setTargetAtTime(this.level, audioContext().currentTime, 0.08);
    }
  }

  async enable(): Promise<void> {
    this.enabled = true;
    await resumeAudio();
    this.sync();
  }

  disable(): void {
    this.enabled = false;
    this.input.gain.setTargetAtTime(0, audioContext().currentTime, 0.05);
    this.sync();
  }

  setLevel(v: number): void {
    this.level = Math.max(0, v);
  }

  get on(): boolean {
    return this.enabled && audioRunning();
  }

  private sync(): void {
    this.pill.classList.toggle("is-hidden", this.on);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.clearInterval(this.watchdog);
    this.unsubState();
    this.canvas.removeEventListener("pointerdown", this.onClick);
    this.pill.remove();
    this.input.gain.value = 0;
    this.input.disconnect();
  }
}

// ---- analyser drawing -------------------------------------------------------

export function makeAnalyser(tap: AudioNode, fftSize = 2048): AnalyserNode {
  const an = audioContext().createAnalyser();
  an.fftSize = fftSize;
  an.smoothingTimeConstant = 0.78;
  tap.connect(an);
  return an;
}

const F_MIN = 40;
const F_MAX = 16000;

/** px (0..w) → frequency on a log axis. */
export function pxToFreq(px: number, w: number): number {
  return F_MIN * Math.pow(F_MAX / F_MIN, px / w);
}

/** frequency → px on the same axis. */
export function freqToPx(f: number, w: number): number {
  return (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * w;
}

let spectrumBytes: Uint8Array<ArrayBuffer> | null = null;

/** Filled log-frequency spectrum, drawn into a canvas-2D rect. */
export function drawSpectrum(
  g: CanvasRenderingContext2D,
  an: AnalyserNode,
  x: number,
  y: number,
  w: number,
  h: number,
  color = "#7aa2ff",
): void {
  const n = an.frequencyBinCount;
  if (!spectrumBytes || spectrumBytes.length < n) spectrumBytes = new Uint8Array(n);
  const view = spectrumBytes.subarray(0, n) as Uint8Array<ArrayBuffer>;
  an.getByteFrequencyData(view);
  const nyquist = audioContext().sampleRate / 2;

  g.save();
  g.beginPath();
  g.moveTo(x, y + h);
  for (let px = 0; px <= w; px += 2) {
    const f = pxToFreq(px, w);
    const bin = Math.min(n - 1, Math.round((f / nyquist) * n));
    const v = view[bin] / 255;
    g.lineTo(x + px, y + h - v * h);
  }
  g.lineTo(x + w, y + h);
  g.closePath();
  g.globalAlpha = 0.22;
  g.fillStyle = color;
  g.fill();
  g.globalAlpha = 1;
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.stroke();
  g.restore();
}

/** Light log-axis gridlines + labels under a spectrum. */
export function drawFreqAxis(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  g.save();
  g.strokeStyle = "#2a2f42";
  g.fillStyle = "#8a91a5";
  g.font = "10px ui-monospace, Menlo, monospace";
  g.textAlign = "center";
  for (const f of [100, 1000, 10000]) {
    const px = x + freqToPx(f, w);
    g.beginPath();
    g.moveTo(px, y);
    g.lineTo(px, y + h);
    g.stroke();
    g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, px, y + h + 12);
  }
  g.restore();
}

let waveBytes: Uint8Array<ArrayBuffer> | null = null;

/** Time-domain oscilloscope trace. */
export function drawWaveform(
  g: CanvasRenderingContext2D,
  an: AnalyserNode,
  x: number,
  y: number,
  w: number,
  h: number,
  color = "#7dd6a0",
): void {
  const n = an.fftSize;
  if (!waveBytes || waveBytes.length < n) waveBytes = new Uint8Array(n);
  const view = waveBytes.subarray(0, n) as Uint8Array<ArrayBuffer>;
  an.getByteTimeDomainData(view);
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 1.4;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const px = x + (i / (n - 1)) * w;
    const py = y + h / 2 + ((view[i] - 128) / 128) * (h / 2) * 0.95;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.stroke();
  g.restore();
}

// ---- keyboard focus overlay ----------------------------------------------------
// Click-to-take-the-controls UX for the flyable demos (and it doubles as the
// audio gesture — one click arms both the keys and the ears).

export class FlyFocus {
  readonly wrapper: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private _focused = false;
  private readonly onFocus = (): void => this.sync(true);
  private readonly onBlur = (): void => this.sync(false);
  private readonly onPointer = (): void => this.canvas.focus();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    hint: string,
    promptText = "Click to take the controls",
  ) {
    this.wrapper = document.createElement("div");
    this.wrapper.style.position = "relative";
    canvas.parentElement?.insertBefore(this.wrapper, canvas);
    this.wrapper.appendChild(canvas);
    canvas.tabIndex = 0;
    canvas.style.outline = "none";
    canvas.style.cursor = "pointer";

    this.prompt = document.createElement("div");
    this.prompt.style.cssText =
      "position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;";
    const pill = document.createElement("span");
    pill.textContent = promptText;
    pill.style.cssText =
      "padding:.5rem 1.1rem;border-radius:999px;border:1px solid rgba(122,162,255,.5);" +
      "background:rgba(10,11,16,.72);color:#d7dbe6;font:600 .82rem ui-sans-serif,system-ui,sans-serif;" +
      "letter-spacing:.06em;";
    this.prompt.appendChild(pill);
    this.wrapper.appendChild(this.prompt);

    this.bar = document.createElement("div");
    this.bar.textContent = hint;
    if (!hint) this.bar.style.display = "none";
    this.bar.style.cssText =
      "position:absolute;left:50%;bottom:.6rem;transform:translateX(-50%);max-width:94%;" +
      "padding:.28rem .8rem;border-radius:999px;background:rgba(10,11,16,.66);color:#aab4d4;" +
      "font:600 .68rem ui-monospace,Menlo,monospace;white-space:nowrap;overflow:hidden;" +
      "text-overflow:ellipsis;pointer-events:none;transition:opacity .3s;";
    this.wrapper.appendChild(this.bar);

    canvas.addEventListener("focus", this.onFocus);
    canvas.addEventListener("blur", this.onBlur);
    canvas.addEventListener("pointerdown", this.onPointer);
    this.sync(false);
  }

  private sync(focused: boolean): void {
    this._focused = focused;
    this.prompt.style.opacity = focused ? "0" : "1";
    this.bar.style.opacity = focused ? "0.85" : "0.45";
  }

  get focused(): boolean {
    return this._focused;
  }

  /** A positioned HUD element living over the canvas. */
  panel(css: string): HTMLDivElement {
    const div = document.createElement("div");
    div.style.cssText = `position:absolute;pointer-events:none;${css}`;
    this.wrapper.appendChild(div);
    return div;
  }

  dispose(): void {
    this.canvas.removeEventListener("focus", this.onFocus);
    this.canvas.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("pointerdown", this.onPointer);
  }
}

/** A 2D context in CSS-pixel units (the Shell canvas is DPR-scaled). */
export function ctx2d(shell: Shell): { g: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const g = shell.canvas.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w: shell.canvas.width / dpr, h: shell.canvas.height / dpr };
}

// Palette shared by the 2D figures in this series.
export const EAR_PAL = {
  bg: "#06070b",
  grid: "#2a2f42",
  text: "#d7dbe6",
  muted: "#8a91a5",
  accent: "#7aa2ff",
  warm: "#ffb86b",
  good: "#7dd6a0",
  red: "#ff8585",
};
