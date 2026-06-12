// Ridge lift: the terrain tells the wind to go up.
//
// Near the ground, air can't flow INTO a slope — the velocity component
// perpendicular to the surface has to vanish, so the flow follows the
// terrain. For a horizontal wind V over ground with gradient ∇h, the
// terrain-following vertical velocity at the surface is
//
//     w = V · ∇h        (positive on windward slopes, negative on lee)
//
// and the effect fades with height above the ground. That single dot
// product is the soaring economy of the whole game: windward faces are
// elevators, lee sides quietly sink.
//
// This module registers that as an INFLUENCE on the spine's shared wind
// field (src/lib/spine/wind.ts) — flight, grass, clouds, and audio all
// sample `wind.sample(...)`, so they all feel the same lift. Inside the
// influence we read the field's steady parameters (direction/speed)
// directly rather than calling wind.sample, which would recurse.

import { Vector2 } from "three";
import { wind, type WindInfluence } from "../spine";
import { terrainGrid } from "./basin";

export interface RidgeLiftOptions {
  /** e-folding height of the effect above ground, meters. Default 90. */
  decayHeight?: number;
  /** Multiplier on the windward (rising) response. Default 1. */
  strength?: number;
  /** Lee-side sink is gentler than windward lift. Default 0.45. */
  leeFactor?: number;
  /** Cap on |vertical| in m/s so cliffs don't catapult. Default 7. */
  maxLift?: number;
}

/**
 * Build the influence without registering it (the demos integrate it
 * directly to draw streamlines). Queries go through the fast bilinear
 * terrain cache: ~a microsecond, fine for thousands of samples per frame.
 */
export function makeRidgeLiftInfluence(opts: RidgeLiftOptions = {}): WindInfluence {
  const decayHeight = opts.decayHeight ?? 90;
  const strength = opts.strength ?? 1;
  const leeFactor = opts.leeFactor ?? 0.45;
  const maxLift = opts.maxLift ?? 7;
  const grad = new Vector2();

  return (x, y, _z, _t, out) => {
    const z = _z;
    const grid = terrainGrid();
    const ground = grid.heightAt(x, z);
    const agl = y - ground;
    if (agl < 0) return; // underground: not our problem

    grid.gradientAt(x, z, grad);
    // steady incident wind (no influences — avoid recursion)
    const vx = Math.cos(wind.direction) * wind.speed;
    const vz = Math.sin(wind.direction) * wind.speed;
    let w = (vx * grad.x + vz * grad.y) * strength;
    if (w < 0) w *= leeFactor;
    w = Math.max(-maxLift, Math.min(maxLift, w));
    out.y += w * Math.exp(-agl / decayHeight);
  };
}

/**
 * Register ridge lift on the shared wind field. Returns the unsubscribe.
 * Call once per scene that flies; dispose with the demo.
 */
export function registerRidgeLift(opts: RidgeLiftOptions = {}): () => void {
  return wind.addInfluence(makeRidgeLiftInfluence(opts));
}
