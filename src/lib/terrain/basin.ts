// The basin: one analytic height function for the whole valley.
//
// `terrainHeightAt(x, z)` is the canonical terrain query for the entire site.
// Water sits at world y = 0 (see src/lib/spine/water.ts); this function is
// negative under the lake (bathymetry), positive on land, and the shoreline
// is wherever it crosses zero. Fish ask it how deep the water is, the
// shallow-water sim reads its depth term, ridge lift differentiates it, and
// every terrain mesh on the site displaces by it — CPU and GPU evaluate the
// same composition (see ./terrainNodes.ts for the TSL twin; the two files
// must stay in lockstep, constant for constant).
//
// The shape, from the inside out:
//   bowl    — the tarn: a flat-floored depression, deepest under the headwall
//   shore   — a definite beach slope crossing y = 0 at the shore radius
//   rise    — the rim: terrain climbs from the shore to the crest ring
//   settle  — beyond the crest the world eases down but stays mountainous
//   ridges  — warped ridged fBm, masked so it grows with distance from shore
//   outlet  — an angular notch where the rim drops to a low lip and a valley
//             floor descends away downstream (every tarn drains somewhere)
//
// Everything is a pure function of (x, z): no stored heightmap, no files,
// the same mountain every time anyone asks.

import { Vector2, Vector3 } from "three";
import { fbm2, smooth01 } from "./noise";

export interface BasinParams {
  seed: number;

  // Domain warp: coordinates are bent before anything radial or fractal
  // looks at them, so no circle survives as a circle.
  warpAmp: number; // meters of displacement
  warpFreq: number; // 1/m
  warpOctaves: number;

  // The lake bowl.
  shoreRadius: number; // nominal shoreline radius, meters
  bowlDepth: number; // deepest point of the tarn, meters
  bowlOffsetX: number; // deepest point sits off-center, under the headwall
  bowlOffsetZ: number;
  shoreSlope: number; // beach gradient through y = 0
  shoreClampLo: number; // the linear beach term saturates at these offsets
  shoreClampHi: number;

  // The rim ring.
  crestRadius: number; // distance of the crest ring
  rimHeight: number; // skeleton height at the crest, before ridges
  outerHeight: number; // skeleton height far beyond the crest
  settleRadius: number; // where the far world levels out

  // Ridged mountains.
  mountainAmp: number;
  mountainFreq: number;
  mountainOctaves: number;
  ridge: number; // 0 = billows, 1 = knife crests
  gain: number;
  envInner: number; // ridge amplitude is zero inside this radius…
  envOuter: number; // …and full beyond this one
  envFar: number; // fraction of amplitude removed out past the crest

  // The outlet.
  outletAngle: number; // radians, direction the lake drains toward
  outletWidth: number; // angular half-width of the notch
  lipHeight: number; // height of the outlet lip above the water
  outletFall: number; // valley floor gradient downstream (negative = descends)

  // Detail layers.
  shoreNoiseAmp: number; // roughens the coast band
  shoreNoiseFreq: number;
  shoreBandWidth: number; // gaussian width of the coast band, meters
  bedAmp: number; // gentle relief on the lakebed
  bedFreq: number;
  bedOctaves: number;
}

// The world. Tuned so: lake ~0.3 km² at y=0, shoreline meanders between
// roughly 230 m and 420 m from the origin, crest ring peaks around +600 m,
// the outlet lip holds the lake at +4 m, and the deepest sounding (~-30 m)
// sits south-west of center under the headwall.
export const BASIN: BasinParams = {
  seed: 1847,

  warpAmp: 110,
  warpFreq: 1 / 640,
  warpOctaves: 3,

  shoreRadius: 320,
  bowlDepth: 26,
  bowlOffsetX: -120,
  bowlOffsetZ: 75,
  shoreSlope: 0.065,
  shoreClampLo: -90,
  shoreClampHi: 140,

  crestRadius: 1150,
  rimHeight: 360,
  outerHeight: 190,
  settleRadius: 2700,

  mountainAmp: 290,
  mountainFreq: 1 / 520,
  mountainOctaves: 5,
  ridge: 0.85,
  gain: 0.5,
  envInner: 360,
  envOuter: 700,
  envFar: 0.55,

  outletAngle: -0.55,
  outletWidth: 0.5,
  lipHeight: 4,
  outletFall: -0.0035,

  shoreNoiseAmp: 3,
  shoreNoiseFreq: 1 / 60,
  shoreBandWidth: 110,
  bedAmp: 5,
  bedFreq: 1 / 90,
  bedOctaves: 3,
};

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Build a height evaluator for a parameter set. The default world is
 * `terrainHeightAt` below; demos build variants of this to put sliders on.
 */
export function makeBasinHeight(params: Partial<BasinParams> = {}): (x: number, z: number) => number {
  const p: BasinParams = { ...BASIN, ...params };

  return (x: number, z: number): number => {
    // -- domain warp ----------------------------------------------------------
    const wq = p.warpFreq;
    const u = fbm2(x * wq, z * wq, { octaves: p.warpOctaves, seed: p.seed + 101 });
    const v = fbm2(x * wq + 19.7, z * wq - 7.3, { octaves: p.warpOctaves, seed: p.seed + 211 });
    const wx = x + p.warpAmp * u;
    const wz = z + p.warpAmp * v;
    const r = Math.sqrt(wx * wx + wz * wz);

    // -- radial skeleton ------------------------------------------------------
    // Tarn bowl: flat floor, walls easing to zero influence at the shore.
    const bx = wx - p.bowlOffsetX;
    const bz = wz - p.bowlOffsetZ;
    const rb = Math.sqrt(bx * bx + bz * bz) / p.shoreRadius;
    const bowl = -p.bowlDepth * (1 - smooth01(0.45, 1.0, rb));

    // Beach: a clamped linear ramp gives the shoreline a definite slope, so
    // the zero crossing is crisp instead of a marsh.
    const shore = clamp(r - p.shoreRadius, p.shoreClampLo, p.shoreClampHi) * p.shoreSlope;

    // Rim and settle.
    const rise = smooth01(p.shoreRadius, p.crestRadius, r);
    const settle = smooth01(p.crestRadius, p.settleRadius, r);
    let h = bowl + shore + p.rimHeight * rise - (p.rimHeight - p.outerHeight) * settle;

    // -- mountains -------------------------------------------------------------
    const env = smooth01(p.envInner, p.envOuter, r) * (1 - p.envFar * settle);
    const m = fbm2(wx * p.mountainFreq, wz * p.mountainFreq, {
      octaves: p.mountainOctaves,
      ridge: p.ridge,
      gain: p.gain,
      seed: p.seed,
    });
    h += p.mountainAmp * env * m;

    // -- coast and lakebed detail ----------------------------------------------
    const bandT = (r - p.shoreRadius) / p.shoreBandWidth;
    const band = Math.exp(-bandT * bandT);
    h += p.shoreNoiseAmp * band * fbm2(wx * p.shoreNoiseFreq, wz * p.shoreNoiseFreq, { octaves: 3, seed: p.seed + 57 });

    const bedMask = 1 - smooth01(0.5, 0.85, rb);
    h += p.bedAmp * bedMask * fbm2(wx * p.bedFreq, wz * p.bedFreq, { octaves: p.bedOctaves, seed: p.seed + 71 });

    // -- the outlet --------------------------------------------------------------
    // Clamp everything inside an angular wedge down to a descending valley
    // floor. min() keeps the lake bowl itself untouched (it is already lower).
    const ang = Math.atan2(wz, wx);
    let d = Math.abs(ang - p.outletAngle);
    d = Math.min(d, TAU - d);
    const notch = Math.exp(-(d / p.outletWidth) * (d / p.outletWidth));
    const outside = smooth01(p.shoreRadius * 0.55, p.shoreRadius * 1.1, r);
    const floorH = p.lipHeight + (r - p.shoreRadius) * p.outletFall;
    const w = notch * outside;
    h += (Math.min(h, floorH) - h) * w;

    return h;
  };
}

/**
 * THE canonical terrain query. World y in meters at world (x, z); negative
 * values are under the lake. Every series reads this one function.
 */
export const terrainHeightAt: (x: number, z: number) => number = /* @__PURE__ */ makeBasinHeight();

/** Water depth at calm surface level (y = 0). Zero on land. */
export function waterDepthAt(x: number, z: number): number {
  return Math.max(0, -terrainHeightAt(x, z));
}

const NEPS = 1.0;

/** Outward unit normal of the terrain surface, by central differences. */
export function terrainNormalAt(x: number, z: number, target = new Vector3()): Vector3 {
  const hL = terrainHeightAt(x - NEPS, z);
  const hR = terrainHeightAt(x + NEPS, z);
  const hD = terrainHeightAt(x, z - NEPS);
  const hU = terrainHeightAt(x, z + NEPS);
  return target.set(hL - hR, 2 * NEPS, hD - hU).normalize();
}

// ---- fast approximate queries -------------------------------------------------
// The exact function costs ~14 gradient-noise evaluations. Things that ask
// thousands of times per frame (wind influences, fish, scatter filters) go
// through a bilinear lattice cache instead: build once, then ~50 ns a query.

export class TerrainGrid {
  readonly minX: number;
  readonly minZ: number;
  readonly cell: number;
  readonly res: number;
  private readonly data: Float32Array;

  constructor(halfExtent = 1600, res = 512, height: (x: number, z: number) => number = terrainHeightAt) {
    this.minX = -halfExtent;
    this.minZ = -halfExtent;
    this.res = res;
    this.cell = (halfExtent * 2) / res;
    this.data = new Float32Array((res + 1) * (res + 1));
    for (let j = 0; j <= res; j++) {
      const z = this.minZ + j * this.cell;
      for (let i = 0; i <= res; i++) {
        this.data[j * (res + 1) + i] = height(this.minX + i * this.cell, z);
      }
    }
  }

  /** Bilinear height. Clamped at the lattice edge. */
  heightAt(x: number, z: number): number {
    const res = this.res;
    const fx = clamp((x - this.minX) / this.cell, 0, res - 1e-6);
    const fz = clamp((z - this.minZ) / this.cell, 0, res - 1e-6);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const row = j * (res + 1) + i;
    const h00 = this.data[row];
    const h10 = this.data[row + 1];
    const h01 = this.data[row + res + 1];
    const h11 = this.data[row + res + 2];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  /** Height gradient (∂h/∂x, ∂h/∂z) by central differences on the lattice. */
  gradientAt(x: number, z: number, target = new Vector2()): Vector2 {
    const e = this.cell;
    return target.set(
      (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e),
      (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e),
    );
  }

  /** normal.y of the surface — 1 is flat ground, 0 is a wall. */
  upAt(x: number, z: number): number {
    const g = this.gradientAt(x, z, sharedGrad);
    return 1 / Math.sqrt(1 + g.x * g.x + g.y * g.y);
  }
}

const sharedGrad = new Vector2();

let defaultGrid: TerrainGrid | null = null;

/** Lazy page-wide cache over the canonical terrain (±1600 m, 6.25 m cells). */
export function terrainGrid(): TerrainGrid {
  defaultGrid ??= new TerrainGrid();
  return defaultGrid;
}
