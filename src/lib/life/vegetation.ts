// The shore: grass blades and reeds, placed by the terrain and moved by the
// wind. Placement is the Forest post's trick again — deterministic hashes
// over a candidate lattice, filtered by altitude, slope, and (for reeds)
// water depth, so every reload grows the same shoreline. The sway is a
// material: bend grows with height squared, direction and strength track
// the spine wind field, and a traveling gust wave moves through the
// population at the wind field's own gust scale.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  Vector2,
  Vector3,
} from "three/webgpu";
import type { UniformNode } from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  float,
  hash,
  instanceIndex,
  mix,
  positionLocal,
  positionWorld,
  sin,
  time,
  uniform,
  vec3,
  vertexColor,
} from "three/tsl";
import { fbm2, hash2, terrainGrid, terrainHeightAt } from "../terrain";
import { wind } from "../spine";

// ---- geometry ---------------------------------------------------------------------

const _c = new Color();
const _c2 = new Color();

function gradientStrip(
  positions: number[],
  colorsLow: number,
  colorsHigh: number,
  maxY: number,
): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  const n = positions.length / 3;
  const cols = new Float32Array(n * 3);
  _c.setHex(colorsLow);
  _c2.setHex(colorsHigh);
  for (let i = 0; i < n; i++) {
    const y = positions[i * 3 + 1] / maxY;
    const c = _c.clone().lerp(_c2, Math.min(1, Math.max(0, y)));
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new BufferAttribute(cols, 3));
  return geo;
}

/**
 * One grass blade: a tapered four-segment strip, unit height, pre-bent a
 * little so even still air doesn't look like a comb. 8 triangles.
 */
export function makeGrassBladeGeometry(): BufferGeometry {
  const segs = 4;
  const positions: number[] = [];
  const indices: number[] = [];
  const w0 = 0.022;
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    const w = (w0 * (1 - s * 0.85)) / 2;
    const lean = 0.08 * s * s; // built-in droop
    positions.push(-w, s, lean, w, s, lean);
  }
  // collapse the tip pair into a point
  positions[positions.length - 6] = 0;
  positions[positions.length - 3] = 0.0001;
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = gradientStrip(positions, 0x4a5c2a, 0x8fa14e, 1);
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * One reed (a cattail): a slim three-sided stalk, a dark seed head near the
 * top, and one arching leaf blade. Unit height. ~20 triangles.
 */
export function makeReedGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];

  // stalk: three faces around a thin taper
  const stalkPos: number[] = [];
  const stalkIdx: number[] = [];
  const sides = 3;
  const segs = 3;
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    const r = 0.008 * (1 - s * 0.5);
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      stalkPos.push(Math.cos(a) * r, s * 0.78, Math.sin(a) * r);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < sides; k++) {
      const a = i * sides + k;
      const b = i * sides + ((k + 1) % sides);
      const c = a + sides;
      const d = b + sides;
      stalkIdx.push(a, b, c, b, d, c);
    }
  }
  const stalk = gradientStrip(stalkPos, 0x5d6b35, 0x9aa05c, 0.78);
  stalk.setIndex(stalkIdx);
  stalk.computeVertexNormals();
  parts.push(stalk);

  // seed head: a brown sausage — a 4-sided prism reads fine at distance
  const headPos: number[] = [];
  const headIdx: number[] = [];
  for (let i = 0; i <= 1; i++) {
    const y = 0.78 + i * 0.16;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      headPos.push(Math.cos(a) * 0.016, y, Math.sin(a) * 0.016);
    }
  }
  for (let k = 0; k < 4; k++) {
    const a = k;
    const b = (k + 1) % 4;
    headIdx.push(a, b, a + 4, b, b + 4, a + 4);
  }
  // cap the top
  headPos.push(0, 0.955, 0);
  for (let k = 0; k < 4; k++) headIdx.push(8, 4 + k, 4 + ((k + 1) % 4));
  const head = gradientStrip(headPos, 0x4a3120, 0x5d4128, 1);
  head.setIndex(headIdx);
  head.computeVertexNormals();
  parts.push(head);

  // spike above the head
  const spike = gradientStrip([0, 0.94, 0, 0.004, 1.0, 0, -0.004, 1.0, 0], 0x8d8a5e, 0x8d8a5e, 1);
  spike.setIndex([0, 2, 1]);
  spike.computeVertexNormals();
  parts.push(spike);

  // one leaf: a narrow strip arching off the stalk
  const leafPos: number[] = [];
  const leafIdx: number[] = [];
  for (let i = 0; i <= 3; i++) {
    const s = i / 3;
    const w = 0.012 * (1 - s * 0.8);
    leafPos.push(0.01 + s * 0.16 - w, 0.18 + s * 0.5 - s * s * 0.12, 0, 0.01 + s * 0.16 + w, 0.18 + s * 0.5 - s * s * 0.12, 0.012);
  }
  for (let i = 0; i < 3; i++) {
    const a = i * 2;
    leafIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const leaf = gradientStrip(leafPos, 0x556832, 0x7d8c48, 0.78);
  leaf.setIndex(leafIdx);
  leaf.computeVertexNormals();
  parts.push(leaf);

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

// ---- placement ----------------------------------------------------------------------

export interface VegetationPlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  rand: number;
}

export interface ShoreScatterOptions {
  /** Center of the planted patch (a stretch of shoreline). */
  centerX: number;
  centerZ: number;
  /** Half-extent of the candidate square, meters. */
  extent: number;
  /** Candidate pitch, meters. */
  cell: number;
  seed: number;
  /** Altitude band for grass, meters above the lake. */
  minAltitude: number;
  maxAltitude: number;
  /** Minimum normal.y — meadows are gentle ground. */
  minUp: number;
  /** 0..1 fraction of the clump field that stays planted. */
  clumpKeep: number;
  density: number;
  useAltitude: boolean;
  useSlope: boolean;
  useClump: boolean;
}

export const DEFAULT_GRASS: ShoreScatterOptions = {
  centerX: 60,
  centerZ: 372,
  extent: 90,
  cell: 0.55,
  seed: 7121,
  minAltitude: 0.25,
  maxAltitude: 26,
  minUp: 0.8,
  clumpKeep: 0.74,
  density: 1,
  useAltitude: true,
  useSlope: true,
  useClump: true,
};

/** Grass blades for the meadow band above the beach. */
export function scatterShoreGrass(overrides: Partial<ShoreScatterOptions> = {}): VegetationPlacement[] {
  const o = { ...DEFAULT_GRASS, ...overrides };
  const grid = terrainGrid();
  const out: VegetationPlacement[] = [];
  const cells = Math.floor((o.extent * 2) / o.cell);
  const clumpFreq = 1 / 18;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      if (hash2(i, j, o.seed) > o.density) continue;
      const x = o.centerX - o.extent + (i + hash2(i, j, o.seed + 1)) * o.cell;
      const z = o.centerZ - o.extent + (j + hash2(i, j, o.seed + 2)) * o.cell;
      const h = grid.heightAt(x, z);
      if (o.useAltitude) {
        if (h < o.minAltitude || h > o.maxAltitude - 18 * hash2(i, j, o.seed + 3)) continue;
      } else if (h < 0.05) continue;
      if (o.useSlope && grid.upAt(x, z) < o.minUp) continue;
      if (o.useClump) {
        const clump = fbm2(x * clumpFreq, z * clumpFreq, { octaves: 2, seed: o.seed + 9 }) * 0.5 + 0.5;
        if (clump > o.clumpKeep) continue;
      }
      const rand = hash2(i, j, o.seed + 4);
      out.push({
        x,
        y: terrainHeightAt(x, z) - 0.01,
        z,
        scale: 0.22 + 0.3 * rand,
        yaw: rand * Math.PI * 2,
        rand,
      });
    }
  }
  return out;
}

export interface ReedScatterOptions {
  centerX: number;
  centerZ: number;
  extent: number;
  cell: number;
  seed: number;
  /** Terrain height band: reeds root from this depth up to this bank height. */
  minBed: number; // e.g. -0.7 (70 cm of water)
  maxBed: number; // e.g. +0.25 (wet bank)
  clumpKeep: number;
  density: number;
}

export const DEFAULT_REEDS: ReedScatterOptions = {
  centerX: 60,
  centerZ: 372,
  extent: 90,
  cell: 0.45,
  seed: 9337,
  minBed: -0.7,
  maxBed: 0.25,
  clumpKeep: 0.42,
  density: 1,
};

/** Reeds for the flooded margin: rooted underwater, standing into the air. */
export function scatterReeds(overrides: Partial<ReedScatterOptions> = {}): VegetationPlacement[] {
  const o = { ...DEFAULT_REEDS, ...overrides };
  const grid = terrainGrid();
  const out: VegetationPlacement[] = [];
  const cells = Math.floor((o.extent * 2) / o.cell);
  const clumpFreq = 1 / 13;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      if (hash2(i, j, o.seed) > o.density * 0.8) continue;
      const x = o.centerX - o.extent + (i + hash2(i, j, o.seed + 1)) * o.cell;
      const z = o.centerZ - o.extent + (j + hash2(i, j, o.seed + 2)) * o.cell;
      const h = grid.heightAt(x, z);
      if (h < o.minBed || h > o.maxBed) continue;
      // reeds clump much harder than grass — they spread by rhizome
      const clump = fbm2(x * clumpFreq, z * clumpFreq, { octaves: 2, seed: o.seed + 9 }) * 0.5 + 0.5;
      if (clump > o.clumpKeep) continue;
      const rand = hash2(i, j, o.seed + 4);
      out.push({
        x,
        y: terrainHeightAt(x, z) - 0.02,
        z,
        scale: 1.5 + 0.9 * rand, // total stalk height in meters
        yaw: rand * Math.PI * 2,
        rand,
      });
    }
  }
  return out;
}

const _m = new Matrix4();

/** Fill an InstancedMesh from placements (position, yaw, uniform-ish scale). */
export function fillVegetationInstances(mesh: InstancedMesh, placements: readonly VegetationPlacement[]): void {
  const count = Math.min(placements.length, mesh.instanceMatrix.count);
  for (let i = 0; i < count; i++) {
    const p = placements[i];
    const c = Math.cos(p.yaw);
    const s = Math.sin(p.yaw);
    const w = p.scale * (0.8 + 0.5 * p.rand);
    _m.set(c * w, 0, s * w, p.x, 0, p.scale, 0, p.y, -s * w, 0, c * w, p.z, 0, 0, 0, 1);
    mesh.setMatrixAt(i, _m);
  }
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
}

// ---- the sway material -----------------------------------------------------------------

export interface SwayMaterialKit {
  material: MeshStandardNodeMaterial;
  /** Bend response: how far the tip leans per m/s of wind (unit space). */
  compliance: UniformNode<"float", number>;
  /** Call once per frame with sim time: reads the spine wind field. */
  update(t: number): void;
}

export interface SwayOptions {
  /** Tip lean per m/s of wind speed, unit space. Grass ~0.045, reeds ~0.02. */
  compliance?: number;
  /** Bend exponent: 2 = grass (bends all along), 1.5 = stiffer stalks. */
  exponent?: number;
  /** Where the wind is sampled for the uniform, world space. */
  probeX?: number;
  probeZ?: number;
  /** Per-instance tint variation toward straw, 0..1. */
  strawiness?: number;
}

/**
 * Wind sway in the vertex stage. Direction and mean strength come from the
 * spine wind field (sampled once per frame on the CPU — one sample, ten
 * thousand blades). Spatial variation rides a traveling wave through world
 * space at the wind field's own gust scale, plus a per-instance flutter
 * phase, so gusts visibly MOVE through the meadow instead of pumping it
 * in unison.
 */
export function makeSwayMaterial(opts: SwayOptions = {}): SwayMaterialKit {
  const compliance = uniform(opts.compliance ?? 0.045);
  const exponent = opts.exponent ?? 2;
  const uDir = uniform(new Vector2(1, 0));
  const uSpeed = uniform(3);
  const probe = new Vector3(opts.probeX ?? 0, 1.5, opts.probeZ ?? 0);

  const material = new MeshStandardNodeMaterial();
  material.side = DoubleSide;

  const ph = hash(float(instanceIndex).add(733.1)).mul(Math.PI * 2);
  const y = positionLocal.y.max(0);
  const bendShape = y.pow(exponent);

  // gust wave: phase advances along the wind direction at the wind's speed,
  // wavelength = the wind field's 60 m gust scale
  const k = (Math.PI * 2) / 60;
  const along = positionWorld.x.mul(uDir.x).add(positionWorld.z.mul(uDir.y));
  const gust = sin(along.mul(k).sub(time.mul(uSpeed.mul(k))).add(ph.mul(0.25)))
    .mul(0.5)
    .add(0.5);

  // per-blade flutter on top — fast, small, phase-hashed
  const flutter = sin(time.mul(5.3).add(ph.mul(7))).mul(0.18);

  const lean = compliance.mul(uSpeed).mul(bendShape).mul(gust.mul(0.85).add(0.35).add(flutter));
  material.positionNode = positionLocal.add(vec3(lean.mul(uDir.x), lean.mul(-0.18).mul(bendShape.min(1)), lean.mul(uDir.y)));

  const straw = hash(float(instanceIndex).add(99.7)).mul(opts.strawiness ?? 0.5);
  material.colorNode = vertexColor().mul(mix(vec3(1, 1, 1), vec3(1.25, 1.1, 0.7), straw));
  material.roughnessNode = float(0.92);
  material.metalnessNode = float(0);

  const sample = new Vector3();
  return {
    material,
    compliance,
    update(t: number): void {
      wind.sample(probe.x, probe.y, probe.z, t, sample);
      const speed = Math.hypot(sample.x, sample.z);
      if (speed > 1e-4) uDir.value.set(sample.x / speed, sample.z / speed);
      uSpeed.value = speed;
    },
  };
}
