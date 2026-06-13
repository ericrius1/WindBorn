// The playable bird, Fish Hawk's own copy. The Lift point mass supplies the
// physics, the New Feathers osprey supplies the body, and the spine's
// water/wind/bus glue both to the lake. A small ownership state machine decides,
// each frame, which law of nature is flying the bird: air (the flight model),
// float (buoyancy), run (the takeoff script), plunge (water drag + the strike).
//
// The game extends the milestone bridge with the two hooks the dive needs:
// every entry captures a DiveEntry (angle, speed, miss against the aimed fish)
// so dive.ts can score it, and a carried fish applies carryEffect() to the air
// step so a heavy catch genuinely changes the flight home. Whoever owns the
// frame, the same FlightBody stores pose, the same animator poses the mesh, the
// same wingbeat clock drives the wings, and publishFlightState keeps the
// telemetry contract flowing for the camera, the audio, and the journal.

import * as THREE from "three/webgpu";
import { disturb, waterHeightAt, waterNormalAt, wind } from "../../lib/spine";
import { terrainHeightAt } from "../../lib/terrain";
import { buildOsprey, type Osprey } from "../../lib/bird/build";
import { OspreyAnimator } from "../../lib/bird/animator";
import {
  ALPHA_TRIM,
  FlightBody,
  clamp,
  clamp01,
  publishFlightState,
  type FlightCommands,
} from "../../lib/flight";
import { carryEffect, type CarriedFish, type DiveEntry } from "../../lib/game";

export type BirdState = "air" | "float" | "run" | "plunge";

const ZERO = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Q_IDENTITY = new THREE.Quaternion();

const BODY_CENTER = 0.3;

export class PlayerBird {
  readonly body = new FlightBody();
  readonly osprey: Osprey;
  readonly anim: OspreyAnimator;
  readonly group = new THREE.Group();

  state: BirdState = "air";
  heading = 0;

  landSpeed = 3.0;
  buoyancyStiffness = 22;
  buoyancyDamping = 7.5;
  floatDepth = 0.12;

  diveEntrySpeed = 5.5;
  maxPlungeDepth = 2.4;
  grabRadius = 0.6;
  entrySpeed = 0;
  wet = 0;

  /** The fish in the talons, or null. Set by tryGrab's success; carry it home. */
  carried: CarriedFish | null = null;
  /** The scored entry of the last plunge — angle, speed, miss against the aim. */
  lastEntry: DiveEntry | null = null;
  /** Where the dive is aiming this frame; the entry's miss is measured to it. */
  aim: { x: number; z: number } | null = null;

  /** The grab hook: called during the plunge window with talon pos + reach. */
  tryGrab: ((x: number, y: number, z: number, radius: number) => CarriedFish | null) | null = null;
  /** Fired the instant the talons close, with the entry score data + fish. */
  onCatch: ((entry: DiveEntry, fish: CarriedFish) => void) | null = null;
  /** Fired the instant a committed dive breaks the surface (entry captured). */
  onEntry: ((entry: DiveEntry) => void) | null = null;
  /** Fired when the bird breaches back into the air after a plunge. */
  onBreach: (() => void) | null = null;

  private stateTime = 0;
  private plungeYaw = 0;
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private wakeTimer = 0;
  private skimTimer = 0;
  private runSpeed = 0;
  private gait = 0.8;
  private brakeW = 0;
  private started = false;
  private readonly qTarget = new THREE.Quaternion();
  private readonly qWork = new THREE.Quaternion();
  private readonly m = new THREE.Matrix4();
  private readonly n = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor() {
    this.osprey = buildOsprey();
    this.osprey.group.position.y = -BODY_CENTER;
    this.group.add(this.osprey.group);
    this.anim = new OspreyAnimator(this.osprey);
    this.anim.flapRateHz = 0;
  }

  get carrying(): boolean {
    return this.carried !== null;
  }

  update(dt: number, t: number, cmds: FlightCommands): void {
    const h = Math.min(dt, 0.05);
    this.stateTime += h;

    if (this.state === "air") this.updateAir(h, t, cmds);
    else if (this.state === "float") this.updateFloat(h, t, cmds);
    else if (this.state === "plunge") this.updatePlunge(h, t, cmds);
    else this.updateRun(h, t, cmds);

    if (this.state !== "plunge" && this.wet > 0) {
      this.wet = Math.max(0, this.wet - h / 2.0);
    }

    this.anim.phase = this.body.flapPhase / (Math.PI * 2);
    this.anim.gait01 = this.gait;
    this.anim.update(h);

    this.group.position.copy(this.body.pos);
    if (!this.started) {
      this.group.quaternion.copy(this.qTarget);
      this.started = true;
    } else {
      const k = 1 - Math.exp(-(this.state === "air" ? 9 : 5) * h);
      this.group.quaternion.slerp(this.qTarget, k);
    }

    publishFlightState(this.body);
  }

  softBounds(radius: number, h: number): void {
    if (this.state !== "air") return;
    const body = this.body;
    const d = Math.hypot(body.pos.x, body.pos.z);
    if (d > radius) {
      this.tmp.set(-body.pos.x / d, 0, -body.pos.z / d);
      body.vel.addScaledVector(this.tmp, (d - radius) * 0.6 * h);
    }
  }

  reset(x: number, y: number, z: number, heading = 0, speed = 10): void {
    this.body.reset(x, y, z, heading, speed);
    this.state = "air";
    this.stateTime = 0;
    this.heading = heading;
    this.gait = 0.8;
    this.brakeW = 0;
    this.runSpeed = 0;
    this.wet = 0;
    this.entrySpeed = 0;
    this.carried = null;
    this.lastEntry = null;
    this.started = false;
  }

  dispose(): void {
    this.osprey.dispose();
  }

  // ---- air ----------------------------------------------------------------------------

  private updateAir(h: number, t: number, cmds: FlightCommands): void {
    const body = this.body;

    const waterPre = waterHeightAt(body.pos.x, body.pos.z, t);
    const closing = Math.max(0.5, -body.vel.y * h * 2.5);
    if (body.vel.y < -this.diveEntrySpeed && body.pos.y - waterPre < closing) {
      this.enterPlunge();
      this.updatePlunge(h, t, cmds);
      return;
    }

    const carry = carryEffect(this.carried);
    body.commands.bank = cmds.bank;
    body.commands.pitch = cmds.pitch;
    body.commands.effort = cmds.effort * carry.effortScale;
    body.commands.tuck = cmds.tuck;
    body.step(h, t);
    if (this.carried) body.vel.y -= carry.sinkAccel * h;

    const water = waterHeightAt(body.pos.x, body.pos.z, t);
    const height = body.pos.y - water;

    const near = clamp01((2.4 - height) / 2.0);
    const sinking = clamp01(-body.vel.y * 0.7);
    this.brakeW += (near * sinking * (1 - body.tuck) - this.brakeW) * Math.min(1, h * 6);

    const slow = clamp01((7 - body.airspeed) / 5);
    const gaitTarget = clamp(1 - body.flapAmp * (0.62 + 0.3 * slow), 0.06, 1);
    this.gait += (gaitTarget - this.gait) * Math.min(1, h * 3);

    this.applyPoses(body.tuck, this.brakeW, 0);
    this.anim.bank = clamp(body.bank / body.maxBank, -1, 1);

    this.m.lookAt(body.forward, ZERO, body.up);
    this.qTarget.setFromRotationMatrix(this.m);
    this.qWork.setFromAxisAngle(X_AXIS, -body.alpha);
    this.qTarget.multiply(this.qWork);

    if (body.onWater && Math.hypot(body.vel.x, body.vel.z) < this.landSpeed) this.enterFloat();
  }

  // ---- float --------------------------------------------------------------------------

  private enterFloat(): void {
    const body = this.body;
    this.state = "float";
    this.stateTime = 0;
    this.heading =
      Math.hypot(body.vel.x, body.vel.z) > 0.2
        ? Math.atan2(body.vel.z, body.vel.x)
        : Math.atan2(body.forward.z, body.forward.x);
    body.vel.multiplyScalar(0.3);
    body.commands.effort = 0;
    this.wakeTimer = 0.5;
  }

  private updateFloat(h: number, t: number, cmds: FlightCommands): void {
    const body = this.body;
    const water = waterHeightAt(body.pos.x, body.pos.z, t);

    const targetY = water + BODY_CENTER - this.floatDepth;
    body.vel.y += ((targetY - body.pos.y) * this.buoyancyStiffness - body.vel.y * this.buoyancyDamping) * h;

    wind.sample(body.pos.x, 0.2, body.pos.z, t, this.tmp);
    body.vel.x += (this.tmp.x * 0.045 - body.vel.x * 1.6) * h;
    body.vel.z += (this.tmp.z * 0.045 - body.vel.z * 1.6) * h;
    body.pos.addScaledVector(body.vel, h);

    this.heading += cmds.bank * 0.9 * h;

    body.airspeed = Math.max(0, body.airspeed - body.airspeed * 2 * h);
    body.flapAmp += (0 - body.flapAmp) * Math.min(1, h * 4);
    body.bank *= Math.exp(-2 * h);
    body.stall = 0;
    body.onWater = true;

    this.wakeTimer -= h;
    if (this.wakeTimer <= 0) {
      this.wakeTimer = 1.4;
      disturb({
        kind: "wake",
        x: body.pos.x,
        z: body.pos.z,
        energy: 0.025,
        radius: 0.32,
        vx: body.vel.x,
        vz: body.vel.z,
      });
    }

    this.applyPoses(0, 0, 1);
    this.gait += (1 - this.gait) * Math.min(1, h * 2);
    this.anim.bank = 0;
    this.floatOrientation(t, 0.85);

    if (cmds.effort > 0.45 && this.stateTime > 0.4) this.enterRun();
  }

  // ---- run ----------------------------------------------------------------------------

  private enterRun(): void {
    this.state = "run";
    this.stateTime = 0;
    this.runSpeed = Math.hypot(this.body.vel.x, this.body.vel.z);
    this.skimTimer = 0;
  }

  private updateRun(h: number, t: number, cmds: FlightCommands): void {
    const body = this.body;
    const water = waterHeightAt(body.pos.x, body.pos.z, t);

    this.runSpeed = Math.min(this.runSpeed + 2.8 * h, 9);
    body.vel.x = Math.cos(this.heading) * this.runSpeed;
    body.vel.z = Math.sin(this.heading) * this.runSpeed;
    const lift = Math.max(0, this.runSpeed - 1.6) * 0.55;
    body.vel.y += (lift - 0.65 - body.vel.y * 0.8) * h;
    body.pos.addScaledVector(body.vel, h);

    const height = body.pos.y - water;
    if (height < 0.12) {
      body.pos.y = water + 0.12;
      if (body.vel.y < 0) body.vel.y = 0;
      this.skimTimer -= h;
      if (this.skimTimer <= 0) {
        this.skimTimer = 0.16;
        disturb({
          kind: "skim",
          x: body.pos.x,
          z: body.pos.z,
          energy: 0.06 + this.runSpeed * 0.012,
          radius: 0.2,
          vx: body.vel.x,
          vz: body.vel.z,
        });
      }
    }

    body.flapPhase += (2.5 + 2) * Math.PI * 2 * h;
    body.flapAmp += (1 - body.flapAmp) * Math.min(1, h * 6);
    body.airspeed = this.runSpeed;
    body.onWater = height < 0.3;

    this.applyPoses(0, 0, 0);
    this.gait += (0.1 - this.gait) * Math.min(1, h * 3.5);
    this.anim.bank = 0;
    this.floatOrientation(t, 0.2);

    if (height > 0.8 && this.runSpeed > 6.5) this.enterAir(cmds);
    if (cmds.effort < 0.05 && this.runSpeed < 4) {
      this.state = "float";
      this.stateTime = 0;
    }
  }

  private enterAir(cmds: FlightCommands): void {
    const body = this.body;
    this.state = "air";
    this.stateTime = 0;
    this.brakeW = 0;
    body.alpha = ALPHA_TRIM;
    body.bank = 0;
    body.stall = 0;
    body.vel.y = Math.max(body.vel.y, 1.2);
    body.commands.effort = cmds.effort;
  }

  // ---- plunge: the strike, scored -----------------------------------------------------

  private enterPlunge(): void {
    const body = this.body;
    this.state = "plunge";
    this.stateTime = 0;
    this.entrySpeed = body.vel.length();
    this.wet = 1;
    this.brakeW = 0;
    this.plungeYaw = Math.atan2(body.vel.x, body.vel.z);

    // Capture the DiveEntry exactly at the surface: angle below horizontal,
    // speed, and the horizontal miss against whatever the dive was aiming at.
    const hSpeed = Math.hypot(body.vel.x, body.vel.z);
    const angle = Math.atan2(-body.vel.y, Math.max(hSpeed, 1e-3));
    const aim = this.aim;
    const miss = aim ? Math.hypot(body.pos.x - aim.x, body.pos.z - aim.z) : 999;
    this.lastEntry = {
      speed: this.entrySpeed,
      angle: clamp(angle, 0, Math.PI / 2),
      miss,
      depth: 0, // set on grab against the actual fish depth
    };
    this.onEntry?.(this.lastEntry);

    disturb({
      kind: "splash",
      x: body.pos.x,
      z: body.pos.z,
      energy: clamp((this.entrySpeed * this.entrySpeed) / 200, 0.35, 1.3),
      radius: 0.5,
      vx: body.vel.x,
      vz: body.vel.z,
    });
  }

  private updatePlunge(h: number, t: number, cmds: FlightCommands): void {
    const body = this.body;

    body.vel.multiplyScalar(Math.exp(-3.4 * h));
    body.vel.y += 5.4 * h;
    this.plungeYaw += cmds.bank * 0.8 * h;
    body.pos.addScaledVector(body.vel, h);

    const floor = Math.max(terrainHeightAt(body.pos.x, body.pos.z) + 0.3, -this.maxPlungeDepth);
    if (body.pos.y < floor) {
      body.pos.y = floor;
      if (body.vel.y < 0) body.vel.y = 0;
    }

    if (!this.carried && this.tryGrab && this.stateTime < 1.1) {
      const fish = this.tryGrab(body.pos.x, body.pos.y - BODY_CENTER, body.pos.z, this.grabRadius);
      if (fish) {
        this.carried = fish;
        if (this.lastEntry) {
          this.lastEntry.depth = Math.max(0, -(body.pos.y - BODY_CENTER));
          this.onCatch?.(this.lastEntry, fish);
        }
      }
    }

    body.airspeed = body.vel.length();
    body.bank *= Math.exp(-3 * h);
    body.stall = 0;
    body.onWater = true;

    const rising = body.vel.y > 0.25 && this.stateTime > 0.3;
    if (rising) {
      body.flapPhase += 5 * Math.PI * 2 * h;
      body.flapAmp += (1 - body.flapAmp) * Math.min(1, h * 5);
      this.applyPoses(0, 0, 0, 0.25);
      this.gait += (0.05 - this.gait) * Math.min(1, h * 4);
    } else {
      body.flapAmp += (0 - body.flapAmp) * Math.min(1, h * 6);
      this.applyPoses(0, 0, 0, 1);
      this.gait += (0.4 - this.gait) * Math.min(1, h * 3);
    }
    this.anim.bank = 0;

    const hSpeed = Math.hypot(body.vel.x, body.vel.z);
    if (hSpeed > 0.4) this.plungeYaw = Math.atan2(body.vel.x, body.vel.z);
    const pitch = clamp(Math.atan2(-body.vel.y, Math.max(hSpeed, 0.6)), -1.45, 1.45);
    this.euler.set(pitch, this.plungeYaw, 0);
    this.qTarget.setFromEuler(this.euler);

    const water = waterHeightAt(body.pos.x, body.pos.z, t);
    if (body.pos.y > water + 0.12 && body.vel.y > 0) {
      disturb({
        kind: "splash",
        x: body.pos.x,
        z: body.pos.z,
        energy: 0.4,
        radius: 0.45,
        vx: body.vel.x,
        vz: body.vel.z,
      });
      body.vel.y = Math.max(body.vel.y, 2.2);
      const heading = this.plungeYaw;
      body.vel.x += Math.sin(heading) * 1.2;
      body.vel.z += Math.cos(heading) * 1.2;
      this.enterAir(cmds);
      this.onBreach?.();
      return;
    }
    if (this.stateTime > 4) body.vel.y = Math.max(body.vel.y, 3);
  }

  // ---- shared --------------------------------------------------------------------------

  private applyPoses(tuck: number, brake: number, float: number, strike = 0): void {
    const p = this.anim.poseTarget;
    p.tuck = tuck;
    p.brake = brake;
    p.float = float;
    p.strike = strike;
  }

  private floatOrientation(t: number, tilt: number): void {
    const body = this.body;
    this.qTarget.setFromAxisAngle(Y_AXIS, Math.PI / 2 - this.heading);
    waterNormalAt(body.pos.x, body.pos.z, t, this.n);
    this.qWork.setFromUnitVectors(Y_AXIS, this.n);
    this.qWork.slerp(Q_IDENTITY, 1 - clamp01(tilt));
    this.qTarget.premultiply(this.qWork);
  }
}

// ---- a minimal autopilot ---------------------------------------------------------------
// Heading error → bank, altitude error → pitch + effort, with a don't-stall
// guard. Used wherever a demo flies itself.

export function steerToward(
  body: FlightBody,
  cmds: FlightCommands,
  tx: number,
  ty: number,
  tz: number,
): void {
  const heading = Math.atan2(body.vel.z, body.vel.x);
  const desired = Math.atan2(tz - body.pos.z, tx - body.pos.x);
  const err = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading));
  cmds.bank = clamp(err * 1.4, -1, 1);
  const altErr = ty - body.pos.y;
  cmds.pitch = clamp(altErr * 0.1 - body.vel.y * 0.12, -0.7, 0.7);
  if (body.airspeed < 7.5) cmds.pitch = Math.min(cmds.pitch, 0.1);
  cmds.effort = clamp(0.3 + altErr * 0.12 + (9.5 - body.airspeed) * 0.12, 0, 1);
  cmds.tuck = 0;
}
