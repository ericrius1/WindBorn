// The Lift series flight model: an osprey as a point mass under four forces.
//
// Everything here is derived step by step in the Lift essays (forces.html
// onward):
//
//   lift    L = ½ ρ V² S · C_L(α)     perpendicular to the airflow
//   drag    D = ½ ρ V² S · C_D(α)     opposing the airflow
//   weight  W = m g                   straight down
//   thrust  T = effort · min(Tmax, P/V)   along the flight path (flapping)
//
// The state is deliberately tiny — position, velocity, bank, angle of
// attack — because the feel of the game lives in how player commands shape
// those few numbers, not in a full rigid body. Orientation for rendering is
// reconstructed from the airspeed vector, the bank angle, and α.
//
// All aerodynamic forces are computed from AIRSPEED (velocity minus the
// spine wind sampled at the bird), which is what makes updrafts, gusts, and
// ridge lift work for free in updrafts.html.

import { Vector3 } from "three";
import { wind, waterHeightAt, disturb } from "../spine";

export const G = 9.81; // m/s²
export const AIR_DENSITY = 1.2; // kg/m³, valley air

// Real osprey numbers (forces.html derives everything from these):
// ~1.5 kg, ~1.6 m span, wing area ≈ 0.30 m² → aspect ratio ≈ 8.5.
export const OSPREY = {
  mass: 1.5, // kg
  span: 1.6, // m
  wingArea: 0.3, // m²
  aspectRatio: (1.6 * 1.6) / 0.3, // ≈ 8.53
  cd0: 0.033, // profile drag at zero lift (body + wings)
  oswald: 0.9, // span efficiency
};

// Finite-wing lift slope: thin-airfoil 2π corrected for aspect ratio,
//   a = 2π / (1 + 2 / (e·AR)) ≈ 5.0 per radian.
export const CL_SLOPE = (2 * Math.PI) / (1 + 2 / (OSPREY.oswald * OSPREY.aspectRatio));

// Stall: attached flow holds to about 16° of incidence, then the boundary
// layer lets go over the next few degrees.
export const ALPHA_STALL = 0.28; // rad ≈ 16°
const STALL_WIDTH = 0.12; // rad over which attachment is lost

export const ALPHA_TRIM = 0.1; // rad ≈ 5.7°, the hands-off angle of attack

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// 0 = fully attached flow, 1 = fully separated.
export function stallBlend(alpha: number): number {
  return smoothstep(ALPHA_STALL, ALPHA_STALL + STALL_WIDTH, Math.abs(alpha));
}

// C_L(α): a straight line while the flow is attached, blending into the
// flat-plate curve (≈ 1.1·sin 2α) once it separates. The blend is what makes
// our stall mush instead of cliff.
export function liftCoefficient(alpha: number): number {
  const attached = CL_SLOPE * alpha;
  const separated = 1.1 * Math.sin(2 * alpha);
  const s = stallBlend(alpha);
  return attached * (1 - s) + separated * s;
}

// C_D(α): profile drag + induced drag C_L²/(π e AR), plus a separated-flow
// penalty that grows through the stall.
export function dragCoefficient(alpha: number): number {
  const cl = liftCoefficient(alpha);
  const induced = (cl * cl) / (Math.PI * OSPREY.oswald * OSPREY.aspectRatio);
  const s = stallBlend(alpha);
  const separated = s * 1.3 * Math.sin(alpha) * Math.sin(alpha);
  return OSPREY.cd0 + induced + separated;
}

// What the player (or an autopilot) asks for. The body smooths these — the
// commands are targets, never instant state.
export interface FlightCommands {
  bank: number; // -1..1 → target bank angle, + banks right
  pitch: number; // -1..1 → α command around trim, + pulls the nose up
  effort: number; // 0..1 flap effort
  tuck: number; // 0..1 dive tuck (folds the wings, sheds area)
}

export class FlightBody {
  // ---- pose ------------------------------------------------------------
  readonly pos = new Vector3(0, 25, 0);
  readonly vel = new Vector3(10, 0, 0);
  bank = 0; // rad, + = right wing down
  alpha = ALPHA_TRIM; // rad, current angle of attack
  flapPhase = 0; // rad, advances while flapping (wingbeat clock)
  tuck = 0; // 0..1 smoothed tuck state

  // ---- commands (write every frame; the body does the smoothing) --------
  readonly commands: FlightCommands = { bank: 0, pitch: 0, effort: 0, tuck: 0 };

  // ---- tuning knobs (the joy pass plays with these) ----------------------
  maxBank = 1.05; // rad ≈ 60°
  bankRate = 2.4; // rad/s toward the commanded bank
  alphaRate = 6; // 1/s response of α toward its command
  alphaRange = 0.15; // rad of α authority around trim
  powerMax = 95; // W of burst muscle power
  thrustMax = 11; // N of flap thrust at low speed
  windScale = 1; // 0 = still air (early demos), 1 = the real spine wind

  // ---- diagnostics, refreshed every step (read, don't write) -------------
  airspeed = 10; // |velocity - wind| m/s
  readonly airVel = new Vector3(10, 0, 0);
  readonly forward = new Vector3(1, 0, 0); // unit vector along the airflow
  readonly up = new Vector3(0, 1, 0); // unit lift direction (includes bank)
  readonly liftForce = new Vector3();
  readonly dragForce = new Vector3();
  readonly thrustForce = new Vector3();
  readonly weightForce = new Vector3(0, -OSPREY.mass * G, 0);
  readonly windAt = new Vector3(); // wind sampled at the bird this step
  stall = 0; // 0..1, how separated the flow is
  flapAmp = 0; // 0..1 smoothed effort, drives the visible wingbeat
  onWater = false;

  private splashCooldown = 0;
  private readonly tmp = new Vector3();
  private readonly liftDir = new Vector3();

  // Advance the model by dt seconds of simulated time at world time t.
  // Substeps keep the integration honest when a tab hiccups.
  step(dt: number, t: number): void {
    dt = Math.min(dt, 0.05);
    const n = Math.max(1, Math.ceil(dt / (1 / 90)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.substep(h, t + i * h);
  }

  private substep(dt: number, t: number): void {
    const c = this.commands;
    const m = OSPREY.mass;

    // -- wind & airspeed --------------------------------------------------
    wind.sample(this.pos.x, this.pos.y, this.pos.z, t, this.windAt);
    this.windAt.multiplyScalar(this.windScale);
    this.airVel.copy(this.vel).sub(this.windAt);
    const V = Math.max(this.airVel.length(), 0.5);
    this.airspeed = this.airVel.length();
    this.forward.copy(this.airVel).divideScalar(Math.max(this.airVel.length(), 1e-6));
    if (this.airVel.lengthSq() < 1e-8) this.forward.set(1, 0, 0);

    // -- smooth the commands ----------------------------------------------
    // Deep stall costs control authority: separated wings answer slowly.
    const authority = 1 - 0.65 * this.stall;
    const bankTarget = clamp(c.bank, -1, 1) * this.maxBank;
    const maxStep = this.bankRate * authority * dt;
    this.bank += clamp(bankTarget - this.bank, -maxStep, maxStep);

    const alphaTarget = ALPHA_TRIM + clamp(c.pitch, -1, 1) * this.alphaRange;
    const k = 1 - Math.exp(-this.alphaRate * authority * dt);
    this.alpha += (alphaTarget - this.alpha) * k;

    this.tuck += (clamp(c.tuck, 0, 1) - this.tuck) * (1 - Math.exp(-5 * dt));
    this.flapAmp += (clamp(c.effort, 0, 1) - this.flapAmp) * (1 - Math.exp(-7 * dt));

    // -- coefficients & dynamic pressure ------------------------------------
    this.stall = stallBlend(this.alpha);
    // Tucking folds the wings: less area, less lift, far less drag.
    const S = OSPREY.wingArea * (1 - 0.7 * this.tuck);
    const cl = liftCoefficient(this.alpha) * (1 - 0.75 * this.tuck);
    const cd = dragCoefficient(this.alpha) * (1 - 0.55 * this.tuck);
    const q = 0.5 * AIR_DENSITY * V * V * S; // dynamic pressure × area

    // -- lift direction: perpendicular to the airflow, rolled by bank -------
    // l0 = world-up with the along-flow component removed…
    this.liftDir.set(0, 1, 0).addScaledVector(this.forward, -this.forward.y);
    if (this.liftDir.lengthSq() < 1e-6) this.liftDir.set(1, 0, 0); // straight dive
    this.liftDir.normalize();
    // …then rotated about the airflow by the bank angle.
    this.tmp.crossVectors(this.forward, this.liftDir);
    this.liftDir
      .multiplyScalar(Math.cos(this.bank))
      .addScaledVector(this.tmp, Math.sin(this.bank))
      .normalize();
    this.up.copy(this.liftDir);

    // -- four forces ---------------------------------------------------------
    this.liftForce.copy(this.liftDir).multiplyScalar(q * cl);
    this.dragForce.copy(this.forward).multiplyScalar(-q * cd);
    // Flapping is power-limited: muscles deliver watts, thrust = P/V, capped
    // at low speed where the cap (not the power) is the limit.
    const thrust = c.effort * Math.min(this.thrustMax, this.powerMax / Math.max(V, 2));
    this.thrustForce.copy(this.forward).multiplyScalar(thrust);

    // Wingbeat clock: ospreys beat ~2.5–4 Hz; frequency rises with effort.
    if (c.effort > 0.03) this.flapPhase += (2.5 + 2 * c.effort) * Math.PI * 2 * dt;

    // -- integrate (semi-implicit Euler) -------------------------------------
    this.tmp
      .copy(this.liftForce)
      .add(this.dragForce)
      .add(this.thrustForce)
      .add(this.weightForce);
    this.vel.addScaledVector(this.tmp, dt / m);
    this.pos.addScaledVector(this.vel, dt);

    // -- the water is a floor, not a fail state ------------------------------
    this.splashCooldown = Math.max(0, this.splashCooldown - dt);
    const wy = waterHeightAt(this.pos.x, this.pos.z, t);
    this.onWater = false;
    if (this.pos.y < wy + 0.35) {
      this.pos.y = wy + 0.35;
      this.onWater = true;
      const vy = this.vel.y;
      if (vy < 0) {
        if (this.splashCooldown <= 0 && Math.abs(vy) > 0.4) {
          const hard = Math.abs(vy) > 3;
          disturb({
            kind: hard ? "splash" : "skim",
            x: this.pos.x,
            z: this.pos.z,
            energy: clamp(0.5 * m * vy * vy * 0.06, 0.02, 1),
            radius: hard ? 0.8 : 0.4,
            vx: this.vel.x,
            vz: this.vel.z,
          });
          this.splashCooldown = 0.3;
        }
        this.vel.y = 0;
      }
      // Belly drag: skimming scrubs speed but never kills.
      this.vel.x -= this.vel.x * 1.5 * dt;
      this.vel.z -= this.vel.z * 1.5 * dt;
    }
  }

  // Place the bird somewhere with a given heading (rad about +y) and speed.
  reset(x: number, y: number, z: number, heading = 0, speed = 10): void {
    this.pos.set(x, y, z);
    this.vel.set(Math.cos(heading) * speed, 0, Math.sin(heading) * speed);
    this.bank = 0;
    this.alpha = ALPHA_TRIM;
    this.tuck = 0;
    this.flapAmp = 0;
    this.stall = 0;
    this.commands.bank = 0;
    this.commands.pitch = 0;
    this.commands.effort = 0;
    this.commands.tuck = 0;
  }
}
