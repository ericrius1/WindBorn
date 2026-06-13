// Stars, hashed straight into the sky dome's fragment shader. No star
// catalog, no point sprites: the view direction is rotated back around the
// celestial pole (undoing the night's rotation), snapped onto a 3D lattice,
// and each lattice cell rolls dice for one star — position jitter, a
// power-law brightness, a temperature tint, a twinkle phase. The same cell
// always rolls the same dice, so the sky is the same sky every night, and
// rotating the *sampling direction* rather than any geometry is what makes
// the whole field wheel around the pole for free.

import { Vector3 } from "three/webgpu";
import { cos, dot, cross, exp, float, floor, fract, int, mix, pow, sin, smoothstep, time, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { CELESTIAL_POLE } from "./palette";
import { hash3 } from "./noise3";

type NodeF = Node<"float">;
type NodeV3 = Node<"vec3">;

export interface StarFieldOptions {
  /** Lattice frequency: higher = more, smaller cells = more stars. */
  frequency?: number;
  /** Fraction of cells that actually hold a star (0..1). */
  abundance?: number;
  /** Angular radius of a bright star's core, radians-ish. */
  size?: number;
  /** Overall brightness multiplier (pre tone mapping). */
  intensity?: number;
}

/**
 * Star radiance for a view direction. `rotation` is the current sky rotation
 * around the celestial pole in radians (one full turn per day — feed it
 * `hour / 24 * 2π`); `visibility` fades the field in through twilight
 * (0 = day, 1 = full night). Add the result onto the sky color.
 */
export function starFieldNode(
  dir: NodeV3,
  rotation: NodeF,
  visibility: NodeF,
  options: StarFieldOptions = {},
): NodeV3 {
  const freq = options.frequency ?? 56;
  const abundance = options.abundance ?? 0.3;
  const size = options.size ?? 0.0035;
  const intensity = options.intensity ?? 0.9;

  // Undo the diurnal rotation: Rodrigues' formula around the pole axis.
  // The stars are fixed; it is the sampling frame that turns.
  const k = vec3(CELESTIAL_POLE.x, CELESTIAL_POLE.y, CELESTIAL_POLE.z);
  const ang = rotation.negate();
  const c = cos(ang);
  const s = sin(ang);
  const d = dir
    .mul(c)
    .add(cross(k, dir).mul(s))
    .add(k.mul(dot(k, dir)).mul(c.oneMinus()));

  // One candidate star per lattice cell of the rotated direction.
  const p = d.mul(freq);
  const cell = floor(p);
  const f = fract(p);
  const cx = int(cell.x);
  const cy = int(cell.y);
  const cz = int(cell.z);
  const h1 = hash3(cx, cy, cz, int(11));
  const h2 = hash3(cx, cy, cz, int(23));
  const h3 = hash3(cx, cy, cz, int(37));
  const h4 = hash3(cx, cy, cz, int(53));
  const h5 = hash3(cx, cy, cz, int(71));

  // Star position inside the cell (kept off the walls so a star never
  // straddles a cell boundary at this size).
  const sp = vec3(h1, h2, h3).mul(0.5).add(0.25);
  const dist = f.sub(sp).length();

  // Power-law magnitudes: most stars faint, a few brilliant — gated so only
  // `abundance` of cells hold a star at all.
  const lit = smoothstep(1 - abundance, 1 - abundance + 0.02, h4);
  const mag = pow(h4, 9).mul(9).add(0.1).mul(lit);

  // A tight gaussian spark. The radius is in cell units: size · freq.
  const r = size * freq;
  const spark = exp(dist.mul(dist).negate().div(r * r));

  // Twinkle: scintillation is the atmosphere wobbling the wavefront, so it
  // strengthens toward the horizon where the air column is longest.
  const airmass = float(1).div(d.y.max(0.12));
  const tw = sin(time.mul(h5.mul(5).add(2)).add(h5.mul(40)))
    .mul(0.5)
    .add(0.5)
    .mul(airmass.mul(0.12).min(0.45));
  const twinkle = float(1).sub(tw);

  // Temperature tint: blue-white giants to orange dwarfs.
  const tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.86, 0.7), pow(h5, 2));

  // Below the horizon there are no stars (the lake is not transparent).
  const horizon = smoothstep(-0.02, 0.04, dir.y);

  return tint
    .mul(spark)
    .mul(mag)
    .mul(twinkle)
    .mul(visibility)
    .mul(horizon)
    .mul(intensity);
}

/** CPU twin of the twilight gate: how visible the stars are at a given sun
 *  elevation. Fades in through nautical twilight, full by astronomical. */
export function starVisibility(sunElevationDeg: number): number {
  const t = (-sunElevationDeg - 6) / 8; // 0 at -6°, 1 at -14°
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** The celestial pole as a fresh Vector3 (for demos that draw the axis). */
export function celestialPole(target = new Vector3()): Vector3 {
  return target.copy(CELESTIAL_POLE);
}
