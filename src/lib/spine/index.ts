// The spine: four shared systems every series plugs into.
//   wind        — one wind field (flight, ripples, clouds, grass, audio)
//   water       — surface height/normal queries, swappable provider
//   clock       — one time-of-day signal
//   disturbance — the bus anything uses to touch the water

export { wind, WindField, type WindInfluence } from "./wind";
export {
  WATER_LEVEL,
  waterHeightAt,
  waterNormalAt,
  waterProvider,
  setWaterProvider,
  ambientWater,
  type WaterProvider,
} from "./water";
export { clock, WorldClock } from "./clock";
export { disturb, onDisturbance, type Disturbance, type DisturbanceKind } from "./disturbance";
