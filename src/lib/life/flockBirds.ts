// The other wings, built with the same direct-mesh kit as the osprey: a
// lofted body, wings as tapered two-layer vanes (dark above, pale below —
// a bird overhead is a different color than a bird below you), everything
// faceted and merged into ONE geometry per species so a whole flock is one
// instanced draw call.
//
// The flap lives in the material: vertices outboard of the body hinge ride
// a sine in the vertex stage, phase hashed per instance. Forty swallows
// beat out of step for free, and nobody pays for a skeleton.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Euler,
  Matrix4,
  MeshStandardNodeMaterial,
  Quaternion,
  Vector3,
} from "three/webgpu";
import type { UniformNode } from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  abs,
  float,
  hash,
  instanceIndex,
  max,
  mix,
  positionLocal,
  pow,
  sin,
  smoothstep,
  time,
  uniform,
  vec3,
  vertexColor,
} from "three/tsl";
import { facetGeometry, featherGeometry, loftStations, mirrorGeometryX, type LoftStation } from "../bird/loft";

// ---- shared builders -----------------------------------------------------------

const _c = new Color();

/**
 * One wing as a tapered, swept vane: rows along the span, two layers so the
 * top can be dark and the underside pale. Built for the +x side, root at
 * x = rootX; mirror for the other wing. Bird faces +z.
 */
interface WingSpec {
  rootX: number;
  span: number; // root to tip, meters
  rootChord: number;
  tipChord: number;
  sweep: number; // tip set-back, meters
  dihedral: number; // tip rise, meters
  top: number; // hex colors
  bottom: number;
  tip?: number;
  segments?: number;
}

function wingVane(spec: WingSpec): BufferGeometry {
  const seg = spec.segments ?? 6;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const top = new Color(spec.top);
  const bottom = new Color(spec.bottom);
  const tip = new Color(spec.tip ?? spec.top);
  const gap = 0.0015;

  for (let layer = 0; layer < 2; layer++) {
    const yOff = layer === 0 ? gap / 2 : -gap / 2;
    const base = layer === 0 ? top : bottom;
    for (let i = 0; i <= seg; i++) {
      const s = i / seg;
      const x = spec.rootX + spec.span * s;
      const chord = spec.rootChord + (spec.tipChord - spec.rootChord) * Math.pow(s, 0.9);
      const zLE = spec.rootChord * 0.5 - spec.sweep * Math.pow(s, 1.4);
      const y = spec.dihedral * s * s + yOff;
      // three chordwise columns: leading edge, mid (slight camber), trailing
      positions.push(x, y, zLE, x, y + (layer === 0 ? 0.003 : 0.003), zLE - chord * 0.45, x, y, zLE - chord);
      _c.copy(base).lerp(tip, Math.max(0, (s - 0.65) / 0.35));
      for (let k = 0; k < 3; k++) colors.push(_c.r, _c.g, _c.b);
    }
  }

  const stride = 3;
  const layerStride = (seg + 1) * 3;
  for (let layer = 0; layer < 2; layer++) {
    const off = layer * layerStride;
    for (let i = 0; i < seg; i++) {
      for (let k = 0; k < 2; k++) {
        const a = off + i * stride + k;
        const b = a + 1;
        const d = a + stride;
        const e = d + 1;
        if (layer === 0) indices.push(a, b, d, b, e, d);
        else indices.push(a, d, b, b, d, e);
      }
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** A thin two-triangle vane (tail prongs, small fins). p0..p3 wind a quad. */
function flatQuad(p: number[], hex: number): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(p), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const c = new Color(hex);
  const colors = new Float32Array(12);
  for (let i = 0; i < 4; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function facetAll(parts: BufferGeometry[], jitter = 0.06): BufferGeometry {
  const faceted = parts.map((p) => {
    p.deleteAttribute("uv");
    const f = facetGeometry(p, { jitter });
    p.dispose();
    return f;
  });
  const merged = mergeGeometries(faceted);
  for (const f of faceted) f.dispose();
  return merged;
}

// ---- the swallow ------------------------------------------------------------------
// Barn swallow: 18 cm, 32 cm span, steel-blue above, buff below, rust
// throat, long pointed wings, forked tail. Hinge for the flap at |x| ≈ 15 mm.

const SWALLOW_STATIONS: LoftStation[] = [
  { pos: [0, 0, -0.085], rx: 0.004, ry: 0.004 },
  { pos: [0, 0.002, -0.04], rx: 0.011, ry: 0.01 },
  { pos: [0, 0.004, 0.01], rx: 0.016, ry: 0.015 },
  { pos: [0, 0.006, 0.05], rx: 0.014, ry: 0.013 },
  { pos: [0, 0.008, 0.075], rx: 0.0095, ry: 0.0095 },
  { pos: [0, 0.007, 0.092], rx: 0.0025, ry: 0.0025 },
];

const SWALLOW_BLUE = 0x1d2c4d;
const SWALLOW_BUFF = 0xe7dcc6;
const SWALLOW_RUST = 0x9c4527;

export const SWALLOW_HINGE = 0.015;

export function makeSwallowGeometry(): BufferGeometry {
  const blue = new Color(SWALLOW_BLUE);
  const buff = new Color(SWALLOW_BUFF);
  const rust = new Color(SWALLOW_RUST);

  const body = loftStations(SWALLOW_STATIONS, {
    segments: 9,
    rings: 12,
    paint: (u, theta, _pos, out) => {
      const up = Math.sin(theta);
      out.copy(up > 0.15 ? blue : buff);
      // rust forehead and throat: head region, underside
      if (u > 0.72 && up < 0.3) out.copy(rust);
    },
  });

  const wingL = wingVane({
    rootX: 0.012,
    span: 0.135,
    rootChord: 0.052,
    tipChord: 0.007,
    sweep: 0.075,
    dihedral: 0.006,
    top: SWALLOW_BLUE,
    bottom: 0xcfc5b2,
    tip: 0x10182c,
  });
  const wingR = mirrorGeometryX(wingL);

  // forked tail: two slim prongs splayed from the tail root
  const prongs: BufferGeometry[] = [];
  for (const side of [1, -1]) {
    prongs.push(
      flatQuad(
        [
          side * 0.002, 0, -0.075,
          side * 0.022, 0.002, -0.155,
          side * 0.028, 0.002, -0.15,
          side * 0.008, 0, -0.08,
        ],
        SWALLOW_BLUE,
      ),
    );
  }

  return facetAll([body, wingL, wingR, ...prongs]);
}

// ---- the goose ----------------------------------------------------------------------
// Canada goose: ~0.95 m bill to tail, 1.5 m span. Brown body, black neck
// sock, the white chinstrap. One loft runs tail → up the neck → bill.

const GOOSE_STATIONS: LoftStation[] = [
  { pos: [0, 0.0, -0.36], rx: 0.03, ry: 0.025 }, // tail
  { pos: [0, 0.02, -0.2], rx: 0.085, ry: 0.075 },
  { pos: [0, 0.03, 0.0], rx: 0.1, ry: 0.09 }, // mid body
  { pos: [0, 0.035, 0.16], rx: 0.085, ry: 0.08 }, // breast
  { pos: [0, 0.05, 0.26], rx: 0.042, ry: 0.04 }, // neck base
  { pos: [0, 0.16, 0.3], rx: 0.026, ry: 0.026 }, // neck
  { pos: [0, 0.28, 0.33], rx: 0.024, ry: 0.024 }, // upper neck
  { pos: [0, 0.34, 0.37], rx: 0.028, ry: 0.026 }, // head
  { pos: [0, 0.33, 0.43], rx: 0.012, ry: 0.012 }, // bill base
  { pos: [0, 0.325, 0.47], rx: 0.005, ry: 0.005 }, // bill tip
];

const GOOSE_BROWN = 0x6a5c48;
const GOOSE_PALE = 0xcfc4ad;
const GOOSE_BLACK = 0x17150f;
const GOOSE_CHIN = 0xe9e5da;

export const GOOSE_HINGE = 0.07;

export function makeGooseGeometry(): BufferGeometry {
  const brown = new Color(GOOSE_BROWN);
  const pale = new Color(GOOSE_PALE);
  const black = new Color(GOOSE_BLACK);
  const chin = new Color(GOOSE_CHIN);

  const body = loftStations(GOOSE_STATIONS, {
    segments: 10,
    rings: 22,
    paint: (u, theta, pos, out) => {
      const up = Math.sin(theta);
      if (u < 0.06) {
        out.copy(black); // tail
      } else if (u < 0.12 && up < 0) {
        out.copy(chin); // white undertail wedge
      } else if (u < 0.52) {
        out.copy(up > 0.1 ? brown : pale); // barred body, pale below
      } else if (pos.y > 0.3 && pos.y < 0.37 && up < 0.2 && u > 0.68 && u < 0.85) {
        out.copy(chin); // the chinstrap, painted in world space on the cheeks
      } else {
        out.copy(black); // neck sock, head, bill
      }
    },
  });

  const wingL = wingVane({
    rootX: 0.06,
    span: 0.64,
    rootChord: 0.24,
    tipChord: 0.06,
    sweep: 0.2,
    dihedral: 0.05,
    top: 0x57493a,
    bottom: 0x8f8470,
    tip: 0x1d1812,
    segments: 7,
  });
  const wingR = mirrorGeometryX(wingL);

  return facetAll([body, wingL, wingR]);
}

// ---- the eagle ----------------------------------------------------------------------
// Bald eagle: ~0.85 m, 2.1 m span. Dark chocolate, white head and tail,
// and slotted primary "fingers" at the wingtips — the soaring silhouette.

const EAGLE_STATIONS: LoftStation[] = [
  { pos: [0, 0, -0.36], rx: 0.025, ry: 0.022 },
  { pos: [0, 0.01, -0.18], rx: 0.075, ry: 0.07 },
  { pos: [0, 0.02, 0.02], rx: 0.092, ry: 0.088 },
  { pos: [0, 0.025, 0.2], rx: 0.07, ry: 0.068 },
  { pos: [0, 0.04, 0.3], rx: 0.045, ry: 0.044 }, // neck
  { pos: [0, 0.05, 0.38], rx: 0.038, ry: 0.037 }, // head
  { pos: [0, 0.042, 0.44], rx: 0.016, ry: 0.016 }, // bill base
  { pos: [0, 0.035, 0.48], rx: 0.006, ry: 0.007 }, // hooked tip
];

const EAGLE_DARK = 0x2c2117;
const EAGLE_WHITE = 0xeae6dc;
const EAGLE_BILL = 0xd8a93a;

export const EAGLE_HINGE = 0.06;

export function makeEagleGeometry(): BufferGeometry {
  const dark = new Color(EAGLE_DARK);
  const white = new Color(EAGLE_WHITE);
  const bill = new Color(EAGLE_BILL);

  const body = loftStations(EAGLE_STATIONS, {
    segments: 10,
    rings: 18,
    paint: (u, _theta, _pos, out) => {
      if (u > 0.88) out.copy(bill);
      else if (u > 0.6) out.copy(white); // the white hood
      else out.copy(dark);
    },
  });

  const parts: BufferGeometry[] = [body];

  for (const side of [1, -1] as const) {
    const vane = wingVane({
      rootX: 0.055,
      span: 0.72,
      rootChord: 0.3,
      tipChord: 0.13,
      sweep: 0.1,
      dihedral: 0.045,
      top: 0x32281c,
      bottom: 0x4a4034,
      segments: 7,
    });
    // slotted primaries: five fingers fanned off the tip, angled back
    const fingers: BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const f = featherGeometry({
        length: 0.2 - i * 0.012,
        width: 0.035,
        top: 0x241b12,
        bottom: 0x3a322a,
        curl: 0.004,
        rows: 3,
      });
      // feather extends along −z; aim it outboard (+x) and fan it backward
      f.rotateZ(-0.12 - i * 0.05); // rising fan seen from the front
      f.rotateY(-Math.PI / 2 + 0.18 + i * 0.16);
      f.translate(0.74, 0.05, -0.02 - i * 0.035);
      fingers.push(f);
    }
    const wing = mergeGeometries([vane, ...fingers]);
    vane.dispose();
    for (const f of fingers) f.dispose();
    parts.push(side === 1 ? wing : mirrorGeometryX(wing));
    if (side === -1) wing.dispose();
  }

  // white tail fan: three overlapping vanes
  for (let i = -1; i <= 1; i++) {
    parts.push(
      flatQuad(
        [
          i * 0.02 - 0.025, 0, -0.34,
          i * 0.07 - 0.035, -0.005, -0.52,
          i * 0.07 + 0.035, -0.005, -0.52,
          i * 0.02 + 0.025, 0, -0.34,
        ],
        0xe5e1d6,
      ),
    );
  }

  return facetAll(parts);
}

// ---- the flap material -----------------------------------------------------------------

type FloatUniform = UniformNode<"float", number>;

export interface FlapMaterialKit {
  material: MeshStandardNodeMaterial;
  /** Wingbeat frequency, Hz. */
  frequency: FloatUniform;
  /** Flap amplitude: vertical wingtip travel scale (≈ radians of stroke). */
  amplitude: FloatUniform;
  /** 0 = everyone flaps continuously, 1 = long glide phases mixed in. */
  glide: FloatUniform;
}

/**
 * Vertex-stage flapping: everything outboard of `hingeX` rises and falls on
 * a per-instance-phased sine. Stroke displacement grows ~linearly with span
 * (a rigid-wing rotation, small-angle), with a touch of extra tip lag so the
 * stroke looks whippy rather than hinged.
 */
export function makeFlapMaterial(hingeX: number): FlapMaterialKit {
  const frequency = uniform(6);
  const amplitude = uniform(0.9);
  const glide = uniform(0);

  const material = new MeshStandardNodeMaterial();
  material.side = DoubleSide;

  const ph = hash(float(instanceIndex).add(17.9)).mul(Math.PI * 2);
  const span = max(abs(positionLocal.x).sub(hingeX), 0);
  const stroke = sin(time.mul(frequency).mul(Math.PI * 2).add(ph));
  // glide gating: a slow per-instance cycle eases the amplitude in and out
  const gate = smoothstep(-0.2, 0.4, sin(time.mul(0.7).add(ph.mul(3.7))));
  const amp = amplitude.mul(mix(float(1), gate, glide));
  const lag = pow(span.add(1), 1.15).sub(1); // slightly superlinear toward the tip
  material.positionNode = positionLocal.add(vec3(0, stroke.mul(amp).mul(lag), 0));

  const bright = hash(float(instanceIndex).add(41.3)).mul(0.2).add(0.88);
  material.colorNode = vertexColor().mul(bright);
  material.roughnessNode = float(0.85);
  material.metalnessNode = float(0);

  return { material, frequency, amplitude, glide };
}

// ---- instance transform helper -------------------------------------------------------

const _e = new Euler();
const _q = new Quaternion();
const _s = new Vector3();

/**
 * Compose an instance matrix for a bird at `pos` flying along `vel` (nose
 * +z), banked by `roll` radians, uniformly scaled. YXZ order: yaw to the
 * heading, pitch to the climb, then roll about the body axis.
 */
export function setBirdMatrix(m: Matrix4, pos: Vector3, vel: Vector3, roll: number, scale = 1): Matrix4 {
  const hs = Math.max(1e-5, Math.hypot(vel.x, vel.z));
  _e.set(-Math.atan2(vel.y, hs), Math.atan2(vel.x, vel.z), roll, "YXZ");
  _q.setFromEuler(_e);
  _s.set(scale, scale, scale);
  return m.compose(pos, _q, _s);
}
