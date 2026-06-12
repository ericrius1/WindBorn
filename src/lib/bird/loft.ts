// The direct-mesh kit. Three honest tools build the whole bird:
//
//   · loftStations — elliptical cross-section rings strung along a spine
//     curve and stitched into a closed tube (body, beak, legs, toes);
//   · featherGeometry — a tapered two-layer vane with baked colors
//     (every flight feather, every tail feather);
//   · facetGeometry — un-weld the triangles so each face owns one normal
//     and one color: the low-poly look, chosen on purpose.
//
// No distance fields, no isosurfaces — every vertex is placed by a formula
// you can read. Geometry comes out indexed and smooth; run facetGeometry on
// it to commit to the faceted style.

import * as THREE from "three/webgpu";

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

// Deterministic per-face jitter (the painter's "feathers are not paint" trick).
export function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Catmull-Rom through a list of scalars, t in [0, 1] across the whole list.
export function catmull1(values: number[], t: number): number {
  const n = values.length;
  if (n === 1) return values[0];
  const f = clamp01(t) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  const u = f - i;
  const p0 = values[Math.max(0, i - 1)];
  const p1 = values[i];
  const p2 = values[i + 1];
  const p3 = values[Math.min(n - 1, i + 2)];
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u)
  );
}

// ---- lofted tubes -------------------------------------------------------------

export interface LoftStation {
  pos: [number, number, number]; // spine point
  rx: number; // ring half-width
  ry: number; // ring half-height
  yOff?: number; // ring center offset along the ring's up axis (keel, crown)
}

export interface LoftOptions {
  segments?: number; // vertices around each ring (default 16)
  rings?: number; // rings along the spine (default 4 × stations)
  capStart?: boolean; // close the first ring with a fan (default true)
  capEnd?: boolean; // close the last ring (default true)
  // Per-vertex paint: u along the loft (0 start → 1 end), theta around the
  // ring (0 = +x side, π/2 = top), world position. Write into `out`.
  paint?: (u: number, theta: number, pos: THREE.Vector3, out: THREE.Color) => void;
  // Per-ring skin influences: up to four [boneIndex, weight] pairs.
  weights?: (u: number) => [number, number][];
}

// Sample the station list into a smooth spine (Catmull-Rom on positions and
// radii alike) and stitch rings into an indexed tube with optional end caps,
// vertex colors, and skin attributes. Ring frames never twist: the ring's
// right axis is fixed world +x and its up axis follows the spine tangent —
// exactly right for a creature laid out along the z axis.
export function loftStations(stations: LoftStation[], opts: LoftOptions = {}): THREE.BufferGeometry {
  const segments = opts.segments ?? 16;
  const rings = opts.rings ?? stations.length * 4;
  const capStart = opts.capStart ?? true;
  const capEnd = opts.capEnd ?? true;

  const pts = stations.map((s) => new THREE.Vector3(...s.pos));
  const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
  const rxs = stations.map((s) => s.rx);
  const rys = stations.map((s) => s.ry);
  const yOffs = stations.map((s) => s.yOff ?? 0);

  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const indices: number[] = [];

  const center = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const xAxis = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color(1, 1, 1);

  const pushSkin = (u: number): void => {
    if (!opts.weights) return;
    const w = opts.weights(u);
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += w[k]?.[1] ?? 0;
    sum = sum || 1;
    for (let k = 0; k < 4; k++) {
      skinIndices.push(w[k]?.[0] ?? 0);
      skinWeights.push((w[k]?.[1] ?? 0) / sum);
    }
  };

  const pushVertex = (u: number, theta: number): void => {
    positions.push(p.x, p.y, p.z);
    uvs.push(u, theta / (Math.PI * 2));
    if (opts.paint) {
      col.setRGB(1, 1, 1);
      opts.paint(u, theta, p, col);
      colors.push(col.r, col.g, col.b);
    }
    pushSkin(u);
  };

  for (let r = 0; r < rings; r++) {
    const u = r / (rings - 1);
    curve.getPoint(u, center);
    curve.getTangent(u, tangent).normalize();
    // ring frame: right is world +x, up is tangent × right (no roll, ever)
    xAxis.set(1, 0, 0);
    yAxis.crossVectors(tangent, xAxis).normalize();
    if (yAxis.lengthSq() < 1e-8) yAxis.set(0, 1, 0);
    const rx = Math.max(1e-4, catmull1(rxs, u));
    const ry = Math.max(1e-4, catmull1(rys, u));
    const yOff = catmull1(yOffs, u);
    for (let s = 0; s < segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      p.copy(center)
        .addScaledVector(xAxis, Math.cos(theta) * rx)
        .addScaledVector(yAxis, Math.sin(theta) * ry + yOff);
      pushVertex(u, theta);
    }
  }

  // tube faces. Ring vertices run CCW seen from the far end of the spine
  // (right axis +x, up axis tangent×x), so (a, b, c)(b, d, c) faces outward.
  for (let r = 0; r < rings - 1; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * segments + s;
      const b = r * segments + ((s + 1) % segments);
      const c = (r + 1) * segments + s;
      const d = (r + 1) * segments + ((s + 1) % segments);
      indices.push(a, b, c, b, d, c);
    }
  }

  // caps: a fan to the spine endpoint
  if (capStart) {
    curve.getPoint(0, p);
    const ci = positions.length / 3;
    pushVertex(0, 0);
    for (let s = 0; s < segments; s++) indices.push(ci, (s + 1) % segments, s);
  }
  if (capEnd) {
    curve.getPoint(1, p);
    const ci = positions.length / 3;
    pushVertex(1, 0);
    const base = (rings - 1) * segments;
    for (let s = 0; s < segments; s++) indices.push(ci, base + s, base + ((s + 1) % segments));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  if (opts.paint) geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  if (opts.weights) {
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  }
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ---- feathers -----------------------------------------------------------------

export interface FeatherSpec {
  length: number; // quill base to tip, meters
  width: number; // widest vane width, meters
  top: THREE.ColorRepresentation; // upper surface
  bottom: THREE.ColorRepresentation; // under surface
  tipColor?: THREE.ColorRepresentation; // distal blend target (black wingtips)
  tipStart?: number; // 0..1 along length where the tip blend begins
  bars?: { count: number; strength: number }; // dark cross-bands (tail)
  curl?: number; // downward sag at the tip, meters
  rows?: number; // length divisions (default 6)
}

// One feather: a tapered vane extending along −z from the quill at the
// origin, vane width along x, upper surface facing +y. Two thin layers —
// the top painted dark, the underside pale — because a feather seen from
// below is a different color than the same feather seen from above.
export function featherGeometry(spec: FeatherSpec): THREE.BufferGeometry {
  const rows = spec.rows ?? 6;
  const cols = 3; // quill line + both vane edges
  const gap = 0.0012; // layer separation
  const topC = new THREE.Color(spec.top);
  const botC = new THREE.Color(spec.bottom);
  const tipC = new THREE.Color(spec.tipColor ?? spec.top);
  const tipStart = spec.tipStart ?? 0.72;
  const curl = spec.curl ?? spec.length * 0.1;

  // rounded vane: narrow at the quill, widest mid-feather, rounded tip
  const widthAt = (s: number): number => {
    const grow = Math.min(1, s / 0.25);
    const tip = s > 0.78 ? Math.sqrt(Math.max(0, 1 - ((s - 0.78) / 0.22) ** 2)) : 1;
    return spec.width * 0.5 * grow * tip;
  };

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const c = new THREE.Color();

  const paintAt = (s: number, base: THREE.Color): void => {
    c.copy(base);
    if (s > tipStart) c.lerp(tipC, clamp01((s - tipStart) / (1 - tipStart)));
    if (spec.bars) {
      const band = Math.sin(s * Math.PI * spec.bars.count);
      if (band > 0.45) c.multiplyScalar(1 - spec.bars.strength);
    }
    colors.push(c.r, c.g, c.b);
  };

  // two layers: 0 = top (+y, dark), 1 = bottom (−y, pale)
  for (let layer = 0; layer < 2; layer++) {
    const yBase = layer === 0 ? gap * 0.5 : -gap * 0.5;
    const base = layer === 0 ? topC : botC;
    for (let r = 0; r <= rows; r++) {
      const s = r / rows;
      const w = widthAt(s);
      const z = -s * spec.length;
      const y = yBase - curl * s * s;
      for (let cI = 0; cI < cols; cI++) {
        const x = (cI - 1) * w; // −w, 0, +w
        positions.push(x, y + (cI === 1 ? gap * 0.6 : 0), z); // quill ridge
        paintAt(s, base);
      }
    }
  }

  const rowStride = cols;
  const layerStride = (rows + 1) * cols;
  for (let layer = 0; layer < 2; layer++) {
    const off = layer * layerStride;
    for (let r = 0; r < rows; r++) {
      for (let cI = 0; cI < cols - 1; cI++) {
        const a = off + r * rowStride + cI;
        const b = a + 1;
        const d = a + rowStride;
        const e = d + 1;
        // top layer faces up (+y), bottom layer faces down
        if (layer === 0) indices.push(a, b, d, b, e, d);
        else indices.push(a, d, b, b, d, e);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ---- faceting -----------------------------------------------------------------

export interface FacetOptions {
  jitter?: number; // per-face brightness jitter, 0..~0.1
  // Optional repaint at the face centroid — sharper than averaging corners
  // when the pattern is high-frequency (speckles, bars).
  paintFace?: (centroid: THREE.Vector3, normal: THREE.Vector3, out: THREE.Color) => void;
}

// Un-weld an indexed mesh so every triangle owns one flat normal and one
// flat color. Copies skin attributes through, so faceted geometry still
// skins. Returns a new non-indexed geometry.
export function facetGeometry(src: THREE.BufferGeometry, opts: FacetOptions = {}): THREE.BufferGeometry {
  const index = src.getIndex();
  const pos = src.getAttribute("position");
  const col = src.getAttribute("color") as THREE.BufferAttribute | undefined;
  const skinI = src.getAttribute("skinIndex") as THREE.BufferAttribute | undefined;
  const skinW = src.getAttribute("skinWeight") as THREE.BufferAttribute | undefined;
  const nTris = index ? index.count / 3 : pos.count / 3;
  const jitter = opts.jitter ?? 0.06;

  const positions = new Float32Array(nTris * 9);
  const normals = new Float32Array(nTris * 9);
  const colors = new Float32Array(nTris * 9);
  const skinIndex = skinI ? new Uint16Array(nTris * 12) : null;
  const skinWeight = skinW ? new Float32Array(nTris * 12) : null;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const cv = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const fc = new THREE.Color();

  const vid = (t: number, k: number): number => (index ? index.getX(t * 3 + k) : t * 3 + k);

  for (let t = 0; t < nTris; t++) {
    const i0 = vid(t, 0), i1 = vid(t, 1), i2 = vid(t, 2);
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    cv.fromBufferAttribute(pos, i2);
    ab.subVectors(b, a);
    ac.subVectors(cv, a);
    n.crossVectors(ab, ac).normalize();
    centroid.copy(a).add(b).add(cv).multiplyScalar(1 / 3);

    if (opts.paintFace) {
      fc.setRGB(1, 1, 1);
      opts.paintFace(centroid, n, fc);
    } else if (col) {
      fc.setRGB(
        (col.getX(i0) + col.getX(i1) + col.getX(i2)) / 3,
        (col.getY(i0) + col.getY(i1) + col.getY(i2)) / 3,
        (col.getZ(i0) + col.getZ(i1) + col.getZ(i2)) / 3,
      );
    } else {
      fc.setRGB(1, 1, 1);
    }
    if (jitter > 0) fc.multiplyScalar(1 - jitter / 2 + jitter * hash1(t * 1.618 + centroid.x * 31 + centroid.y * 57 + centroid.z * 17));

    const src3 = [i0, i1, i2];
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      const si = src3[k];
      positions[o] = pos.getX(si);
      positions[o + 1] = pos.getY(si);
      positions[o + 2] = pos.getZ(si);
      normals[o] = n.x;
      normals[o + 1] = n.y;
      normals[o + 2] = n.z;
      colors[o] = fc.r;
      colors[o + 1] = fc.g;
      colors[o + 2] = fc.b;
      if (skinIndex && skinI) {
        const so = t * 12 + k * 4;
        skinIndex[so] = skinI.getX(si);
        skinIndex[so + 1] = skinI.getY(si);
        skinIndex[so + 2] = skinI.getZ(si);
        skinIndex[so + 3] = skinI.getW(si);
      }
      if (skinWeight && skinW) {
        const so = t * 12 + k * 4;
        skinWeight[so] = skinW.getX(si);
        skinWeight[so + 1] = skinW.getY(si);
        skinWeight[so + 2] = skinW.getZ(si);
        skinWeight[so + 3] = skinW.getW(si);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  if (skinIndex) geo.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
  if (skinWeight) geo.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
  return geo;
}

// Mirror a (non-indexed or indexed) geometry across the x = 0 plane and fix
// the winding. `boneRemap` rewrites skinIndex entries (left bone → right).
export function mirrorGeometryX(
  src: THREE.BufferGeometry,
  boneRemap?: Map<number, number>,
): THREE.BufferGeometry {
  const geo = src.toNonIndexed ? (src.getIndex() ? src.toNonIndexed() : src.clone()) : src.clone();
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const nor = geo.getAttribute("normal") as THREE.BufferAttribute | undefined;
  const skinI = geo.getAttribute("skinIndex") as THREE.BufferAttribute | undefined;

  for (let i = 0; i < pos.count; i++) pos.setX(i, -pos.getX(i));
  if (nor) for (let i = 0; i < nor.count; i++) nor.setX(i, -nor.getX(i));
  if (skinI && boneRemap) {
    for (let i = 0; i < skinI.count; i++) {
      skinI.setXYZW(
        i,
        boneRemap.get(skinI.getX(i)) ?? skinI.getX(i),
        boneRemap.get(skinI.getY(i)) ?? skinI.getY(i),
        boneRemap.get(skinI.getZ(i)) ?? skinI.getZ(i),
        boneRemap.get(skinI.getW(i)) ?? skinI.getW(i),
      );
    }
  }

  // flip winding: swap corners 1 and 2 of every triangle, every attribute
  for (const name of Object.keys(geo.attributes)) {
    const attr = geo.getAttribute(name) as THREE.BufferAttribute;
    const item = attr.itemSize;
    const arr = attr.array as Float32Array | Uint16Array;
    for (let t = 0; t < attr.count / 3; t++) {
      for (let k = 0; k < item; k++) {
        const i1 = (t * 3 + 1) * item + k;
        const i2 = (t * 3 + 2) * item + k;
        const tmp = arr[i1];
        arr[i1] = arr[i2];
        arr[i2] = tmp;
      }
    }
    attr.needsUpdate = true;
  }
  return geo;
}
