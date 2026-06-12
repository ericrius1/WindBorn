// The osprey's one source of truth: a table of capsules. Each row is a
// tapered capsule — a head, a tail, two radii — and every part of this series
// reads the same table: the signed-distance field unions these capsules into
// one skin (part 1), the skin weights ask "which capsule is this vertex
// near" (part 2), the wing IK reads segment lengths to unfold the Z folded
// under the plumage (part 2), the wingbeat and the action poses move the
// joints the rows became (parts 3–5). Change a number here and the whole
// bird is re-meshed, re-rigged, and re-flown to match.
//
// Conventions: meters, +y up, facing +z, perched with feet near y = 0.
// Folded span ≈ 0.24 m; unfolded ≈ 1.6 m — all of it hiding in the angles.

export interface OspreyBone {
  name: string;
  parent: string | null; // joint hierarchy
  head: [number, number, number]; // joint pivot, rest pose, world space
  tail: [number, number, number]; // segment far end
  r0: number; // flesh radius at head
  r1: number; // flesh radius at tail
  blend: number; // smooth-union width where this capsule meets the rest
  zone: number; // paint zone (see ZONE)
  // squash the capsule into a blade: offsets along `axis` shrink by factor s
  // (feathered panels are flat; muscles are round)
  flat?: { axis: [number, number, number]; s: number };
}

// Paint zones. The painter refines these per-point (white belly vs dark
// back both live on "body"), but the zone picks which rules apply.
export const ZONE = {
  body: 0,
  head: 1,
  wing: 2,
  tail: 3,
  beak: 4,
  leg: 5,
  talon: 6,
} as const;

interface RawBone {
  name: string;
  parent: string | null;
  head: [number, number, number];
  tail: [number, number, number];
  r0: number;
  r1?: number;
  blend?: number;
  zone?: number;
  flat?: { axis: [number, number, number]; s: number };
}

// ---- the parts list ---------------------------------------------------------
// An osprey is rangier than a buteo: small head, deep keel, long narrow
// wings, legs set well forward for the feet-first strike. The folded wing is
// a Z: humerus swept back and down, forearm forward and up to the wrist,
// hand swept back along the body almost to the tail tip.

const CORE: RawBone[] = [
  // torso: rump to shoulders; the keel everything hangs from
  { name: "body", parent: null, head: [0, 0.30, -0.10], tail: [0, 0.34, 0.10], r0: 0.082, r1: 0.078, blend: 0.05 },
  // the deep white chest (shape only — it never rotates on its own)
  { name: "breast", parent: "body", head: [0, 0.31, 0.04], tail: [0, 0.25, 0.13], r0: 0.07, r1: 0.045, blend: 0.06 },
  // rump tapering toward the tail base
  { name: "rump", parent: "body", head: [0, 0.30, -0.08], tail: [0, 0.265, -0.21], r0: 0.06, r1: 0.034, blend: 0.055 },

  { name: "neck", parent: "body", head: [0, 0.36, 0.12], tail: [0, 0.43, 0.165], r0: 0.044, r1: 0.039, blend: 0.045, zone: ZONE.head },
  { name: "head", parent: "neck", head: [0, 0.43, 0.165], tail: [0, 0.468, 0.232], r0: 0.041, r1: 0.033, blend: 0.028, zone: ZONE.head },
  // the bill: black, and the tip drops — the hook
  { name: "beak", parent: "head", head: [0, 0.455, 0.252], tail: [0, 0.432, 0.302], r0: 0.0125, r1: 0.0035, blend: 0.011, zone: ZONE.beak },

  // tail: one capsule squashed flat into a panel; part 3 fans it by scaling
  {
    name: "tailFan", parent: "body", head: [0, 0.27, -0.20], tail: [0, 0.225, -0.43],
    r0: 0.030, r1: 0.017, blend: 0.028, zone: ZONE.tail, flat: { axis: [0, 1, 0], s: 0.32 },
  },
];

const LEFT: RawBone[] = [
  // folded wing (x > 0 = her left): the Z pressed against the body
  {
    name: "humerusL", parent: "body", head: [0.068, 0.345, 0.085], tail: [0.094, 0.318, -0.078],
    r0: 0.036, r1: 0.029, blend: 0.04, zone: ZONE.wing,
  },
  {
    name: "forearmL", parent: "humerusL", head: [0.094, 0.318, -0.078], tail: [0.076, 0.352, 0.152],
    r0: 0.029, r1: 0.023, blend: 0.034, zone: ZONE.wing, flat: { axis: [1, 0, 0], s: 0.55 },
  },
  {
    name: "handL", parent: "forearmL", head: [0.076, 0.352, 0.152], tail: [0.058, 0.300, -0.193],
    r0: 0.021, r1: 0.007, blend: 0.028, zone: ZONE.wing, flat: { axis: [1, 0, 0], s: 0.45 },
  },

  // leg: feathered trousers down to the bare tarsus and the great feet
  { name: "thighL", parent: "body", head: [0.045, 0.27, 0.02], tail: [0.066, 0.155, 0.046], r0: 0.040, r1: 0.026, blend: 0.045 },
  { name: "tarsusL", parent: "thighL", head: [0.066, 0.155, 0.046], tail: [0.073, 0.042, 0.062], r0: 0.0125, r1: 0.0105, blend: 0.012, zone: ZONE.leg },
  { name: "footL", parent: "tarsusL", head: [0.073, 0.042, 0.062], tail: [0.076, 0.018, 0.092], r0: 0.0105, r1: 0.009, blend: 0.012, zone: ZONE.leg },

  // toes: three forward, one back. (The famous reversible outer toe is a
  // rigging note, not a mesh one — see part 1's aside.)
  { name: "toeInL", parent: "footL", head: [0.072, 0.020, 0.080], tail: [0.046, 0.010, 0.148], r0: 0.0078, r1: 0.0050, blend: 0.008, zone: ZONE.leg },
  { name: "toeMidL", parent: "footL", head: [0.0755, 0.020, 0.082], tail: [0.081, 0.010, 0.162], r0: 0.0078, r1: 0.0052, blend: 0.008, zone: ZONE.leg },
  { name: "toeOutL", parent: "footL", head: [0.079, 0.020, 0.080], tail: [0.114, 0.010, 0.136], r0: 0.0074, r1: 0.0048, blend: 0.008, zone: ZONE.leg },
  { name: "toeBackL", parent: "footL", head: [0.075, 0.020, 0.068], tail: [0.082, 0.010, 0.010], r0: 0.0072, r1: 0.0048, blend: 0.008, zone: ZONE.leg },
];

function mirror(b: RawBone): RawBone {
  const flip = (v: [number, number, number]): [number, number, number] => [-v[0], v[1], v[2]];
  return {
    ...b,
    name: b.name.slice(0, -1) + "R",
    parent: b.parent && /L$/.test(b.parent) ? b.parent.slice(0, -1) + "R" : b.parent,
    head: flip(b.head),
    tail: flip(b.tail),
    flat: b.flat ? { axis: flip(b.flat.axis), s: b.flat.s } : undefined,
  };
}

function finish(b: RawBone): OspreyBone {
  return {
    name: b.name,
    parent: b.parent ?? null,
    head: b.head,
    tail: b.tail,
    r0: b.r0,
    r1: b.r1 ?? b.r0,
    blend: b.blend ?? 0.03,
    zone: b.zone ?? ZONE.body,
    flat: b.flat,
  };
}

export const OSPREY_BONES: OspreyBone[] = [...CORE, ...LEFT, ...LEFT.map(mirror)].map(finish);

export const BONE_INDEX = new Map(OSPREY_BONES.map((b, i) => [b.name, i]));

export function bone(name: string): OspreyBone {
  const i = BONE_INDEX.get(name);
  if (i === undefined) throw new Error(`no bone ${name}`);
  return OSPREY_BONES[i];
}

export function boneLength(b: OspreyBone): number {
  return Math.hypot(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]);
}

// Distance from a point to a bone's segment minus the lerped flesh radius —
// negative inside the flesh. The zone painter asks this for every vertex and
// the skin weights ask it for every (vertex, bone) pair.
export function boneDistance(b: OspreyBone, px: number, py: number, pz: number): number {
  const ax = b.head[0], ay = b.head[1], az = b.head[2];
  const bax = b.tail[0] - ax, bay = b.tail[1] - ay, baz = b.tail[2] - az;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  let h = l2 > 1e-12 ? (pax * bax + pay * bay + paz * baz) / l2 : 0;
  h = Math.max(0, Math.min(1, h));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.hypot(dx, dy, dz) - (b.r0 + (b.r1 - b.r0) * h);
}

// Useful rest-pose anchors.
export const EYE_L: [number, number, number] = [0.0315, 0.4565, 0.214];
export const FOOT_PIVOT_L: [number, number, number] = [0.0745, 0.021, 0.077];
