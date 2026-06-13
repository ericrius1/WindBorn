// A self-flying dive for the in-article figures: hover, tuck, strike,
// plunge, grab, climb, repeat — forever, with nobody at the stick. The hero
// scenes fly the real PlayerBird; the figures need a loop that hits its
// marks every time so the reader can stare at one seam (the moving sim
// window, the grab radius) without piloting. Kinematic on purpose: the
// physics-honest version of every phase lives in the flight model and in
// PlayerBird's plunge; this is the camera-ready re-run.

import * as THREE from "three/webgpu";
import { disturb, waterHeightAt } from "../../lib/spine";
import { buildOsprey, type Osprey } from "../../lib/bird/build";
import { OspreyAnimator } from "../../lib/bird/animator";

export type ScriptedPhase = "hover" | "dive" | "plunge" | "climb" | "recover";

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export interface ScriptedDiverOptions {
  /** Hover altitude before the tuck, meters. */
  altitude?: number;
  /** Where to strike: a live target (a cruising fish) or a fixed point. */
  target?: () => { x: number; z: number };
  /** Deepest the plunge may carry, meters below the surface. */
  maxDepth?: number;
  /** Seconds of hover before each dive. */
  hoverSeconds?: number;
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

  private readonly targetFn: () => { x: number; z: number };
  private readonly maxDepth: number;
  private readonly hoverSeconds: number;
  private readonly grab: ((x: number, y: number, z: number) => boolean) | null;
  private yaw = 0;
  private pitch = 0;

  constructor(options: ScriptedDiverOptions = {}) {
    this.altitude = options.altitude ?? 8;
    this.targetFn = options.target ?? (() => ({ x: 0, z: 0 }));
    this.maxDepth = options.maxDepth ?? 2.2;
    this.hoverSeconds = options.hoverSeconds ?? 1.8;
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
        // Station-keeping over the target on near-vertical hover strokes.
        anim.requestPose(null);
        anim.bank = 0;
        anim.gait01 += (0.05 - anim.gait01) * Math.min(1, h * 3);
        anim.flapRateHz = 4.6;
        this.vel.multiplyScalar(Math.exp(-2.4 * h));
        this.pos.x += (aim.x - this.pos.x) * Math.min(1, h * 1.5);
        this.pos.z += (aim.z - this.pos.z) * Math.min(1, h * 1.5);
        this.pos.y += (this.altitude - this.pos.y) * Math.min(1, h * 1.3);
        if (this.phaseTime > this.hoverSeconds) this.setPhase("dive");
        break;
      }
      case "dive": {
        // Gravity plus the tuck; horizontal velocity chases the lead.
        anim.requestPose("tuck");
        this.vel.y = Math.max(this.vel.y - 14 * h, -16.5);
        const tti = Math.max(0.15, (this.pos.y - water) / Math.max(2, -this.vel.y));
        this.vel.x += (((aim.x - this.pos.x) / (tti + 0.25)) * 1.6 - this.vel.x) * Math.min(1, h * 4);
        this.vel.z += (((aim.z - this.pos.z) / (tti + 0.25)) * 1.6 - this.vel.z) * Math.min(1, h * 4);
        if (this.pos.y - water < 1.4) anim.requestPose("strike");
        if (this.pos.y <= water + 0.02) {
          this.entrySpeed = this.vel.length();
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
        // Drag scrubs the entry in a quarter second; buoyancy turns it.
        anim.requestPose("strike");
        this.vel.multiplyScalar(Math.exp(-3.6 * h));
        this.vel.y += 5.2 * h;
        if (!this.carried && this.grab && this.phaseTime < 1.1) {
          this.carried = this.grab(this.pos.x, this.pos.y - 0.2, this.pos.z);
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
        // Hauling out and away from the strike point.
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

    // Face the velocity; pitch follows the flight path, no roll.
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
