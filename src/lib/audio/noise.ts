// Noise sources — the raw material of almost every sound in this series.
//
// White noise is equal energy per hertz: the flat spectrum turbulence hands
// us. Pink noise is equal energy per OCTAVE (−3 dB/oct), which is closer to
// how broadband natural sound actually reaches an ear, so it's the better
// bed for water and distant air. We bake each into a looping AudioBuffer
// once per context and hand out cheap BufferSource taps.

import { audioContext } from "./context";

const SECONDS = 2; // loop length; long enough that the repeat is inaudible

let whiteCache: AudioBuffer | null = null;
let pinkCache: AudioBuffer | null = null;

/** A 2 s buffer of uniform white noise in [-1, 1). */
export function whiteNoiseBuffer(): AudioBuffer {
  if (whiteCache) return whiteCache;
  const ctx = audioContext();
  const buf = ctx.createBuffer(1, ctx.sampleRate * SECONDS, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  whiteCache = buf;
  return buf;
}

/**
 * Pink noise via three cascaded one-pole lowpass states summed with the
 * input — a classic cheap approximation of a −3 dB/octave slope, good to
 * within ±0.5 dB across the audible band. (Exact pink noise needs an
 * infinite filter; three poles spread over the spectrum is plenty for a
 * lake.)
 */
export function pinkNoiseBuffer(): AudioBuffer {
  if (pinkCache) return pinkCache;
  const ctx = audioContext();
  const buf = ctx.createBuffer(1, ctx.sampleRate * SECONDS, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0;
  for (let i = 0; i < data.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
  }
  pinkCache = buf;
  return buf;
}

/** A looping noise source, started immediately. Caller stops/disconnects. */
export function noiseSource(kind: "white" | "pink" = "white"): AudioBufferSourceNode {
  const ctx = audioContext();
  const src = ctx.createBufferSource();
  src.buffer = kind === "white" ? whiteNoiseBuffer() : pinkNoiseBuffer();
  src.loop = true;
  // Random offset so parallel taps of the same buffer don't correlate.
  src.start(0, Math.random() * SECONDS);
  return src;
}
