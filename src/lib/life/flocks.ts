// Flight controllers for the other wings. Three very different animals:
//
//   SwallowFlock — a state machine per bird (wander → dive → skim → climb);
//                  the skim leg writes `skim` events onto the disturbance
//                  bus, so each pass draws a dotted line of rings on the lake.
//   GooseSkein   — a V that EMERGES: every goose chases the patch of upwash
//                  just outboard of its predecessor's wingtip vortex. The
//                  geometry of that patch (≈ πb/8 outboard of the centerline,
//                  plus half a span) is derived in the post.
//   EaglePatrol  — a thermal soarer: circle and climb, glide to the next
//                  rising air, repeat. The game's future fish-thief; the
//                  hunt will read `position` to know when to look up.

import { Vector3 } from "three";
import { disturb, waterHeightAt, wind } from "../spine";

const TAU = Math.PI * 2;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- swallows -------------------------------------------------------------------------

export const SWALLOW_WANDER = 0;
export const SWALLOW_DIVE = 1;
export const SWALLOW_SKIM = 2;
export const SWALLOW_CLIMB = 3;

export interface Swallow {
  position: Vector3;
  velocity: Vector3;
  /** Roll angle for the instance transform, radians. */
  bank: number;
  state: number;
  /** Seconds left in the current state (wander) or meters left (skim). */
  budget: number;
  /** Entry point + direction of the current skim run. */
  runX: number;
  runZ: number;
  runDirX: number;
  runDirZ: number;
  /** Meters since the last skim event. */
  sinceTouch: number;
  seed: number;
}

export interface SwallowFlockParams {
  count: number;
  centerX: number;
  centerZ: number;
  /** Hunting area radius over the water. */
  radius: number;
  cruiseSpeed: number;
  skimSpeed: number;
  /** Height of the wander band above the water. */
  loftLow: number;
  loftHigh: number;
  /** Clearance held above the moving surface during a skim. */
  skimHeight: number;
  /** Meters of travel between skim disturbances (the dotted line's pitch). */
  touchSpacing: number;
  /** 0..1 — how eager birds are to start a run (dusk cranks this up). */
  activity: number;
  seed: number;
}

export const DEFAULT_SWALLOWS: SwallowFlockParams = {
  count: 16,
  centerX: 60,
  centerZ: 300,
  radius: 55,
  cruiseSpeed: 7,
  skimSpeed: 8.5,
  loftLow: 3,
  loftHigh: 10,
  skimHeight: 0.07,
  touchSpacing: 1.7,
  activity: 0.6,
  seed: 533,
};

const _steer = new Vector3();

export class SwallowFlock {
  readonly params: SwallowFlockParams;
  readonly birds: Swallow[] = [];
  private readonly rand: () => number;

  constructor(params: Partial<SwallowFlockParams> = {}) {
    this.params = { ...DEFAULT_SWALLOWS, ...params };
    const p = this.params;
    this.rand = mulberry32(p.seed);
    for (let i = 0; i < p.count; i++) {
      const a = this.rand() * TAU;
      const r = Math.sqrt(this.rand()) * p.radius;
      const heading = this.rand() * TAU;
      this.birds.push({
        position: new Vector3(
          p.centerX + Math.cos(a) * r,
          p.loftLow + this.rand() * (p.loftHigh - p.loftLow),
          p.centerZ + Math.sin(a) * r,
        ),
        velocity: new Vector3(Math.cos(heading), 0, Math.sin(heading)).multiplyScalar(p.cruiseSpeed),
        bank: 0,
        state: SWALLOW_WANDER,
        budget: 1 + this.rand() * 4,
        runX: 0,
        runZ: 0,
        runDirX: 1,
        runDirZ: 0,
        sinceTouch: 0,
        seed: this.rand(),
      });
    }
  }

  update(dt: number, t: number): void {
    const p = this.params;
    for (const b of this.birds) {
      const pos = b.position;
      const vel = b.velocity;
      _steer.set(0, 0, 0);

      switch (b.state) {
        case SWALLOW_WANDER: {
          // banked meander inside the hunting disc, hawking for fliers
          const wob = Math.sin(t * (0.8 + b.seed) + b.seed * 40);
          const side = new Vector3(-vel.z, 0, vel.x).normalize();
          _steer.addScaledVector(side, wob * 6);
          // height hold inside the band
          const targetY = p.loftLow + (p.loftHigh - p.loftLow) * (0.3 + 0.7 * b.seed);
          _steer.y += (targetY - pos.y) * 2 - vel.y * 1.5;
          // soft tether to the hunting area
          const hx = p.centerX - pos.x;
          const hz = p.centerZ - pos.z;
          const hd = Math.hypot(hx, hz);
          if (hd > p.radius) {
            _steer.x += (hx / hd) * 8;
            _steer.z += (hz / hd) * 8;
          }
          b.budget -= dt;
          if (b.budget <= 0) {
            if (this.rand() < p.activity) {
              // pick a skim line through the area
              const a = this.rand() * TAU;
              const r = Math.sqrt(this.rand()) * p.radius * 0.6;
              b.runX = p.centerX + Math.cos(a) * r;
              b.runZ = p.centerZ + Math.sin(a) * r;
              const dir = this.rand() * TAU;
              b.runDirX = Math.cos(dir);
              b.runDirZ = Math.sin(dir);
              b.state = SWALLOW_DIVE;
            } else {
              b.budget = 1 + this.rand() * 3;
            }
          }
          break;
        }
        case SWALLOW_DIVE: {
          // drive at the run entry point, low
          const dx = b.runX - pos.x;
          const dz = b.runZ - pos.z;
          const d = Math.hypot(dx, dz);
          _steer.x += (dx / Math.max(d, 1e-4)) * 10;
          _steer.z += (dz / Math.max(d, 1e-4)) * 10;
          const targetY = Math.max(p.skimHeight + 0.1, pos.y - d * 0.25);
          _steer.y += (targetY - pos.y) * 3 - vel.y * 2;
          if (d < 2.5 && pos.y < 1.2) {
            b.state = SWALLOW_SKIM;
            b.budget = 10 + this.rand() * 16; // meters of run
            b.sinceTouch = 0;
          }
          break;
        }
        case SWALLOW_SKIM: {
          // hold the line, hold the clearance over the LIVE surface
          _steer.x += (b.runDirX * p.skimSpeed - vel.x) * 4;
          _steer.z += (b.runDirZ * p.skimSpeed - vel.z) * 4;
          const surf = waterHeightAt(pos.x, pos.z, t);
          _steer.y += (surf + p.skimHeight - pos.y) * 30 - vel.y * 9;
          const travel = Math.hypot(vel.x, vel.z) * dt;
          b.budget -= travel;
          b.sinceTouch += travel;
          if (b.sinceTouch > p.touchSpacing) {
            b.sinceTouch = 0;
            // the wingtip kiss — a tiny event, but the bus makes it visible
            disturb({
              kind: "skim",
              x: pos.x,
              z: pos.z,
              energy: 0.006,
              radius: 0.05,
              vx: vel.x,
              vz: vel.z,
            });
          }
          if (b.budget <= 0) b.state = SWALLOW_CLIMB;
          break;
        }
        case SWALLOW_CLIMB: {
          _steer.y += 14 - vel.y * 2;
          if (pos.y > p.loftLow) {
            b.state = SWALLOW_WANDER;
            b.budget = 2 + this.rand() * 5;
          }
          break;
        }
      }

      vel.addScaledVector(_steer, dt);
      // speed envelope
      const speed = vel.length();
      const target = b.state === SWALLOW_SKIM ? p.skimSpeed : p.cruiseSpeed;
      if (speed > 1e-5) vel.multiplyScalar((speed + (target - speed) * Math.min(1, dt * 2)) / speed);
      pos.addScaledVector(vel, dt);
      if (pos.y < 0.04) pos.y = 0.04;

      // bank from lateral steering (visual only)
      const lat = (_steer.x * -vel.z + _steer.z * vel.x) / Math.max(speed, 1e-4);
      b.bank += (Math.max(-0.9, Math.min(0.9, lat / 9.8)) - b.bank) * Math.min(1, dt * 5);
    }
  }
}

// ---- geese ------------------------------------------------------------------------------

export interface Goose {
  position: Vector3;
  velocity: Vector3;
  bank: number;
}

export interface SkeinParams {
  count: number;
  /** Wingspan b, meters — the V's geometry derives from this. */
  span: number;
  /** Streamwise gap behind the bird ahead, meters. */
  backStep: number;
  /** Extra clearance outboard of the ideal upwash line, meters. */
  sideSlack: number;
  speed: number;
  altitude: number;
  /** Transit path: across a disc of this radius around the center. */
  centerX: number;
  centerZ: number;
  range: number;
  /** false = no vortex seeking: everyone just follows the leader (the demo's
   *  control case — a clump, not a V). */
  seekUpwash: boolean;
  seed: number;
}

export const DEFAULT_SKEIN: SkeinParams = {
  count: 9,
  span: 1.5,
  backStep: 2.6,
  sideSlack: 0.15,
  speed: 13,
  altitude: 38,
  centerX: 0,
  centerZ: 120,
  range: 420,
  seekUpwash: true,
  seed: 211,
};

/**
 * The slot a follower wants, in the predecessor's frame: directly behind by
 * `backStep`, and outboard by πb/8 (the vortex core) + b/2 (your own half
 * span) + slack — so your inner wingtip flies in his upwash.
 */
export function upwashOffset(p: SkeinParams): number {
  return (Math.PI / 8) * p.span + p.span / 2 + p.sideSlack;
}

export class GooseSkein {
  readonly params: SkeinParams;
  readonly geese: Goose[] = [];
  /** Each follower's side of the V: +1 right leg, −1 left leg. */
  readonly sides: number[] = [];
  private readonly rand: () => number;
  private heading = 0;

  constructor(params: Partial<SkeinParams> = {}) {
    this.params = { ...DEFAULT_SKEIN, ...params };
    this.rand = mulberry32(this.params.seed);
    for (let i = 0; i < this.params.count; i++) {
      this.geese.push({ position: new Vector3(), velocity: new Vector3(), bank: 0 });
      this.sides.push(i === 0 ? 0 : i % 2 === 1 ? 1 : -1);
    }
    this.newTransit(true);
  }

  /** Start a fresh crossing: new heading, everyone near formation. */
  newTransit(scatter = false): void {
    const p = this.params;
    this.heading = this.rand() * TAU;
    const dirX = Math.cos(this.heading);
    const dirZ = Math.sin(this.heading);
    const startX = p.centerX - dirX * p.range;
    const startZ = p.centerZ - dirZ * p.range;
    const off = upwashOffset(p);
    for (let i = 0; i < this.geese.length; i++) {
      const g = this.geese[i];
      const leg = Math.ceil(i / 2); // position along the V's arm
      const side = this.sides[i];
      const back = leg * p.backStep;
      const lateral = leg * off * side;
      g.position.set(
        startX - dirX * back - dirZ * lateral + (scatter ? (this.rand() - 0.5) * 6 : 0),
        p.altitude + (scatter ? (this.rand() - 0.5) * 3 : leg * 0.15),
        startZ - dirZ * back + dirX * lateral + (scatter ? (this.rand() - 0.5) * 6 : 0),
      );
      g.velocity.set(dirX * p.speed, 0, dirZ * p.speed);
      g.bank = 0;
    }
  }

  /** Distance the leader still has to fly before this transit ends. */
  remaining(): number {
    const p = this.params;
    const g = this.geese[0];
    const dirX = Math.cos(this.heading);
    const dirZ = Math.sin(this.heading);
    const along = (g.position.x - p.centerX) * dirX + (g.position.z - p.centerZ) * dirZ;
    return p.range - along;
  }

  update(dt: number, t: number): void {
    const p = this.params;
    const off = p.seekUpwash ? upwashOffset(p) : 0.4; // no seeking → tuck in behind
    const dirX = Math.cos(this.heading);
    const dirZ = Math.sin(this.heading);

    // leader: straight transit with a slow breathing of altitude
    const lead = this.geese[0];
    lead.velocity.set(dirX * p.speed, Math.sin(t * 0.4) * 0.2, dirZ * p.speed);
    lead.position.addScaledVector(lead.velocity, dt);
    lead.position.y += (p.altitude - lead.position.y) * dt * 0.3;

    for (let i = 1; i < this.geese.length; i++) {
      const g = this.geese[i];
      // follow your same-side predecessor (the bird whose vortex you ride)
      const aheadIndex = i <= 2 ? 0 : i - 2;
      const ahead = this.geese[aheadIndex];
      const side = this.sides[i];
      // slot in the predecessor's frame: one backStep behind, one upwash
      // offset outboard on your side of the V
      const ax = ahead.velocity.x;
      const az = ahead.velocity.z;
      const as = Math.max(1e-4, Math.hypot(ax, az));
      const fx = ax / as;
      const fz = az / as;
      const slotX = ahead.position.x - fx * p.backStep - fz * off * side;
      const slotZ = ahead.position.z - fz * p.backStep + fx * off * side;
      const slotY = ahead.position.y + 0.15; // ride slightly high in the upwash

      // critically-damped chase with the predecessor's velocity feed-forward
      const kp = 2.2;
      const kd = 2.0 * Math.sqrt(kp);
      const axx = kp * (slotX - g.position.x) + kd * (ahead.velocity.x - g.velocity.x);
      const ayy = kp * 2 * (slotY - g.position.y) + kd * (ahead.velocity.y - g.velocity.y);
      const azz = kp * (slotZ - g.position.z) + kd * (ahead.velocity.z - g.velocity.z);
      g.velocity.x += axx * dt;
      g.velocity.y += ayy * dt;
      g.velocity.z += azz * dt;
      g.position.addScaledVector(g.velocity, dt);

      const lat = (axx * -g.velocity.z + azz * g.velocity.x) / Math.max(g.velocity.length(), 1e-4);
      g.bank += (Math.max(-0.5, Math.min(0.5, lat / 9.8)) - g.bank) * Math.min(1, dt * 3);
    }

    if (this.remaining() <= 0) this.newTransit();
  }
}

// ---- the eagle --------------------------------------------------------------------------

export const EAGLE_CIRCLE = 0;
export const EAGLE_GLIDE = 1;

export interface EagleParams {
  /** Patrol territory. */
  centerX: number;
  centerZ: number;
  territory: number;
  circleRadius: number;
  speed: number;
  /** Working altitude band. */
  low: number;
  high: number;
  /** Climb rate while circling (thermal lift), m/s. */
  climb: number;
  /** Glide slope: meters lost per meter traveled. */
  sink: number;
  seed: number;
}

export const DEFAULT_EAGLE: EagleParams = {
  centerX: -40,
  centerZ: 60,
  territory: 260,
  circleRadius: 42,
  speed: 11,
  low: 45,
  high: 110,
  climb: 0.7,
  sink: 0.07,
  seed: 89,
};

export class EaglePatrol {
  readonly params: EagleParams;
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  bank = 0;
  state: number = EAGLE_CIRCLE;

  private readonly rand: () => number;
  private thermalX: number;
  private thermalZ: number;
  private phase: number;
  private targetX = 0;
  private targetZ = 0;

  constructor(params: Partial<EagleParams> = {}) {
    this.params = { ...DEFAULT_EAGLE, ...params };
    const p = this.params;
    this.rand = mulberry32(p.seed);
    this.thermalX = p.centerX;
    this.thermalZ = p.centerZ;
    this.phase = this.rand() * TAU;
    this.position.set(
      this.thermalX + Math.cos(this.phase) * p.circleRadius,
      (p.low + p.high) / 2,
      this.thermalZ + Math.sin(this.phase) * p.circleRadius,
    );
  }

  update(dt: number, t: number): void {
    const p = this.params;
    if (this.state === EAGLE_CIRCLE) {
      // carve the circle; the wind drifts the whole gyre downwind a little
      const w = wind.sample(this.thermalX, this.position.y, this.thermalZ, t);
      this.thermalX += w.x * 0.12 * dt;
      this.thermalZ += w.z * 0.12 * dt;
      const omega = p.speed / p.circleRadius;
      this.phase += omega * dt;
      const px = this.thermalX + Math.cos(this.phase) * p.circleRadius;
      const pz = this.thermalZ + Math.sin(this.phase) * p.circleRadius;
      // analytic tangent: d/dt of the circle, plus the thermal climb
      this.velocity.set(-Math.sin(this.phase) * p.speed, p.climb, Math.cos(this.phase) * p.speed);
      this.position.set(px, Math.min(p.high, this.position.y + p.climb * dt), pz);
      // steady-state bank for a coordinated turn: tan φ = v² / (g·r)
      const target = Math.atan((p.speed * p.speed) / (9.81 * p.circleRadius));
      this.bank += (target - this.bank) * Math.min(1, dt * 2);
      if (this.position.y >= p.high - 0.5) {
        // topped out: pick the next thermal and go
        const a = this.rand() * TAU;
        const r = (0.3 + 0.7 * this.rand()) * p.territory;
        this.targetX = p.centerX + Math.cos(a) * r;
        this.targetZ = p.centerZ + Math.sin(a) * r;
        this.state = EAGLE_GLIDE;
      }
    } else {
      // straight glide to the next thermal, trading height for distance
      const dx = this.targetX - this.position.x;
      const dz = this.targetZ - this.position.z;
      const d = Math.hypot(dx, dz);
      const gs = p.speed * 1.35; // glides are faster than circles
      this.velocity.set((dx / Math.max(d, 1e-4)) * gs, -p.sink * gs, (dz / Math.max(d, 1e-4)) * gs);
      this.position.addScaledVector(this.velocity, dt);
      this.bank += (0 - this.bank) * Math.min(1, dt * 2);
      if (d < 8 || this.position.y < p.low) {
        this.thermalX = this.position.x;
        this.thermalZ = this.position.z;
        this.phase = this.rand() * TAU;
        this.state = EAGLE_CIRCLE;
      }
    }
  }
}
