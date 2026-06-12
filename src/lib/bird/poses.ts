// The action-pose library. A pose is not an animation clip — it is a small
// table of *targets*: where the wingtips should be (in the extension / lift /
// sweep space the gaits already speak), what the tail and legs should do,
// how the body should pitch. The animator blends active poses by weight and
// lets critically-damped springs do all the easing, which is why any pose
// flows into any other from wherever the bird happens to be, mid-flap
// included.

export type PoseName = "tuck" | "brake" | "strike" | "float";

export const POSE_NAMES: PoseName[] = ["tuck", "brake", "strike", "float"];

export interface LegPose {
  thigh: [number, number, number]; // Euler degrees, left side (right mirrors yaw/roll)
  tarsus: [number, number, number];
  foot: [number, number, number];
  toeSpread: number; // 0 = relaxed, 1 = splayed wide with the outer toe reversed
}

export interface PoseTarget {
  ext: number; // wingtip extension 0..1
  lift: number; // tip height vs shoulder, meters
  sweep: number; // tip fore/aft vs shoulder, meters
  twist: number; // blade twist, radians (+ = leading edge up: braking)
  poleUp: number; // 0 = elbow flat back, 1 = elbow thrown high
  flapGain: number; // how much of the gait's flap survives this pose
  tailSpread: number; // 0..1
  tailPitch: number; // degrees, + = tail down
  bodyPitch: number; // radians, + = nose up
  bodyLift: number; // meters of root offset (negative = settle low)
  neckPitch: number; // degrees on the neck joint (+ = craned down)
  headPitch: number; // degrees on the head joint
  legs: LegPose;
}

const LEGS_TRAIL: LegPose = {
  thigh: [62, 0, 6],
  tarsus: [30, 0, 0],
  foot: [22, 0, 0],
  toeSpread: 0,
};

const LEGS_FLOAT: LegPose = {
  thigh: [38, 0, 10],
  tarsus: [55, 0, 0],
  foot: [18, 0, 0],
  toeSpread: 0,
};

const LEGS_REACH: LegPose = {
  thigh: [-72, 0, 14],
  tarsus: [-28, 0, 0],
  foot: [-18, 0, 0],
  toeSpread: 1,
};

const LEGS_HANG: LegPose = {
  thigh: [-26, 0, 10],
  tarsus: [-6, 0, 0],
  foot: [-6, 0, 0],
  toeSpread: 0.3,
};

// The neutral in-flight target the poses blend *against*. Wing numbers here
// are placeholders — in flight the gait table supplies them live; this row
// only contributes when the animator runs with no gait at all.
export const POSE_BASE: PoseTarget = {
  ext: 0.94,
  lift: 0.03,
  sweep: -0.02,
  twist: 0,
  poleUp: 0.35,
  flapGain: 1,
  tailSpread: 0.25,
  tailPitch: -4,
  bodyPitch: 0.05,
  bodyLift: 0,
  neckPitch: 0,
  headPitch: 0,
  legs: LEGS_TRAIL,
};

export const POSES: Record<PoseName, PoseTarget> = {
  // The dive: wings swept hard back along the body, tail closed, head
  // stretched toward the water. Ospreys don't teardrop like falcons — they
  // descend steep and adjust — but the shape is the same idea: span costs
  // drag, and right now drag is the enemy.
  tuck: {
    ext: 0.30,
    lift: -0.07,
    sweep: -0.30,
    twist: -0.12,
    poleUp: 0.12,
    flapGain: 0,
    tailSpread: 0.05,
    tailPitch: 5,
    bodyPitch: -0.42,
    bodyLift: 0,
    neckPitch: -14,
    headPitch: -10,
    legs: { thigh: [74, 0, 4], tarsus: [42, 0, 0], foot: [26, 0, 0], toeSpread: 0 },
  },
  // The flare: everything turns into an air brake at once. Wings thrown
  // forward and high with the leading edge pitched way up, tail fanned wide
  // and pressed down, legs dropping. Lift spikes, then the wing lets go —
  // the spike is the cushion.
  brake: {
    ext: 0.86,
    lift: 0.26,
    sweep: 0.10,
    twist: 0.55,
    poleUp: 0.85,
    flapGain: 0.2,
    tailSpread: 1.0,
    tailPitch: -30,
    bodyPitch: 0.5,
    bodyLift: 0,
    neckPitch: 6,
    headPitch: -22,
    legs: LEGS_HANG,
  },
  // The signature: feet thrown forward to where the eyes are looking, wings
  // flung high and back out of the way, head down sighting between the
  // talons. The osprey hits the water feet-first, every time.
  strike: {
    ext: 0.58,
    lift: 0.34,
    sweep: -0.12,
    twist: 0.25,
    poleUp: 0.95,
    flapGain: 0,
    tailSpread: 0.75,
    tailPitch: -12,
    bodyPitch: 0.2,
    bodyLift: 0,
    neckPitch: 26,
    headPitch: 18,
    legs: LEGS_REACH,
  },
  // Riding on the water after the plunge: wings folded against the body,
  // tail held up out of the wet, legs tucked, head up and alert. The body
  // sits low — buoyancy is part 5's job, but the pose leaves room for it.
  float: {
    ext: 0.05,
    lift: 0.01,
    sweep: -0.02,
    twist: 0,
    poleUp: 0.3,
    flapGain: 0,
    tailSpread: 0.12,
    tailPitch: -16,
    bodyPitch: 0.1,
    bodyLift: -0.03,
    neckPitch: -8,
    headPitch: -4,
    legs: LEGS_FLOAT,
  },
};

// Linear blend of pose targets (legs included). `mix` overwrites `out`.
export function mixPose(out: PoseTarget, add: PoseTarget, w: number): void {
  if (w <= 0) return;
  out.ext += (add.ext - out.ext) * w;
  out.lift += (add.lift - out.lift) * w;
  out.sweep += (add.sweep - out.sweep) * w;
  out.twist += (add.twist - out.twist) * w;
  out.poleUp += (add.poleUp - out.poleUp) * w;
  out.flapGain += (add.flapGain - out.flapGain) * w;
  out.tailSpread += (add.tailSpread - out.tailSpread) * w;
  out.tailPitch += (add.tailPitch - out.tailPitch) * w;
  out.bodyPitch += (add.bodyPitch - out.bodyPitch) * w;
  out.bodyLift += (add.bodyLift - out.bodyLift) * w;
  out.neckPitch += (add.neckPitch - out.neckPitch) * w;
  out.headPitch += (add.headPitch - out.headPitch) * w;
  const a = out.legs, b = add.legs;
  out.legs = {
    thigh: [a.thigh[0] + (b.thigh[0] - a.thigh[0]) * w, a.thigh[1] + (b.thigh[1] - a.thigh[1]) * w, a.thigh[2] + (b.thigh[2] - a.thigh[2]) * w],
    tarsus: [a.tarsus[0] + (b.tarsus[0] - a.tarsus[0]) * w, a.tarsus[1] + (b.tarsus[1] - a.tarsus[1]) * w, a.tarsus[2] + (b.tarsus[2] - a.tarsus[2]) * w],
    foot: [a.foot[0] + (b.foot[0] - a.foot[0]) * w, a.foot[1] + (b.foot[1] - a.foot[1]) * w, a.foot[2] + (b.foot[2] - a.foot[2]) * w],
    toeSpread: a.toeSpread + (b.toeSpread - a.toeSpread) * w,
  };
}

export function clonePose(p: PoseTarget): PoseTarget {
  return {
    ...p,
    legs: {
      thigh: [...p.legs.thigh],
      tarsus: [...p.legs.tarsus],
      foot: [...p.legs.foot],
      toeSpread: p.legs.toeSpread,
    },
  };
}
