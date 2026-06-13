// Under's library: everything the site needs once a camera (or a bird) goes
// through the surface.
//
//   crossing     the above/below state machine (one waterHeightAt compare)
//   medium       the water as a participating medium: glow, fog, sun tint
//   ceiling      the surface from below — Snell's window + the TIR mirror
//   caustics     analytic Jacobian caustics + raymarched god rays
//   bubbles      disturbance-bus bubble columns
//   spray        water streaming off a breaching body
//   fish         a minimal direct-mesh fish for the grab moment
//   lensOverlay  meniscus band, droplet streaks, underwater grade

export { SurfaceCrossing, type CrossingEvent, type CrossingSide } from "./crossing";
export {
  UNDER_ABSORB,
  MEDIUM_SHALLOW,
  MEDIUM_DEEP,
  mediumColorNode,
  sunTintAtDepth,
  underwaterFog,
  makeDepthDome,
  type DepthDome,
} from "./medium";
export {
  SurfaceCeiling,
  criticalAngle,
  windowRadius,
  MAX_MARKERS,
  type SurfaceCeilingOptions,
} from "./ceiling";
export {
  BETA_PER_METER,
  causticFocusNode,
  causticLightNode,
  GodRayScreen,
  type GodRayOptions,
} from "./caustics";
export { BubblePlume } from "./bubbles";
export { Spray } from "./spray";
export { buildFish, FishCruiser, type Fish, type CruiseOptions } from "./fish";
export { LensOverlay, type LensOverlayOptions } from "./lensOverlay";
