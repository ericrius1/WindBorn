// The Mirror's library: everything other series need to put convincing
// water in a scene.
//
//   ambientWaves     CPU wave table (mirrors the spine provider)
//   waveNodes        the same table as TSL height/slope/normal builders
//   opticsNodes      Fresnel, Beer–Lambert, sun glint, dispersion speed
//   dawnSky          minimal dawn sky + sun uniforms (TODO(sky): replace)
//   planarReflection mirrored-camera render-to-texture for flat water
//   rippleRings      disturbance-bus events → expanding ring packets
//   lakeSurface      the assembled surface material (the finale's export)

export {
  WAVE_TABLE,
  BASE_AMP_PER_WIND,
  chopWeight,
  ambientWaveHeight,
  ambientWaveSlope,
  ambientWaveNormal,
  type AmbientWaveDef,
  type AmbientWaveParams,
} from "./ambientWaves";
export {
  createWaveUniforms,
  waveHeightNode,
  waveSlopeNode,
  waveNormalNode,
  waveParamsFromUniforms,
  type WaveUniformInit,
  type WaveUniforms,
} from "./waveNodes";
export {
  WATER_IOR,
  f0FromIor,
  fresnelSchlick,
  fresnelExact,
  beerLambert,
  sunGlint,
  phaseSpeed,
  phaseSpeedCpu,
} from "./opticsNodes";
export { createDawnSky, type DawnSky } from "./dawnSky";
export { PlanarReflection } from "./planarReflection";
export { RippleRings, MAX_RINGS } from "./rippleRings";
export { LakeSurface, type LakeSurfaceOptions, type LakeEnvironment, type LakeBed } from "./lakeSurface";
