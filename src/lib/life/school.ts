// Fish as underwater boids. Three steering rules (separation, alignment,
// cohesion) make the school; two terrain terms (a comfortable water-column
// depth read from the bathymetry, and a preferred swim depth below the
// surface) pin it to the lake; a rise behavior sends individual fish to the
// surface after floating food — and every completed rise goes out on the
// disturbance bus as a `rise` event, which is how the rest of the game
// learns where the fish are.
//
// The simulation is deliberately CPU-side and small (a few hundred fish):
// the game needs to query individual positions every frame (the hunt aims
// at one fish), so the state lives where the gameplay code lives.

import { Vector2, Vector3 } from "three";
import { terrainGrid } from "../terrain";
import { disturb } from "../spine";

/** What the school needs to know about the bottom — the TerrainGrid from
 *  the Basin satisfies this; demos may pass a flat tank instead. */
export interface BottomSampler {
  heightAt(x: number, z: number): number;
  gradientAt(x: number, z: number, target?: Vector2): Vector2;
}

export interface Fish {
  position: Vector3;
  velocity: Vector3;
  /** Body length, meters. */
  size: number;
  /** 0 = schooling, 1 = rising to the surface, 2 = recovering after a rise. */
  state: 0 | 1 | 2;
  /** Seconds left before this fish may rise again. */
  cooldown: number;
  /** Rise target on the surface (valid while state === 1). */
  targetX: number;
  targetZ: number;
  /** Stable per-fish random in [0, 1) — tint, phase, temperament. */
  seed: number;
}

export interface RiseEvent {
  x: number;
  z: number;
  /** Simulation time of the rise, seconds. */
  time: number;
  fish: number;
}

export interface SchoolParams {
  count: number;
  /** Home range: fish drift back toward this disc. */
  homeX: number;
  homeZ: number;
  homeRadius: number;
  homeWeight: number;

  // -- the three boids rules ------------------------------------------------
  separationRadius: number;
  alignmentRadius: number;
  cohesionRadius: number;
  separationWeight: number;
  alignmentWeight: number;
  cohesionWeight: number;

  // -- speeds and turning ----------------------------------------------------
  cruiseSpeed: number;
  maxSpeed: number;
  /** Steering acceleration cap, m/s². */
  maxForce: number;

  // -- terrain terms -----------------------------------------------------------
  /** Comfortable water-column depth band, meters of water under the surface. */
  minColumnDepth: number;
  maxColumnDepth: number;
  /** How hard fish steer along the depth gradient back into the band. */
  depthWeight: number;
  /** Preferred swim height (world y, negative = below surface). */
  swimDepth: number;
  /** Keep-out margins against the surface and the bed, meters. */
  surfaceMargin: number;
  bedMargin: number;

  // -- rising -------------------------------------------------------------------
  /** Rise probability per fish per second at hunger = 1 (before gating). */
  riseRate: number;
  /** Fish must be above this y to consider rising. */
  riseDepthLimit: number;

  seed: number;
}

export const DEFAULT_SCHOOL: SchoolParams = {
  count: 200,
  homeX: 60,
  homeZ: 300,
  homeRadius: 55,
  homeWeight: 0.35,

  separationRadius: 0.7,
  alignmentRadius: 2.4,
  cohesionRadius: 3.6,
  separationWeight: 1.6,
  alignmentWeight: 1.0,
  cohesionWeight: 0.7,

  cruiseSpeed: 0.85,
  maxSpeed: 2.6,
  maxForce: 2.2,

  minColumnDepth: 2.0,
  maxColumnDepth: 10.0,
  depthWeight: 0.8,
  swimDepth: -1.6,
  surfaceMargin: 0.25,
  bedMargin: 0.4,

  riseRate: 0.02,
  riseDepthLimit: -3.5,

  seed: 1849,
};

/** Surface food the school can rise to (duns and spinners from the hatch). */
export interface FoodTarget {
  x: number;
  z: number;
}

export interface SchoolUpdateOptions {
  /** 0 = no rising, 1 = full dusk feeding frenzy. */
  hunger?: number;
  /** Floating food positions; rises aim at the nearest one in range. */
  food?: readonly FoodTarget[];
  /** Called when a rise consumed food target `i` (index into `food`). */
  onEat?: (i: number) => void;
}

// Small deterministic RNG so the same seed grows the same school.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const steer = new Vector3();
const away = new Vector3();
const avgVel = new Vector3();
const center = new Vector3();
const accel = new Vector3();
const grad = new Vector2();

export class FishSchool {
  readonly params: SchoolParams;
  readonly fish: Fish[] = [];
  /** Recent rises, pruned past 30 s — the hunt reads these. */
  readonly rises: RiseEvent[] = [];

  private readonly grid: BottomSampler;
  private readonly rand: () => number;

  constructor(params: Partial<SchoolParams> = {}, grid: BottomSampler = terrainGrid()) {
    this.params = { ...DEFAULT_SCHOOL, ...params };
    this.grid = grid;
    this.rand = mulberry32(this.params.seed);

    const p = this.params;
    for (let i = 0; i < p.count; i++) {
      // Spawn inside the home disc, only where the water is deep enough.
      let x = p.homeX;
      let z = p.homeZ;
      for (let tries = 0; tries < 20; tries++) {
        const a = this.rand() * Math.PI * 2;
        const r = Math.sqrt(this.rand()) * p.homeRadius;
        x = p.homeX + Math.cos(a) * r;
        z = p.homeZ + Math.sin(a) * r;
        if (-this.grid.heightAt(x, z) > p.minColumnDepth * 0.8) break;
      }
      const bottom = this.grid.heightAt(x, z);
      const y = Math.max(bottom + p.bedMargin, p.swimDepth) + (this.rand() - 0.5) * 0.8;
      const heading = this.rand() * Math.PI * 2;
      this.fish.push({
        position: new Vector3(x, Math.min(y, -p.surfaceMargin), z),
        velocity: new Vector3(Math.cos(heading), 0, Math.sin(heading)).multiplyScalar(p.cruiseSpeed),
        size: 0.28 + 0.18 * this.rand(),
        state: 0,
        cooldown: this.rand() * 10,
        targetX: 0,
        targetZ: 0,
        seed: this.rand(),
      });
    }
  }

  update(dt: number, t: number, opts: SchoolUpdateOptions = {}): void {
    const p = this.params;
    const fish = this.fish;
    const n = fish.length;
    const hunger = opts.hunger ?? 0;
    const food = opts.food;

    const sepR2 = p.separationRadius * p.separationRadius;
    const aliR2 = p.alignmentRadius * p.alignmentRadius;
    const cohR2 = p.cohesionRadius * p.cohesionRadius;

    for (let i = 0; i < n; i++) {
      const f = fish[i];
      const pos = f.position;
      const vel = f.velocity;
      accel.set(0, 0, 0);

      if (f.state === 1) {
        // -- rising: ignore the school, drive at the surface target ------------
        steer.set(f.targetX - pos.x, -pos.y * 1.5 + 0.4, f.targetZ - pos.z);
        steer.normalize().multiplyScalar(p.maxSpeed * 1.1).sub(vel).clampLength(0, p.maxForce * 3);
        accel.add(steer);
        if (pos.y > -0.07) this.completeRise(i, f, t, opts);
      } else {
        // -- the three rules, one O(n) pass per fish ----------------------------
        away.set(0, 0, 0);
        avgVel.set(0, 0, 0);
        center.set(0, 0, 0);
        let nSep = 0;
        let nAli = 0;
        let nCoh = 0;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const o = fish[j];
          const dx = pos.x - o.position.x;
          const dy = pos.y - o.position.y;
          const dz = pos.z - o.position.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < sepR2 && d2 > 1e-9) {
            // push grows as 1/d — nearest neighbors dominate
            const inv = 1 / d2;
            away.x += dx * inv;
            away.y += dy * inv;
            away.z += dz * inv;
            nSep++;
          }
          if (d2 < aliR2) {
            avgVel.add(o.velocity);
            nAli++;
          }
          if (d2 < cohR2) {
            center.add(o.position);
            nCoh++;
          }
        }
        if (nSep > 0) {
          steer.copy(away).normalize().multiplyScalar(p.maxSpeed).sub(vel).clampLength(0, p.maxForce);
          accel.addScaledVector(steer, p.separationWeight);
        }
        if (nAli > 0) {
          avgVel.multiplyScalar(1 / nAli);
          steer.copy(avgVel).normalize().multiplyScalar(p.maxSpeed).sub(vel).clampLength(0, p.maxForce);
          accel.addScaledVector(steer, p.alignmentWeight);
        }
        if (nCoh > 0) {
          center.multiplyScalar(1 / nCoh).sub(pos);
          steer.copy(center).normalize().multiplyScalar(p.maxSpeed).sub(vel).clampLength(0, p.maxForce);
          accel.addScaledVector(steer, p.cohesionWeight);
        }

        // -- home range: a soft tether, quadratic past the edge ------------------
        const hx = p.homeX - pos.x;
        const hz = p.homeZ - pos.z;
        const hd = Math.hypot(hx, hz);
        if (hd > p.homeRadius) {
          const over = (hd - p.homeRadius) / p.homeRadius;
          accel.x += (hx / hd) * p.homeWeight * over * p.maxForce;
          accel.z += (hz / hd) * p.homeWeight * over * p.maxForce;
        }

        // -- bathymetry: steer along the depth gradient into the comfort band ---
        const bottom = this.grid.heightAt(pos.x, pos.z);
        const column = -bottom;
        if (column < p.minColumnDepth || column > p.maxColumnDepth) {
          const g = this.grid.gradientAt(pos.x, pos.z, grad);
          const gl = Math.hypot(g.x, g.y);
          if (gl > 1e-5) {
            // gradient points uphill (toward shore); deeper water is -gradient
            const sign = column < p.minColumnDepth ? -1 : 1;
            const urge = column < p.minColumnDepth
              ? (p.minColumnDepth - column) / p.minColumnDepth
              : Math.min(1, (column - p.maxColumnDepth) / p.maxColumnDepth);
            accel.x += (sign * g.x / gl) * p.depthWeight * urge * p.maxForce;
            accel.z += (sign * g.y / gl) * p.depthWeight * urge * p.maxForce;
          }
        }

        // -- vertical: settle toward the preferred swim depth ---------------------
        let targetY = Math.max(bottom + p.bedMargin, p.swimDepth);
        targetY = Math.min(targetY, -p.surfaceMargin);
        if (f.state === 2) {
          // recovering: dive back below the cruise band
          targetY = Math.max(bottom + p.bedMargin, p.swimDepth - 0.8);
          f.cooldown -= dt;
          if (f.cooldown < 0) {
            f.state = 0;
            f.cooldown = 8 + 16 * f.seed;
          }
        }
        accel.y += (targetY - pos.y) * 1.4 - vel.y * 1.2;

        // -- maybe rise ------------------------------------------------------------
        if (
          f.state === 0 &&
          hunger > 0 &&
          pos.y > p.riseDepthLimit &&
          f.cooldown <= 0 &&
          Math.random() < hunger * p.riseRate * dt
        ) {
          this.beginRise(f, food);
        }
        if (f.state === 0 && f.cooldown > 0) f.cooldown -= dt;
      }

      // -- integrate ----------------------------------------------------------------
      vel.addScaledVector(accel, dt);

      // hold cruise speed: rescale gently toward cruiseSpeed, hard-cap at max
      const speed = vel.length();
      if (speed > 1e-6) {
        const target = f.state === 1 ? p.maxSpeed : p.cruiseSpeed * (0.85 + 0.3 * f.seed);
        const blended = speed + (target - speed) * Math.min(1, dt * 1.5);
        vel.multiplyScalar(Math.min(blended, p.maxSpeed) / speed);
      }

      pos.addScaledVector(vel, dt);

      // hard floors and ceilings (a fish is never in the rock, never in the air)
      const bedHere = this.grid.heightAt(pos.x, pos.z) + p.bedMargin * 0.5;
      if (pos.y < bedHere) {
        pos.y = bedHere;
        if (vel.y < 0) vel.y *= -0.4;
      }
      const ceil = f.state === 1 ? 0.0 : -p.surfaceMargin * 0.6;
      if (pos.y > ceil) {
        pos.y = ceil;
        if (vel.y > 0 && f.state !== 1) vel.y = 0;
      }
    }

    // prune old rises
    while (this.rises.length > 0 && t - this.rises[0].time > 30) this.rises.shift();
  }

  private beginRise(f: Fish, food?: readonly FoodTarget[]): void {
    // aim at the nearest floating food within reach, or just ahead of us
    let bestI = -1;
    let bestD2 = 36; // 6 m reach
    if (food) {
      for (let k = 0; k < food.length; k++) {
        const dx = food[k].x - f.position.x;
        const dz = food[k].z - f.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestI = k;
        }
      }
    }
    if (bestI >= 0 && food) {
      f.targetX = food[bestI].x;
      f.targetZ = food[bestI].z;
    } else if (food && food.length > 0) {
      return; // food exists but none in reach — stay down
    } else {
      const v = f.velocity;
      const s = Math.max(0.2, Math.hypot(v.x, v.z));
      f.targetX = f.position.x + (v.x / s) * 1.5;
      f.targetZ = f.position.z + (v.z / s) * 1.5;
    }
    f.state = 1;
  }

  private completeRise(i: number, f: Fish, t: number, opts: SchoolUpdateOptions): void {
    // THE contract: every rise goes out on the disturbance bus. Ripple rings,
    // the splash synth, and the hunt's telegraphing all hang off this call.
    disturb({
      kind: "rise",
      x: f.position.x,
      z: f.position.z,
      energy: 0.04 + 0.04 * f.size,
      radius: 0.12 + 0.3 * f.size,
    });
    this.rises.push({ x: f.position.x, z: f.position.z, time: t, fish: i });

    if (opts.food && opts.onEat) {
      // eat the nearest surface fly within a body length
      let bestI = -1;
      let bestD2 = f.size * f.size;
      for (let k = 0; k < opts.food.length; k++) {
        const dx = opts.food[k].x - f.position.x;
        const dz = opts.food[k].z - f.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestI = k;
        }
      }
      if (bestI >= 0) opts.onEat(bestI);
    }

    f.state = 2;
    f.cooldown = 1.2 + 1.5 * f.seed;
    f.velocity.y = -0.8;
  }
}
