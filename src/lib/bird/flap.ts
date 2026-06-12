// The wingbeat clock and the gait table. A wingbeat is a loop, but not a
// sine: only the downstroke pushes air where air needs pushing, so the bird
// spends more time on the half that pays — the clock is *warped*, giving the
// downstroke its share of the period first and hurrying the upstroke home.
// During that hurried half the wrist folds, pulling span in, because hauling
// a full wing back up through the air would refund most of the downstroke.
//
// A *gait* is one point in this knob space. Hover, cruise, and glide are
// just three different settings of the same clock, so "how is she flying"
// compresses to a single number: gait01 ∈ [0, 1].

export interface GaitParams {
  rateMul: number; // multiplies the commanded flap rate
  amp: number; // tip excursion, meters
  downFrac: number; // fraction of the period spent on the downstroke
  foldUp: number; // 0..1, how much span pulls in on the upstroke
  twistAmp: number; // radians of blade twist at mid-downstroke
  ext: number; // baseline extension 0..1
  lift: number; // baseline tip height vs shoulder, meters
  sweep: number; // baseline tip fore/aft vs shoulder, meters
  planeTilt: number; // stroke-plane tilt: fraction of amp spent fore-aft
  bodyPitch: number; // radians nose-up the gait itself wants
  tailSpread: number; // 0..1
  flapMix: number; // 1 = full flapping, 0 = wings held (glide)
}

// The three anchors. gait01 = 0 → hover (steep body, huge deep strokes,
// stroke plane tilted back so the wing rows air downward); 0.5 → cruise
// (the workhorse beat); 1 → glide (the M-shaped hold, no beat at all).
export const GAIT_HOVER: GaitParams = {
  rateMul: 1.5,
  amp: 0.30,
  downFrac: 0.5,
  foldUp: 0.3,
  twistAmp: 0.6,
  ext: 0.88,
  lift: 0.06,
  sweep: 0.02,
  planeTilt: 0.55,
  bodyPitch: 0.38,
  tailSpread: 0.85,
  flapMix: 1,
};

export const GAIT_CRUISE: GaitParams = {
  rateMul: 1.0,
  amp: 0.21,
  downFrac: 0.57,
  foldUp: 0.65,
  twistAmp: 0.35,
  ext: 0.94,
  lift: 0.03,
  sweep: -0.02,
  planeTilt: 0.18,
  bodyPitch: 0.05,
  tailSpread: 0.25,
  flapMix: 1,
};

export const GAIT_GLIDE: GaitParams = {
  rateMul: 0.55,
  amp: 0.012, // the residual breathing of a held wing
  downFrac: 0.5,
  foldUp: 0,
  twistAmp: 0.04,
  ext: 0.97,
  lift: -0.015, // tips droop just below the raised wrists: the M
  sweep: -0.05,
  planeTilt: 0,
  bodyPitch: 0.0,
  tailSpread: 0.15,
  flapMix: 0.0,
};

function lerpGait(a: GaitParams, b: GaitParams, t: number, out: GaitParams): GaitParams {
  const keys = Object.keys(a) as (keyof GaitParams)[];
  for (const k of keys) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

// Blend along the 1D gait axis: hover → cruise → glide.
export function gaitParams(gait01: number, out: GaitParams = { ...GAIT_CRUISE }): GaitParams {
  const g = Math.max(0, Math.min(1, gait01));
  if (g <= 0.5) return lerpGait(GAIT_HOVER, GAIT_CRUISE, g * 2, out);
  return lerpGait(GAIT_CRUISE, GAIT_GLIDE, (g - 0.5) * 2, out);
}

// ---- the warped clock --------------------------------------------------------

export interface StrokeSample {
  theta: number; // warped stroke angle: 0 at top, π at bottom, 2π back at top
  down: boolean; // in the downstroke half
  vert: number; // +1 at the top of the stroke, −1 at the bottom
  sweep: number; // + during the downstroke (tip moving forward)
  upAmount: number; // 0 except during the upstroke, where it bells to 1
}

// Warp phase p ∈ [0,1) so the downstroke owns `downFrac` of the period.
export function strokeAt(p: number, downFrac: number, out: StrokeSample): StrokeSample {
  const pp = p - Math.floor(p);
  const down = pp < downFrac;
  const theta = down
    ? (pp / downFrac) * Math.PI
    : Math.PI + ((pp - downFrac) / (1 - downFrac)) * Math.PI;
  out.theta = theta;
  out.down = down;
  out.vert = Math.cos(theta);
  out.sweep = Math.sin(theta);
  out.upAmount = down ? 0 : Math.sin(((pp - downFrac) / (1 - downFrac)) * Math.PI);
  return out;
}

// The flap layer's contribution to one wing's target, in pose space:
// vertical offset, fore-aft offset, extension multiplier, twist. The
// animator adds these on top of whatever the gait + poses asked for.
export interface FlapOffsets {
  dLift: number; // meters
  dSweep: number; // meters
  extMul: number; // ≤ 1, the upstroke fold
  twist: number; // radians
}

export function flapOffsets(s: StrokeSample, gp: GaitParams, out: FlapOffsets): FlapOffsets {
  const a = gp.amp * gp.flapMix;
  out.dLift = a * s.vert;
  out.dSweep = a * (0.35 + gp.planeTilt) * s.sweep;
  out.extMul = 1 - gp.foldUp * 0.32 * s.upAmount * gp.flapMix;
  out.twist = -gp.twistAmp * s.sweep * gp.flapMix; // leading edge down on the downstroke
  return out;
}
