// The Lift series library: a point-mass flight model with honest
// aerodynamics, input → command shaping, a chase camera, wind influences
// (ridge lift, thermals), and the FlightState telemetry other systems read.

export {
  G,
  AIR_DENSITY,
  OSPREY,
  CL_SLOPE,
  ALPHA_STALL,
  ALPHA_TRIM,
  stallBlend,
  liftCoefficient,
  dragCoefficient,
  FlightBody,
  type FlightCommands,
} from "./model";
export { flightState, publishFlightState, type FlightState } from "./state";
export { StickControls } from "./controls";
export { ChaseCamera } from "./chase";
export { BirdGlyph } from "./glyph";
export { expoCurve, applyDeadzone, damp, clamp, clamp01, Spring } from "./tuning";
export {
  ridgeLiftInfluence,
  thermalInfluence,
  type RidgeLiftOptions,
  type ThermalSpec,
} from "./influences";
