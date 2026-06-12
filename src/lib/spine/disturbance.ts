// The disturbance bus. Anything that touches the water announces it here:
// an osprey strike, a fish rise, a raindrop, a wingtip kissing the surface.
// Anything that reacts to water being touched — the fluid sim, the foam
// layer, the splash synthesizer in your headphones — subscribes.
//
// One channel, written once, reused by every series after The Splash.

export type DisturbanceKind = "splash" | "rise" | "rain" | "wake" | "skim";

export interface Disturbance {
  kind: DisturbanceKind;
  x: number;
  z: number;
  // Joule-ish scalar; a raindrop is ~0.001, a fish rise ~0.05, a full
  // talons-first strike ~1.0. Listeners scale their response from this.
  energy: number;
  // Footprint radius in meters.
  radius: number;
  // Horizontal velocity of the disturber, for directional wakes (optional).
  vx?: number;
  vz?: number;
}

type Listener = (d: Disturbance) => void;

const listeners = new Set<Listener>();

export function onDisturbance(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function disturb(d: Disturbance): void {
  for (const fn of listeners) fn(d);
}
