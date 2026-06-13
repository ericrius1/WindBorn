// The adaptive score: music as a set of layers, each keyed to a world input
// (altitude, hour, weather), crossfaded with equal-power law so the mix
// never bumps as the world changes.
//
// THE HARMONIC LANGUAGE — calm on purpose. Everything lives in D major
// pentatonic (D E F# A B): five notes with no semitone clashes, so any layer
// can sound over any other in any combination and never grind. That's not a
// stylistic nicety, it's the engineering requirement of adaptive music —
// layers fade in and out independently, so every pair must be consonant.
//
// THE LAYERS
//   drone   — D root + fifth, always on; the lake's pedal point
//   meadow  — warm mid-register pad cycling slow triads; low altitude, day
//   aloft   — sparse high bell notes; grows with altitude
//   night   — dark low pad on B minor colors; keyed to the clock
//   storm   — pulsing low fifth + noise swell; keyed to the weather
//
// THE CROSSFADE MATH — loudness adds in power (amplitude²), not amplitude.
// If two equal layers crossfade linearly, the midpoint plays 0.5 + 0.5
// amplitude = 1.0 amplitude but only 0.25 + 0.25 = 0.5 power: a −3 dB hole.
// The fix: every layer weight wᵢ becomes a gain gᵢ = √(wᵢ / max(1, Σw)),
// so Σgᵢ² (total power) stays constant whenever weights sum to ≥ 1, and
// fades stay smooth when they don't. The two-layer case reduces to the
// classic cos/sin pair.
//
// Pads glide between chords instead of retriggering — oscillator frequencies
// chase their targets with setTargetAtTime, which is both cheaper and more
// "breath" than envelopes. Bell notes are scheduled a beat ahead on the
// context clock from update(), the standard lookahead pattern.

import { audioContext, glide, masterBus } from "./context";
import { noiseSource } from "./noise";

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** MIDI note → frequency. A4 (69) = 440 Hz. */
export function noteHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Equal-power layer gains from raw weights (see derivation above). */
export function equalPowerWeights(weights: number[]): number[] {
  let sum = 0;
  for (const w of weights) sum += Math.max(0, w);
  const norm = Math.max(1, sum);
  return weights.map((w) => Math.sqrt(Math.max(0, w) / norm));
}

export interface ScoreInputs {
  /** Height above the water, meters. */
  altitude: number;
  /** World-clock hour, 0–24. */
  hour: number;
  /** Weather tension 0..1 (e.g. wind speed mapped through a knee). */
  storm: number;
}

/** The raw layer weights for a set of inputs — exported so demos can plot
 *  exactly what the engine will do. */
export function layerWeights(inp: ScoreInputs): {
  drone: number;
  meadow: number;
  aloft: number;
  night: number;
  storm: number;
} {
  const s = (a: number, b: number, x: number): number => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  const day = s(5.2, 7.5, inp.hour) * (1 - s(19, 21.5, inp.hour));
  const high = s(18, 65, inp.altitude);
  const storm = clamp01(inp.storm);
  return {
    drone: 1,
    meadow: day * (1 - high) * (1 - 0.7 * storm),
    aloft: high * (0.45 + 0.55 * day) * (1 - 0.5 * storm),
    night: (1 - day) * (1 - 0.5 * storm),
    storm,
  };
}

// Pentatonic pitch material (MIDI).
const MEADOW_CHORDS: number[][] = [
  [50, 57, 64], // D3  A3  E4   (Dsus2 spread)
  [55, 62, 71], // G3  D4  B4   (G, open)
  [57, 64, 69], // A3  E4  A4   (A, hollow)
  [47, 54, 62], // B2  F#3 D4   (Bm)
];
const NIGHT_CHORDS: number[][] = [
  [47, 50, 54], // B2 D3 F#3
  [45, 52, 57], // A2 E3 A3
];
const BELL_NOTES = [74, 76, 78, 81, 83, 86]; // D5 E5 F#5 A5 B5 D6

interface PadVoice {
  oscA: OscillatorNode;
  oscB: OscillatorNode;
}

/** A 3-voice glide pad: triangle pairs detuned ±5 cents through a lowpass. */
class GlidePad {
  readonly gain: GainNode;
  private readonly voices: PadVoice[] = [];
  private readonly filter: BiquadFilterNode;

  constructor(out: AudioNode, chord: number[], cutoff: number) {
    const ctx = audioContext();
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = cutoff;
    this.filter.Q.value = 0.3;
    this.filter.connect(this.gain).connect(out);
    for (const midi of chord) {
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();
      oscA.type = "triangle";
      oscB.type = "triangle";
      oscA.frequency.value = noteHz(midi);
      oscB.frequency.value = noteHz(midi);
      oscA.detune.value = -5;
      oscB.detune.value = 5;
      const v = ctx.createGain();
      v.gain.value = 0.16;
      oscA.connect(v);
      oscB.connect(v);
      v.connect(this.filter);
      oscA.start();
      oscB.start();
      this.voices.push({ oscA, oscB });
    }
  }

  /** Glide every voice to a new chord over ~2 s. */
  setChord(chord: number[]): void {
    for (let i = 0; i < this.voices.length; i++) {
      const f = noteHz(chord[i % chord.length]);
      glide(this.voices[i].oscA.frequency, f, 0.8);
      glide(this.voices[i].oscB.frequency, f, 0.8);
    }
  }

  dispose(): void {
    for (const v of this.voices) {
      v.oscA.stop();
      v.oscB.stop();
      v.oscA.disconnect();
      v.oscB.disconnect();
    }
    this.filter.disconnect();
    this.gain.disconnect();
  }
}

export class AdaptiveScore {
  readonly output: GainNode;

  // Per-layer gain nodes (post equal-power weighting).
  private readonly gains: Record<"drone" | "meadow" | "aloft" | "night" | "storm", GainNode>;
  private readonly droneOscs: OscillatorNode[] = [];
  private readonly meadowPad: GlidePad;
  private readonly nightPad: GlidePad;
  private readonly stormOscs: OscillatorNode[] = [];
  private readonly stormLfo: OscillatorNode;
  private readonly stormNoise: AudioBufferSourceNode;
  private readonly toClose: AudioNode[] = [];

  private meadowChord = 0;
  private nightChord = 0;
  private chordTimer = 0;
  private nextBell = 0;
  private aloftLevel = 0;
  private disposed = false;

  constructor(destination: AudioNode = masterBus()) {
    const ctx = audioContext();
    this.output = ctx.createGain();
    this.output.gain.value = 0.8;
    this.output.connect(destination);

    const mk = (): GainNode => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.output);
      return g;
    };
    this.gains = { drone: mk(), meadow: mk(), aloft: mk(), night: mk(), storm: mk() };

    // -- drone: D2 + A2, barely moving ------------------------------------
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 320;
    droneFilter.connect(this.gains.drone);
    this.toClose.push(droneFilter);
    for (const [midi, level, det] of [
      [38, 0.3, -4],
      [38, 0.3, 4],
      [45, 0.16, 0],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = noteHz(midi);
      osc.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(droneFilter);
      osc.start();
      this.droneOscs.push(osc);
      this.toClose.push(g);
    }

    // -- pads ---------------------------------------------------------------
    this.meadowPad = new GlidePad(this.gains.meadow, MEADOW_CHORDS[0], 950);
    this.nightPad = new GlidePad(this.gains.night, NIGHT_CHORDS[0], 520);

    // -- storm: pulsing low fifth + a noise swell ----------------------------
    const stormBus = ctx.createGain();
    stormBus.gain.value = 1;
    this.stormLfo = ctx.createOscillator();
    this.stormLfo.type = "sine";
    this.stormLfo.frequency.value = 1.1;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.4;
    stormBus.gain.value = 0.6;
    this.stormLfo.connect(lfoDepth).connect(stormBus.gain);
    this.stormLfo.start();
    const stormFilter = ctx.createBiquadFilter();
    stormFilter.type = "lowpass";
    stormFilter.frequency.value = 240;
    stormFilter.connect(stormBus).connect(this.gains.storm);
    for (const midi of [38, 45]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = noteHz(midi);
      const g = ctx.createGain();
      g.gain.value = 0.13;
      osc.connect(g).connect(stormFilter);
      osc.start();
      this.stormOscs.push(osc);
      this.toClose.push(g);
    }
    this.stormNoise = noiseSource("pink");
    const stormNoiseGain = ctx.createGain();
    stormNoiseGain.gain.value = 0.1;
    const stormNoiseLp = ctx.createBiquadFilter();
    stormNoiseLp.type = "lowpass";
    stormNoiseLp.frequency.value = 600;
    this.stormNoise.connect(stormNoiseLp).connect(stormNoiseGain).connect(this.gains.storm);
    this.toClose.push(stormBus, stormFilter, lfoDepth, stormNoiseGain, stormNoiseLp);
  }

  /** Advance the score one frame. `dt` in seconds. */
  update(inp: ScoreInputs, dt: number): void {
    if (this.disposed) return;
    const w = layerWeights(inp);
    const [gD, gM, gA, gN, gS] = equalPowerWeights([w.drone, w.meadow, w.aloft, w.night, w.storm]);
    glide(this.gains.drone.gain, gD * 0.9, 0.5);
    glide(this.gains.meadow.gain, gM, 0.5);
    glide(this.gains.aloft.gain, gA, 0.5);
    glide(this.gains.night.gain, gN, 0.5);
    glide(this.gains.storm.gain, gS, 0.4);
    this.aloftLevel = gA;

    // Chord clock: meadow moves every ~9 s, night every other change.
    this.chordTimer += dt;
    if (this.chordTimer > 9) {
      this.chordTimer = 0;
      this.meadowChord = (this.meadowChord + 1) % MEADOW_CHORDS.length;
      this.meadowPad.setChord(MEADOW_CHORDS[this.meadowChord]);
      if (this.meadowChord % 2 === 0) {
        this.nightChord = (this.nightChord + 1) % NIGHT_CHORDS.length;
        this.nightPad.setChord(NIGHT_CHORDS[this.nightChord]);
      }
    }

    // Bell lookahead: while the aloft layer is audible, drop sparse high
    // notes on a loose grid.
    const ctx = audioContext();
    if (this.aloftLevel > 0.05 && ctx.state === "running") {
      if (this.nextBell < ctx.currentTime) this.nextBell = ctx.currentTime + 0.1;
      while (this.nextBell < ctx.currentTime + 0.4) {
        if (Math.random() < 0.55) this.bell(this.nextBell);
        this.nextBell += 0.7 + Math.random() * 1.3;
      }
    }
  }

  /** One high bell: a sine with a soft octave partial, 2–3 s of decay. */
  private bell(t0: number): void {
    const ctx = audioContext();
    const midi = BELL_NOTES[Math.floor(Math.random() * BELL_NOTES.length)];
    const f = noteHz(midi);
    const dur = 2 + Math.random() * 1.2;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.2 - 0.6;
    pan.connect(this.gains.aloft);
    for (const [mult, level] of [
      [1, 0.16],
      [2, 0.05],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f * mult;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(level, t0 + 0.02);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(env).connect(pan);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
      osc.addEventListener("ended", () => {
        osc.disconnect();
        env.disconnect();
      });
    }
    window.setTimeout(() => pan.disconnect(), (dur + 0.3) * 1000);
  }

  set level(v: number) {
    glide(this.output.gain, Math.max(0, v), 0.1);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const o of [...this.droneOscs, ...this.stormOscs, this.stormLfo]) {
      o.stop();
      o.disconnect();
    }
    this.stormNoise.stop();
    this.stormNoise.disconnect();
    this.meadowPad.dispose();
    this.nightPad.dispose();
    for (const n of this.toClose) n.disconnect();
    for (const g of Object.values(this.gains)) g.disconnect();
    this.output.disconnect();
  }
}
