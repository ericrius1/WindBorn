// Tree geometry, built directly: a conifer is a tapered trunk and three
// stacked open cones; a snag (standing dead tree) is a bare tapered spar
// with a few stub branches. One of each geometry serves the whole forest —
// the hundred-thousand copies differ only by instance transform and a
// per-instance tint, which is the entire point of the Forest post.
//
// All trees are unit-height (base at y = 0, tip near y = 1) so an instance
// scale IS the tree height in meters. Conifers are rotationally symmetric,
// so instances skip yaw entirely; snags carry a yaw because their branches
// (the perch points) have a facing.

import {
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

function paint(geo: BufferGeometry, hex: number): BufferGeometry {
  geo.deleteAttribute("uv");
  const n = geo.getAttribute("position").count;
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  return geo;
}

const lerpChannel = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);
function lerpHex(a: number, b: number, t: number): number {
  return (
    (lerpChannel((a >> 16) & 255, (b >> 16) & 255, t) << 16) |
    (lerpChannel((a >> 8) & 255, (b >> 8) & 255, t) << 8) |
    lerpChannel(a & 255, b & 255, t)
  );
}

/**
 * ~52 triangles of archetypal conifer (at the default 3 tiers): a short
 * tapered trunk and `tiers` stacked open cones, darker at the bottom.
 * Vertex-colored; instance scale = tree height in meters.
 */
export function makeConiferGeometry(tiers = 3): BufferGeometry {
  const n = Math.max(1, Math.round(tiers));
  const parts: BufferGeometry[] = [];

  const trunk = new CylinderGeometry(0.018, 0.034, 0.4, 5, 1, true);
  trunk.translate(0, 0.2, 0);
  parts.push(paint(trunk, 0x4a3a28));

  const tierHeight = (0.82 / n) * Math.min(1.65, n * 0.95);
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : i / (n - 1);
    const radius = 0.36 - 0.2 * f;
    const base = 0.18 + 0.62 * (i / n);
    const cone = new ConeGeometry(radius, tierHeight, 7, 1, true);
    cone.translate(0, base + tierHeight / 2, 0);
    parts.push(paint(cone, lerpHex(0x2e4a26, 0x3a5c30, f)));
  }

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

// Branch stubs for the snag: [attach height, yaw, pitch up, length].
const SNAG_BRANCHES: Array<[number, number, number, number]> = [
  [0.52, 0.4, 0.32, 0.3],
  [0.66, 2.6, 0.42, 0.24],
  [0.8, 4.4, 0.3, 0.2],
];

const UP = new Vector3(0, 1, 0);

/**
 * A standing dead tree. Returns the geometry plus the perch offsets in
 * unit-snag space (scale by the instance scale, rotate by its yaw): the
 * spar top and each branch tip — exactly where an osprey would land.
 */
export function makeSnagGeometry(): { geometry: BufferGeometry; perchOffsets: Vector3[] } {
  const parts: BufferGeometry[] = [];
  const perchOffsets: Vector3[] = [];

  const spar = new CylinderGeometry(0.012, 0.05, 1.0, 5, 1, true);
  spar.translate(0, 0.5, 0);
  parts.push(paint(spar, 0x8d8474));
  perchOffsets.push(new Vector3(0, 1.0, 0));

  const q = new Quaternion();
  for (const [attach, yaw, pitch, len] of SNAG_BRANCHES) {
    const dir = new Vector3(
      Math.cos(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.sin(yaw) * Math.cos(pitch),
    );
    const branch = new CylinderGeometry(0.006, 0.012, len, 4, 1, true);
    branch.applyQuaternion(q.setFromUnitVectors(UP, dir));
    const mid = dir.clone().multiplyScalar(len / 2).add(new Vector3(0, attach, 0));
    branch.translate(mid.x, mid.y, mid.z);
    parts.push(paint(branch, 0x847b6c));
    perchOffsets.push(dir.clone().multiplyScalar(len).add(new Vector3(0, attach, 0)));
  }

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return { geometry: merged, perchOffsets };
}

/** A low boulder: a squashed icosahedron. Instance scale = radius. */
export function makeBoulderGeometry(): BufferGeometry {
  const rock = new IcosahedronGeometry(1, 0);
  rock.scale(1, 0.62, 0.85);
  rock.translate(0, 0.3, 0); // partly buried
  return paint(rock, 0x77756d);
}

/** A grass tuft: two crossed quads. Cheap enough for tens of thousands. */
export function makeTuftGeometry(): BufferGeometry {
  const a = new PlaneGeometry(0.5, 0.4);
  a.translate(0, 0.2, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  const merged = mergeGeometries([paint(a, 0x6d8442), paint(b, 0x5d7a3a)]);
  a.dispose();
  b.dispose();
  return merged;
}
