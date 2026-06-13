// A self-flying dive for the in-article figures: hover, tuck, strike, plunge,
// grab, climb, repeat — forever, with nobody at the stick. The hero scenes fly
// the real PlayerBird; the figures need a loop that hits its marks every time so
// the reader can stare at one seam (the entry angle, the lead, the grab radius)
// without piloting. Kinematic on purpose. Fish Hawk's copy also reports the
// DiveEntry it just flew, so the dive-scoring figure can grade a scripted dive
// the same way it grades the player's.

import * as THREE from "three/webgpu";
import { disturb, waterHeightAt } from "../../lib/spine";
import { buildOsprey, type Osprey } from "../../lib/bird/build";
import { OspreyAnimator } from "../../lib/bird/animator";
import type { DiveEntry } from "../../lib/game";

export type ScriptedPhase = "hover" | "dive" | "plunge" | "climb" | "recover";

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export interface ScriptedDiverOptions {
  altitude?: number;
  target?: () => { x: number; z: number };
  maxDepth?: number;
  hoverSeconds?: number;
  /** Down-speed multiplier through the dive — the scoring figure tunes this. */
  diveVigor?: number;
  /** Attempted once per plunge frame; return true to mark the catch. */
  grab?: ((x: number, y: number, z: number) => boolean) | null;
}

export class ScriptedDiver {
  readonly osprey: Osprey;
  readonly anim: OspreyAnimator;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();

  phase: ScriptedPhase = "hover";
  phaseTime = 0;
  entrySpeed = 0;
  carried = false;
  altitude: number;
  diveVigor: number;

  /** The DiveEntry of the most recent surface entry (for scoring). */
  lastEntry: DiveEntry | null = null;

  private readonly targetFn: () => { x: number; z: number };
  private readonly maxDepth: number;
  private readonly hoverSeconds: number;
  private readonly grab: ((x: number, y: number, z: number) => boolean) | null;
  private yaw = 0;
  private pitch = 0;
  private aimAt = { x: 0, z: 0 };

  constructor(options: ScriptedDiverOptions = {}) {
    this.altitude = options.altitude ?? 8;
    this.targetFn = options.target ?? (() => ({ x: 0, z: 0 }));
    this.maxDepth = options.maxDepth ?? 2.2;
    this.hoverSeconds = options.hoverSeconds ?? 1.8;
    this.diveVigor = options.diveVigor ?? 1;
    this.grab = options.grab ?? null;

    this.osprey = buildOsprey();
    this.osprey.group.rotation.order = "YXZ";
    this.anim = new OspreyAnimator(this.osprey);
    this.reset();
  }

  reset(): void {
    const aim = this.targetFn();
    this.phase = "hover";
    this.phaseTime = 0;
    this.carried = false;
    this.entrySpeed = 0;
    this.pos.set(aim.x - 1.5, this.altitude, aim.z + 0.5);
    this.vel.set(0, 0, 0);
  }

  diveNow(): void {
    if (this.phase === "hover") this.setPhase("dive");
  }

  private setPhase(p: ScriptedPhase): void {
    this.phase = p;
    this.phaseTime = 0;
  }

  update(dt: number, t: number): void {
    const h = clamp(dt, 0, 0.05);
    this.phaseTime += h;
    const anim = this.anim;
    const aim = this.targetFn();
    const water = waterHeightAt(this.pos.x, this.pos.z, t);

    switch (this.phase) {
      case "hover": {
        anim.requestPose(null);
        anim.bank = 0;
        anim.gait01 += (0.05 - anim.gait01) * Math.min(1, h * 3);
        anim.flapRateHz = 4.6;
        this.vel.multiplyScalar(Math.exp(-2.4 * h));
        this.pos.x += (aim.x - this.pos.x) * Math.min(1, h * 1.5);
        this.pos.z += (aim.z - this.pos.z) * Math.min(1, h * 1.5);
        this.pos.y += (this.altitude - this.pos.y) * Math.min(1, h * 1.3);
        if (this.phaseTime > this.hoverSeconds) {
          this.aimAt = { x: aim.x, z: aim.z };
          this.setPhase("dive");
        }
        break;
      }
      case "dive": {
        anim.requestPose("tuck");
        this.vel.y = Math.max(this.vel.y - 14 * this.diveVigor * h, -16.5 * this.diveVigor);
        const tti = Math.max(0.15, (this.pos.y - water) / Math.max(2, -this.vel.y));
        this.vel.x += (((aim.x - this.pos.x) / (tti + 0.25)) * 1.6 - this.vel.x) * Math.min(1, h * 4);
        this.vel.z += (((aim.z - this.pos.z) / (tti + 0.25)) * 1.6 - this.vel.z) * Math.min(1, h * 4);
        if (this.pos.y - water < 1.4) anim.requestPose("strike");
        if (this.pos.y <= water + 0.02) {
          this.entrySpeed = this.vel.length();
          const hSpeed = Math.hypot(this.vel.x, this.vel.z);
          this.lastEntry = {
            speed: this.entrySpeed,
            angle: clamp(Math.atan2(-this.vel.y, Math.max(hSpeed, 1e-3)), 0, Math.PI / 2),
            miss: Math.hypot(this.pos.x - this.aimAt.x, this.pos.z - this.aimAt.z),
            depth: 0,
          };
          disturb({
            kind: "splash",
            x: this.pos.x,
            z: this.pos.z,
            energy: clamp((this.entrySpeed * this.entrySpeed) / 200, 0.35, 1.3),
            radius: 0.5,
            vx: this.vel.x,
            vz: this.vel.z,
          });
          this.setPhase("plunge");
        }
        break;
      }
      case "plunge": {
        anim.requestPose("strike");
        this.vel.multiplyScalar(Math.exp(-3.6 * h));
        this.vel.y += 5.2 * h;
        if (!this.carried && this.grab && this.phaseTime < 1.1) {
          this.carried = this.grab(this.pos.x, this.pos.y - 0.2, this.pos.z);
          if (this.carried && this.lastEntry) this.lastEntry.depth = Math.max(0, -(this.pos.y - 0.2));
        }
        if (this.pos.y < -this.maxDepth) {
          this.pos.y = -this.maxDepth;
          this.vel.y = Math.max(this.vel.y, 0);
        }
        if (this.pos.y > water + 0.1 && this.vel.y > 0) {
          disturb({
            kind: "splash",
            x: this.pos.x,
            z: this.pos.z,
            energy: 0.4,
            radius: 0.45,
            vx: this.vel.x,
            vz: this.vel.z,
          });
          this.setPhase("climb");
        }
        break;
      }
      case "climb": {
        anim.requestPose(null);
        anim.gait01 += (0.12 - anim.gait01) * Math.min(1, h * 2.5);
        anim.flapRateHz = 4.4;
        this.vel.y += (1.8 - this.vel.y) * Math.min(1, h * 1.8);
        const ex = this.pos.x - aim.x || 1;
        const ez = this.pos.z - aim.z;
        const el = Math.hypot(ex, ez) || 1;
        this.vel.x += ((ex / el) * 4.5 - this.vel.x) * Math.min(1, h * 1.2);
        this.vel.z += ((ez / el) * 4.5 - this.vel.z) * Math.min(1, h * 1.2);
        if (this.phaseTime > 2.6) this.setPhase("recover");
        break;
      }
      case "recover": {
        anim.requestPose(null);
        anim.gait01 += (0.6 - anim.gait01) * Math.min(1, h);
        anim.flapRateHz = 3.2;
        this.vel.y += ((this.altitude - this.pos.y) * 0.5 - this.vel.y) * Math.min(1, h * 1.2);
        if (this.phaseTime > 2.6) this.reset();
        break;
      }
    }

    this.pos.addScaledVector(this.vel, h);
    this.anim.update(h);

    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (hSpeed > 0.35) {
      const targetYaw = Math.atan2(this.vel.x, this.vel.z);
      const d = ((targetYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.yaw += d * Math.min(1, h * 4);
    }
    const targetPitch =
      this.phase === "hover" ? -0.25 : clamp(Math.atan2(-this.vel.y, Math.max(hSpeed, 0.8)), -1.5, 1.5);
    this.pitch += (targetPitch - this.pitch) * Math.min(1, h * 3.5);

    const g = this.osprey.group;
    g.position.copy(this.pos);
    g.rotation.y = this.yaw;
    g.rotation.x = this.pitch;
    g.rotation.z = 0;
  }

  dispose(): void {
    this.osprey.dispose();
  }
}
