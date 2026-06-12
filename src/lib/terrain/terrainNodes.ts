// The GPU half of the terrain parity pair. These TSL builders transcribe
// ./noise.ts and ./basin.ts operation for operation, so a vertex displaced
// in a shader lands on exactly the surface `terrainHeightAt` reports on the
// CPU (within f32 rounding — microns at valley scale). The integer hash is
// the key: WGSL u32 arithmetic wraps modulo 2^32, JavaScript's Math.imul
// does the same, so both halves draw the *same* gradient at every lattice
// point. If ./basin.ts changes, this file changes with it.

import {
  Fn,
  abs,
  atan,
  clamp,
  cos,
  exp,
  float,
  floor,
  int,
  length,
  min,
  mix,
  normalize,
  oneMinus,
  sin,
  smoothstep,
  uint,
  vec2,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { BASIN } from "./basin";

type NodeF = Node<"float">;
type NodeI = Node<"int">;
type NodeV2 = Node<"vec2">;
type NodeV3 = Node<"vec3">;

const asFloat = (v: NodeF | number): NodeF => (typeof v === "number" ? float(v) : v);

// ---- hash and gradient noise (twin of noise.ts) -------------------------------

// murmur3-finalizer hash → [0, 1). Bit-identical to hash2() on the CPU:
// u32 multiply wraps exactly like Math.imul, xor and logical shifts match.
export const hashNode = /* @__PURE__ */ Fn<[NodeI, NodeI, NodeI], NodeF>(([ix, iy, seed]) => {
  const h = uint(ix)
    .mul(uint(0x27d4eb2d))
    .bitXor(uint(iy).mul(uint(0x165667b1)))
    .bitXor(uint(seed).mul(uint(0x9e3779b9)))
    .toVar();
  h.assign(h.bitXor(h.shiftRight(uint(15))).mul(uint(0x85ebca6b)));
  h.assign(h.bitXor(h.shiftRight(uint(13))).mul(uint(0xc2b2ae35)));
  h.assign(h.bitXor(h.shiftRight(uint(16))));
  return float(h).mul(1 / 4294967296);
});

// Perlin's quintic fade, as in noise.ts.
const fade = (t: NodeF): NodeF => t.mul(t).mul(t).mul(t.mul(t.mul(6).sub(15)).add(10));

// Random unit gradient at a corner, dotted with the offset to the sample.
const gradDot = (cx: NodeI, cy: NodeI, seed: NodeI, dx: NodeF, dy: NodeF): NodeF => {
  const a = hashNode(cx, cy, seed).mul(Math.PI * 2);
  return cos(a).mul(dx).add(sin(a).mul(dy));
};

/** 2D gradient noise, range ≈ [-1, 1]. Twin of perlin2(). */
export const perlinNode = /* @__PURE__ */ Fn<[NodeV2, NodeI], NodeF>(([p, seed]) => {
  const ip = floor(p).toVar();
  const f = p.sub(ip).toVar();
  const ix = int(ip.x).toVar();
  const iy = int(ip.y).toVar();
  const one = int(1);
  const d00 = gradDot(ix, iy, seed, f.x, f.y);
  const d10 = gradDot(ix.add(one), iy, seed, f.x.sub(1), f.y);
  const d01 = gradDot(ix, iy.add(one), seed, f.x, f.y.sub(1));
  const d11 = gradDot(ix.add(one), iy.add(one), seed, f.x.sub(1), f.y.sub(1));
  const u = fade(f.x).toVar();
  const v = fade(f.y);
  return mix(mix(d00, d10, u), mix(d01, d11, u), v).mul(1.414);
});

// ---- fBm (twin of fbm2) ---------------------------------------------------------

const ROT_C = Math.cos(0.5);
const ROT_S = Math.sin(0.5);

export interface FbmNodeParams {
  octaves: number; // compile-time: the loop unrolls
  seed: number; // compile-time
  lacunarity?: number; // compile-time
  gain?: NodeF | number; // may be a uniform for live sliders
  ridge?: NodeF | number; // may be a uniform for live sliders
}

/**
 * Fractal sum of `perlinNode` octaves with the same per-octave rotation and
 * the same ridge fold (n → 1 − 2|n|, blended) as the CPU fbm2.
 */
export function fbm2Node(p: NodeV2, params: FbmNodeParams): NodeF {
  const lac = params.lacunarity ?? 2;
  const gain = asFloat(params.gain ?? 0.5);
  const ridge = asFloat(params.ridge ?? 0);
  let pos: NodeV2 = p;
  let sum: NodeF = float(0);
  let amp: NodeF = float(1);
  let norm: NodeF = float(0);
  for (let o = 0; o < params.octaves; o++) {
    let n: NodeF = perlinNode(pos, int(params.seed + o * 131));
    n = mix(n, oneMinus(abs(n).mul(2)), ridge);
    sum = sum.add(n.mul(amp));
    norm = norm.add(amp);
    amp = amp.mul(gain);
    const nx = pos.x.mul(ROT_C).sub(pos.y.mul(ROT_S));
    const ny = pos.x.mul(ROT_S).add(pos.y.mul(ROT_C));
    pos = vec2(nx.mul(lac), ny.mul(lac)).toVar();
  }
  return sum.div(norm);
}

// ---- the basin (twin of makeBasinHeight) ------------------------------------------

/**
 * Optional uniform overrides so demos can put sliders on the interesting
 * knobs without forking the whole composition. Anything not overridden is
 * baked from BASIN at shader-build time.
 */
export interface BasinOverrides {
  warpAmp?: NodeF;
  mountainAmp?: NodeF;
  ridge?: NodeF;
  rimHeight?: NodeF;
  bowlDepth?: NodeF;
  lipHeight?: NodeF;
}

/**
 * Build a callable height function node: world (x, z) in meters → height.
 * Mirrors makeBasinHeight() in basin.ts term for term.
 */
export function makeBasinHeightNode(o: BasinOverrides = {}) {
  const p = BASIN;
  const warpAmp = o.warpAmp ?? float(p.warpAmp);
  const mountainAmp = o.mountainAmp ?? float(p.mountainAmp);
  const ridge = o.ridge ?? float(p.ridge);
  const rimHeight = o.rimHeight ?? float(p.rimHeight);
  const bowlDepth = o.bowlDepth ?? float(p.bowlDepth);
  const lipHeight = o.lipHeight ?? float(p.lipHeight);

  return Fn<[NodeV2], NodeF>(([xz]) => {
    // -- domain warp -----------------------------------------------------------
    const wq = p.warpFreq;
    const u = fbm2Node(xz.mul(wq), { octaves: p.warpOctaves, seed: p.seed + 101 });
    const v = fbm2Node(vec2(xz.x.mul(wq).add(19.7), xz.y.mul(wq).sub(7.3)), {
      octaves: p.warpOctaves,
      seed: p.seed + 211,
    });
    const w = xz.add(vec2(u, v).mul(warpAmp)).toVar();
    const r = length(w).toVar();

    // -- radial skeleton ---------------------------------------------------------
    const rb = length(w.sub(vec2(p.bowlOffsetX, p.bowlOffsetZ))).div(p.shoreRadius).toVar();
    const bowl = bowlDepth.negate().mul(oneMinus(smoothstep(0.45, 1.0, rb)));
    const shore = clamp(r.sub(p.shoreRadius), p.shoreClampLo, p.shoreClampHi).mul(p.shoreSlope);
    const rise = smoothstep(p.shoreRadius, p.crestRadius, r).toVar();
    const settle = smoothstep(p.crestRadius, p.settleRadius, r).toVar();
    const h = bowl
      .add(shore)
      .add(rimHeight.mul(rise))
      .sub(rimHeight.sub(p.outerHeight).mul(settle))
      .toVar();

    // -- mountains -----------------------------------------------------------------
    const env = smoothstep(p.envInner, p.envOuter, r).mul(oneMinus(settle.mul(p.envFar)));
    const m = fbm2Node(w.mul(p.mountainFreq), {
      octaves: p.mountainOctaves,
      ridge,
      gain: p.gain,
      seed: p.seed,
    });
    h.addAssign(mountainAmp.mul(env).mul(m));

    // -- coast and lakebed detail -----------------------------------------------------
    const bandT = r.sub(p.shoreRadius).div(p.shoreBandWidth);
    const band = exp(bandT.mul(bandT).negate());
    h.addAssign(
      band.mul(p.shoreNoiseAmp).mul(fbm2Node(w.mul(p.shoreNoiseFreq), { octaves: 3, seed: p.seed + 57 })),
    );
    const bedMask = oneMinus(smoothstep(0.5, 0.85, rb));
    h.addAssign(bedMask.mul(p.bedAmp).mul(fbm2Node(w.mul(p.bedFreq), { octaves: p.bedOctaves, seed: p.seed + 71 })));

    // -- the outlet ---------------------------------------------------------------------
    const ang = atan(w.y, w.x);
    const d0 = abs(ang.sub(p.outletAngle));
    const d = min(d0, d0.negate().add(Math.PI * 2));
    const dn = d.div(p.outletWidth);
    const notch = exp(dn.mul(dn).negate());
    const outside = smoothstep(p.shoreRadius * 0.55, p.shoreRadius * 1.1, r);
    const floorH = lipHeight.add(r.sub(p.shoreRadius).mul(p.outletFall));
    const blend = notch.mul(outside);
    h.addAssign(min(h, floorH).sub(h).mul(blend));

    return h;
  });
}

/** The canonical GPU height function — the exact twin of terrainHeightAt. */
export const terrainHeightNode = /* @__PURE__ */ makeBasinHeightNode();

type HeightFnNode = ReturnType<typeof makeBasinHeightNode>;

/**
 * Outward surface normal by central differences of a height function node.
 * `eps` in meters; match it to your mesh density (coarser eps = softer
 * shading on coarser LOD rings, which is what you want).
 */
export function terrainNormalNode(
  xz: NodeV2,
  eps: NodeF | number = 1,
  heightFn: HeightFnNode = terrainHeightNode,
): NodeV3 {
  const e = asFloat(eps);
  const hL = heightFn(xz.sub(vec2(e, 0)));
  const hR = heightFn(xz.add(vec2(e, 0)));
  const hD = heightFn(xz.sub(vec2(0, e)));
  const hU = heightFn(xz.add(vec2(0, e)));
  return normalize(vec3(hL.sub(hR), e.mul(2), hD.sub(hU)));
}
