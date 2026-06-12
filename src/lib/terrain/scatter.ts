// Deterministic scatter: where every tree, snag, boulder, and grass tuft in
// the valley stands. No randomness survives a reload — placement is a pure
// function of the integer cell grid and the seed, so the forest you learn
// is the forest you keep, and every series that asks for the perch list
// gets the same answer.
//
// The rules (each one is a toggle in the Forest post's demos):
//   altitude — trees live between the wet beach and the treeline, with a
//              noise-raggedy upper edge (no straight lines on a mountain)
//   slope    — nothing roots on ground steeper than ~44° (normal.y < 0.72)
//   clumping — a broad noise field thins the forest into groves + clearings
//   density  — a per-cell hash keeps the survivor count tunable
//
// Filters run against the fast TerrainGrid; the final planted height is the
// exact analytic terrainHeightAt so trunks sit ON the surface.

import { fbm2, hash2, smooth01 } from "./noise";
import { TREELINE } from "./surface";
import { terrainGrid, terrainHeightAt } from "./basin";
import { makeSnagGeometry } from "./conifer";

export interface TreePlacement {
  x: number;
  y: number;
  z: number;
  /** Tree height in meters (instance scale of the unit geometry). */
  scale: number;
  /** 0..1 deterministic per-tree random, for tint variation. */
  rand: number;
}

export interface SnagPlacement extends TreePlacement {
  yaw: number;
}

export interface ScatterRules {
  /** Candidate grid pitch in meters. Default 3. */
  cell: number;
  /** Half-extent of the planted square, meters. Default 1500. */
  extent: number;
  minAltitude: number;
  treeline: number;
  /** Minimum normal.y (1 = flat). Default 0.72 ≈ slopes under 44°. */
  minUp: number;
  /** 0..1 — fraction of the clump field that stays forest. Default 0.62. */
  clumpKeep: number;
  /** 0..1 global thinning. Default 1. */
  density: number;
  /** Per-tree snag odds inside the shore band. Default 0.0035. */
  snagChance: number;
  useAltitude: boolean;
  useSlope: boolean;
  useClump: boolean;
  seed: number;
}

export const DEFAULT_RULES: ScatterRules = {
  cell: 3,
  extent: 1500,
  minAltitude: 3,
  treeline: TREELINE,
  minUp: 0.72,
  clumpKeep: 0.62,
  density: 1,
  snagChance: 0.0035,
  useAltitude: true,
  useSlope: true,
  useClump: true,
  seed: 4101,
};

export interface ForestData {
  trees: TreePlacement[];
  snags: SnagPlacement[];
}

/** Run the scatter. ~1M candidate cells at the default rules; a few hundred ms. */
export function scatterForest(overrides: Partial<ScatterRules> = {}): ForestData {
  const r: ScatterRules = { ...DEFAULT_RULES, ...overrides };
  const grid = terrainGrid();
  const trees: TreePlacement[] = [];
  const snags: SnagPlacement[] = [];
  const cells = Math.floor((r.extent * 2) / r.cell);
  const clumpFreq = 1 / 95;

  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const keep = hash2(i, j, r.seed);
      if (keep > r.density) continue;

      const x = -r.extent + (i + hash2(i, j, r.seed + 1)) * r.cell;
      const z = -r.extent + (j + hash2(i, j, r.seed + 2)) * r.cell;

      // cheap filters on the cached lattice first
      const h = grid.heightAt(x, z);
      if (r.useAltitude) {
        const raggedTop = r.treeline - 30 * hash2(i, j, r.seed + 3);
        if (h < r.minAltitude || h > raggedTop) continue;
      } else if (h < 0.2) {
        continue; // trees underwater help nobody, whatever the demo toggles say
      }
      if (r.useSlope && grid.upAt(x, z) < r.minUp) continue;
      if (r.useClump) {
        const clump = fbm2(x * clumpFreq, z * clumpFreq, { octaves: 2, seed: r.seed + 9 }) * 0.5 + 0.5;
        if (clump > r.clumpKeep) continue;
      }

      // survivors get the exact height so trunks sit on the real surface
      const y = terrainHeightAt(x, z) - 0.25;
      const rand = hash2(i, j, r.seed + 4);

      // krummholz: trees shrink toward the treeline
      const shrink = r.useAltitude ? 1 - 0.55 * smooth01(r.treeline - 70, r.treeline, h) : 1;
      const scale = (7 + 7 * rand) * shrink;

      // a few shoreline trees die standing and become perches
      if (h < 40 && hash2(i, j, r.seed + 5) < r.snagChance) {
        snags.push({ x, y, z, scale: scale * 1.15, rand, yaw: hash2(i, j, r.seed + 6) * Math.PI * 2 });
      } else {
        trees.push({ x, y, z, scale, rand });
      }
    }
  }
  return { trees, snags };
}

// ---- ground scatter ---------------------------------------------------------------

export interface GroundPlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  rand: number;
}

/** Boulders for the scree aprons and moraine: mid-steep ground above the forest floor. */
export function scatterBoulders(extent = 1200, cell = 11, seed = 5207): GroundPlacement[] {
  const grid = terrainGrid();
  const out: GroundPlacement[] = [];
  const cells = Math.floor((extent * 2) / cell);
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      if (hash2(i, j, seed) > 0.55) continue;
      const x = -extent + (i + hash2(i, j, seed + 1)) * cell;
      const z = -extent + (j + hash2(i, j, seed + 2)) * cell;
      const h = grid.heightAt(x, z);
      if (h < 1 || h > 420) continue;
      const up = grid.upAt(x, z);
      if (up < 0.55 || up > 0.88) continue; // the talus band
      const y = terrainHeightAt(x, z) - 0.1;
      const rand = hash2(i, j, seed + 3);
      out.push({ x, y, z, scale: 0.35 + 1.4 * rand * rand, yaw: rand * Math.PI * 2, rand });
    }
  }
  return out;
}

/** Grass tufts for the meadow ring near the shore. */
export function scatterTufts(extent = 800, cell = 4, seed = 6113): GroundPlacement[] {
  const grid = terrainGrid();
  const out: GroundPlacement[] = [];
  const cells = Math.floor((extent * 2) / cell);
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      if (hash2(i, j, seed) > 0.7) continue;
      const x = -extent + (i + hash2(i, j, seed + 1)) * cell;
      const z = -extent + (j + hash2(i, j, seed + 2)) * cell;
      const h = grid.heightAt(x, z);
      if (h < 0.6 || h > 90) continue;
      if (grid.upAt(x, z) < 0.85) continue; // meadows are gentle
      const y = terrainHeightAt(x, z);
      const rand = hash2(i, j, seed + 3);
      out.push({ x, y, z, scale: 0.6 + 0.9 * rand, yaw: rand * Math.PI * 2, rand });
    }
  }
  return out;
}

// ---- perch data ----------------------------------------------------------------------
// Published for everything downstream: the nest series needs THE snag, the
// fish-carry needs a target, the game needs landing spots with a facing.

export type PerchKind = "nest" | "snag-top" | "branch";

export interface PerchPoint {
  x: number;
  y: number;
  z: number;
  kind: PerchKind;
  /** World yaw the perch faces (radians around +y, 0 = +x). */
  yaw: number;
}

/**
 * THE nest snag: a grand dead pine on the north-shore promontory, found by
 * scanning the shoreline for low, flat ground with open water on most
 * sides. Its top is the nest site of the entire game.
 */
export const NEST_SNAG: SnagPlacement = {
  x: -46,
  z: 375,
  y: 0, // resolved against the real terrain below
  scale: 16,
  rand: 0.5,
  // face the open water: toward the lake center
  yaw: Math.atan2(0 - 375, 0 - -46),
};
NEST_SNAG.y = terrainHeightAt(NEST_SNAG.x, NEST_SNAG.z) - 0.25;

let cachedForest: ForestData | null = null;

/** The canonical forest (default rules), built once per page. */
export function defaultForest(): ForestData {
  cachedForest ??= scatterForest();
  return cachedForest;
}

let cachedPerches: PerchPoint[] | null = null;

/**
 * Every perch in the valley, world space: the nest spar first, then each
 * snag's top and branch tips. Deterministic — safe to treat as level data.
 */
export function perchPoints(): PerchPoint[] {
  if (cachedPerches) return cachedPerches;
  const { perchOffsets, geometry } = makeSnagGeometry();
  geometry.dispose(); // only the offsets are needed here

  const points: PerchPoint[] = [];
  const add = (s: SnagPlacement, isNest: boolean): void => {
    const cos = Math.cos(s.yaw);
    const sin = Math.sin(s.yaw);
    perchOffsets.forEach((o, i) => {
      const wx = s.x + (o.x * cos - o.z * sin) * s.scale;
      const wz = s.z + (o.x * sin + o.z * cos) * s.scale;
      const wy = s.y + o.y * s.scale;
      const kind: PerchKind = isNest && i === 0 ? "nest" : i === 0 ? "snag-top" : "branch";
      // branches face outward along their own direction; tops face the snag's yaw
      const yaw = i === 0 ? s.yaw : Math.atan2(wz - s.z, wx - s.x);
      points.push({ x: wx, y: wy, z: wz, kind, yaw });
    });
  };

  add(NEST_SNAG, true);
  for (const s of defaultForest().snags) add(s, false);
  cachedPerches = points;
  return cachedPerches;
}
