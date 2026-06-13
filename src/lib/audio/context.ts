// One AudioContext for the whole site, behind one master limiter.
//
// Browsers refuse to start audio without a user gesture, and our demos lazy-
// mount while scrolled offscreen — so the context here is created suspended,
// stays suspended until `resumeAudio()` is called from a real click, and
// every consumer must behave gracefully in both states (schedule against
// `currentTime`, never assume the clock is moving).
//
// Topology:
//   synth outputs → masterBus (GainNode)
//                 → limiter (DynamicsCompressor configured as a limiter)
//                 → destination
//
// The limiter is the site's seatbelt: any single splash or chord is mixed to
// sit well under 0 dBFS, but five demos and a hailstorm of bus events can
// stack. A 20:1 ratio with a hard knee at −6 dBFS turns "clipping" into
// "briefly squeezed".

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let stateListeners = new Set<() => void>();

/** The shared context, created on first ask (suspended until a gesture). */
export function audioContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    ctx.addEventListener("statechange", () => {
      for (const fn of stateListeners) fn();
    });
  }
  return ctx;
}

/** The node every synth connects its output to (pre-limiter master fader). */
export function masterBus(): GainNode {
  if (!master) {
    const c = audioContext();
    master = c.createGain();
    master.gain.value = 0.9;

    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -6; // dBFS where limiting begins
    limiter.knee.value = 0; // hard knee: a true ceiling, not a slope
    limiter.ratio.value = 20; // 20 dB in → 1 dB out past the threshold
    limiter.attack.value = 0.002; // clamp transients within 2 ms
    limiter.release.value = 0.25; // let go slowly enough not to pump

    master.connect(limiter);
    limiter.connect(c.destination);
  }
  return master;
}

/** Master volume 0..1 (pre-limiter). */
export function setMasterGain(v: number): void {
  const m = masterBus();
  m.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), audioContext().currentTime, 0.03);
}

/** True while the context clock is actually running. */
export function audioRunning(): boolean {
  return ctx !== null && ctx.state === "running";
}

/**
 * Resume the context. MUST be called from inside a user-gesture handler
 * (click/keydown) the first time, or the browser will ignore it.
 */
export async function resumeAudio(): Promise<void> {
  const c = audioContext();
  if (c.state !== "running") {
    try {
      await c.resume();
    } catch {
      // Not a gesture; the next real click will succeed.
    }
  }
}

/** Subscribe to running/suspended changes (for "click to listen" UI). */
export function onAudioStateChange(fn: () => void): () => void {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}

/**
 * Frame-rate-independent smoothing target for AudioParams: a wrapper around
 * setTargetAtTime with a sane default time constant. Use this for every
 * continuously-tracked parameter (cutoffs, gains) — direct `.value` writes
 * at 60 Hz produce zipper noise.
 */
export function glide(param: AudioParam, value: number, timeConstant = 0.08): void {
  param.setTargetAtTime(value, audioContext().currentTime, timeConstant);
}
