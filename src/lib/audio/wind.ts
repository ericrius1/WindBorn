// Wind synthesized from live airspeed — the sound of speed itself.
//
// There is no "wind sound" in nature: what you hear at speed is turbulence
// boiling around your own head, broadband pressure noise whose loudness and
// brightness both climb with airspeed. So the patch is honest about that:
// ONE white-noise source, split through a small bank of filters whose
// cutoffs and gains are functions of V, plus two event layers (flap whumps,
// stall buffet) keyed to the flight model's wingbeat clock and stall blend.
//
//   noise ─┬─ lowpass   (the body of the whoosh,   fc ≈ 100 + 14·V Hz)
//          ├─ bandpass  (the glide hiss,           fc ≈ 280 + 36·V Hz)
//          ├─ bandpass×2 (the dive scream: high-Q resonators that only
//          │             open above ~16 m/s,       fc ≈ 550 + 75·V Hz)
//          └─ (per-flap) lowpassed bursts — the whump of a downstroke
//
// Loudness follows dynamic pressure: q = ½ρV². In amplitude terms we use
// (V/V_ref)^1.6 with V_ref = 32 m/s (a committed dive), which keeps a 10 m/s
// glide quiet and a full stoop loud without ever leaving headroom.
//
// Everything is driven through update(telemetry, dt) — the caller reads the
// shared FlightState (or a slider) and hands in plain numbers. No polling of
// UI, no timers; if update stops, the sound freezes at its last setting (and
// the demo shell's sound gate mutes it).

import { audioContext, glide, masterBus } from "./context";
import { noiseSource } from "./noise";

export interface WindTelemetry {
  /** Airspeed in m/s — the one number that matters most. */
  airspeed: number;
  /** Flap effort 0..1 (scales the whump). */
  flapping: number;
  /** Wingbeat phase in radians (whumps fire on the downstroke). */
  flapPhase: number;
  /** Stall blend 0..1 (drives the buffet tremolo). */
  stall: number;
  /** Dive tuck 0..1 (sharpens the scream slightly). */
  tuck: number;
  /** Gust factor: local wind magnitude / mean wind speed, ~1.0 when calm. */
  gust?: number;
}

/** A neutral telemetry frame (everything quiet). */
export function stillAir(): WindTelemetry {
  return { airspeed: 0, flapping: 0, flapPhase: 0, stall: 0, tuck: 0, gust: 1 };
}

const V_REF = 32; // m/s — amplitude reference (a committed dive)

// The mapping, factored out so demos can plot the exact curves the synth uses.
export const windCurves = {
  /** Master amplitude 0..~1 for an airspeed. */
  amp(v: number): number {
    return Math.min(1.2, Math.pow(Math.max(v, 0) / V_REF, 1.6));
  },
  /** Lowpass cutoff (Hz) — the whoosh body. */
  lowCutoff(v: number): number {
    return 100 + 14 * v;
  },
  /** Bandpass center (Hz) — the glide hiss. */
  midCenter(v: number): number {
    return 280 + 36 * v;
  },
  /** Hiss gain relative to the body. */
  midGain(v: number): number {
    return 0.5 * Math.min(1, v / 14);
  },
  /** Scream resonator center (Hz). */
  screamCenter(v: number, tuck = 0): number {
    return (550 + 75 * v) * (1 + 0.12 * tuck);
  },
  /** Scream gain — closed below ~16 m/s, wide open by ~28. */
  screamGain(v: number): number {
    const t = Math.min(1, Math.max(0, (v - 16) / 12));
    return 0.85 * t * t;
  },
};

export class WindSynth {
  /** Connect this to a gate/analyser/master — the synth's only output. */
  readonly output: GainNode;

  private readonly src: AudioBufferSourceNode;
  private readonly low: BiquadFilterNode;
  private readonly lowGain: GainNode;
  private readonly mid: BiquadFilterNode;
  private readonly midGain: GainNode;
  private readonly screamA: BiquadFilterNode;
  private readonly screamB: BiquadFilterNode;
  private readonly screamGain: GainNode;
  private readonly body: GainNode; // master amp × gusts, tremolo target
  private readonly buffetOsc: OscillatorNode;
  private readonly buffetDepth: GainNode;
  private prevPhase = 0;
  private disposed = false;

  constructor(destination: AudioNode = masterBus()) {
    const ctx = audioContext();
    this.output = ctx.createGain();
    this.output.gain.value = 1;

    // body gain carries amplitude; the buffet LFO wiggles it additively.
    this.body = ctx.createGain();
    this.body.gain.value = 0;
    this.body.connect(this.output);

    this.src = noiseSource("white");

    this.low = ctx.createBiquadFilter();
    this.low.type = "lowpass";
    this.low.frequency.value = windCurves.lowCutoff(0);
    this.low.Q.value = 0.5;
    this.lowGain = ctx.createGain();
    this.lowGain.gain.value = 1;
    this.src.connect(this.low).connect(this.lowGain).connect(this.body);

    this.mid = ctx.createBiquadFilter();
    this.mid.type = "bandpass";
    this.mid.frequency.value = windCurves.midCenter(0);
    this.mid.Q.value = 0.8;
    this.midGain = ctx.createGain();
    this.midGain.gain.value = 0;
    this.src.connect(this.mid).connect(this.midGain).connect(this.body);

    // Two detuned high-Q resonators a minor sixth apart sound like a scream;
    // one alone sounds like a test tone.
    this.screamA = ctx.createBiquadFilter();
    this.screamA.type = "bandpass";
    this.screamA.Q.value = 14;
    this.screamB = ctx.createBiquadFilter();
    this.screamB.type = "bandpass";
    this.screamB.Q.value = 11;
    this.screamGain = ctx.createGain();
    this.screamGain.gain.value = 0;
    this.src.connect(this.screamA).connect(this.screamGain);
    this.src.connect(this.screamB).connect(this.screamGain);
    this.screamGain.connect(this.body);

    // Stall buffet: a ~10 Hz tremolo whose depth IS the stall blend — the
    // airframe shakes audibly exactly when the physics says the flow lets go.
    this.buffetOsc = ctx.createOscillator();
    this.buffetOsc.type = "sine";
    this.buffetOsc.frequency.value = 10;
    this.buffetDepth = ctx.createGain();
    this.buffetDepth.gain.value = 0;
    this.buffetOsc.connect(this.buffetDepth).connect(this.body.gain);
    this.buffetOsc.start();

    this.output.connect(destination);
  }

  /** Feed one frame of telemetry. Call from your render loop. */
  update(t: WindTelemetry, _dt: number): void {
    if (this.disposed) return;
    const v = Math.max(0, t.airspeed);
    const gust = t.gust ?? 1;

    // Gusts modulate both loudness and brightness a little — a gust is
    // literally more air, faster.
    const amp = windCurves.amp(v) * (0.7 + 0.3 * gust);
    glide(this.body.gain, amp, 0.06);
    glide(this.low.frequency, windCurves.lowCutoff(v) * (0.85 + 0.15 * gust), 0.09);
    glide(this.mid.frequency, windCurves.midCenter(v), 0.09);
    glide(this.midGain.gain, windCurves.midGain(v), 0.09);

    const fc = windCurves.screamCenter(v, t.tuck);
    glide(this.screamA.frequency, fc, 0.07);
    glide(this.screamB.frequency, fc * 1.31, 0.07);
    glide(this.screamGain.gain, windCurves.screamGain(v), 0.07);

    // Buffet: depth follows the stall blend; rate climbs as it deepens.
    glide(this.buffetDepth.gain, 0.5 * amp * t.stall, 0.05);
    glide(this.buffetOsc.frequency, 9 + 5 * t.stall, 0.1);

    // Flap whump: fire once per wingbeat as the phase passes mid-downstroke
    // (sin goes positive→negative through π). Compare wrapped phases.
    const TAU = Math.PI * 2;
    const ph = ((t.flapPhase % TAU) + TAU) % TAU;
    if (t.flapping > 0.05 && this.prevPhase < Math.PI && ph >= Math.PI) {
      this.whump(Math.min(1, t.flapping) * (0.35 + 0.4 * Math.min(1, v / 12)));
    }
    this.prevPhase = ph;
  }

  /**
   * One downstroke: a lowpassed noise burst (air shoved off the wing) plus
   * a quick pitch-dropping thump. ~150 ms, self-cleaning nodes.
   */
  private whump(strength: number): void {
    if (this.disposed || strength <= 0) return;
    const ctx = audioContext();
    const t0 = ctx.currentTime;

    const burst = noiseSource("white");
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(320, t0);
    lp.frequency.exponentialRampToValueAtTime(110, t0 + 0.14);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.55 * strength, t0 + 0.012);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    burst.connect(lp).connect(env).connect(this.output);
    burst.stop(t0 + 0.2);

    const thump = ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(95, t0);
    thump.frequency.exponentialRampToValueAtTime(45, t0 + 0.12);
    const tEnv = ctx.createGain();
    tEnv.gain.setValueAtTime(0, t0);
    tEnv.gain.linearRampToValueAtTime(0.25 * strength, t0 + 0.015);
    tEnv.gain.exponentialRampToValueAtTime(0.001, t0 + 0.13);
    thump.connect(tEnv).connect(this.output);
    thump.start(t0);
    thump.stop(t0 + 0.15);

    burst.addEventListener("ended", () => {
      burst.disconnect();
      lp.disconnect();
      env.disconnect();
    });
    thump.addEventListener("ended", () => {
      thump.disconnect();
      tEnv.disconnect();
    });
  }

  /** Overall level 0..1. */
  set level(v: number) {
    glide(this.output.gain, Math.max(0, v), 0.05);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.src.stop();
    this.buffetOsc.stop();
    this.src.disconnect();
    this.buffetOsc.disconnect();
    this.buffetDepth.disconnect();
    for (const n of [
      this.low,
      this.lowGain,
      this.mid,
      this.midGain,
      this.screamA,
      this.screamB,
      this.screamGain,
      this.body,
      this.output,
    ])
      n.disconnect();
  }
}
