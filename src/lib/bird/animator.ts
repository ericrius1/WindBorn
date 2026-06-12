// The animator: one update() that stacks the whole motion system in layers.
//
//   gait table  →  what the wings want at this flight speed   (flap.ts)
//   pose table  →  what the current action wants               (poses.ts)
//   springs     →  how we get from here to there, smoothly     (springs.ts)
//   stroke clock→  the wingbeat riding on top                  (flap.ts)
//   wing IK     →  targets become joint rotations              (wing.ts)
//   feathers    →  per-vane lag springs, the secondary motion
//
// Nothing in here plays a clip. Every frame is solved fresh from a small
// pile of scalars, which is why any state flows into any other state from
// wherever the bird happens to be — mid-flap included.

import * as THREE from "three/webgpu";
import type { Osprey, FeatherInstance } from "./build";
import { gaitParams, strokeAt, flapOffsets, type GaitParams, type StrokeSample, type FlapOffsets } from "./flap";
import { POSES, POSE_BASE, POSE_NAMES, mixPose, clonePose, type PoseName, type PoseTarget } from "./poses";
import { Spring1D } from "./springs";
import { WINGS, applyWingTip, tipFromParams, makeWingSolveResult, type WingSolveResult } from "./wing";

const DEG = Math.PI / 180;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

interface FeatherDrive {
  f: FeatherInstance;
  spring: Spring1D;
  freq: number;
  gain: number;
}

export class OspreyAnimator {
  // flight state knobs
  gait01 = 0.5; // 0 hover · 0.5 cruise · 1 glide
  flapRateHz = 2.8; // commanded wingbeat rate before the gait multiplies it
  bank = 0; // −1 … 1, rolls lift between the wings

  // pose weight targets; springs chase these
  readonly poseTarget: Record<PoseName, number> = { tuck: 0, brake: 0, strike: 0, float: 0 };
  poseFreqHz = 2.4;
  poseZeta = 0.95;

  // feather secondary motion
  feathersEnabled = true;
  featherFreqHz = 5.5;
  featherGain = 1;
  featherZeta = 0.5;

  // layer switches (demos teaching one layer turn the others off)
  legsEnabled = true;
  headEnabled = true;

  // direct gait overrides — the flap demos pin individual knobs while the
  // sliders move them; undefined means "use the gait table"
  overrideAmp?: number;
  overrideDownFrac?: number;
  overrideFoldUp?: number;
  overrideTwistAmp?: number;

  // read-back state for demo overlays
  phase = 0;
  readonly stroke: StrokeSample = { theta: 0, down: true, vert: 1, sweep: 0, upAmount: 0 };
  readonly gp: GaitParams = gaitParams(0.5);
  readonly blended: PoseTarget = clonePose(POSE_BASE);
  readonly solveL: WingSolveResult = makeWingSolveResult();
  readonly solveR: WingSolveResult = makeWingSolveResult();

  private weights = new Map<PoseName, Spring1D>(POSE_NAMES.map((n) => [n, new Spring1D(0)]));
  private featherDrives: FeatherDrive[] = [];
  private fo: FlapOffsets = { dLift: 0, dSweep: 0, extMul: 1, twist: 0 };
  private pole = new THREE.Vector3();
  private tip = new THREE.Vector3();
  private qx = new THREE.Quaternion();
  private xAxis = new THREE.Vector3(1, 0, 0);

  constructor(readonly osprey: Osprey) {
    for (const f of osprey.feathers) {
      let freqMul = 1;
      let gain = 0;
      if (f.kind === "primary") {
        freqMul = 1.1 - 0.55 * f.span01; // outer primaries are floppier
        gain = 2.0 * (0.3 + Math.pow(f.span01, 1.5));
      } else if (f.kind === "secondary") {
        freqMul = 1.25;
        gain = 0.55;
      } else if (f.kind === "tertial") {
        freqMul = 1.4;
        gain = 0.35;
      }
      this.featherDrives.push({ f, spring: new Spring1D(0), freq: freqMul, gain });
    }
  }

  // Current spring-tracked weight of a pose (for demo readouts).
  poseWeight(name: PoseName): number {
    return this.weights.get(name)!.value;
  }

  // Jump every pose spring straight to its target — no easing. The "snap"
  // demo uses this to show raw targets; everyone else lets the springs work.
  snap(): void {
    for (const n of POSE_NAMES) this.weights.get(n)!.set(this.poseTarget[n]);
  }

  // Convenience: ask for exactly one pose (or none).
  requestPose(name: PoseName | null, weight = 1): void {
    for (const n of POSE_NAMES) this.poseTarget[n] = n === name ? weight : 0;
  }

  update(dt: number): void {
    const h = clamp(dt, 0, 0.05);
    const rig = this.osprey.rig;

    // 1 · gait: where on the hover↔cruise↔glide axis are we
    gaitParams(this.gait01, this.gp);
    if (this.overrideAmp !== undefined) this.gp.amp = this.overrideAmp;
    if (this.overrideDownFrac !== undefined) this.gp.downFrac = this.overrideDownFrac;
    if (this.overrideFoldUp !== undefined) this.gp.foldUp = this.overrideFoldUp;
    if (this.overrideTwistAmp !== undefined) this.gp.twistAmp = this.overrideTwistAmp;

    // 2 · the warped clock
    this.phase += h * this.flapRateHz * this.gp.rateMul;
    strokeAt(this.phase, this.gp.downFrac, this.stroke);

    // 3 · pose layer: start from what the gait wants, blend in active poses
    const b = this.blended;
    b.ext = this.gp.ext;
    b.lift = this.gp.lift;
    b.sweep = this.gp.sweep;
    b.twist = 0;
    b.poleUp = 0.35;
    b.flapGain = 1;
    b.tailSpread = this.gp.tailSpread;
    b.tailPitch = -4;
    b.bodyPitch = this.gp.bodyPitch;
    b.bodyLift = 0;
    b.neckPitch = 0;
    b.headPitch = 0;
    b.legs = POSE_BASE.legs;
    for (const n of POSE_NAMES) {
      const w = this.weights.get(n)!.step(this.poseTarget[n], h, this.poseFreqHz, this.poseZeta);
      mixPose(b, POSES[n], clamp01(w));
    }

    // 4 · flap offsets, gated by the pose's flapGain
    flapOffsets(this.stroke, this.gp, this.fo);
    const gain = clamp01(b.flapGain);
    const dLift = this.fo.dLift * gain;
    const dSweep = this.fo.dSweep * gain;
    const extMul = THREE.MathUtils.lerp(1, this.fo.extMul, gain);
    const twist = b.twist + this.fo.twist * gain;

    // 5 · wing IK, banked: rolling shifts lift between the wings
    this.pole.set(0, THREE.MathUtils.lerp(0.15, 1, clamp01(b.poleUp)), THREE.MathUtils.lerp(-1, -0.25, clamp01(b.poleUp))).normalize();
    const roll = this.bank * 0.08;
    const extBank = 0.14 * Math.abs(this.bank);
    const extL = clamp01(b.ext * extMul * (this.bank > 0 ? 1 : 1 - extBank));
    const extR = clamp01(b.ext * extMul * (this.bank < 0 ? 1 : 1 - extBank));
    tipFromParams(WINGS.L, extL, b.lift + dLift + roll, b.sweep + dSweep, this.tip);
    applyWingTip(rig, WINGS.L, this.tip, { twist, pole: this.pole }, this.solveL);
    tipFromParams(WINGS.R, extR, b.lift + dLift - roll, b.sweep + dSweep, this.tip);
    applyWingTip(rig, WINGS.R, this.tip, { twist, pole: this.pole }, this.solveR);

    // 6 · tail, body, head, legs
    this.osprey.setTailSpread(b.tailSpread);
    rig.bone("tailFan").rotation.x = -b.tailPitch * DEG;

    rig.root.rotation.x = -b.bodyPitch; // radians; + = nose up
    const bob = -dLift * 0.12;
    rig.root.position.y = 0.305 + b.bodyLift + bob;

    if (this.headEnabled) {
      rig.bone("neck").rotation.x = b.neckPitch * DEG; // + = craned down
      rig.bone("head").rotation.x = b.headPitch * DEG;
    }

    if (this.legsEnabled) {
      const lg = b.legs;
      rig.setEulerDeg("thighL", lg.thigh[0], lg.thigh[1], lg.thigh[2]);
      rig.setEulerDeg("thighR", lg.thigh[0], -lg.thigh[1], -lg.thigh[2]);
      rig.setEulerDeg("tarsusL", lg.tarsus[0], lg.tarsus[1], lg.tarsus[2]);
      rig.setEulerDeg("tarsusR", lg.tarsus[0], -lg.tarsus[1], -lg.tarsus[2]);
      rig.setEulerDeg("footL", lg.foot[0], lg.foot[1], lg.foot[2]);
      rig.setEulerDeg("footR", lg.foot[0], -lg.foot[1], -lg.foot[2]);
      // the reversible outer toe: spread swings it backward, two-and-two
      const spread = clamp01(lg.toeSpread);
      rig.bone("toeOutL").rotation.y = 2.1 * spread;
      rig.bone("toeOutR").rotation.y = -2.1 * spread;
      rig.bone("toeInL").rotation.y = -0.25 * spread;
      rig.bone("toeInR").rotation.y = 0.25 * spread;
    }

    // 7 · feather lag: each vane chases the stroke and bends by how far
    // behind it is. The spring IS the flexibility.
    if (this.feathersEnabled) {
      for (const d of this.featherDrives) {
        const driver = dLift + (d.f.side === "L" ? roll : -roll);
        const v = d.spring.step(driver, h, this.featherFreqHz * d.freq, this.featherZeta);
        const deflect = clamp((v - driver) * d.gain * this.featherGain * 3.0, -0.4, 0.4);
        this.qx.setFromAxisAngle(this.xAxis, deflect);
        d.f.mesh.quaternion.copy(d.f.baseQuat).multiply(this.qx);
      }
    } else {
      for (const d of this.featherDrives) {
        d.spring.set(0);
        d.f.mesh.quaternion.copy(d.f.baseQuat);
      }
    }
  }
}
