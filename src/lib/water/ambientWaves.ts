// The ambient wave table — the one set of numbers behind every calm-lake
// surface on the site, evaluated twice:
//
//   · on the CPU, by the spine's ambient water provider
//     (src/lib/spine/water.ts), for buoyancy, landings, fish, anything that
//     asks `waterHeightAt(x, z, t)`;
//   · on the GPU, by the TSL builders in ./waveNodes.ts, for the vertices
//     and normals you actually see.
//
// MIRROR WARNING: `WAVE_TABLE` and `BASE_AMP_PER_WIND` are a byte-for-byte
// mirror of the private constants in src/lib/spine/water.ts (that file is
// shared/read-only, and the GPU needs the constants too). If the spine table
// ever changes, this file must change with it — the whole point of the pair
// is that a sphere floated by `waterHeightAt` sits glued to the rendered
// surface. With `choppiness = 1` and `ampScale = 1`, `ambientWaveHeight`
// returns exactly what the spine provider returns.

import { Vector3 } from "three";

export interface AmbientWaveDef {
  /** Direction offset from the wind direction, radians. */
  angle: number;
  /** Crest-to-crest wavelength, meters. */
  wavelength: number;
  /** Amplitude as a fraction of the wind-scaled base amplitude. */
  amp: number;
  /** Phase speed, m/s (tuned for a lake's look — see note below). */
  speed: number;
}

// Five directional waves spread around the wind direction: one long swell,
// progressively shorter and weaker dressing on top. Wavelengths span 11 m
// down to 45 cm. (Honest physics note: deep-water dispersion would give the
// 11 m swell a phase speed of √(gλ/2π) ≈ 4.1 m/s; the table runs slower on
// purpose — at lake scale the dispersion-true speeds read as frantic. The
// table is the site-wide contract, so the look-tuning lives here, declared.)
export const WAVE_TABLE: readonly AmbientWaveDef[] = [
  { angle: 0.0, wavelength: 11.0, amp: 0.4, speed: 1.0 },
  { angle: 0.35, wavelength: 5.3, amp: 0.25, speed: 1.3 },
  { angle: -0.5, wavelength: 2.1, amp: 0.18, speed: 1.7 },
  { angle: 0.9, wavelength: 0.9, amp: 0.1, speed: 2.4 },
  { angle: -1.2, wavelength: 0.45, amp: 0.07, speed: 3.1 },
];

/** Base amplitude in meters per (m/s) of wind. 3 m/s of wind ≈ 10 cm swell
 *  before the per-wave fractions shrink it. Mirrors spine/water.ts. */
export const BASE_AMP_PER_WIND = 0.035;

export interface AmbientWaveParams {
  /** Wind direction in radians around +y (0 = +x). Waves are steered by it. */
  windDirection: number;
  /** Wind speed, m/s. Scales every amplitude linearly. */
  windSpeed: number;
  /**
   * Spectrum tilt: 1 leaves the table untouched (= spine parity). Above 1
   * boosts the short capillary end of the table, below 1 calms it. Wave i of
   * N is scaled by choppiness^(i/(N−1)), so the long swell never moves.
   */
  choppiness?: number;
  /** Master amplitude scale. 0 = glass, 1 = spine parity. */
  ampScale?: number;
}

/** Per-wave choppiness weight: 1 for the swell, `chop` for the shortest. */
export function chopWeight(index: number, chop: number): number {
  return Math.pow(chop, index / (WAVE_TABLE.length - 1));
}

/**
 * Surface height (relative to mean level y = 0) at world (x, z), time t.
 * With choppiness = ampScale = 1 this is exactly the spine ambient provider:
 *   h = Σ base · ampᵢ · sin((x·cos aᵢ + z·sin aᵢ)·kᵢ + t·speedᵢ·kᵢ)
 * where aᵢ = windDirection + angleᵢ and kᵢ = 2π/λᵢ.
 */
export function ambientWaveHeight(x: number, z: number, t: number, p: AmbientWaveParams): number {
  const chop = p.choppiness ?? 1;
  const base = BASE_AMP_PER_WIND * p.windSpeed * (p.ampScale ?? 1);
  let h = 0;
  for (let i = 0; i < WAVE_TABLE.length; i++) {
    const w = WAVE_TABLE[i];
    const a = p.windDirection + w.angle;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const k = (Math.PI * 2) / w.wavelength;
    h += base * w.amp * chopWeight(i, chop) * Math.sin((x * dx + z * dz) * k + t * w.speed * k);
  }
  return h;
}

/** Analytic ∂h/∂x and ∂h/∂z — the same sum, differentiated by hand. */
export function ambientWaveSlope(
  x: number,
  z: number,
  t: number,
  p: AmbientWaveParams,
  out: { dhdx: number; dhdz: number } = { dhdx: 0, dhdz: 0 },
): { dhdx: number; dhdz: number } {
  const chop = p.choppiness ?? 1;
  const base = BASE_AMP_PER_WIND * p.windSpeed * (p.ampScale ?? 1);
  let dhdx = 0;
  let dhdz = 0;
  for (let i = 0; i < WAVE_TABLE.length; i++) {
    const w = WAVE_TABLE[i];
    const a = p.windDirection + w.angle;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const k = (Math.PI * 2) / w.wavelength;
    const c = base * w.amp * chopWeight(i, chop) * k * Math.cos((x * dx + z * dz) * k + t * w.speed * k);
    dhdx += c * dx;
    dhdz += c * dz;
  }
  out.dhdx = dhdx;
  out.dhdz = dhdz;
  return out;
}

const slopeScratch = { dhdx: 0, dhdz: 0 };

/** Analytic unit normal of the ambient surface (matches the GPU's normal). */
export function ambientWaveNormal(
  x: number,
  z: number,
  t: number,
  p: AmbientWaveParams,
  target = new Vector3(),
): Vector3 {
  const s = ambientWaveSlope(x, z, t, p, slopeScratch);
  return target.set(-s.dhdx, 1, -s.dhdz).normalize();
}
