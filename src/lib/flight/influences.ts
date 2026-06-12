// Wind influences for the spine field: ridge lift and thermal columns.
// updrafts.html derives both. These are factories — demos register the
// returned function with wind.addInfluence(...) and keep the unsubscribe.
//
// IMPORTANT: influences are called from inside wind.sample(), so they must
// never call wind.sample() themselves. The ridge influence deflects only the
// STEADY part of the field (wind.direction / wind.speed read directly).

import { wind, type WindInfluence } from "../spine";

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---- ridge lift --------------------------------------------------------------
// Air can't flow through a hill. Near the surface the vertical velocity must
// match the terrain following the flow — the kinematic boundary condition:
//   w(surface) = u · ∇h
// Positive on the windward slope (air forced up), negative in the lee (air
// pulled down). The effect fades with height above the ground.

export interface RidgeLiftOptions {
  // e-folding height of the lift band above the terrain, meters.
  decayHeight?: number;
  // Overall multiplier (1 = the pure boundary condition).
  strength?: number;
  // Clamp on lee-side sink, m/s (keep no-fail-states friendly).
  maxSink?: number;
}

export function ridgeLiftInfluence(
  heightAt: (x: number, z: number) => number,
  opts: RidgeLiftOptions = {},
): WindInfluence {
  const decay = opts.decayHeight ?? 25;
  const strength = opts.strength ?? 1;
  const maxSink = opts.maxSink ?? 1.5;
  const e = 2; // finite-difference step, meters

  return (x, y, z, _t, out) => {
    const ground = heightAt(x, z);
    const above = y - ground;
    if (above < 0 || above > decay * 4) return;
    // Terrain gradient.
    const hx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
    const hz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    // Steady wind only — never re-enter wind.sample from an influence.
    const ux = Math.cos(wind.direction) * wind.speed;
    const uz = Math.sin(wind.direction) * wind.speed;
    let w = (ux * hx + uz * hz) * strength * Math.exp(-above / decay);
    if (w < -maxSink) w = -maxSink;
    out.y += w;
  };
}

// ---- thermals -----------------------------------------------------------------
// A buoyant column over sun-warmed ground: a Gaussian core in radius, with a
// vertical profile that ramps up from the surface and caps out where the
// rising air cools to the ambient temperature.

export interface ThermalSpec {
  x: number;
  z: number;
  radius: number; // core radius, meters
  strength: number; // peak updraft, m/s
  top: number; // cap height, meters
}

export function thermalInfluence(s: ThermalSpec): WindInfluence {
  return (x, y, z, _t, out) => {
    if (y > s.top || y < 0) return;
    const dx = x - s.x;
    const dz = z - s.z;
    const r2 = (dx * dx + dz * dz) / (s.radius * s.radius);
    if (r2 > 9) return;
    const core = Math.exp(-r2);
    const profile = smoothstep(0, 25, y) * (1 - smoothstep(s.top * 0.7, s.top, y));
    out.y += s.strength * core * profile;
  };
}
