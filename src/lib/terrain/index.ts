// The Basin's public API. Everything other series should need:
//
//   terrainHeightAt(x, z)  — THE canonical terrain query (y in meters;
//                            negative under the lake, shoreline at zero)
//   waterDepthAt(x, z)     — convenience: max(0, -terrainHeightAt)
//   terrainNormalAt        — surface normal by central differences
//   terrainGrid()          — fast bilinear cache for per-frame swarms
//   terrainHeightNode      — the GPU twin (TSL), plus the noise builders
//   perchPoints()/NEST_SNAG — published perch data for the nest & the hunt
//   registerRidgeLift()    — adds terrain lift to the spine wind field

export {
  BASIN,
  makeBasinHeight,
  terrainHeightAt,
  terrainNormalAt,
  waterDepthAt,
  terrainGrid,
  TerrainGrid,
  type BasinParams,
} from "./basin";
export { fbm2, perlin2, hash2, smooth01, type FbmParams } from "./noise";
export {
  hashNode,
  perlinNode,
  fbm2Node,
  makeBasinHeightNode,
  terrainHeightNode,
  terrainNormalNode,
  type BasinOverrides,
  type FbmNodeParams,
} from "./terrainNodes";
export { ClipmapTerrain, type ClipmapOptions } from "./clipmap";
export { terrainSurfaceColor, terrainRoughness, TREELINE, SNOWLINE, type SurfaceColorOptions } from "./surface";
export {
  makeConiferGeometry,
  makeSnagGeometry,
  makeBoulderGeometry,
  makeTuftGeometry,
} from "./conifer";
export {
  scatterForest,
  scatterBoulders,
  scatterTufts,
  defaultForest,
  perchPoints,
  NEST_SNAG,
  DEFAULT_RULES,
  type ForestData,
  type TreePlacement,
  type SnagPlacement,
  type GroundPlacement,
  type PerchPoint,
  type PerchKind,
  type ScatterRules,
} from "./scatter";
export { makeRidgeLiftInfluence, registerRidgeLift, type RidgeLiftOptions } from "./ridgeLift";
