// The bridge that makes First Flight playable: the Lift point mass supplies
// the physics, the New Feathers osprey supplies the body, and the spine's
// water/wind/bus glue both to the lake. A small ownership state machine
// decides, each frame, which law of nature is flying the bird:
//
//   air    — the flight model integrates lift / drag / weight / flap thrust
//   float  — linearized buoyancy: a damped spring toward waterHeightAt
//   run    — the takeoff script: hover-gait strokes building speed
//
// Whoever owns the frame, the same FlightBody instance stores position and
// velocity, the same animator poses the mesh, the same wingbeat clock (the
// flight model's flapPhase) drives the wings, and every water contact goes
// out on the disturbance bus. publishFlightState runs every update, so the
// telemetry contract from the Lift series keeps flowing no matter who owns
// the bird.

import * as THREE from "three/webgpu";
import { disturb, waterHeightAt, waterNormalAt, wind } from "../../lib/spine";
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

export type BirdState = "air" | "float" | "run";

const ZERO = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Q_IDENTITY = new THREE.Quaternion();

// Height of the body centre above the osprey group origin (the rig root sits
// at 0.305 m in the modelling pose). The flight model's point mass is the
// body centre; the mesh hangs this far below it.
const BODY_CENTER = 0.3;

export class PlayerBird {
  readonly body = new FlightBody();
  readonly osprey: Osprey;
  readonly anim: OspreyAnimator;
  /** World-space holder: positioned at body.pos, oriented by the state. */
  readonly group = new THREE.Group();

  state: BirdState = "air";
  /** Heading (rad about +y) while the water owns the bird. */
  heading = 0;

  // Handoff tuning — the handoff demo exposes these as sliders.
  /** Ground speed below which a skim settles into a float. */
  landSpeed = 3.0;
  /** Buoyancy spring stiffness toward the surface, 1/s². */
  buoyancyStiffness = 22;
  buoyancyDamping = 7.5;
  /** How deep the body centre settles below its dry resting height, m. */
  floatDepth = 0.12;

  private stateTime = 0;
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
    // One wingbeat clock: the animator's phase is *assigned* from the flight
    // model's flapPhase every frame, never advanced on its own.
    this.anim.flapRateHz = 0;
  }

  update(dt: number, t: number, cmds: FlightCommands): void {
    const h = Math.min(dt, 0.05);
    this.stateTime += h;

    if (this.state === "air") this.updateAir(h, t, cmds);
    else if (this.state === "float") this.updateFloat(h, t, cmds);
    else this.updateRun(h, t, cmds);

    // the model's clock drives the wings (and the camera bob, and someday
    // the audio whump — all off the same phase)
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

  /** Polite world bounds: drift the bird back toward the lake centre. */
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
    this.started = false;
  }

  dispose(): void {
    this.osprey.dispose();
  }

  // ---- air: the flight model owns the bird --------------------------------------

  private updateAir(h: number, t: number, cmds: FlightCommands): void {
    const body = this.body;
    body.commands.bank = cmds.bank;
    body.commands.pitch = cmds.pitch;
    body.commands.effort = cmds.effort;
    body.commands.tuck = cmds.tuck;
    body.step(h, t);

    const water = waterHeightAt(body.pos.x, body.pos.z, t);
    const height = body.pos.y - water;

    // Flare assist: descending onto the surface blends in the brake pose —
    // the same height-triggered conversion to an air brake touchgo.html used,
    // here layered on live physics instead of a scripted glide.
    const near = clamp01((2.4 - height) / 2.0);
    const sinking = clamp01(-body.vel.y * 0.7);
    this.brakeW += (near * sinking * (1 - body.tuck) - this.brakeW) * Math.min(1, h * 6);

    // Gait from the flight state: effort pulls toward flapping, low airspeed
    // deepens the stroke toward hover, no effort settles into the glide hold.
    const slow = clamp01((7 - body.airspeed) / 5);
    const gaitTarget = clamp(1 - body.flapAmp * (0.62 + 0.3 * slow), 0.06, 1);
    this.gait += (gaitTarget - this.gait) * Math.min(1, h * 3);

    this.applyPoses(body.tuck, this.brakeW, 0);
    this.anim.bank = clamp(body.bank / body.maxBank, -1, 1);

    // Orientation rebuilt from the airflow, exactly like the Lift glyph:
    // forward along the air velocity, rolled to the lift direction, pitched
    // up by the angle of attack.
    this.m.lookAt(body.forward, ZERO, body.up);
    this.qTarget.setFromRotationMatrix(this.m);
    this.qWork.setFromAxisAngle(X_AXIS, -body.alpha);
    this.qTarget.multiply(this.qWork);

    // The handoff: skimming slow enough means the water owns the bird now.
    if (body.onWater && Math.hypot(body.vel.x, body.vel.z) < this.landSpeed) this.enterFloat();
  }

  // ---- float: Archimedes owns the bird --------------------------------------------

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

    // Buoyancy, linearized (touchgo.html): a damped spring pulling the body
    // centre toward the live surface, queried from the same function the GPU
    // displaces the rendered lake with.
    const targetY = water + BODY_CENTER - this.floatDepth;
    body.vel.y += ((targetY - body.pos.y) * this.buoyancyStiffness - body.vel.y * this.buoyancyDamping) * h;

    // Wind pushes the float around; water drag resists.
    wind.sample(body.pos.x, 0.2, body.pos.z, t, this.tmp);
    body.vel.x += (this.tmp.x * 0.045 - body.vel.x * 1.6) * h;
    body.vel.z += (this.tmp.z * 0.045 - body.vel.z * 1.6) * h;
    body.pos.addScaledVector(body.vel, h);

    // Paddle: bank input slowly swings the bow.
    this.heading += cmds.bank * 0.9 * h;

    // Keep the published telemetry honest while the model isn't stepping.
    body.airspeed = Math.max(0, body.airspeed - body.airspeed * 2 * h);
    body.flapAmp += (0 - body.flapAmp) * Math.min(1, h * 4);
    body.bank *= Math.exp(-2 * h);
    body.stall = 0;
    body.onWater = true;

    // A floating body is a slow, continuous disturbance.
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

  // ---- run: the takeoff script owns the bird ----------------------------------------

  private enterRun(): void {
    this.state = "run";
    this.stateTime = 0;
    this.runSpeed = Math.hypot(this.body.vel.x, this.body.vel.z);
    this.skimTimer = 0;
  }

  private updateRun(h: number, t: number, cmds: FlightCommands): void {
    const body = this.body;
    const water = waterHeightAt(body.pos.x, body.pos.z, t);

    // Near-vertical hover strokes haul the bird forward; lift follows speed.
    this.runSpeed = Math.min(this.runSpeed + 2.8 * h, 9);
    body.vel.x = Math.cos(this.heading) * this.runSpeed;
    body.vel.z = Math.sin(this.heading) * this.runSpeed;
    const lift = Math.max(0, this.runSpeed - 1.6) * 0.55;
    body.vel.y += (lift - 0.65 - body.vel.y * 0.8) * h;
    body.pos.addScaledVector(body.vel, h);

    const height = body.pos.y - water;
    if (height < 0.12) {
      // Feet slap the surface stride after stride while she's still low.
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

    // The model's wingbeat clock keeps ticking at full effort.
    body.flapPhase += (2.5 + 2) * Math.PI * 2 * h;
    body.flapAmp += (1 - body.flapAmp) * Math.min(1, h * 6);
    body.airspeed = this.runSpeed;
    body.onWater = height < 0.3;

    this.applyPoses(0, 0, 0);
    this.gait += (0.1 - this.gait) * Math.min(1, h * 3.5);
    this.anim.bank = 0;
    this.floatOrientation(t, 0.2);

    // Climb-out: clear of the water and fast enough → the flight model takes
    // the bird back, mid-wingbeat, without a cut.
    if (height > 0.8 && this.runSpeed > 6.5) this.enterAir(cmds);
    // Aborted run (effort released early) settles back onto the water.
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

  // ---- shared bits -------------------------------------------------------------------

  private applyPoses(tuck: number, brake: number, float: number): void {
    const p = this.anim.poseTarget;
    p.tuck = tuck;
    p.brake = brake;
    p.float = float;
    p.strike = 0;
  }

  /** Yaw to the heading, tilted onto the live wave slope (scaled by `tilt`). */
  private floatOrientation(t: number, tilt: number): void {
    const body = this.body;
    this.qTarget.setFromAxisAngle(Y_AXIS, Math.PI / 2 - this.heading);
    waterNormalAt(body.pos.x, body.pos.z, t, this.n);
    this.qWork.setFromUnitVectors(Y_AXIS, this.n);
    this.qWork.slerp(Q_IDENTITY, 1 - clamp01(tilt)); // the hull resists full roll
    this.qTarget.premultiply(this.qWork);
  }
}

// ---- a minimal autopilot ---------------------------------------------------------
// Heading error → bank, altitude error → pitch + effort, with a don't-stall
// guard. Used wherever a demo flies itself (unfocused hero, the in-article
// figures). Rebuilt here from the steering law the Lift essays derived.

export function steerToward(body: FlightBody, cmds: FlightCommands, tx: number, ty: number, tz: number): void {
  const heading = Math.atan2(body.vel.z, body.vel.x);
  const desired = Math.atan2(tz - body.pos.z, tx - body.pos.x);
  const err = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading));
  cmds.bank = clamp(err * 1.4, -1, 1);
  const altErr = ty - body.pos.y;
  cmds.pitch = clamp(altErr * 0.1 - body.vel.y * 0.12, -0.7, 0.7);
  if (body.airspeed < 7.5) cmds.pitch = Math.min(cmds.pitch, 0.1); // never beg for a stall
  cmds.effort = clamp(0.3 + altErr * 0.12 + (9.5 - body.airspeed) * 0.12, 0, 1);
  cmds.tuck = 0;
}
