// The speed of sight — the camera communicating airspeed.
//
// Three effects, derived in speedsight.html:
//
//   velocity blur   average the frame along each pixel's screen-space motion
//                   vector (the velocity buffer) — a film camera's shutter
//   radial streaks  forward flight makes the optical-flow field radiate from
//                   the aim point, so the dive look is a pull toward a center
//   dive DOF        a thin lens focuses one distance; the circle of
//                   confusion grows with |1 − focus/z| — gathered, not
//                   scattered, with a per-tap weight so sharp pixels don't
//                   smear onto blurred neighbors
//
// SpeedEffects owns the uniforms and reads the flight model's published
// FlightState every frame — the contract joy.html promised the camera would
// someday consume.

import { Vector2 } from "three/webgpu";
import {
  Fn,
  float,
  int,
  Loop,
  mix,
  perspectiveDepthToViewZ,
  screenSize,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec4,
} from "three/tsl";
import type { Node, TextureNode } from "three/webgpu";
import { flightState } from "../flight/state";

type NodeF = Node<"float">;
type NodeV4 = Node<"vec4">;

// ---- velocity-buffer motion blur ---------------------------------------------

/**
 * Average `taps` samples of the frame along the velocity vector, centered on
 * the pixel — the discrete version of integrating the image over the
 * shutter interval. `velocityTex` is the MRT velocity target (NDC units per
 * frame); `shutter` scales it (1 = the full frame-to-frame motion).
 *
 * `base` is the upstream chain's color at this pixel; it stands in for the
 * center tap so stacked resamplers compose (the neighbors still come from
 * the raw frame — exact when one resampler runs, honest when two overlap).
 */
export function velocityBlurNode(
  sceneTex: TextureNode,
  velocityTex: TextureNode,
  shutter: NodeF | number = 1,
  taps = 12,
  base?: NodeV4,
): NodeV4 {
  return Fn(() => {
    const uvN = uv();
    // velocity is NDC (−1..1) per frame; screen uv moves at half that rate
    const vel = velocityTex.sample(uvN).xy.mul(0.5).mul(shutter);
    const acc = (base ?? sceneTex.sample(uvN)).toVar();
    Loop({ start: int(1), end: int(taps), type: "int", condition: "<" }, ({ i }) => {
      const s = float(i).div(taps - 1).sub(0.5); // −0.5 .. +0.5 across the shutter
      acc.addAssign(sceneTex.sample(uvN.add(vel.mul(s))));
    });
    return acc.div(taps);
  })();
}

// ---- radial streaks --------------------------------------------------------------

export interface StreakParams {
  /** 0..1 — how far toward the fully streaked frame to blend. */
  amount: NodeF;
  /** Screen-space point the streaks radiate from (uv). The uniform shares
   *  this instance, so moving the Vector2 moves the streak center. */
  center: Vector2;
  /** Max sample pull toward the center, as a fraction of the radius. */
  reach?: number;
  /** Chromatic spread: red taps pull slightly more than blue, 0..1. */
  fringe?: NodeF | number;
  taps?: number;
}

/**
 * Streaked color: samples pulled along the ray from `center` through the
 * pixel — the optical-flow direction of pure forward motion. The pull
 * grows with distance from center (flow speed ∝ sin θ), so the aim point
 * stays readable while the periphery tears. Returns the blend of `base`
 * toward the streaked frame by `amount`.
 */
export function radialStreakNode(sceneTex: TextureNode, base: NodeV4, params: StreakParams): NodeV4 {
  const { amount, center, reach = 0.22, fringe = 0, taps = 8 } = params;
  const centerU = uniform(center);
  const fringeN: NodeF = typeof fringe === "number" ? float(fringe) : fringe;
  return Fn(() => {
    const uvN = uv();
    const toPx = uvN.sub(centerU); // ray the streak runs along
    const r = toPx.length();
    // flow magnitude: zero at the aim point, saturating toward the edge
    const flow = smoothstep(0.02, 0.55, r).mul(reach).mul(amount);
    const acc = vec4(0).toVar();
    Loop({ start: int(0), end: int(taps), type: "int", condition: "<" }, ({ i }) => {
      const f = float(i).div(taps - 1); // 0..1 along the streak
      const pull = flow.mul(f);
      // chromatic spread: long-wavelength taps reach farther down the streak
      const pr = pull.mul(fringeN.mul(0.35).add(1));
      const pb = pull.mul(float(1).sub(fringeN.mul(0.35)));
      const sr = sceneTex.sample(uvN.sub(toPx.mul(pr))).r;
      const sg = sceneTex.sample(uvN.sub(toPx.mul(pull)));
      const sb = sceneTex.sample(uvN.sub(toPx.mul(pb))).b;
      acc.addAssign(vec4(sr, sg.g, sb, sg.a));
    });
    const streaked = acc.div(taps);
    // blend by flow, not raw amount: the center keeps the sharp frame
    return mix(base, streaked, flow.div(reach).clamp(0, 1).mul(amount.clamp(0, 1)));
  })();
}

// ---- depth of field: circle of confusion, gathered --------------------------------

export interface DofParams {
  /** Distance to the focal plane, meters. */
  focusDistance: NodeF;
  /** Depth range (m) over which the CoC reaches full size — small = shallow. */
  focalRange: NodeF;
  /** Max blur radius as a fraction of screen height (0 disables). */
  maxCoc: NodeF;
  /** Camera near/far (plain numbers — they don't change at runtime). */
  near: number;
  far: number;
}

// A fixed Poisson-ish disc: golden-angle spiral, radius ∝ √i for even area
// coverage. Computed once at module load; baked into the shader as constants.
const DISC_TAPS = 16;
const DISC: [number, number][] = [];
for (let i = 0; i < DISC_TAPS; i++) {
  const r = Math.sqrt((i + 0.5) / DISC_TAPS);
  const a = i * 2.39996; // golden angle
  DISC.push([Math.cos(a) * r, Math.sin(a) * r]);
}

/**
 * Single-pass gather DOF. CoC from the thin-lens model:
 *
 *   coc(z) = maxCoc · clamp(|z − focus| / range, 0, 1)
 *
 * Each pixel gathers a disc scaled by its own CoC; each tap is weighted by
 * the tap's own CoC over the gather radius, the scatter-as-gather trick
 * that keeps in-focus subjects from being smeared by a blurred background.
 */
export function cocDofNode(
  sceneTex: TextureNode,
  depthTex: TextureNode,
  p: DofParams,
  base?: NodeV4,
): NodeV4 {
  return Fn(() => {
    const uvN = uv();
    const aspect = screenSize.y.div(screenSize.x);

    const distAt = (u: Node<"vec2">): NodeF =>
      perspectiveDepthToViewZ(depthTex.sample(u).r, float(p.near), float(p.far)).negate();

    const cocAt = (d: NodeF): NodeF =>
      d.sub(p.focusDistance).abs().div(p.focalRange.max(0.01)).clamp(0, 1).mul(p.maxCoc);

    const radius = cocAt(distAt(uvN));
    const acc = (base ?? sceneTex.sample(uvN)).toVar();
    const wsum = float(1).toVar();
    for (const [dx, dy] of DISC) {
      const off = vec2(dx * 1.0, dy).mul(vec2(aspect, 1)).mul(radius);
      const u2 = uvN.add(off);
      // the tap only reaches this pixel if its own CoC spans the distance
      const tapCoc = cocAt(distAt(u2));
      const w = tapCoc.div(radius.max(1e-5)).clamp(0, 1);
      acc.addAssign(sceneTex.sample(u2).mul(w));
      wsum.addAssign(w);
    }
    return acc.div(wsum);
  })();
}

// ---- the flightState bridge ----------------------------------------------------------

export class SpeedEffects {
  /** 0..1 — drive for the radial streaks. */
  readonly streak = uniform(0);
  /** Where the streaks radiate from (uv; the chase camera aims slightly high). */
  readonly streakCenter = new Vector2(0.5, 0.56);
  /** Chromatic spread riding the streaks. */
  readonly fringe = uniform(0);
  /** DOF uniforms (meters / fraction of screen height). */
  readonly focusDistance = uniform(18);
  readonly focalRange = uniform(10);
  readonly maxCoc = uniform(0);

  // CPU tuning
  /** Airspeed (m/s) where streaks begin / saturate. */
  streakStart = 13;
  streakFull = 28;
  /** Streak blend at full speed. */
  streakMax = 0.8;
  /** Max CoC (screen heights) at full dive tuck. */
  diveCoc = 0.014;
  /** Focal range during the dive — shallow focus is the point. */
  diveRange = 7;
  cruiseRange = 60;
  /** FOV mapping (degrees) — the same speed→width law the chase camera
   *  uses, exposed so scenes without the chase rig agree with it. */
  fovBase = 55;
  fovGain = 0.9; // deg per m/s above cruise
  fovRef = 9; // m/s — cruise

  private speedSm = 0;
  private diveSm = 0;

  /** Smoothed airspeed the effects are currently keyed to. */
  get airspeed(): number {
    return this.speedSm;
  }

  /** Dive signal 0..1 (tucked AND falling), smoothed. */
  get dive(): number {
    return this.diveSm;
  }

  /** The FOV (degrees) for the current smoothed airspeed. */
  get fov(): number {
    return this.fovBase + this.fovGain * Math.max(0, this.speedSm - this.fovRef);
  }

  /**
   * Read the published FlightState and settle the uniforms. `focusDist` is
   * the camera→subject distance (the bird, usually) the caller measures.
   */
  update(dt: number, focusDist: number): void {
    const k = 1 - Math.exp(-6 * dt);
    this.speedSm += (flightState.airspeed - this.speedSm) * k;
    // the dive signal: tucked AND falling
    const diving =
      flightState.tuck * Math.min(1, Math.max(0, -flightState.verticalSpeed / 10));
    this.diveSm += (diving - this.diveSm) * k;

    const span = Math.max(1, this.streakFull - this.streakStart);
    let s = (this.speedSm - this.streakStart) / span;
    s = Math.min(1, Math.max(0, s));
    s = s * s * (3 - 2 * s);
    this.streak.value = s * this.streakMax;
    this.fringe.value = s * 0.7;

    this.focusDistance.value = focusDist;
    this.maxCoc.value = this.diveSm * this.diveCoc;
    this.focalRange.value =
      this.cruiseRange + (this.diveRange - this.cruiseRange) * this.diveSm;
  }
}
