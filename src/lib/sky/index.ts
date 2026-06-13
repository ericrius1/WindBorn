// Air & Light's public API — the sky and weather contract every later series
// (interludes, grading, the game) reads:
//
//   palette     sunDirection/moonDirection from the clock hour, sun
//               elevation, and the SkyPalette (fog/ambient/sun colors keyed
//               to elevation) — the CPU side of the sky
//   atmosphere  the GPU sky: single-scattering gradient, sun disc, stars,
//               moonlight, overcast + lightning uniforms; replaces The
//               Mirror's placeholder dawn sky (same seam: uniforms +
//               skyColor(dir) + setHour)
//   fog         closed-form exponential height fog + aerial perspective,
//               with the dawn-mist schedule
//   cloudLayer  raymarched cumulus drifting on the spine wind
//   weather     the calm/breezy/storm state machine; drives the spine wind,
//               rains on the disturbance bus
//   moon        a sphere lit by the real sun (phases are geometry)
//   stars       the hashed star field and its twilight gate

export {
  LATITUDE_DEG,
  DECLINATION_DEG,
  MOON_DECLINATION_DEG,
  CELESTIAL_POLE,
  celestialDirection,
  sunDirection,
  moonDirection,
  moonDirectionLagged,
  sunElevationDeg,
  moonElevationDeg,
  skyColors,
  createSkyPalette,
  type SkyPalette,
} from "./palette";
export {
  BETA_RAYLEIGH,
  BETA_MIE,
  RAYLEIGH_THICKNESS,
  MIE_THICKNESS,
  MIE_G,
  createAtmosphere,
  type Atmosphere,
  type AtmosphereOptions,
} from "./atmosphere";
export {
  createHeightFog,
  layerDepthCpu,
  transmittanceCpu,
  mistAmountForHour,
  type HeightFog,
  type HeightFogInit,
} from "./fog";
export { CloudLayer, type CloudLayerOptions } from "./cloudLayer";
export {
  WeatherSystem,
  WEATHER_TARGETS,
  type WeatherKind,
  type WeatherTargets,
  type WeatherSystemOptions,
} from "./weather";
export { Moon, MOON_ANGULAR_RADIUS_DEG, type MoonOptions } from "./moon";
export { starFieldNode, starVisibility, celestialPole, type StarFieldOptions } from "./stars";
export { hash3, vnoise3, fbm3 } from "./noise3";
