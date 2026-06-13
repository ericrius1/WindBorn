// 3D value noise on the GPU — the air's grain. Clouds are carved from it,
// stars are hashed from it, mist swirls by it. Same recipe as the spine's CPU
// value noise (integer-lattice hash, smoothstep blend), lifted to TSL so the
// whole field evaluates per fragment without a single texture fetch.
//
// The hash is a murmur-style integer finalizer: u32 arithmetic wraps modulo
// 2^32 in WGSL, so every lattice point answers the same on every machine.

import { Fn, float, floor, int, mix, uint, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

type NodeF = Node<"float">;
type NodeI = Node<"int">;
type NodeV3 = Node<"vec3">;

/** Lattice hash → [0, 1). Three coordinates and a seed lane. */
export const hash3 = /* @__PURE__ */ Fn<[NodeI, NodeI, NodeI, NodeI], NodeF>(
  ([ix, iy, iz, seed]) => {
    const h = uint(ix)
      .mul(uint(0x27d4eb2d))
      .bitXor(uint(iy).mul(uint(0x165667b1)))
      .bitXor(uint(iz).mul(uint(0x9e3779b9)))
      .bitXor(uint(seed).mul(uint(0x85ebca6b)))
      .toVar();
    h.assign(h.bitXor(h.shiftRight(uint(15))).mul(uint(0x85ebca6b)));
    h.assign(h.bitXor(h.shiftRight(uint(13))).mul(uint(0xc2b2ae35)));
    h.assign(h.bitXor(h.shiftRight(uint(16))));
    return float(h).mul(1 / 4294967296);
  },
);

const smooth = (t: NodeF): NodeF => t.mul(t).mul(t.mul(-2).add(3));

/** Trilinear value noise, range [0, 1]. Eight hashes per sample — cheap on
 *  purpose: a cloud march calls this hundreds of times per pixel. */
export const vnoise3 = /* @__PURE__ */ Fn<[NodeV3, NodeI], NodeF>(([p, seed]) => {
  const ip = floor(p).toVar();
  const f = p.sub(ip).toVar();
  const ix = int(ip.x).toVar();
  const iy = int(ip.y).toVar();
  const iz = int(ip.z).toVar();
  const one = int(1);
  const ux = smooth(f.x).toVar();
  const uy = smooth(f.y).toVar();
  const uz = smooth(f.z).toVar();

  const c000 = hash3(ix, iy, iz, seed);
  const c100 = hash3(ix.add(one), iy, iz, seed);
  const c010 = hash3(ix, iy.add(one), iz, seed);
  const c110 = hash3(ix.add(one), iy.add(one), iz, seed);
  const c001 = hash3(ix, iy, iz.add(one), seed);
  const c101 = hash3(ix.add(one), iy, iz.add(one), seed);
  const c011 = hash3(ix, iy.add(one), iz.add(one), seed);
  const c111 = hash3(ix.add(one), iy.add(one), iz.add(one), seed);

  const z0 = mix(mix(c000, c100, ux), mix(c010, c110, ux), uy);
  const z1 = mix(mix(c001, c101, ux), mix(c011, c111, ux), uy);
  return mix(z0, z1, uz);
});

/**
 * Fractal sum of `octaves` vnoise3 layers (compile-time unrolled), normalized
 * to [0, 1]. Each octave doubles frequency and halves amplitude; a fixed
 * offset per octave de-correlates the lattices.
 */
export function fbm3(p: NodeV3, octaves: number, seed = 0): NodeF {
  let sum: NodeF = float(0);
  let amp = 1;
  let norm = 0;
  let pos: NodeV3 = p;
  for (let o = 0; o < octaves; o++) {
    sum = sum.add(vnoise3(pos, int(seed + o * 131)).mul(amp));
    norm += amp;
    amp *= 0.5;
    pos = pos.mul(2.03).add(vec3(17.3, 9.1, 31.7));
  }
  return sum.mul(1 / norm);
}
