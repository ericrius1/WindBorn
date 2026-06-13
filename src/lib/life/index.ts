// The Alive series' public API — the ecosystem the game reads. The hunt
// never gets UI markers; it gets THIS: fish positions and rise events,
// hatch intensity by hour, the other wings, and a shore that moves.
//
//   FishSchool       — boids + bathymetry; rises go out on the disturbance
//                      bus and stay queryable in `school.rises`
//   hatchIntensity   — 0..1 by clock hour; HatchSwarm runs the life cycle
//   SwallowFlock     — skim runs writing `skim` events onto the bus
//   GooseSkein       — the emergent V (upwashOffset is the derivation)
//   EaglePatrol      — thermal circles + glides; the future fish-thief
//   scatterShoreGrass / scatterReeds — deterministic shoreline planting
//   createDuskLight  — stand-in golden-hour light keyed to clock.hour
//                      (TODO(life): adopt src/lib/sky palette once stable)

export {
  FishSchool,
  DEFAULT_SCHOOL,
  type Fish,
  type RiseEvent,
  type SchoolParams,
  type FoodTarget,
  type SchoolUpdateOptions,
  type BottomSampler,
} from "./school";
export {
  makeFishGeometry,
  makeFishMaterial,
  fillFishInstances,
  GlintField,
  type FishMaterialKit,
} from "./fishGeometry";
export {
  hatchIntensity,
  HatchSwarm,
  DEFAULT_HATCH,
  NYMPH,
  DUN,
  FLYING,
  SPINNER,
  SPENT,
  type Mayfly,
  type MayflyStage,
  type HatchParams,
  type StageCounts,
} from "./hatch";
export {
  makeMayflyGeometry,
  makeMayflyMaterial,
  fillMayflyInstances,
  type MayflyMaterialKit,
} from "./mayflyGeometry";
export {
  SwallowFlock,
  GooseSkein,
  EaglePatrol,
  upwashOffset,
  DEFAULT_SWALLOWS,
  DEFAULT_SKEIN,
  DEFAULT_EAGLE,
  SWALLOW_WANDER,
  SWALLOW_DIVE,
  SWALLOW_SKIM,
  SWALLOW_CLIMB,
  EAGLE_CIRCLE,
  EAGLE_GLIDE,
  type Swallow,
  type SwallowFlockParams,
  type Goose,
  type SkeinParams,
  type EagleParams,
} from "./flocks";
export {
  makeSwallowGeometry,
  makeGooseGeometry,
  makeEagleGeometry,
  makeFlapMaterial,
  setBirdMatrix,
  SWALLOW_HINGE,
  GOOSE_HINGE,
  EAGLE_HINGE,
  type FlapMaterialKit,
} from "./flockBirds";
export {
  makeGrassBladeGeometry,
  makeReedGeometry,
  scatterShoreGrass,
  scatterReeds,
  fillVegetationInstances,
  makeSwayMaterial,
  DEFAULT_GRASS,
  DEFAULT_REEDS,
  type VegetationPlacement,
  type ShoreScatterOptions,
  type ReedScatterOptions,
  type SwayMaterialKit,
  type SwayOptions,
} from "./vegetation";
export { createDuskLight, goldenness, type DuskLight } from "./dusklight";
