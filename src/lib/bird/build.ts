// From table to bird, with no field in between. The body is a loft: elliptical
// cross-section rings strung along a spine curve from tail to crown. Each wing
// is a loft too — a thin airfoil ring swept along the three arm segments —
// dressed with individual feather planes. Tail, legs, toes: more lofts. Every
// vertex is placed by a formula, painted on the way through, then the whole
// thing is faceted so each triangle owns one normal and one color.
//
// The painter knows real field marks: white below, dark chocolate above, a
// dark stripe through a yellow eye, barred tail, black wingtips, the speckled
// necklace.

import * as THREE from "three/webgpu";
import { BONE_INDEX, bone, EYE_L } from "./skeleton";
import {
  loftStations,
  featherGeometry,
  facetGeometry,
  mirrorGeometryX,
  hash1,
  type LoftStation,
  type FeatherSpec,
} from "./loft";
import { createOspreyRig, type OspreyRig } from "./rig";

// Plumage palette (sRGB). Flat facets eat saturation, so everything is
// pushed a little past the field guide.
export const PLUMAGE = {
  white: 0xf2ecdc, // belly, head, underparts
  brown: 0x47311f, // mantle, upperwing — dark chocolate
  brownDeep: 0x2e2015, // wingtips, eye-stripe core
  stripe: 0x342113, // the bandit mask
  underwing: 0xe6dfc9, // pale flight-feather undersides
  tail: 0x8a755a, // barred gray-brown
  beak: 0x191715, // black bill
  cere: 0x6f7d88, // blue-gray cere and gape
  leg: 0xb7bfc2, // pale gray-blue tarsus and toes
  talon: 0x16130f, // black talons
  iris: 0xf0c12e, // that yellow eye
} as const;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth01 = (v: number): number => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

const srgb = (hex: number): THREE.Color => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

interface Palette {
  white: THREE.Color;
  brown: THREE.Color;
  brownDeep: THREE.Color;
  stripe: THREE.Color;
  underwing: THREE.Color;
  tail: THREE.Color;
  beak: THREE.Color;
  cere: THREE.Color;
  leg: THREE.Color;
}

function makePalette(): Palette {
  return {
    white: srgb(PLUMAGE.white),
    brown: srgb(PLUMAGE.brown),
    brownDeep: srgb(PLUMAGE.brownDeep),
    stripe: srgb(PLUMAGE.stripe),
    underwing: srgb(PLUMAGE.underwing),
    tail: srgb(PLUMAGE.tail),
    beak: srgb(PLUMAGE.beak),
    cere: srgb(PLUMAGE.cere),
    leg: srgb(PLUMAGE.leg),
  };
}

// ---- the body loft -------------------------------------------------------------
// Eleven stations from under-tail to beak root. The spine curve interpolates
// the centers; the radii interpolate alongside. This list IS the body.

export function bodyStations(): LoftStation[] {
  return [
    { pos: [0, 0.262, -0.215], rx: 0.03, ry: 0.026 }, // under-tail coverts
    { pos: [0, 0.285, -0.155], rx: 0.052, ry: 0.047 },
    { pos: [0, 0.3, -0.06], rx: 0.073, ry: 0.067, yOff: -0.004 }, // belly
    { pos: [0, 0.307, 0.05], rx: 0.077, ry: 0.073, yOff: -0.006 }, // the keel
    { pos: [0, 0.318, 0.125], rx: 0.06, ry: 0.058, yOff: -0.004 }, // breast
    { pos: [0, 0.35, 0.158], rx: 0.043, ry: 0.041 }, // neck base
    { pos: [0, 0.4, 0.178], rx: 0.0375, ry: 0.0365 }, // neck
    { pos: [0, 0.438, 0.196], rx: 0.039, ry: 0.0375 }, // nape
    { pos: [0, 0.452, 0.225], rx: 0.0355, ry: 0.034 }, // crown
    { pos: [0, 0.4465, 0.25], rx: 0.0245, ry: 0.0255 }, // face
    { pos: [0, 0.4435, 0.262], rx: 0.013, ry: 0.0135 }, // beak root
  ];
}

// Skin weights along the body loft: torso to the body joint, blending up
// through the neck to the head. Pure functions of u — no proximity search.
function bodyWeights(u: number): [number, number][] {
  const iBody = BONE_INDEX.get("body")!;
  const iNeck = BONE_INDEX.get("neck")!;
  const iHead = BONE_INDEX.get("head")!;
  if (u < 0.45) return [[iBody, 1]];
  if (u < 0.58) {
    const t = smooth01((u - 0.45) / 0.13);
    return [[iBody, 1 - t], [iNeck, t]];
  }
  if (u < 0.68) return [[iNeck, 1]];
  if (u < 0.78) {
    const t = smooth01((u - 0.68) / 0.1);
    return [[iNeck, 1 - t], [iHead, t]];
  }
  return [[iHead, 1]];
}

// The painter, in loft coordinates: u along the spine (0 tail → 1 beak),
// theta around the ring (π/2 = the bird's back), plus the world position for
// marks that live in world space (the eye-stripe).
function paintBody(u: number, theta: number, pos: THREE.Vector3, out: THREE.Color, pal: Palette): void {
  const up = Math.sin(theta); // +1 on the back, −1 on the belly
  const ax = Math.abs(pos.x);

  if (u < 0.52) {
    // torso: dark mantle above, white below
    const dorsal = smooth01((up - 0.3) / 0.22);
    out.copy(pal.white).lerp(pal.brown, dorsal);
    // the necklace: a speckled brown band across the upper chest
    if (u > 0.38 && u < 0.49 && up < -0.2) {
      if (hash1(u * 311.7 + theta * 71.3) < 0.42) out.lerp(pal.brown, 0.5);
    }
    // faint feather rows on the brown back
    if (dorsal > 0.5) {
      const row = Math.sin(u * 56 + theta * 3);
      out.multiplyScalar(1 - 0.06 * Math.max(0, row));
    }
    return;
  }

  // neck and head: white, with the dark wedge climbing the nape and the
  // bandit stripe through the eye
  out.copy(pal.white);
  if (up > 0.25 && u < 0.74) {
    out.lerp(pal.brown, smooth01((0.74 - u) / 0.2) * smooth01((up - 0.25) / 0.3));
  }
  // crown streaks
  if (u > 0.78 && u < 0.94 && up > 0.55) {
    if (hash1(u * 173.1 + theta * 39.7) < 0.32) out.lerp(pal.brown, 0.3);
  }
  // eye-stripe: beak gape through the eye toward the nape, sides only.
  // A band around a segment in the (z, y) plane.
  const z0 = 0.26, y0 = 0.4485, z1 = 0.175, y1 = 0.428;
  const segLen2 = (z1 - z0) ** 2 + (y1 - y0) ** 2;
  const t = clamp01(((pos.z - z0) * (z1 - z0) + (pos.y - y0) * (y1 - y0)) / segLen2);
  const dz = pos.z - (z0 + (z1 - z0) * t);
  const dy = pos.y - (y0 + (y1 - y0) * t);
  const dStripe = Math.hypot(dz, dy);
  const side = smooth01((ax - 0.012) / 0.012);
  out.lerp(pal.stripe, smooth01((0.0145 - dStripe) / 0.006) * side);
}

export interface BodyGeometryOptions {
  rings?: number;
  segments?: number;
  painted?: boolean; // false = bare clay (the assembly demo's "before")
  facet?: boolean;
  jitter?: number;
}

export function buildBodyGeometry(opts: BodyGeometryOptions = {}): THREE.BufferGeometry {
  const pal = makePalette();
  const painted = opts.painted ?? true;
  const clay = srgb(0xb8b2a6);
  const raw = loftStations(bodyStations(), {
    rings: opts.rings ?? 26,
    segments: opts.segments ?? 18,
    paint: (u, theta, pos, out) => {
      if (painted) paintBody(u, theta, pos, out, pal);
      else out.copy(clay);
    },
    weights: bodyWeights,
  });
  if (opts.facet === false) return raw;
  const geo = facetGeometry(raw, { jitter: opts.jitter ?? 0.05 });
  raw.dispose();
  return geo;
}

// ---- the beak ------------------------------------------------------------------

export function buildBeakGeometry(): THREE.BufferGeometry {
  const pal = makePalette();
  const raw = loftStations(
    [
      { pos: [0, 0.451, 0.256], rx: 0.0125, ry: 0.012 },
      { pos: [0, 0.449, 0.276], rx: 0.009, ry: 0.0085 },
      { pos: [0, 0.4415, 0.292], rx: 0.0055, ry: 0.005 },
      { pos: [0, 0.4295, 0.305], rx: 0.0018, ry: 0.0018 }, // the hook drops
    ],
    {
      rings: 9,
      segments: 10,
      paint: (u, _theta, _pos, out) => {
        out.copy(pal.beak);
        if (u < 0.2) out.lerp(pal.cere, smooth01((0.2 - u) / 0.12) * 0.85);
      },
    },
  );
  const geo = facetGeometry(raw, { jitter: 0.04 });
  raw.dispose();
  return geo;
}

// ---- the wing ------------------------------------------------------------------
// The arm polyline from the table, swept with a thin airfoil ring: nose,
// three points down the underside, trailing edge, three points back across
// the top. Quad strips around a section — a loft wearing a different ring.

interface ArmFrame {
  point: THREE.Vector3;
  chord: THREE.Vector3; // unit, leading → trailing (mostly −z)
}

function armKnots(): THREE.Vector3[] {
  const h = bone("humerusL");
  const f = bone("forearmL");
  const hd = bone("handL");
  return [
    new THREE.Vector3(...h.head),
    new THREE.Vector3(...f.head),
    new THREE.Vector3(...hd.head),
    new THREE.Vector3(...hd.tail),
  ];
}

function armLengths(knots: THREE.Vector3[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < knots.length; i++) out.push(out[i - 1] + knots[i].distanceTo(knots[i - 1]));
  return out;
}

function armPoint(knots: THREE.Vector3[], cum: number[], m: number, out: THREE.Vector3): THREE.Vector3 {
  const total = cum[cum.length - 1];
  const mm = clamp01(m / total) * total;
  for (let i = 1; i < cum.length; i++) {
    if (mm <= cum[i] || i === cum.length - 1) {
      const t = (mm - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
      return out.copy(knots[i - 1]).lerp(knots[i], t);
    }
  }
  return out.copy(knots[knots.length - 1]);
}

// Piecewise-linear profile against knot arc positions.
function profileAt(knotS: number[], values: number[], s: number): number {
  if (s <= knotS[0]) return values[0];
  for (let i = 1; i < knotS.length; i++) {
    if (s <= knotS[i]) {
      const t = (s - knotS[i - 1]) / (knotS[i] - knotS[i - 1]);
      return values[i - 1] + (values[i] - values[i - 1]) * t;
    }
  }
  return values[values.length - 1];
}

function armFrame(knots: THREE.Vector3[], cum: number[], s: number, out: ArmFrame): ArmFrame {
  const total = cum[cum.length - 1];
  const d = 0.035;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  armPoint(knots, cum, s * total, out.point);
  armPoint(knots, cum, Math.max(0, s * total - d), a);
  armPoint(knots, cum, Math.min(total, s * total + d), b);
  const dir = b.sub(a).normalize();
  out.chord.set(dir.z, 0, -dir.x).normalize(); // backward, perpendicular in plan
  return out;
}

// Chordwise section: [fraction along chord, vertical offset × thickness].
// Order matters: nose → underside → trailing edge → top — CCW seen from the
// wingtip, so the standard loft winding faces outward.
const SECTION: [number, number][] = [
  [0, 0.06], // nose
  [0.18, -0.3],
  [0.48, -0.26],
  [0.78, -0.16],
  [1, 0.0], // trailing edge
  [0.78, 0.2],
  [0.48, 0.42],
  [0.18, 0.55],
];

export interface WingGeometryOptions {
  rows?: number;
  painted?: boolean;
}

// The left wing membrane (shoulder fairing + coverts + the hand), skinned to
// body/humerus/forearm/hand by span position. World space, faceted.
export function buildWingMembraneGeometry(opts: WingGeometryOptions = {}): THREE.BufferGeometry {
  const pal = makePalette();
  const painted = opts.painted ?? true;
  const clay = srgb(0xb8b2a6);
  const rows = opts.rows ?? 15;
  const knots = armKnots();
  const cum = armLengths(knots);
  const total = cum[cum.length - 1];
  const knotS = cum.map((c) => c / total);

  const leProf = [0.075, 0.07, 0.058, 0.012];
  const teProf = [0.16, 0.145, 0.105, 0.022];
  const thProf = [0.018, 0.015, 0.009, 0.003];

  const iBody = BONE_INDEX.get("body")!;
  const iHum = BONE_INDEX.get("humerusL")!;
  const iFore = BONE_INDEX.get("forearmL")!;
  const iHand = BONE_INDEX.get("handL")!;
  const wrist = knots[2];

  const positions: number[] = [];
  const colors: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const indices: number[] = [];

  const frame: ArmFrame = { point: new THREE.Vector3(), chord: new THREE.Vector3() };
  const p = new THREE.Vector3();
  const c = new THREE.Color();

  const pushWeights = (m: number): void => {
    // blend windows of ±4.5 cm around each joint, root fading from the body
    const w = 0.045;
    let pairs: [number, number][];
    if (m < 0.05) {
      const t = smooth01(m / 0.05);
      pairs = [[iBody, 1 - t * 0.999], [iHum, t * 0.999]];
    } else if (m < cum[1] - w) pairs = [[iHum, 1]];
    else if (m < cum[1] + w) {
      const t = smooth01((m - (cum[1] - w)) / (2 * w));
      pairs = [[iHum, 1 - t], [iFore, t]];
    } else if (m < cum[2] - w) pairs = [[iFore, 1]];
    else if (m < cum[2] + w) {
      const t = smooth01((m - (cum[2] - w)) / (2 * w));
      pairs = [[iFore, 1 - t], [iHand, t]];
    } else pairs = [[iHand, 1]];
    for (let k = 0; k < 4; k++) {
      skinIndices.push(pairs[k]?.[0] ?? 0);
      skinWeights.push(pairs[k]?.[1] ?? 0);
    }
  };

  for (let r = 0; r < rows; r++) {
    const s = r / (rows - 1);
    armFrame(knots, cum, s, frame);
    const le = profileAt(knotS, leProf, s);
    const te = profileAt(knotS, teProf, s);
    const th = profileAt(knotS, thProf, s);
    const tipDark = smooth01((s - 0.72) / 0.26);
    for (const [f, yk] of SECTION) {
      p.copy(frame.point).addScaledVector(frame.chord, -le + (le + te) * f);
      p.y += yk * th;
      positions.push(p.x, p.y, p.z);
      if (painted) {
        const topSide = yk > 0.05 || (f === 0 && true);
        if (topSide || f === 1) {
          c.copy(pal.brown);
          if (f === 0) c.multiplyScalar(1.12); // pale leading edge
        } else {
          c.copy(pal.underwing);
          const dWrist = Math.hypot(p.x - wrist.x, p.z - wrist.z);
          c.lerp(pal.brownDeep, smooth01((0.055 - dWrist) / 0.035) * 0.7); // carpal patch
        }
        c.lerp(pal.brownDeep, tipDark * 0.75);
      } else c.copy(clay);
      colors.push(c.r, c.g, c.b);
      pushWeights(s * total);
    }
  }

  const seg = SECTION.length;
  for (let r = 0; r < rows - 1; r++) {
    for (let sI = 0; sI < seg; sI++) {
      const a = r * seg + sI;
      const b = r * seg + ((sI + 1) % seg);
      const cc = (r + 1) * seg + sI;
      const d = (r + 1) * seg + ((sI + 1) % seg);
      indices.push(a, b, cc, b, d, cc);
    }
  }
  // tip cap
  {
    armFrame(knots, cum, 1, frame);
    const ci = positions.length / 3;
    positions.push(frame.point.x, frame.point.y, frame.point.z);
    colors.push(...(painted ? [pal.brownDeep.r, pal.brownDeep.g, pal.brownDeep.b] : [clay.r, clay.g, clay.b]));
    pushWeights(total);
    const base = (rows - 1) * seg;
    for (let sI = 0; sI < seg; sI++) indices.push(ci, base + sI, base + ((sI + 1) % seg));
  }

  const raw = new THREE.BufferGeometry();
  raw.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  raw.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  raw.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  raw.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  raw.setIndex(indices);
  raw.computeVertexNormals();
  const geo = facetGeometry(raw, { jitter: 0.05 });
  raw.dispose();
  return geo;
}

// ---- feathers ------------------------------------------------------------------

export type FeatherKind = "primary" | "secondary" | "tertial" | "rectrix";

export interface FeatherPlacement {
  boneName: string;
  position: THREE.Vector3; // rest-pose world
  direction: THREE.Vector3; // unit, quill → tip
  up: THREE.Vector3;
  spec: FeatherSpec;
  kind: FeatherKind;
  span01: number; // 0 inner → 1 outer along its row
  fanU?: number; // rectrices: −0.5 … +0.5 across the fan
}

const PRIMARY_LEN = [0.13, 0.15, 0.17, 0.185, 0.2, 0.21, 0.215, 0.21, 0.19];

// Where every wing feather sits, in rest-pose world space, for one side.
export function wingFeatherPlacements(side: "L" | "R"): FeatherPlacement[] {
  const sign = side === "L" ? 1 : -1;
  const out: FeatherPlacement[] = [];
  const knots = armKnots();
  const cum = armLengths(knots);
  const frame: ArmFrame = { point: new THREE.Vector3(), chord: new THREE.Vector3() };
  const total = cum[cum.length - 1];
  const handDir = knots[3].clone().sub(knots[2]).normalize();

  const place = (
    kind: FeatherKind,
    span01: number,
    pos: THREE.Vector3,
    dir: THREE.Vector3,
    spec: FeatherSpec,
  ): void => {
    out.push({
      boneName: (kind === "primary" ? "hand" : kind === "secondary" ? "forearm" : "humerus") + side,
      position: new THREE.Vector3(pos.x * sign, pos.y, pos.z),
      direction: new THREE.Vector3(dir.x * sign, dir.y, dir.z).normalize(),
      up: new THREE.Vector3(0, 1, 0),
      spec,
      kind,
      span01,
    });
  };

  // primaries: nine fingers on the hand, fanning from chord-back to almost
  // along the wing axis — the outermost make the black, slotted tip
  const nP = PRIMARY_LEN.length;
  for (let k = 0; k < nP; k++) {
    const e = Math.pow(k / (nP - 1), 1.25);
    const m = cum[2] + (0.06 + 0.86 * (k / (nP - 1))) * (cum[3] - cum[2]);
    armFrame(knots, cum, m / total, frame);
    const dir = frame.chord
      .clone()
      .multiplyScalar(1 - e)
      .addScaledVector(new THREE.Vector3().copy(handDir).addScaledVector(frame.chord, 0.4).normalize(), e);
    dir.y -= 0.06 * e;
    const pos = frame.point.clone();
    pos.y -= 0.004 + 0.0008 * k;
    place("primary", k / (nP - 1), pos, dir, {
      length: PRIMARY_LEN[k],
      width: 0.036 - 0.008 * (k / (nP - 1)),
      top: PLUMAGE.brown,
      bottom: PLUMAGE.underwing,
      tipColor: PLUMAGE.brownDeep,
      tipStart: k >= 5 ? 0.45 : 0.68,
      curl: 0.012 + 0.01 * e,
    });
  }

  // secondaries: ten panels along the forearm, straight back
  const nS = 10;
  for (let k = 0; k < nS; k++) {
    const m = cum[1] + (0.04 + 0.9 * (k / (nS - 1))) * (cum[2] - cum[1]);
    armFrame(knots, cum, m / total, frame);
    const dir = frame.chord.clone();
    dir.x -= 0.1 - 0.06 * (k / (nS - 1)); // inner ones angle toward the tail
    dir.y -= 0.02;
    const pos = frame.point.clone();
    pos.y -= 0.0045;
    place("secondary", k / (nS - 1), pos, dir, {
      length: 0.152 - 0.028 * (k / (nS - 1)),
      width: 0.04,
      top: PLUMAGE.brown,
      bottom: PLUMAGE.underwing,
      tipColor: PLUMAGE.brownDeep,
      tipStart: 0.85,
      curl: 0.008,
    });
  }

  // tertials: three broad blades at the root, closing the gap to the tail
  for (let k = 0; k < 3; k++) {
    const m = (0.2 + 0.3 * k) * cum[1];
    armFrame(knots, cum, m / total, frame);
    const dir = frame.chord.clone();
    dir.x -= 0.22;
    const pos = frame.point.clone();
    pos.y -= 0.003;
    place("tertial", k / 2, pos, dir, {
      length: 0.15 - 0.015 * k,
      width: 0.05,
      top: PLUMAGE.brown,
      bottom: PLUMAGE.underwing,
      tipStart: 0.9,
      curl: 0.006,
    });
  }

  return out;
}

// Twelve rectrices fanning from the tail base. The fan angle itself is set
// live (see Osprey.setTailSpread) — placements store the across-fan position.
export function tailFeatherPlacements(): FeatherPlacement[] {
  const out: FeatherPlacement[] = [];
  const n = 12;
  const root = bone("tailFan");
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1) - 0.5;
    out.push({
      boneName: "tailFan",
      position: new THREE.Vector3(0, root.head[1] + 0.0035 - 0.005 * Math.abs(u) * 2, root.head[2] + 0.01),
      direction: new THREE.Vector3(0, -0.05, -1).normalize(),
      up: new THREE.Vector3(0, 1, 0),
      spec: {
        length: 0.235 - 0.018 * Math.abs(u) * 2,
        width: 0.044,
        top: PLUMAGE.tail,
        bottom: PLUMAGE.underwing,
        tipColor: PLUMAGE.brownDeep,
        tipStart: 0.8,
        bars: { count: 5, strength: 0.26 },
        curl: 0.004,
      },
      kind: "rectrix",
      span01: k / (n - 1),
      fanU: u,
    });
  }
  return out;
}

// Orientation for a feather: local −z → direction, local +y → up.
export function featherQuaternion(
  direction: THREE.Vector3,
  up: THREE.Vector3,
  out = new THREE.Quaternion(),
): THREE.Quaternion {
  const z = direction.clone().multiplyScalar(-1).normalize();
  const y = up.clone().addScaledVector(z, -up.dot(z)).normalize();
  if (y.lengthSq() < 1e-8) y.set(0, 1, 0);
  const x = new THREE.Vector3().crossVectors(y, z);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return out.setFromRotationMatrix(m);
}

// ---- legs, talons, eyes ----------------------------------------------------------

function legLoft(stations: LoftStation[], color: number, segments = 10): THREE.BufferGeometry {
  const c = srgb(color);
  const raw = loftStations(stations, {
    rings: stations.length * 3,
    segments,
    paint: (_u, _t, _p, out) => out.copy(c),
  });
  const geo = facetGeometry(raw, { jitter: 0.05 });
  raw.dispose();
  return geo;
}

// ---- the assembled bird ------------------------------------------------------------

export interface FeatherInstance {
  mesh: THREE.Mesh;
  baseQuat: THREE.Quaternion;
  kind: FeatherKind;
  side: "L" | "R" | "C";
  span01: number;
  fanU: number;
}

export interface OspreyOptions {
  feathers?: boolean; // default true
  painted?: boolean;
}

export interface Osprey {
  group: THREE.Group;
  rig: OspreyRig;
  body: THREE.SkinnedMesh;
  wingL: THREE.SkinnedMesh;
  wingR: THREE.SkinnedMesh;
  feathers: FeatherInstance[]; // wing feathers, both sides
  tailFeathers: FeatherInstance[];
  setTailSpread(spread01: number): void;
  dispose(): void;
}

function boneRemapLR(): Map<number, number> {
  const map = new Map<number, number>();
  for (const [name, i] of BONE_INDEX) {
    if (name.endsWith("L")) {
      const j = BONE_INDEX.get(name.slice(0, -1) + "R");
      if (j !== undefined) map.set(i, j);
    }
  }
  return map;
}

export function buildOsprey(opts: OspreyOptions = {}): Osprey {
  const withFeathers = opts.feathers ?? true;
  const painted = opts.painted ?? true;
  const group = new THREE.Group();
  const rig = createOspreyRig();
  group.add(rig.root);

  const disposables: { dispose(): void }[] = [];
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  disposables.push(mat);

  const bind = (geo: THREE.BufferGeometry): THREE.SkinnedMesh => {
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.bind(rig.skeleton, new THREE.Matrix4());
    mesh.frustumCulled = false;
    group.add(mesh);
    disposables.push(geo);
    return mesh;
  };

  const body = bind(buildBodyGeometry({ painted }));

  const wingGeoL = buildWingMembraneGeometry({ painted });
  const wingGeoR = mirrorGeometryX(wingGeoL, boneRemapLR());
  const wingL = bind(wingGeoL);
  const wingR = bind(wingGeoR);

  // beak: a rigid loft riding the head joint
  const beakGeo = buildBeakGeometry();
  const headDef = bone("head");
  beakGeo.translate(-headDef.head[0], -headDef.head[1], -headDef.head[2]);
  const beak = new THREE.Mesh(beakGeo, mat);
  rig.bone("head").add(beak);
  disposables.push(beakGeo);

  // eyes
  const irisMat = new THREE.MeshStandardMaterial({ color: srgb(PLUMAGE.iris), roughness: 0.25, flatShading: true });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x0b0908, roughness: 0.15 });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const irisGeo = new THREE.IcosahedronGeometry(0.0095, 1);
  const pupilGeo = new THREE.SphereGeometry(0.0048, 10, 8);
  const glintGeo = new THREE.SphereGeometry(0.0021, 8, 6);
  disposables.push(irisMat, pupilMat, glintMat, irisGeo, pupilGeo, glintGeo);
  const [ex, ey, ez] = EYE_L;
  for (const sx of [1, -1]) {
    const addEye = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number): void => {
      const e = new THREE.Mesh(geo, m);
      e.position.set(x - headDef.head[0], y - headDef.head[1], z - headDef.head[2]);
      rig.bone("head").add(e);
    };
    addEye(irisGeo, irisMat, sx * ex, ey, ez);
    addEye(pupilGeo, pupilMat, sx * (ex + 0.003), ey, ez + 0.005);
    addEye(glintGeo, glintMat, sx * (ex + 0.0045), ey + 0.0028, ez + 0.0062);
  }

  // legs: trousers, tarsus, foot, toes, talons — lofts and cones on joints
  const talonMat = new THREE.MeshStandardMaterial({ color: srgb(PLUMAGE.talon), roughness: 0.35, flatShading: true });
  const talonGeo = new THREE.ConeGeometry(0.0036, 0.02, 7);
  disposables.push(talonMat, talonGeo);
  const upY = new THREE.Vector3(0, 1, 0);

  for (const side of ["L", "R"] as const) {
    const sign = side === "L" ? 1 : -1;
    const sx = (v: [number, number, number]): [number, number, number] => [v[0] * sign, v[1], v[2]];
    const attachLoft = (boneName: string, geo: THREE.BufferGeometry): void => {
      const def = bone(boneName);
      geo.translate(-def.head[0], -def.head[1], -def.head[2]);
      const mesh = new THREE.Mesh(geo, mat);
      rig.bone(boneName).add(mesh);
      disposables.push(geo);
    };

    attachLoft(
      "thigh" + side,
      legLoft(
        [
          { pos: sx([0.048, 0.292, 0.018]), rx: 0.036, ry: 0.034 },
          { pos: sx([0.06, 0.21, 0.038]), rx: 0.029, ry: 0.027 },
          { pos: sx([0.066, 0.162, 0.046]), rx: 0.019, ry: 0.017 },
        ],
        PLUMAGE.white,
      ),
    );
    attachLoft(
      "tarsus" + side,
      legLoft(
        [
          { pos: sx([0.066, 0.158, 0.046]), rx: 0.0105, ry: 0.0105 },
          { pos: sx([0.07, 0.1, 0.054]), rx: 0.009, ry: 0.009 },
          { pos: sx([0.073, 0.046, 0.06]), rx: 0.0085, ry: 0.0085 },
        ],
        PLUMAGE.leg,
        8,
      ),
    );
    attachLoft(
      "foot" + side,
      legLoft(
        [
          { pos: sx([0.073, 0.044, 0.06]), rx: 0.012, ry: 0.01 },
          { pos: sx([0.0755, 0.024, 0.082]), rx: 0.011, ry: 0.009 },
        ],
        PLUMAGE.leg,
        8,
      ),
    );

    for (const toe of ["toeIn", "toeMid", "toeOut", "toeBack"]) {
      const def = bone(toe + side);
      attachLoft(
        toe + side,
        legLoft(
          [
            { pos: def.head, rx: def.r0, ry: def.r0 * 0.9 },
            { pos: [
                def.head[0] + (def.tail[0] - def.head[0]) * 0.55,
                def.head[1] + (def.tail[1] - def.head[1]) * 0.55,
                def.head[2] + (def.tail[2] - def.head[2]) * 0.55,
              ], rx: (def.r0 + def.r1) / 2, ry: ((def.r0 + def.r1) / 2) * 0.9 },
            { pos: def.tail, rx: def.r1, ry: def.r1 * 0.9 },
          ],
          PLUMAGE.leg,
          7,
        ),
      );
      // talon: a cone planted at the toe tip, curling down
      const talon = new THREE.Mesh(talonGeo, talonMat);
      const dir = new THREE.Vector3(def.tail[0] - def.head[0], 0, def.tail[2] - def.head[2])
        .normalize()
        .multiplyScalar(0.55);
      dir.y = -0.85;
      dir.normalize();
      talon.quaternion.setFromUnitVectors(upY, dir);
      talon.position
        .set(def.tail[0] - def.head[0], def.tail[1] - def.head[1], def.tail[2] - def.head[2])
        .addScaledVector(dir, 0.02 * 0.32);
      rig.bone(toe + side).add(talon);
    }
  }

  // feathers
  const feathers: FeatherInstance[] = [];
  const tailFeathers: FeatherInstance[] = [];
  const addFeather = (pl: FeatherPlacement, side: "L" | "R" | "C"): FeatherInstance => {
    const geo = featherGeometry(pl.spec);
    const faceted = facetGeometry(geo, { jitter: 0.045 });
    geo.dispose();
    disposables.push(faceted);
    const mesh = new THREE.Mesh(faceted, mat);
    const def = bone(pl.boneName);
    mesh.position.set(pl.position.x - def.head[0], pl.position.y - def.head[1], pl.position.z - def.head[2]);
    const q = featherQuaternion(pl.direction, pl.up);
    mesh.quaternion.copy(q);
    rig.bone(pl.boneName).add(mesh);
    return { mesh, baseQuat: q.clone(), kind: pl.kind, side, span01: pl.span01, fanU: pl.fanU ?? 0 };
  };

  if (withFeathers) {
    for (const pl of wingFeatherPlacements("L")) feathers.push(addFeather(pl, "L"));
    for (const pl of wingFeatherPlacements("R")) feathers.push(addFeather(pl, "R"));
    for (const pl of tailFeatherPlacements()) tailFeathers.push(addFeather(pl, "C"));
  }

  const qYaw = new THREE.Quaternion();
  const setTailSpread = (spread01: number): void => {
    const fan = THREE.MathUtils.lerp(0.22, 1.1, clamp01(spread01));
    for (const f of tailFeathers) {
      qYaw.setFromAxisAngle(upY, -f.fanU * fan);
      f.mesh.quaternion.copy(qYaw).multiply(f.baseQuat);
    }
  };
  setTailSpread(0.2);

  return {
    group,
    rig,
    body,
    wingL,
    wingR,
    feathers,
    tailFeathers,
    setTailSpread,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

// Triangle count helper for the demos' readouts.
export function triangleCount(obj: THREE.Object3D): number {
  let tris = 0;
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      const g = mesh.geometry as THREE.BufferGeometry;
      tris += (g.getIndex()?.count ?? g.getAttribute("position").count) / 3;
    }
  });
  return Math.round(tris);
}
