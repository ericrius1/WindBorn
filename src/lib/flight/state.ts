// FlightState — the flight model's public telemetry, and the contract other
// systems read. This is module-level on purpose: one bird, one state, no
// plumbing.
//
// CONSUMERS (read every frame, never write):
//   import { flightState } from "../flight/state";   // or ../flight
//   · audio   — synthesize wind noise from `airspeed`, flap whumps from
//               `flapPhase` crossing 0, stall buffet from `stall`
//   · camera / postfx — FOV and blur from `airspeed`, `verticalSpeed`
//   · game    — `altitude`, `x/z` for zones, `onWater` for landings
//
// PRODUCER: whichever scene currently owns the bird calls
// publishFlightState(body) once per simulation step. Values are plain
// numbers (no vectors) so readers can never mutate the model by accident.

import type { FlightBody } from "./model";
import { WATER_LEVEL } from "../spine";

export interface FlightState {
  /** Speed through the air in m/s (NOT ground speed). Drives wind audio. */
  airspeed: number;
  /** Speed over the ground in m/s. */
  groundSpeed: number;
  /** Vertical speed in m/s, + climbing. The vario reads this. */
  verticalSpeed: number;
  /** Height above mean water (world y = 0) in meters. */
  altitude: number;
  /** Bank angle in radians, + = banked right. */
  bank: number;
  /** Angle of attack in radians. */
  alpha: number;
  /** Heading in radians around +y, 0 = +x, measured from the airflow. */
  heading: number;
  /** Flap effort 0..1 (0 while gliding). */
  flapping: number;
  /** Wingbeat phase in radians; wraps continuously while flapping. */
  flapPhase: number;
  /** Dive tuck 0..1. */
  tuck: number;
  /** Stall blend 0..1 — how deep into the mush the wing is. */
  stall: number;
  /** True while skimming or floating on the water. */
  onWater: boolean;
  /** World position (for echo distances, zones, journal moments). */
  x: number;
  y: number;
  z: number;
}

export const flightState: FlightState = {
  airspeed: 0,
  groundSpeed: 0,
  verticalSpeed: 0,
  altitude: 0,
  bank: 0,
  alpha: 0,
  heading: 0,
  flapping: 0,
  flapPhase: 0,
  tuck: 0,
  stall: 0,
  onWater: false,
  x: 0,
  y: 0,
  z: 0,
};

// Copy a FlightBody's diagnostics into the shared state. Call once per
// frame from the scene that owns the live bird.
export function publishFlightState(body: FlightBody): void {
  const s = flightState;
  s.airspeed = body.airspeed;
  s.groundSpeed = Math.hypot(body.vel.x, body.vel.z);
  s.verticalSpeed = body.vel.y;
  s.altitude = body.pos.y - WATER_LEVEL;
  s.bank = body.bank;
  s.alpha = body.alpha;
  s.heading = Math.atan2(body.forward.z, body.forward.x);
  s.flapping = body.flapAmp;
  s.flapPhase = body.flapPhase;
  s.tuck = body.tuck;
  s.stall = body.stall;
  s.onWater = body.onWater;
  s.x = body.pos.x;
  s.y = body.pos.y;
  s.z = body.pos.z;
}
