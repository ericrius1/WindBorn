// Glass & Grain's public API — the cinematic pass. Everything here operates
// on the rendered frame, never on the scene:
//
//   grade   what a color grade IS: tone curves, exposure/white balance on
//           the linear side, lift/gamma/gain + contrast + saturation +
//           vignette on the display side, every knob keyed to sun elevation
//   speed   the camera communicating airspeed: velocity-buffer motion blur,
//           radial streaks, gathered circle-of-confusion DOF, the FOV law —
//           all driven by the published FlightState
//   wetLens the dive transition as a post-process: depth-keyed underwater
//           grade, meniscus band magnification, refracting droplets
//   photo   the witness verb: framing guides, free camera, frozen world
//           time, and the journal of moments
//   stack   all of it assembled in the one correct order — what
//           reckoning.html and game.html mount wholesale
//
// The chain's law: resample first (linear), grade light second (linear),
// tone-map third, grade looks fourth (display), draw UI last.

export {
  Grade,
  GRADE_STOPS,
  CONTRAST_PIVOT,
  gradeForHour,
  neutralGrade,
  reinhardNode,
  filmicNode,
  clipNode,
  type GradeSettings,
  type Triple,
} from "./grade";
export {
  SpeedEffects,
  velocityBlurNode,
  radialStreakNode,
  cocDofNode,
  type StreakParams,
  type DofParams,
} from "./speed";
export { WetLensFx, type WetLensFxOptions } from "./wetLens";
export {
  PhotoMode,
  FramingGuides,
  FreeCamera,
  Journal,
  DEFAULT_MOMENTS,
  GUIDE_MODES,
  type GuideMode,
  type FreeCameraOptions,
  type PhotoMoment,
  type MomentContext,
} from "./photo";
export { PostFxStack, type PostFxStackOptions, type PostFxFrame } from "./stack";
