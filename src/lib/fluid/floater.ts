// Floating bodies — the "back" half of two-way coupling (coupling.html).
// The sim pushes water around; this pushes bodies around with the water:
//
//   buoyancy  Archimedes on a sphere cap: weigh the displaced water
//   drag      the body is carried toward the *surface's own velocity*
//             (the sim's vx/vz field — this is what makes wakes shove
//             things and splashes scatter them)
//   tilt      cosmetic: the body leans onto the local surface normal
//
// Heights and normals come from the spine's `waterHeightAt`/`waterNormalAt`
// — the provider contract — so a Floater works on plain ambient water, and
// gets the full sim response for free once installSimProvider() has run.
// Moving floaters announce themselves back to the bus as "wake" events,
// which is how the Kelvin fan in wake.html closes the loop.

import { Vector2, Vector3 } from "three";
import { disturb, waterHeightAt } from "../spine";
import type { FluidSim } from "./sim";

const RHO_WATER = 1000; // kg/m³
const G = 9.81;

export interface FloaterOptions {
  /** Sphere radius, meters. Default 0.22. */
  radius?: number;
  /** Body density relative to water (0.5 floats half-out). Default 0.45. */
  density?: number;
  /** Horizontal drag rate toward the surface velocity, 1/s. Default 2.2. */
  dragXZ?: number;
  /** Vertical drag rate while wet, 1/s. Default 3.2. */
  dragY?: number;
  /** Seconds between wake events while moving. Default 0.14. */
  wakeEvery?: number;
  /** Read the sim's velocity field for drag (else still water). */
  sim?: FluidSim | null;
  /**
   * The height query this body floats on. Defaults to the spine's
   * `waterHeightAt` (whatever provider is installed). Demos that run several
   * sims on one page pass their own SimWaterProvider's heightAt here so
   * bodies always read the window they live in.
   */
  waterAt?: (x: number, z: number, t: number) => number;
}

const _n = new Vector3();
const _v2 = new Vector2();

export class Floater {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  /** Unit up vector after tilting onto the water normal (cosmetic). */
  readonly up = new Vector3(0, 1, 0);
  readonly radius: number;
  readonly mass: number;
  /** 0 = airborne, 1 = fully submerged (sphere). */
  submerged = 0;
  /** Emit "wake" disturbances while moving on the surface. */
  wakeEnabled = true;

  private readonly density: number;
  private readonly dragXZ: number;
  private readonly dragY: number;
  private readonly wakeEvery: number;
  private readonly sim: FluidSim | null;
  private readonly waterAt: (x: number, z: number, t: number) => number;
  private wakeTimer = 0;

  constructor(options: FloaterOptions = {}) {
    this.radius = options.radius ?? 0.22;
    this.density = options.density ?? 0.45;
    this.dragXZ = options.dragXZ ?? 2.2;
    this.dragY = options.dragY ?? 3.2;
    this.wakeEvery = options.wakeEvery ?? 0.14;
    this.sim = options.sim ?? null;
    this.waterAt = options.waterAt ?? waterHeightAt;
    const volume = (4 / 3) * Math.PI * this.radius ** 3;
    this.mass = RHO_WATER * this.density * volume;
  }

  /** Drop the body somewhere and forget its momentum. */
  place(x: number, y: number, z: number): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
  }

  /**
   * One physics step. `t` is the shared demo clock that the water provider
   * is being driven with (the same t the surface material renders).
   */
  update(dt: number, t: number): void {
    const h = Math.min(dt, 0.05);
    if (h <= 0) return;
    const R = this.radius;

    const water = this.waterAt(this.pos.x, this.pos.z, t);

    // Submerged sphere-cap volume: cap height e ∈ [0, 2R],
    // V(e) = π e² (3R − e) / 3 — zero when dry, full sphere at e = 2R.
    const e = Math.min(Math.max(water - (this.pos.y - R), 0), 2 * R);
    const capVolume = (Math.PI * e * e * (3 * R - e)) / 3;
    const fullVolume = (4 / 3) * Math.PI * R ** 3;
    this.submerged = capVolume / fullVolume;

    // Forces: weight down, displaced water up.
    const accelY = -G + (RHO_WATER * capVolume * G) / this.mass;
    this.vel.y += accelY * h;

    if (this.submerged > 0) {
      // The water the body sits in is itself moving; drag carries the body
      // toward that velocity, not toward rest.
      let sx = 0;
      let sz = 0;
      if (this.sim) {
        this.sim.velocityAt(this.pos.x, this.pos.z, _v2);
        const f = this.sim.fadeAt(this.pos.x, this.pos.z);
        sx = _v2.x * f;
        sz = _v2.y * f;
      }
      const kxz = 1 - Math.exp(-this.dragXZ * this.submerged * h);
      this.vel.x += (sx - this.vel.x) * kxz;
      this.vel.z += (sz - this.vel.z) * kxz;
      const ky = 1 - Math.exp(-this.dragY * this.submerged * h);
      this.vel.y -= this.vel.y * ky;
    }

    this.pos.addScaledVector(this.vel, h);

    // Cosmetic tilt toward the local surface normal (finite differences of
    // the same height query the buoyancy used).
    if (this.submerged > 0.02) {
      const e = 0.08;
      const hL = this.waterAt(this.pos.x - e, this.pos.z, t);
      const hR = this.waterAt(this.pos.x + e, this.pos.z, t);
      const hD = this.waterAt(this.pos.x, this.pos.z - e, t);
      const hU = this.waterAt(this.pos.x, this.pos.z + e, t);
      _n.set(hL - hR, 2 * e, hD - hU).normalize();
      this.up.lerp(_n, Math.min(1, h * 6)).normalize();
    }

    // Tell the lake. Speed pays for the wake's energy: E ∝ v².
    if (this.wakeEnabled && this.submerged > 0.05) {
      const speed = Math.hypot(this.vel.x, this.vel.z);
      this.wakeTimer -= h;
      if (speed > 0.35 && this.wakeTimer <= 0) {
        this.wakeTimer = this.wakeEvery;
        disturb({
          kind: "wake",
          x: this.pos.x,
          z: this.pos.z,
          energy: Math.min(0.02 * speed * speed * (R / 0.22), 0.6),
          radius: R * 2.2,
          vx: this.vel.x,
          vz: this.vel.z,
        });
      }
    }
  }
}
