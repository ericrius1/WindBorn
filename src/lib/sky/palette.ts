// The sky's two pure functions: where the sun is, and what color everything
// is because of it. No GPU here — just astronomy reduced to a rotation and a
// palette keyed to sun elevation. Every other module in this series (and the
// grading/fog work in later series) reads these two.

import { Color, Vector3 } from "three";

const DEG = Math.PI / 180;

// Stillwater sits at a mid-northern mountain latitude, and the series fixes
// the date in mid-April — when ospreys return to northern lakes. Fixing the
// declination means one season, forever: an honest simplification, stated.
export const LATITUDE_DEG = 46.6;
export const DECLINATION_DEG = 5.0;

// The moon is modeled as full and (almost) opposite the sun: its hour angle
// is the sun's plus 12 hours, with its own slight declination so the paths
// don't mirror exactly. No phases, no 50-minutes-later-each-night lag.
export const MOON_DECLINATION_DEG = -3.0;

const sinLat = Math.sin(LATITUDE_DEG * DEG);
const cosLat = Math.cos(LATITUDE_DEG * DEG);

// Direction TOWARD a body with declination `decl` at hour angle H(hour),
// in world space: +x east, +y up, -z north. Derived by expressing the body
// in equatorial coordinates and rotating the frame down by the latitude.
function celestialDirection(hour: number, declRad: number, target: Vector3): Vector3 {
  const H = (hour - 12) * 15 * DEG; // hour angle: 0 at solar noon, +west
  const sinD = Math.sin(declRad);
  const cosD = Math.cos(declRad);
  const cosH = Math.cos(H);
  const east = -cosD * Math.sin(H);
  const up = cosLat * cosD * cosH + sinLat * sinD;
  const north = sinD * cosLat - cosD * cosH * sinLat;
  return target.set(east, up, -north).normalize();
}

// Unit vector toward the sun for a clock hour (0–24). Solar time == clock
// time here: no equation of time, no refraction, fixed declination.
export function sunDirection(hour: number, target = new Vector3()): Vector3 {
  return celestialDirection(hour, DECLINATION_DEG * DEG, target);
}

// Unit vector toward the (always-full) moon: opposite-ish the sun.
export function moonDirection(hour: number, target = new Vector3()): Vector3 {
  return celestialDirection(hour + 12, MOON_DECLINATION_DEG * DEG, target);
}

// Sun elevation in degrees above the horizon (negative = below).
export function sunElevationDeg(hour: number): number {
  const H = (hour - 12) * 15 * DEG;
  const d = DECLINATION_DEG * DEG;
  const s = sinLat * Math.sin(d) + cosLat * Math.cos(d) * Math.cos(H);
  return Math.asin(Math.max(-1, Math.min(1, s))) / DEG;
}

// ---- the palette -------------------------------------------------------------
// One struct of colors + light intensities, interpolated over sun elevation.
// This is the contract other series reuse: fog color for aerial perspective,
// sun/ambient for grading, horizon/zenith for anything that fakes a sky.

export interface SkyPalette {
  zenith: Color; // sky straight up
  horizon: Color; // sky at the horizon ring
  sun: Color; // sun disk / direct light tint
  ambient: Color; // hemisphere fill
  fog: Color; // what far things fade toward (aerial perspective target)
  sunIntensity: number; // 0..~1.2, scale for a DirectionalLight
  ambientIntensity: number; // 0..~0.6, scale for ambient/hemisphere fill
  elevation: number; // sun elevation in degrees, for convenience
}

export function createSkyPalette(): SkyPalette {
  return {
    zenith: new Color(),
    horizon: new Color(),
    sun: new Color(),
    ambient: new Color(),
    fog: new Color(),
    sunIntensity: 0,
    ambientIntensity: 0,
    elevation: 0,
  };
}

interface Stop {
  e: number; // sun elevation in degrees
  zenith: number;
  horizon: number;
  sun: number;
  ambient: number;
  fog: number;
  sunI: number;
  ambI: number;
}

// Hand-tuned stops. Elevations: deep night, late nautical twilight, blue
// hour, sunrise, golden hour, morning, midday. (At this latitude and date
// the sun tops out near 48°, so the last stop is the noon look.)
const STOPS: Stop[] = [
  { e: -18, zenith: 0x040609, horizon: 0x0a0f1a, sun: 0x000000, ambient: 0x0e131d, fog: 0x0a0f1a, sunI: 0, ambI: 0.05 },
  { e: -10, zenith: 0x060a16, horizon: 0x14203a, sun: 0x000000, ambient: 0x131a2a, fog: 0x121c33, sunI: 0, ambI: 0.08 },
  { e: -5, zenith: 0x0d1a36, horizon: 0x33486e, sun: 0xb35327, ambient: 0x1f2a44, fog: 0x2e4063, sunI: 0.02, ambI: 0.14 },
  { e: -1, zenith: 0x1b3158, horizon: 0xd97a45, sun: 0xff7e36, ambient: 0x3a4263, fog: 0x8a6a5e, sunI: 0.18, ambI: 0.22 },
  { e: 4, zenith: 0x2c5694, horizon: 0xffac6e, sun: 0xffb46e, ambient: 0x5f6488, fog: 0xb98e74, sunI: 0.85, ambI: 0.38 },
  { e: 12, zenith: 0x3168b4, horizon: 0xc4d6e4, sun: 0xffe8c4, ambient: 0x8c9cb4, fog: 0xbccddc, sunI: 1.05, ambI: 0.5 },
  { e: 35, zenith: 0x2a64c8, horizon: 0xb6d0e6, sun: 0xfff4e2, ambient: 0xa4b4c6, fog: 0xb6d0e6, sunI: 1.15, ambI: 0.58 },
  { e: 70, zenith: 0x2459c0, horizon: 0xaccae4, sun: 0xfff8ee, ambient: 0xa8b8ca, fog: 0xaccae4, sunI: 1.2, ambI: 0.6 },
];

const scratchA = new Color();
const scratchB = new Color();

function lerpHex(out: Color, a: number, b: number, t: number): void {
  scratchA.setHex(a);
  scratchB.setHex(b);
  out.lerpColors(scratchA, scratchB, t);
}

// The palette for a clock hour. Pass a target to avoid per-frame allocation.
export function skyColors(hour: number, target: SkyPalette = createSkyPalette()): SkyPalette {
  const e = sunElevationDeg(hour);
  target.elevation = e;

  let i = 0;
  while (i < STOPS.length - 2 && e > STOPS[i + 1].e) i++;
  const s0 = STOPS[i];
  const s1 = STOPS[i + 1];
  let t = (e - s0.e) / (s1.e - s0.e);
  t = Math.max(0, Math.min(1, t));
  t = t * t * (3 - 2 * t); // ease each segment so stop boundaries don't show

  lerpHex(target.zenith, s0.zenith, s1.zenith, t);
  lerpHex(target.horizon, s0.horizon, s1.horizon, t);
  lerpHex(target.sun, s0.sun, s1.sun, t);
  lerpHex(target.ambient, s0.ambient, s1.ambient, t);
  lerpHex(target.fog, s0.fog, s1.fog, t);
  target.sunIntensity = s0.sunI + (s1.sunI - s0.sunI) * t;
  target.ambientIntensity = s0.ambI + (s1.ambI - s0.ambI) * t;
  return target;
}
