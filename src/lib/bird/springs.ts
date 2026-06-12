// Damped springs, the only easing this series uses. A spring never plays an
// animation — it *chases* a target from wherever it currently is, with
// whatever velocity it currently has, which is why two motions blended by
// springs never pop: there is no blend code, only physics that refuses to
// teleport.
//
//   x'' = ω²(target − x) − 2ζω·x'      ω = 2π·freqHz
//
// ζ = 1 is critical damping: the fastest possible approach with zero
// overshoot. ζ < 1 overshoots and rings (good for flesh and feathers);
// ζ > 1 crawls. The integrator is semi-implicit Euler, stable for the
// stiffness range these demos use (≤ ~20 Hz at 60 fps).

export class Spring1D {
  value: number;
  vel = 0;

  constructor(value = 0) {
    this.value = value;
  }

  set(value: number): void {
    this.value = value;
    this.vel = 0;
  }

  step(target: number, dt: number, freqHz: number, zeta = 1): number {
    const w = 2 * Math.PI * freqHz;
    this.vel += (w * w * (target - this.value) - 2 * zeta * w * this.vel) * dt;
    this.value += this.vel * dt;
    return this.value;
  }
}

// A set of named scalar springs — the animator keeps one per pose weight.
export class SpringSet<K extends string> {
  private springs = new Map<K, Spring1D>();

  get(key: K): Spring1D {
    let s = this.springs.get(key);
    if (!s) {
      s = new Spring1D(0);
      this.springs.set(key, s);
    }
    return s;
  }

  value(key: K): number {
    return this.springs.get(key)?.value ?? 0;
  }
}
