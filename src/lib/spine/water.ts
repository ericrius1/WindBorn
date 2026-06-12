// The water state API. Anything that needs to know where the surface is —
// a floating bird, a foam particle, a reflection, a fish about to rise —
// asks this module, never a specific implementation.
//
// The Mirror series ships the default ambient provider (wind-steered
// directional waves). The Splash series swaps in a provider that overlays a
// real simulation inside a moving local window. Callers never know.

import { Vector3 } from "three";
import { wind } from "./wind";

// Mean lake surface sits at y = 0 in world space, by convention. Terrain
// below the lake is negative; mountains are positive.
export const WATER_LEVEL = 0;

export interface WaterProvider {
  // Surface height (world y) at world position (x, z) and time t seconds.
  heightAt(x: number, z: number, t: number): number;
  // Optional analytic normal; the registry falls back to finite differences.
  normalAt?(x: number, z: number, t: number, target: Vector3): Vector3;
}

// ---- default ambient provider ----------------------------------------------
// A handful of directional gravity-capillary waves, steered by the wind
// direction so ripples and gusts agree. Amplitudes scale with wind speed.

interface WaveDef {
  angle: number; // offset from wind direction
  wavelength: number;
  amp: number; // amplitude as a fraction of wind-scaled base
  speed: number;
}

const WAVES: WaveDef[] = [
  { angle: 0.0, wavelength: 11.0, amp: 0.4, speed: 1.0 },
  { angle: 0.35, wavelength: 5.3, amp: 0.25, speed: 1.3 },
  { angle: -0.5, wavelength: 2.1, amp: 0.18, speed: 1.7 },
  { angle: 0.9, wavelength: 0.9, amp: 0.1, speed: 2.4 },
  { angle: -1.2, wavelength: 0.45, amp: 0.07, speed: 3.1 },
];

class AmbientWater implements WaterProvider {
  heightAt(x: number, z: number, t: number): number {
    const base = 0.035 * wind.speed; // calm lake: centimeters, not meters
    let h = 0;
    for (const w of WAVES) {
      const a = wind.direction + w.angle;
      const dx = Math.cos(a), dz = Math.sin(a);
      const k = (Math.PI * 2) / w.wavelength;
      h += base * w.amp * Math.sin((x * dx + z * dz) * k + t * w.speed * k);
    }
    return WATER_LEVEL + h;
  }
}

// ---- registry ----------------------------------------------------------------

let provider: WaterProvider = new AmbientWater();
export const ambientWater: WaterProvider = provider;

export function setWaterProvider(p: WaterProvider): void {
  provider = p;
}

export function waterProvider(): WaterProvider {
  return provider;
}

export function waterHeightAt(x: number, z: number, t: number): number {
  return provider.heightAt(x, z, t);
}

const EPS = 0.05;

export function waterNormalAt(x: number, z: number, t: number, target = new Vector3()): Vector3 {
  if (provider.normalAt) return provider.normalAt(x, z, t, target);
  const hL = provider.heightAt(x - EPS, z, t);
  const hR = provider.heightAt(x + EPS, z, t);
  const hD = provider.heightAt(x, z - EPS, t);
  const hU = provider.heightAt(x, z + EPS, t);
  return target.set(hL - hR, 2 * EPS, hD - hU).normalize();
}
