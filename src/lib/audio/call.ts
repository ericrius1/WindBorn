// The osprey's voice, and the valley answering it.
//
// SYRINX — a bird's voice box sits where the trachea forks, and it has TWO
// independent sound sources, one per bronchus, each with its own vibrating
// membranes. Many birds voice both at once, slightly mistuned. So the model
// is two parallel voices: sine oscillator → soft-clip waveshaper (the
// membrane doesn't vibrate sinusoidally at volume — clipping adds the
// harmonics that read as "animal" instead of "test tone") → envelope, both
// voices summed through one formant bandpass (the trachea and open beak
// resonate around 2–3 kHz). The voices sit ~30 cents apart with separate
// pitch contours, so they beat against each other — that shimmer is the
// two-voice signature.
//
// The call itself: ospreys whistle short, clear, slightly falling chirps in
// series — cheep… cheep… cheep — each ~0.2 s, fundamental gliding through
// roughly 1.6–2.3 kHz, repeated at 3–4 per second, rising in urgency.
//
// ECHO — the cirque wall is a delay line built by geometry. A call that
// travels distance d to rock and back arrives 2d/343 seconds later (343 m/s
// is the speed of sound in valley air), quieter by spreading loss and duller
// by air absorption. computeEchoTaps() marches rays outward over the terrain
// height function until each one meets rock above flight height, and turns
// every hit into a {delay, gain, cutoff, pan} tap for the EchoNetwork.

import { audioContext, masterBus } from "./context";

const SPEED_OF_SOUND = 343; // m/s

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ---- the voice -------------------------------------------------------------------

let shaperCurve: Float32Array<ArrayBuffer> | null = null;

/** Soft-clip transfer curve (tanh) shared by every voice. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  if (!shaperCurve) {
    shaperCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      shaperCurve[i] = Math.tanh(2.2 * x);
    }
  }
  return shaperCurve;
}

export interface CallOptions {
  /** 0..1 — raises pitch, rate, and chirp count. */
  urgency?: number;
  /** Override the chirp count. */
  chirps?: number;
  /** Voice-two detune in cents (default ~30). */
  detune?: number;
  /** Overall level 0..1. */
  level?: number;
  /** Sound 1 or both syrinx voices (default 2). */
  voices?: 1 | 2;
}

export class OspreyCall {
  readonly output: GainNode;
  private readonly formant: BiquadFilterNode;
  private disposed = false;

  constructor(destination: AudioNode = masterBus()) {
    const ctx = audioContext();
    this.output = ctx.createGain();
    this.output.gain.value = 1;
    this.formant = ctx.createBiquadFilter();
    this.formant.type = "bandpass";
    this.formant.frequency.value = 2400; // the open-beak resonance
    this.formant.Q.value = 0.9;
    this.formant.connect(this.output);
    this.output.connect(destination);
  }

  /**
   * Voice one call series. Returns its duration in seconds (so hosts can
   * time echoes or animations). Safe to call while a previous call rings.
   */
  call(opts: CallOptions = {}): number {
    if (this.disposed) return 0;
    const ctx = audioContext();
    const urgency = clamp(opts.urgency ?? 0.35, 0, 1);
    const nChirps = opts.chirps ?? Math.round(4 + 5 * urgency);
    const interval = 0.34 - 0.12 * urgency; // chirps/s rises with urgency
    const detune = opts.detune ?? 30;
    const level = clamp(opts.level ?? 0.5, 0, 1);
    const voices = opts.voices ?? 2;
    let t = ctx.currentTime + 0.02;

    for (let i = 0; i < nChirps; i++) {
      // Pitch creeps up through the series — the bird leaning in.
      const f0 = (1650 + 350 * urgency) * (1 + 0.025 * i) * (0.98 + Math.random() * 0.04);
      this.chirp(t, f0, 0.16 + 0.06 * (1 - urgency), level, detune, voices);
      t += interval * (0.92 + Math.random() * 0.16);
    }
    return t - ctx.currentTime;
  }

  /** One chirp: both syrinx voices, arcing up then falling. */
  private chirp(
    t0: number,
    f0: number,
    dur: number,
    level: number,
    detuneCents: number,
    voices: 1 | 2 = 2,
  ): void {
    const ctx = audioContext();
    // The classic contour: rise fast to a peak, fall past the start.
    const peak = f0 * 1.32;
    const end = f0 * 0.82;

    for (const voice of voices === 1 ? [0] : [0, 1]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      // Voice two: mistuned, and its contour lags a touch — independent
      // sources, not a chorus effect.
      osc.detune.value = voice === 0 ? 0 : detuneCents;
      const lag = voice === 0 ? 0 : 0.012;
      osc.frequency.setValueAtTime(f0, t0 + lag);
      osc.frequency.exponentialRampToValueAtTime(peak, t0 + lag + dur * 0.35);
      osc.frequency.exponentialRampToValueAtTime(end, t0 + lag + dur);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0 + lag);
      env.gain.linearRampToValueAtTime(level * (voice === 0 ? 0.5 : 0.35), t0 + lag + 0.018);
      env.gain.setValueAtTime(level * (voice === 0 ? 0.45 : 0.3), t0 + lag + dur * 0.7);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + lag + dur);

      const shaper = ctx.createWaveShaper();
      shaper.curve = softClipCurve();

      osc.connect(env).connect(shaper).connect(this.formant);
      osc.start(t0 + lag);
      osc.stop(t0 + lag + dur + 0.02);
      osc.addEventListener("ended", () => {
        osc.disconnect();
        env.disconnect();
        shaper.disconnect();
      });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.formant.disconnect();
    this.output.disconnect();
  }
}

// ---- the wall --------------------------------------------------------------------

export interface EchoTap {
  /** Round-trip time, seconds: 2·d / 343. */
  delay: number;
  /** Linear gain of this reflection. */
  gain: number;
  /** Lowpass cutoff, Hz — air absorption dulls distant echoes. */
  cutoff: number;
  /** Stereo pan −1..1, from the wall's bearing. */
  pan: number;
  /** One-way distance to the wall, meters (for display). */
  distance: number;
  /** Bearing of the wall from the caller, radians about +y (for display). */
  azimuth: number;
}

export interface EchoTapOptions {
  /** Terrain height query (pass terrainHeightAt or a grid cache). */
  heightAt: (x: number, z: number) => number;
  /** Number of rays around the compass (default 8). */
  directions?: number;
  /** Where the listener faces, radians about +y — pans the taps. */
  heading?: number;
  /** Give up beyond this one-way distance, meters (default 1400). */
  maxDistance?: number;
  /** March step, meters (default 12). */
  step?: number;
  /** Mix-space loudness of the reflections (default 3). */
  gainScale?: number;
}

/**
 * March rays from (x, y, z) across the height field; where terrain rises
 * above flight height the ray has met the wall. Reflectivity favors steep
 * rock: gentle beaches graze and absorb, headwalls ring. Returns taps sorted
 * by arrival time.
 *
 * The gain law: pressure spreads as 1/r over the round trip 2d, times a rock
 * reflectivity R. Raw 1/(2d) at lake scale is −50 dB and would vanish in the
 * mix, so we compress the distance law with a square root — same ordering,
 * audible result — and document the compression instead of hiding it.
 */
export function computeEchoTaps(x: number, y: number, z: number, opts: EchoTapOptions): EchoTap[] {
  const dirs = opts.directions ?? 8;
  const maxD = opts.maxDistance ?? 1400;
  const step = opts.step ?? 12;
  const heading = opts.heading ?? 0;
  const scale = opts.gainScale ?? 3;
  const taps: EchoTap[] = [];

  for (let i = 0; i < dirs; i++) {
    const az = (i / dirs) * Math.PI * 2;
    const dx = Math.cos(az);
    const dz = Math.sin(az);
    for (let d = step; d <= maxD; d += step) {
      const h = opts.heightAt(x + dx * d, z + dz * d);
      if (h > y + 2) {
        // Local slope along the ray decides if this is wall or beach.
        const hBack = opts.heightAt(x + dx * (d - step), z + dz * (d - step));
        const slope = (h - hBack) / step;
        const reflect = 0.75 * clamp((slope - 0.25) / 0.55, 0, 1);
        if (reflect < 0.12) continue; // grazing ground: keep marching
        const gain = Math.min(0.5, scale * reflect * Math.sqrt(1 / (2 * d)));
        taps.push({
          delay: (2 * d) / SPEED_OF_SOUND,
          gain,
          cutoff: 16000 / (1 + (2 * d) / 220),
          pan: clamp(Math.sin(az - heading) * 0.85, -1, 1),
          distance: d,
          azimuth: az,
        });
        break;
      }
    }
  }
  taps.sort((a, b) => a.delay - b.delay);
  return taps;
}

/**
 * A bank of delay taps. Feed it the dry call (input); it returns the valley.
 * setTaps() can be called as often as the bird moves — parameter changes are
 * smoothed, and tap count changes rebuild only what's needed.
 */
export class EchoNetwork {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly maxDelay: number;
  private lines: { delay: DelayNode; gain: GainNode; lp: BiquadFilterNode; pan: StereoPannerNode }[] = [];
  private disposed = false;

  constructor(destination: AudioNode = masterBus(), maxDelaySeconds = 9) {
    const ctx = audioContext();
    this.maxDelay = maxDelaySeconds;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.output.connect(destination);
  }

  setTaps(taps: EchoTap[]): void {
    if (this.disposed) return;
    const ctx = audioContext();
    // Grow the pool if needed.
    while (this.lines.length < taps.length) {
      const delay = ctx.createDelay(this.maxDelay);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      const pan = ctx.createStereoPanner();
      this.input.connect(delay).connect(lp).connect(gain).connect(pan).connect(this.output);
      this.lines.push({ delay, gain, lp, pan });
    }
    const t = ctx.currentTime;
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      const tap = taps[i];
      if (!tap) {
        line.gain.gain.setTargetAtTime(0, t, 0.1);
        continue;
      }
      line.delay.delayTime.setTargetAtTime(Math.min(tap.delay, this.maxDelay), t, 0.25);
      line.gain.gain.setTargetAtTime(tap.gain, t, 0.1);
      line.lp.frequency.setTargetAtTime(tap.cutoff, t, 0.1);
      line.pan.pan.setTargetAtTime(tap.pan, t, 0.1);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const l of this.lines) {
      l.delay.disconnect();
      l.gain.disconnect();
      l.lp.disconnect();
      l.pan.disconnect();
    }
    this.input.disconnect();
    this.output.disconnect();
  }
}
