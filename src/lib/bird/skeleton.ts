// The osprey's one source of truth: a table of segments. Each row is a joint
// — a pivot, a far end, two flesh radii — and every part of this series reads
// the same table: the mesh builder lofts rings whose radii come from these
// rows (part 1), the skin weights blend ring stations between the joints the
// rows became (part 1), the wing IK reads segment lengths to fold and extend
// the arm (part 2), the wingbeat and the action poses rotate the joints
// (parts 3–5). Change a number here and the whole bird is re-built, re-rigged,
// and re-flown to match.
//
// Conventions: meters, +y up, facing +z, perched with feet near y = 0.
// Rest pose holds the wings EXTENDED — span ≈ 1.6 m — because flat wings are
// the honest shape to model feathered surfaces in; the folded silhouette is a
// pose the IK reaches, not a separate mesh.

export interface OspreyBone {
  name: string;
  parent: string | null; // joint hierarchy
  head: [number, number, number]; // joint pivot, rest pose, world space
  tail: [number, number, number]; // segment far end
  r0: number; // flesh radius at head
  r1: number; // flesh radius at tail
}

interface RawBone {
  name: string;
  parent: string | null;
  head: [number, number, number];
  tail: [number, number, number];
  r0: number;
  r1?: number;
}

// ---- the parts list ---------------------------------------------------------
// An osprey is rangier than a buteo: small head, deep keel, long narrow
// wings, legs set well forward for the feet-first strike. Mass ~1.5 kg,
// span ~1.6 m — band-tail proportions straight off a real bird.

const CORE: RawBone[] = [
  // torso: the keel everything hangs from. The pivot sits near the center of
  // mass so body pitch reads as the whole bird rotating, not see-sawing.
  { name: "body", parent: null, head: [0, 0.305, 0.0], tail: [0, 0.325, 0.12], r0: 0.075, r1: 0.07 },

  { name: "neck", parent: "body", head: [0, 0.355, 0.145], tail: [0, 0.425, 0.175], r0: 0.04, r1: 0.037 },
  { name: "head", parent: "neck", head: [0, 0.425, 0.175], tail: [0, 0.452, 0.245], r0: 0.04, r1: 0.032 },
  // the bill: black, and the tip drops — the hook
  { name: "beak", parent: "head", head: [0, 0.45, 0.258], tail: [0, 0.428, 0.308], r0: 0.012, r1: 0.002 },

  // tail base: the rectrices fan from here (they are separate feather planes
  // hung on this joint — part 1 builds them, part 3 fans them)
  { name: "tailFan", parent: "body", head: [0, 0.275, -0.195], tail: [0, 0.24, -0.43], r0: 0.03, r1: 0.015 },
];

const LEFT: RawBone[] = [
  // the extended arm (x > 0 = her left): three segments, shoulder to wingtip.
  // The hand row reaches all the way to the tip of the longest primary —
  // for targeting purposes the feather IS the bone.
  {
    name: "humerusL", parent: "body", head: [0.068, 0.345, 0.085], tail: [0.225, 0.352, 0.045],
    r0: 0.034, r1: 0.027,
  },
  {
    name: "forearmL", parent: "humerusL", head: [0.225, 0.352, 0.045], tail: [0.46, 0.358, 0.01],
    r0: 0.027, r1: 0.02,
  },
  {
    name: "handL", parent: "forearmL", head: [0.46, 0.358, 0.01], tail: [0.795, 0.346, -0.068],
    r0: 0.018, r1: 0.006,
  },

  // leg: feathered trousers down to the bare tarsus and the great feet
  { name: "thighL", parent: "body", head: [0.045, 0.275, 0.02], tail: [0.066, 0.16, 0.046], r0: 0.038, r1: 0.024 },
  { name: "tarsusL", parent: "thighL", head: [0.066, 0.16, 0.046], tail: [0.073, 0.045, 0.062], r0: 0.0125, r1: 0.0105 },
  { name: "footL", parent: "tarsusL", head: [0.073, 0.045, 0.062], tail: [0.076, 0.02, 0.09], r0: 0.0105, r1: 0.009 },

  // toes: three forward, one back — until the outer one reverses (part 4).
  { name: "toeInL", parent: "footL", head: [0.072, 0.02, 0.08], tail: [0.046, 0.01, 0.148], r0: 0.0078, r1: 0.005 },
  { name: "toeMidL", parent: "footL", head: [0.0755, 0.02, 0.082], tail: [0.081, 0.01, 0.162], r0: 0.0078, r1: 0.0052 },
  { name: "toeOutL", parent: "footL", head: [0.079, 0.02, 0.08], tail: [0.114, 0.01, 0.136], r0: 0.0074, r1: 0.0048 },
  { name: "toeBackL", parent: "footL", head: [0.075, 0.02, 0.068], tail: [0.082, 0.01, 0.01], r0: 0.0072, r1: 0.0048 },
];

function mirror(b: RawBone): RawBone {
  const flip = (v: [number, number, number]): [number, number, number] => [-v[0], v[1], v[2]];
  return {
    ...b,
    name: b.name.slice(0, -1) + "R",
    parent: b.parent && /L$/.test(b.parent) ? b.parent.slice(0, -1) + "R" : b.parent,
    head: flip(b.head),
    tail: flip(b.tail),
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

// Useful rest-pose anchors.
export const EYE_L: [number, number, number] = [0.0305, 0.4535, 0.218];
export const FOOT_PIVOT_L: [number, number, number] = [0.0745, 0.021, 0.077];
// Where the folded wingtip rests, against the flank, primaries crossed over
// the tail base. The fold (part 2) sends the IK target here.
export const FOLDED_TIP_L: [number, number, number] = [0.055, 0.3, -0.195];
