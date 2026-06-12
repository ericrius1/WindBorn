// Game-feel math used across the Lift demos: response curves, deadzones,
// and frame-rate-independent smoothing. joy.html is the essay about why
// each of these exists.

// Exponential response curve. expo = 0 is linear; higher values soften the
// center of the stick while keeping full deflection at the ends:
//   y = (1 - e)·x + e·x³
export function expoCurve(x: number, expo: number): number {
  return (1 - expo) * x + expo * x * x * x;
}

// Re-map a gamepad axis so the first `dz` of travel is dead, with the rest
// rescaled to keep full range (no jump at the deadzone edge).
export function applyDeadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a < dz) return 0;
  return Math.sign(v) * ((a - dz) / (1 - dz));
}

// Frame-rate-independent exponential approach: returns the new value of
// `current` after dt seconds chasing `target` with rate λ (1/s). Identical
// motion at 30, 60, or 144 fps — lerp-with-a-constant is not.
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

// A critically-damped spring tracker — overshoot-free smoothing with a
// velocity, for things that should feel like they have mass (the camera).
export class Spring {
  value: number;
  velocity = 0;
  constructor(
    value = 0,
    public omega = 6, // natural frequency, rad/s — stiffness
  ) {
    this.value = value;
  }

  update(target: number, dt: number): number {
    // Closed-form critically damped step (stable for any dt).
    const w = this.omega;
    const x = this.value - target;
    const v = this.velocity;
    const e = Math.exp(-w * dt);
    this.value = target + (x + (v + w * x) * dt) * e;
    this.velocity = (v - (v + w * x) * (w * dt)) * e;
    return this.value;
  }

  reset(value: number): void {
    this.value = value;
    this.velocity = 0;
  }
}
