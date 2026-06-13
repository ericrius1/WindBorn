// The grade — what "color grading" actually is, as math.
//
// A graded frame is the rendered frame pushed through a short chain of
// per-pixel functions, each with a precise home in the pipeline:
//
//   scene-referred (linear HDR, before tone mapping)
//     exposure       c · 2^stops            — a gain, counted in stops
//     white balance  c · balance            — per-channel gain toward warm/cool
//   tone mapping     HDR → 0..1             — renderOutput / the curves below
//   display-referred (after tone mapping)
//     lift/gamma/gain  (gain·(c + lift·(1−c)))^(1/gamma)  — three-way color
//     contrast       (c − pivot)·k + pivot  — rotate values about a grey pivot
//     saturation     mix(luma, c, s)        — slide along the grey axis
//     vignette       darken with distance from frame center
//
// grade.html derives each line. The Grade class owns one uniform per knob and
// exposes the two node builders (linear side, display side) so a post chain
// can split around its tone-mapping step. setHour() keys every knob to the
// sun's elevation — the same scheme the sky palette uses — which is how the
// whole site gets "dawn looks like dawn" for free off the world clock.

import { Vector3 } from "three/webgpu";
import { float, luminance, mix, screenUV, smoothstep, uniform, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { sunElevationDeg } from "../sky/palette";

type NodeV3 = Node<"vec3">;

// ---- tone-mapping curves (the teaching objects of grade.html Step 2) ---------

/** Reinhard: c / (1 + c). Never clips, never reaches white — the simplest
 *  curve that maps [0, ∞) into [0, 1). */
export function reinhardNode(c: NodeV3): NodeV3 {
  return c.div(c.add(1));
}

/** A filmic S-curve: the widely used rational fit to the ACES reference
 *  (toe below, shoulder above, near-linear mids). Same family the renderer's
 *  own ACESFilmicToneMapping belongs to; grade.html compares them. */
export function filmicNode(c: NodeV3): NodeV3 {
  // (c·(2.51c + 0.03)) / (c·(2.43c + 0.59) + 0.14)
  const num = c.mul(c.mul(2.51).add(0.03));
  const den = c.mul(c.mul(2.43).add(0.59)).add(0.14);
  return num.div(den).clamp(0, 1);
}

/** No curve at all: clamp. The "before" in every tone-mapping comparison. */
export function clipNode(c: NodeV3): NodeV3 {
  return c.clamp(0, 1);
}

// ---- the settings object -------------------------------------------------------

export type Triple = [number, number, number];

export interface GradeSettings {
  /** Exposure in stops; the shader applies 2^stops as a linear gain. */
  exposure: number;
  /** White balance, −1 (cool) .. +1 (warm). */
  temperature: number;
  /** Contrast about the pivot; 1 = neutral. */
  contrast: number;
  /** Saturation; 0 = grey, 1 = neutral. */
  saturation: number;
  /** Lift: raises the floor (shadows). Display-referred, per channel, ~±0.05. */
  lift: Triple;
  /** Gamma: bends the mids. 1 = neutral. */
  gamma: Triple;
  /** Gain: scales the ceiling (highlights). 1 = neutral. */
  gain: Triple;
  /** Vignette strength, 0..1. */
  vignette: number;
  /** Bloom drive, so the stack can key bloom to the hour too. */
  bloomStrength: number;
  bloomThreshold: number;
}

export function neutralGrade(): GradeSettings {
  return {
    exposure: 0,
    temperature: 0,
    contrast: 1,
    saturation: 1,
    lift: [0, 0, 0],
    gamma: [1, 1, 1],
    gain: [1, 1, 1],
    vignette: 0,
    bloomStrength: 0,
    bloomThreshold: 1,
  };
}

// ---- the hour key ----------------------------------------------------------------
// One look per band of sun elevation, eased between bands — the exact scheme
// the sky palette uses for its colors, so the grade and the light always
// agree about what time it is. Tuned subtle: a grade you can name is a grade
// that is overtuned.

interface GradeStop extends GradeSettings {
  e: number; // sun elevation, degrees
}

export const GRADE_STOPS: GradeStop[] = [
  // deep night: lifted floor, cool gain, colors drained toward scotopic grey
  { e: -18, exposure: 0.55, temperature: -0.55, contrast: 1.07, saturation: 0.6,
    lift: [0.010, 0.014, 0.030], gamma: [1.03, 1.01, 0.97], gain: [0.84, 0.93, 1.10],
    vignette: 0.30, bloomStrength: 0.50, bloomThreshold: 0.55 },
  // late twilight
  { e: -10, exposure: 0.40, temperature: -0.45, contrast: 1.06, saturation: 0.72,
    lift: [0.008, 0.011, 0.024], gamma: [1.02, 1.0, 0.98], gain: [0.88, 0.95, 1.08],
    vignette: 0.28, bloomStrength: 0.45, bloomThreshold: 0.60 },
  // blue hour: cool but no longer colorless
  { e: -5, exposure: 0.25, temperature: -0.30, contrast: 1.06, saturation: 0.88,
    lift: [0.006, 0.008, 0.018], gamma: [1.01, 1.0, 0.99], gain: [0.92, 0.97, 1.05],
    vignette: 0.24, bloomStrength: 0.40, bloomThreshold: 0.65 },
  // sunrise: warm highlights against shadows that keep their blue
  { e: -1, exposure: 0.10, temperature: 0.18, contrast: 1.05, saturation: 1.12,
    lift: [0.003, 0.005, 0.013], gamma: [0.99, 1.0, 1.01], gain: [1.10, 0.99, 0.88],
    vignette: 0.20, bloomStrength: 0.55, bloomThreshold: 0.60 },
  // golden hour: the strongest look of the day
  { e: 4, exposure: 0, temperature: 0.30, contrast: 1.06, saturation: 1.16,
    lift: [0.002, 0.004, 0.011], gamma: [0.99, 1.0, 1.01], gain: [1.12, 1.0, 0.87],
    vignette: 0.18, bloomStrength: 0.60, bloomThreshold: 0.65 },
  // morning
  { e: 12, exposure: 0, temperature: 0.08, contrast: 1.04, saturation: 1.06,
    lift: [0, 0.002, 0.006], gamma: [1, 1, 1], gain: [1.04, 1.0, 0.96],
    vignette: 0.15, bloomStrength: 0.40, bloomThreshold: 0.75 },
  // midday: almost out of the frame's way
  { e: 35, exposure: -0.05, temperature: 0, contrast: 1.03, saturation: 1.02,
    lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
    vignette: 0.12, bloomStrength: 0.30, bloomThreshold: 0.85 },
  { e: 70, exposure: -0.05, temperature: 0, contrast: 1.03, saturation: 1.02,
    lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
    vignette: 0.12, bloomStrength: 0.30, bloomThreshold: 0.85 },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpTriple(out: Triple, a: Triple, b: Triple, t: number): Triple {
  out[0] = lerp(a[0], b[0], t);
  out[1] = lerp(a[1], b[1], t);
  out[2] = lerp(a[2], b[2], t);
  return out;
}

/** The grade for a clock hour, interpolated between GRADE_STOPS on sun
 *  elevation. Pass a target to avoid per-frame allocation. */
export function gradeForHour(hour: number, target: GradeSettings = neutralGrade()): GradeSettings {
  const e = sunElevationDeg(hour);
  let i = 0;
  while (i < GRADE_STOPS.length - 2 && e > GRADE_STOPS[i + 1].e) i++;
  const s0 = GRADE_STOPS[i];
  const s1 = GRADE_STOPS[i + 1];
  let t = (e - s0.e) / (s1.e - s0.e);
  t = Math.max(0, Math.min(1, t));
  t = t * t * (3 - 2 * t); // ease each band so stop boundaries never show

  target.exposure = lerp(s0.exposure, s1.exposure, t);
  target.temperature = lerp(s0.temperature, s1.temperature, t);
  target.contrast = lerp(s0.contrast, s1.contrast, t);
  target.saturation = lerp(s0.saturation, s1.saturation, t);
  lerpTriple(target.lift, s0.lift, s1.lift, t);
  lerpTriple(target.gamma, s0.gamma, s1.gamma, t);
  lerpTriple(target.gain, s0.gain, s1.gain, t);
  target.vignette = lerp(s0.vignette, s1.vignette, t);
  target.bloomStrength = lerp(s0.bloomStrength, s1.bloomStrength, t);
  target.bloomThreshold = lerp(s0.bloomThreshold, s1.bloomThreshold, t);
  return target;
}

// ---- the Grade -------------------------------------------------------------------

/** Mid-grey pivot for the contrast rotation, in display-referred values
 *  (18% scene grey through the sRGB curve lands near 0.42). */
export const CONTRAST_PIVOT = 0.42;

export class Grade {
  /** Master blend: 0 = the raw frame passes through untouched. */
  readonly amount = uniform(1);

  // scene-referred knobs
  /** Linear gain (2^stops — apply() does the conversion). */
  readonly exposureGain = uniform(1);
  /** Per-channel white-balance gain. */
  readonly balance = uniform(new Vector3(1, 1, 1));

  // display-referred knobs
  readonly lift = uniform(new Vector3(0, 0, 0));
  /** Stored as 1/gamma so the shader runs a single pow. */
  readonly gammaInv = uniform(new Vector3(1, 1, 1));
  readonly gain = uniform(new Vector3(1, 1, 1));
  readonly contrast = uniform(1);
  readonly saturation = uniform(1);
  readonly vignette = uniform(0);

  /** Scene-referred half: exposure and white balance, applied to linear HDR
   *  before tone mapping (where a gain still behaves like light). */
  linearNode(c: NodeV3): NodeV3 {
    const graded = c.mul(this.exposureGain).mul(this.balance);
    return mix(c, graded, this.amount);
  }

  /** Display-referred half: lift/gamma/gain, contrast, saturation, vignette —
   *  applied to the tone-mapped 0..1 frame. */
  displayNode(c: NodeV3): NodeV3 {
    // three-way color: floor, bend, ceiling
    let g: NodeV3 = this.gain.mul(c.add(this.lift.mul(float(1).sub(c))));
    g = g.max(0).pow(this.gammaInv);
    // contrast: rotate about the grey pivot
    g = g.sub(CONTRAST_PIVOT).mul(this.contrast).add(CONTRAST_PIVOT);
    // saturation: distance from the grey axis, scaled
    g = mix(vec3(luminance(g)), g, this.saturation);
    // vignette: a soft radial shade, strongest in the corners
    const d = screenUV.sub(0.5).length().mul(1.4142);
    g = g.mul(float(1).sub(smoothstep(0.5, 1.08, d).mul(this.vignette)));
    return mix(c, g.clamp(0, 1), this.amount);
  }

  /** Push a settings object into the uniforms. */
  apply(s: GradeSettings): void {
    this.exposureGain.value = Math.pow(2, s.exposure);
    const t = s.temperature;
    this.balance.value.set(1 + 0.20 * t, 1 + 0.04 * t, 1 - 0.20 * t);
    this.lift.value.set(s.lift[0], s.lift[1], s.lift[2]);
    this.gammaInv.value.set(1 / s.gamma[0], 1 / s.gamma[1], 1 / s.gamma[2]);
    this.gain.value.set(s.gain[0], s.gain[1], s.gain[2]);
    this.contrast.value = s.contrast;
    this.saturation.value = s.saturation;
    this.vignette.value = s.vignette;
  }

  private scratch = neutralGrade();

  /** Key every knob to the world clock. Returns the interpolated settings so
   *  callers can also drive bloom from them. */
  setHour(hour: number): GradeSettings {
    const s = gradeForHour(hour, this.scratch);
    this.apply(s);
    return s;
  }
}
