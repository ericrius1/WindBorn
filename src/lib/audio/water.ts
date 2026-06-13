// Water audio: what the lake says when something touches it.
//
// Three voices, one physical idea each:
//
//   · SPLASH — every impact makes the same three sounds in order:
//       1. the slap: a broadband noise burst as the surface tears open;
//       2. the body: the air cavity the impact entrains rings like a bell.
//          A bubble of radius R resonates at the Minnaert frequency
//             f ≈ 3.26 / R   (R in meters, f in Hz)
//          — big strikes entrain big cavities and ring LOW (a 5 cm cavity
//          is ~65 Hz), raindrops entrain millimeter bubbles and PLINK in
//          the kilohertz. The pitch glides UP as the cavity shrinks, which
//          is the rising "bloop" everyone knows;
//       3. the tail: secondary droplets fall back and make tiny bubbles of
//          their own — a sparse shower of high plinks.
//     One energy number (the disturbance bus's joule-ish scalar) sets the
//     cavity size, the loudness, and the droplet count — so the bus event
//     IS the patch input, no extra parameters invented.
//
//   · LAPPING — the ambient wave train working the shore. We don't fake a
//     loop: each frame we ask the spine's waterHeightAt() how fast the
//     surface is moving at the listener and let |∂h/∂t| drive the gain of
//     a pink-noise wash. Wind picks up → spine waves grow → the lake gets
//     audibly busier, with zero extra wiring.
//
//   · RAIN — not one sound but thousands: each "rain" disturbance becomes a
//     single grain (a tick of highpassed noise, sometimes a plink). The
//     granular texture emerges from event density, exactly like the visual
//     rain rings do.
//
// Everything subscribes to the disturbance bus and the spine; nothing polls
// UI. Distance attenuation and stereo pan come from the event's (x, z)
// relative to a listener the host supplies (the bird, usually).

import { onDisturbance, waterHeightAt, wind, type Disturbance } from "../spine";
import { audioContext, glide, masterBus } from "./context";
import { noiseSource } from "./noise";

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ---- one splash ----------------------------------------------------------------

export interface SplashVoiceOptions {
  /** 0..1 — how much surface-tear noise (skims are all slap, no body). */
  slap?: number;
  /** 0..1 — how much cavity bloop (rises are nearly all body). */
  body?: number;
  /** 0..1 — droplet tail amount. */
  tail?: number;
}

/**
 * Schedule the three-part splash at the given output. Self-cleaning: every
 * node stops, fires `ended`, and disconnects itself.
 */
export function scheduleSplash(
  out: AudioNode,
  energy: number,
  opts: SplashVoiceOptions = {},
): void {
  const ctx = audioContext();
  const t0 = ctx.currentTime + 0.001;
  const E = clamp(energy, 0.0005, 1.5);
  const size = Math.cbrt(E); // length scale from an energy (∝ E^⅓)
  const amp = clamp(0.2 + 0.8 * size, 0, 1);
  const slapAmt = opts.slap ?? 1;
  const bodyAmt = opts.body ?? 1;
  const tailAmt = opts.tail ?? 1;

  // 1 — the slap: bandpassed noise, brighter for small impacts.
  if (slapAmt > 0.01) {
    const dur = 0.035 + 0.09 * size;
    const burst = noiseSource("white");
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(700 + 2200 / (1 + 6 * E), t0);
    bp.frequency.exponentialRampToValueAtTime(300 + 500 / (1 + 6 * E), t0 + dur);
    bp.Q.value = 0.9;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.9 * amp * slapAmt, t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    burst.connect(bp).connect(env).connect(out);
    burst.stop(t0 + dur + 0.05);
    burst.addEventListener("ended", () => {
      burst.disconnect();
      bp.disconnect();
      env.disconnect();
    });
  }

  // 2 — the body: Minnaert cavity, pitch gliding up as it collapses.
  if (bodyAmt > 0.01) {
    const R = 0.0015 + 0.05 * size; // cavity radius, meters
    const f0 = clamp(3.26 / R, 55, 2400) * (0.9 + Math.random() * 0.2);
    const dur = 0.12 + 0.3 * size;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(f0, t0 + 0.01);
    osc.frequency.exponentialRampToValueAtTime(f0 * 1.45, t0 + 0.01 + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0 + 0.01);
    env.gain.linearRampToValueAtTime(0.7 * amp * bodyAmt, t0 + 0.025);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.01 + dur);
    osc.connect(env).connect(out);
    osc.start(t0 + 0.01);
    osc.stop(t0 + 0.01 + dur + 0.02);
    osc.addEventListener("ended", () => {
      osc.disconnect();
      env.disconnect();
    });
  }

  // 3 — the tail: a sparse shower of droplet plinks.
  if (tailAmt > 0.01) {
    const n = Math.round((2 + 13 * size) * tailAmt);
    const spread = 0.1 + 0.55 * size;
    for (let i = 0; i < n; i++) {
      const at = t0 + 0.05 + Math.random() * spread;
      const decay = (1 - (at - t0) / (spread + 0.1)) * 0.5 + 0.1;
      const fr = 600 + Math.random() * 1900; // millimeter bubbles
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(fr, at);
      osc.frequency.exponentialRampToValueAtTime(fr * 1.4, at + 0.05);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(0.14 * amp * decay, at + 0.004);
      env.gain.exponentialRampToValueAtTime(0.001, at + 0.055);
      osc.connect(env).connect(out);
      osc.start(at);
      osc.stop(at + 0.07);
      osc.addEventListener("ended", () => {
        osc.disconnect();
        env.disconnect();
      });
    }
  }
}

/** One rain grain: a 15 ms tick of bright noise; 1 in 6 carries a plink. */
export function scheduleRainGrain(out: AudioNode, energy: number): void {
  const ctx = audioContext();
  const t0 = ctx.currentTime + Math.random() * 0.03;
  const amp = clamp(0.04 + 8 * energy, 0.04, 0.22);

  const burst = noiseSource("white");
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 2500 + Math.random() * 2500;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(amp, t0 + 0.002);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.016);
  burst.connect(hp).connect(env).connect(out);
  burst.stop(t0 + 0.03);
  burst.addEventListener("ended", () => {
    burst.disconnect();
    hp.disconnect();
    env.disconnect();
  });

  if (Math.random() < 0.16) {
    const fr = 1100 + Math.random() * 1700;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(fr, t0);
    osc.frequency.exponentialRampToValueAtTime(fr * 1.5, t0 + 0.04);
    const env2 = ctx.createGain();
    env2.gain.setValueAtTime(0, t0);
    env2.gain.linearRampToValueAtTime(amp * 0.9, t0 + 0.003);
    env2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
    osc.connect(env2).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.06);
    osc.addEventListener("ended", () => {
      osc.disconnect();
      env2.disconnect();
    });
  }
}

// ---- the bus listener ----------------------------------------------------------

export interface WaterAudioOptions {
  destination?: AudioNode;
  /** Where the ears are. Defaults to the origin. */
  listener?: () => { x: number; z: number };
  /** Enable the continuous shore-lapping bed (default true). */
  lapping?: boolean;
  /** Subscribe to the disturbance bus (default true). */
  bus?: boolean;
  /** Meters at which a splash has dropped ~6 dB (default 18). */
  referenceDistance?: number;
}

/**
 * The water section of the soundscape: subscribes to the disturbance bus,
 * turns events into splashes/plinks/grains with distance attenuation and
 * stereo pan, and (optionally) runs the lapping bed off the spine's wave
 * state. Mount with one call; dispose() unsubscribes and silences.
 */
export class WaterAudio {
  readonly output: GainNode;

  private readonly listener: () => { x: number; z: number };
  private readonly refDist: number;
  private readonly unsubscribe: () => void;
  private readonly lapSrc: AudioBufferSourceNode | null = null;
  private readonly lapFilter: BiquadFilterNode | null = null;
  private readonly lapGain: GainNode | null = null;
  private prevH = 0;
  private lapEnv = 0;
  private voices = 0; // active splash budget, decayed in update()
  private disposed = false;

  constructor(opts: WaterAudioOptions = {}) {
    const ctx = audioContext();
    this.listener = opts.listener ?? (() => ({ x: 0, z: 0 }));
    this.refDist = opts.referenceDistance ?? 18;
    this.output = ctx.createGain();
    this.output.gain.value = 1;
    this.output.connect(opts.destination ?? masterBus());

    if (opts.lapping !== false) {
      this.lapSrc = noiseSource("pink");
      this.lapFilter = ctx.createBiquadFilter();
      this.lapFilter.type = "bandpass";
      this.lapFilter.frequency.value = 650;
      this.lapFilter.Q.value = 0.6;
      this.lapGain = ctx.createGain();
      this.lapGain.gain.value = 0;
      this.lapSrc.connect(this.lapFilter).connect(this.lapGain).connect(this.output);
    }

    this.unsubscribe = opts.bus !== false ? onDisturbance((d) => this.handle(d)) : () => {};
  }

  private handle(d: Disturbance): void {
    if (this.disposed) return;
    const L = this.listener();
    const dx = d.x - L.x;
    const dz = d.z - L.z;
    const dist = Math.hypot(dx, dz);

    // Spherical-ish spreading with a soft knee at the reference distance.
    const distGain = 1 / (1 + (dist / this.refDist) * (dist / this.refDist));
    if (distGain < 0.004) return; // inaudible, don't spend nodes

    if (d.kind === "rain") {
      // Rain is granular: each event is one cheap grain, panned hard-ish to
      // its side so a storm fills the stereo field.
      const g = this.spatial(dx, dist, distGain);
      scheduleRainGrain(g, d.energy);
      return;
    }

    // Splash budget: a storm of bus events must not allocate unbounded
    // voices. Each splash costs 1; the budget refills in update().
    if (this.voices > 8) return;
    this.voices += 1;

    const out = this.spatial(dx, dist, distGain);
    if (d.kind === "rise") {
      scheduleSplash(out, d.energy, { slap: 0.25, body: 1, tail: 0.5 });
    } else if (d.kind === "skim") {
      scheduleSplash(out, d.energy, { slap: 1, body: 0.2, tail: 0.7 });
    } else if (d.kind === "wake") {
      scheduleSplash(out, d.energy * 0.4, { slap: 0.5, body: 0.1, tail: 0.3 });
    } else {
      scheduleSplash(out, d.energy, {});
    }
  }

  /** A gain+pan+air-absorption chain for one event; self-disposes lazily.
   *  TODO(ear): intensity panning only — no front/back or elevation cues.
   *  A PannerNode with HRTF panning slots in here without touching the bus
   *  interface, if the game ever wants full 3D ears. */
  private spatial(dx: number, dist: number, distGain: number): AudioNode {
    const ctx = audioContext();
    const g = ctx.createGain();
    g.gain.value = distGain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = clamp(dx / Math.max(dist, 1) * Math.min(1, dist / 6), -1, 1);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 14000 / (1 + dist / 60); // air eats the highs
    g.connect(lp).connect(pan).connect(this.output);
    // Reclaim after the longest possible splash (slap+body+tail < 2 s).
    window.setTimeout(() => {
      g.disconnect();
      lp.disconnect();
      pan.disconnect();
    }, 2500);
    return g;
  }

  /**
   * Advance the lapping bed. `t` is the same world-time the visuals use, so
   * the wash you hear is the literal wave train you see.
   */
  update(t: number, dt: number): void {
    if (this.disposed) return;
    this.voices = Math.max(0, this.voices - dt * 6); // ~6 splashes/s budget
    if (!this.lapGain || !this.lapFilter || dt <= 0) return;

    const L = this.listener();
    const h = waterHeightAt(L.x, L.z, t);
    const dhdt = (h - this.prevH) / dt;
    this.prevH = h;

    // Envelope-follow |∂h/∂t|: fast attack, slow release — each passing
    // crest swells the wash and lets it sigh back down.
    const drive = clamp(Math.abs(dhdt) * 6, 0, 1);
    const rate = drive > this.lapEnv ? 10 : 1.6;
    this.lapEnv += (drive - this.lapEnv) * Math.min(1, rate * dt);

    glide(this.lapGain.gain, 0.22 * this.lapEnv, 0.08);
    // Stronger wind → shorter, choppier waves → a brighter wash.
    glide(this.lapFilter.frequency, 450 + 160 * wind.speed, 0.3);
  }

  set level(v: number) {
    glide(this.output.gain, Math.max(0, v), 0.05);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    if (this.lapSrc) {
      this.lapSrc.stop();
      this.lapSrc.disconnect();
    }
    this.lapFilter?.disconnect();
    this.lapGain?.disconnect();
    this.output.disconnect();
  }
}
