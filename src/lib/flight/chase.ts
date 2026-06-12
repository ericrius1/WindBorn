// The chase camera: a smoothed follow position, a look-ahead aim point, and
// a field of view that answers to airspeed. stick.html derives the basics;
// joy.html adds breathing, flap bob, and the acceleration FOV kick.

import { PerspectiveCamera, Vector3 } from "three";
import type { FlightBody } from "./model";
import { damp } from "./tuning";

export class ChaseCamera {
  // Rig geometry (meters).
  distance = 7;
  height = 2.4;
  aimAhead = 6;

  // Smoothing rates, 1/s. Lower = heavier camera.
  posLag = 3.5;
  aimLag = 5;
  fovLag = 4;

  // Speed-reactive FOV (stick.html).
  fovBase = 55; // deg at and below the reference speed
  fovSpeedGain = 1.1; // deg per m/s above the reference
  fovSpeedRef = 9; // m/s — cruise

  // The joy pass (joy.html). All default to off so earlier posts feel "raw".
  fovKickGain = 0; // deg per m/s² of acceleration along the path
  breathe = 0; // 0..1 idle camera breathing
  flapBob = 0; // 0..1 bob keyed to the wingbeat

  // Rigid mode: snap everything (the "before" in feel comparisons).
  rigid = false;

  private readonly smoothedPos = new Vector3();
  private readonly smoothedAim = new Vector3();
  private fov = this.fovBase;
  private kick = 0;
  private lastSpeed = 0;
  private started = false;
  private readonly tmp = new Vector3();
  private readonly flatF = new Vector3();

  reset(): void {
    this.started = false;
    this.kick = 0;
  }

  update(camera: PerspectiveCamera, body: FlightBody, dt: number, t: number): void {
    // Follow point: behind along the horizontal forward, lifted a little.
    this.flatF.set(body.forward.x, 0, body.forward.z);
    if (this.flatF.lengthSq() < 1e-6) this.flatF.set(1, 0, 0);
    this.flatF.normalize();

    const desired = this.tmp.copy(body.pos).addScaledVector(this.flatF, -this.distance);
    desired.y = Math.max(desired.y + this.height, 0.6); // don't sink the lens

    if (!this.started || this.rigid) {
      this.smoothedPos.copy(desired);
      this.smoothedAim.copy(body.pos).addScaledVector(body.forward, this.aimAhead);
      this.started = true;
    } else {
      // Frame-rate-independent damping toward the rig targets.
      const kp = 1 - Math.exp(-this.posLag * dt);
      this.smoothedPos.lerp(desired, kp);
      const ka = 1 - Math.exp(-this.aimLag * dt);
      this.tmp.copy(body.pos).addScaledVector(body.forward, this.aimAhead);
      this.smoothedAim.lerp(this.tmp, ka);
    }

    // -- joy: breathing + flap bob -------------------------------------------
    if (!this.rigid && (this.breathe > 0 || this.flapBob > 0)) {
      const breathe =
        this.breathe * (Math.sin(t * 0.9) * 0.05 + Math.sin(t * 0.53 + 1.7) * 0.035);
      const bob = this.flapBob * body.flapAmp * Math.sin(body.flapPhase) * 0.06;
      this.smoothedPos.y += breathe + bob;
    }

    camera.position.copy(this.smoothedPos);
    camera.lookAt(this.smoothedAim);

    // -- FOV: speed + acceleration kick ----------------------------------------
    const accel = dt > 0 ? (body.airspeed - this.lastSpeed) / dt : 0;
    this.lastSpeed = body.airspeed;
    this.kick = damp(this.kick, Math.max(0, accel), 3, dt);
    const fovTarget =
      this.fovBase +
      this.fovSpeedGain * Math.max(0, body.airspeed - this.fovSpeedRef) +
      this.fovKickGain * this.kick;
    this.fov = this.rigid ? this.fovBase : damp(this.fov, fovTarget, this.fovLag, dt);
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }
}
