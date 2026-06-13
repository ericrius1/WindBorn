// The mayfly hatch: a clock-driven particle population with a real life
// cycle. Nymphs swim up from the bed, duns ride the surface while their
// wings dry (the vulnerable minute the whole food chain is built on), fliers
// climb into the swarm band and dance, spinners dip back to the water to lay
// eggs, and the spent ones drift until something eats them.
//
// `hatchIntensity(hour)` is the one function everything keys off: the spawn
// rate here, the fish's hunger in the school, the swallows' activity, and —
// later — the music. The world clock says it's seven in the evening; the
// lake answers.

import { wind, waterHeightAt, disturb } from "../spine";
import { waterDepthAt } from "../terrain";

/** 0..1 emergence intensity by clock hour. Peaks in the last light. */
export function hatchIntensity(hour: number): number {
  const dusk = Math.exp(-(((hour - 19.4) / 1.1) ** 2));
  const shoulder = 0.15 * Math.exp(-(((hour - 17.4) / 1.0) ** 2));
  return Math.min(1, dusk + shoulder);
}

export const NYMPH = 0;
export const DUN = 1;
export const FLYING = 2;
export const SPINNER = 3;
export const SPENT = 4;
export type MayflyStage = typeof NYMPH | typeof DUN | typeof FLYING | typeof SPINNER | typeof SPENT;

export interface Mayfly {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  stage: MayflyStage;
  /** Seconds left in the current stage. */
  life: number;
  /** Egg-laying dips remaining (spinners). */
  dips: number;
  /** Stable per-fly random in [0, 1). */
  seed: number;
}

export interface HatchParams {
  /** Hard cap on living flies. */
  capacity: number;
  /** Emergence area: a disc of lake near the shore. */
  centerX: number;
  centerZ: number;
  radius: number;
  /** Spawns per second at intensity 1. */
  peakRate: number;
  /** Center of the aerial swarm band above the water, meters. */
  swarmHeight: number;
  /** Duns drift on the surface this long before takeoff (± half). */
  dunSeconds: number;
  /** Aerial life before the spinner descent (± half). */
  flightSeconds: number;
  seed: number;
}

export const DEFAULT_HATCH: HatchParams = {
  capacity: 2200,
  centerX: 60,
  centerZ: 335,
  radius: 45,
  peakRate: 60,
  swarmHeight: 3.2,
  dunSeconds: 8,
  flightSeconds: 38,
  seed: 977,
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface StageCounts {
  nymph: number;
  dun: number;
  flying: number;
  spinner: number;
  spent: number;
}

export class HatchSwarm {
  readonly params: HatchParams;
  readonly flies: Mayfly[] = [];
  /** Current intensity (set from the hour every update). */
  intensity = 0;
  readonly counts: StageCounts = { nymph: 0, dun: 0, flying: 0, spinner: 0, spent: 0 };

  private readonly rand: () => number;
  private spawnAccum = 0;
  /** Emergence sites: pre-sampled lake points with nymph-friendly depth. */
  private readonly sites: Array<[number, number]> = [];
  /** Rate limiter for egg-dip disturbances (the ring pool is small). */
  private dipBudget = 0;

  constructor(params: Partial<HatchParams> = {}) {
    this.params = { ...DEFAULT_HATCH, ...params };
    this.rand = mulberry32(this.params.seed);

    // Pre-sample emergence sites: nymphs of the big lake species live in
    // silt at 0.5–6 m. Rejection-sample the disc once, against the exact
    // bathymetry, so spawning costs nothing per frame.
    const p = this.params;
    for (let tries = 0; tries < 600 && this.sites.length < 120; tries++) {
      const a = this.rand() * Math.PI * 2;
      const r = Math.sqrt(this.rand()) * p.radius;
      const x = p.centerX + Math.cos(a) * r;
      const z = p.centerZ + Math.sin(a) * r;
      const d = waterDepthAt(x, z);
      if (d > 0.5 && d < 6) this.sites.push([x, z]);
    }
    if (this.sites.length === 0) {
      // no nymph-grade bed inside the disc (deep water or a demo tank):
      // emerge anywhere in the area instead of piling on one point
      for (let i = 0; i < 60; i++) {
        const a = this.rand() * Math.PI * 2;
        const r = Math.sqrt(this.rand()) * p.radius;
        this.sites.push([p.centerX + Math.cos(a) * r, p.centerZ + Math.sin(a) * r]);
      }
    }
  }

  /** Surface food (duns + spent spinners) for the fish school. */
  surfaceFood(): Mayfly[] {
    return this.flies.filter((f) => f.stage === DUN || f.stage === SPENT);
  }

  /** Remove a surface fly (a fish or swallow ate it). */
  eat(fly: Mayfly): void {
    const i = this.flies.indexOf(fly);
    if (i >= 0) this.flies.splice(i, 1);
  }

  update(dt: number, t: number, hour: number): void {
    const p = this.params;
    this.intensity = hatchIntensity(hour);
    this.dipBudget = Math.min(this.dipBudget + dt * 3, 3); // ≤3 ring events/s

    // -- spawn ----------------------------------------------------------------
    this.spawnAccum += this.intensity * p.peakRate * dt;
    while (this.spawnAccum >= 1 && this.flies.length < p.capacity) {
      this.spawnAccum -= 1;
      const [sx, sz] = this.sites[(this.rand() * this.sites.length) | 0];
      const x = sx + (this.rand() - 0.5) * 3;
      const z = sz + (this.rand() - 0.5) * 3;
      this.flies.push({
        x,
        y: -waterDepthAt(x, z) + 0.15,
        z,
        vx: 0,
        vy: 0.25,
        vz: 0,
        stage: NYMPH,
        life: 60, // safety timeout; nymphs convert on reaching the surface
        dips: 0,
        seed: this.rand(),
      });
    }
    if (this.spawnAccum > 4) this.spawnAccum = 4;

    // -- advance every fly -------------------------------------------------------
    const windV = wind.sample(p.centerX, 2, p.centerZ, t);
    const c = this.counts;
    c.nymph = c.dun = c.flying = c.spinner = c.spent = 0;

    for (let i = this.flies.length - 1; i >= 0; i--) {
      const f = this.flies[i];
      f.life -= dt;
      switch (f.stage) {
        case NYMPH: {
          // wriggle upward; gas under the shuck does most of the lifting
          f.vy = 0.22 + 0.1 * Math.sin(t * 7 + f.seed * 40);
          f.x += Math.sin(t * 3 + f.seed * 20) * 0.06 * dt;
          f.y += f.vy * dt;
          const surf = waterHeightAt(f.x, f.z, t);
          if (f.y >= surf - 0.01 || f.life <= 0) {
            f.stage = DUN;
            f.life = p.dunSeconds * (0.5 + f.seed);
            f.vx = f.vy = f.vz = 0;
          }
          c.nymph++;
          break;
        }
        case DUN: {
          // ride the surface while the wings dry; drift with a sliver of wind
          f.x += windV.x * 0.025 * dt;
          f.z += windV.z * 0.025 * dt;
          f.y = waterHeightAt(f.x, f.z, t) + 0.004;
          if (f.life <= 0) {
            f.stage = FLYING;
            f.life = p.flightSeconds * (0.6 + 0.8 * f.seed);
            f.vy = 0.7;
          }
          c.dun++;
          break;
        }
        case FLYING: {
          // climb to the band, then the dance: hover into the wind, bobbing
          const bandY = p.swarmHeight * (0.7 + 0.6 * f.seed);
          const bob = Math.sin(t * (2.2 + f.seed * 2.5) + f.seed * 50) * 2.2;
          f.vy += ((bandY - f.y) * 1.6 - f.vy * 1.1 + bob) * dt;
          // hold station against the drift: thrust upwind, plus swirl
          const ax = -windV.x * 0.4 - f.vx * 0.9 + Math.sin(t * 1.3 + f.seed * 60) * 0.8;
          const az = -windV.z * 0.4 - f.vz * 0.9 + Math.cos(t * 1.1 + f.seed * 60) * 0.8;
          f.vx += (ax + windV.x * 0.35) * dt;
          f.vz += (az + windV.z * 0.35) * dt;
          f.x += f.vx * dt;
          f.y += f.vy * dt;
          f.z += f.vz * dt;
          if (f.y < 0.15) f.y = 0.15;
          if (f.life <= 0) {
            f.stage = SPINNER;
            f.dips = 2 + ((f.seed * 3) | 0);
            f.life = 30;
          }
          c.flying++;
          break;
        }
        case SPINNER: {
          // descend, kiss the water (an egg-laying dip), bounce, repeat
          f.vy += (-1.6 - f.vy) * 2 * dt;
          f.x += f.vx * dt;
          f.y += f.vy * dt;
          f.z += f.vz * dt;
          const surf = waterHeightAt(f.x, f.z, t);
          if (f.y <= surf + 0.005) {
            f.dips--;
            if (this.dipBudget >= 1 && this.rand() < 0.4) {
              this.dipBudget -= 1;
              disturb({ kind: "rain", x: f.x, z: f.z, energy: 0.0008, radius: 0.03 });
            }
            if (f.dips <= 0 || f.life <= 0) {
              f.stage = SPENT;
              f.life = 14 + 10 * f.seed;
              f.vx = f.vy = f.vz = 0;
            } else {
              f.vy = 1.4 + f.seed; // bounce back up
            }
          }
          c.spinner++;
          break;
        }
        case SPENT: {
          // wings flat on the film, drifting — easy calories for anything
          f.x += windV.x * 0.02 * dt;
          f.z += windV.z * 0.02 * dt;
          f.y = waterHeightAt(f.x, f.z, t) + 0.002;
          if (f.life <= 0) {
            this.flies.splice(i, 1);
            continue;
          }
          c.spent++;
          break;
        }
      }
    }
  }
}
