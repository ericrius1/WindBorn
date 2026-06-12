// From function to geometry: run surface nets over the osprey field, then
// commit to a look. The default style is deliberately low-poly — every
// triangle gets one normal and one color, so the facets show and the
// silhouette does the talking. The painter knows real field marks: white
// below, dark chocolate above, a dark stripe through a yellow eye, barred
// tail, black wingtips, the speckled necklace.

import * as THREE from "three/webgpu";
import { OSPREY_BONES, ZONE, boneDistance, bone, EYE_L } from "./skeleton";
import { ospreyField, ospreyGradient, FIELD_BOUNDS, type FieldOptions } from "./field";
import { surfaceNets } from "./nets";
import { computeSkinWeights, WEIGHT_POWER_DEFAULT } from "./rig";

export interface BuildOptions extends FieldOptions {
  res?: number; // sampling resolution along the longest axis
  style?: "faceted" | "smooth";
  skin?: boolean; // bake skinIndex/skinWeight attributes for the rig
  weightPower?: number; // skin-weight falloff sharpness
}

export interface OspreyMesh {
  geometry: THREE.BufferGeometry;
  vertexCount: number;
  triangleCount: number;
  cells: number;
  buildMs: number;
}

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
  talon: 0x16130f, // black talons (riders)
  iris: 0xf0c12e, // that yellow eye
} as const;

// Zone fallback palette, indexed by ZONE — the assembly demo colors raw
// capsules with this before the painter exists.
export const ZONE_COLORS = [
  PLUMAGE.white, // body (painter splits white/brown)
  PLUMAGE.white, // head
  PLUMAGE.brown, // wing
  PLUMAGE.tail, // tail
  PLUMAGE.beak, // beak
  PLUMAGE.leg, // leg
  PLUMAGE.talon, // talon
];

const hash1 = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth01 = (v: number): number => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

// ---- the painter -------------------------------------------------------------
// color(point, normal): zone from the nearest capsule, then the field marks.

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
  const c = (hex: number): THREE.Color => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
  return {
    white: c(PLUMAGE.white),
    brown: c(PLUMAGE.brown),
    brownDeep: c(PLUMAGE.brownDeep),
    stripe: c(PLUMAGE.stripe),
    underwing: c(PLUMAGE.underwing),
    tail: c(PLUMAGE.tail),
    beak: c(PLUMAGE.beak),
    cere: c(PLUMAGE.cere),
    leg: c(PLUMAGE.leg),
  };
}

// rest-pose wrist position, for the dark carpal patch on the underwing
const WRIST: [number, number, number] = bone("handL").head as [number, number, number];

function paint(
  x: number,
  y: number,
  z: number,
  ny: number,
  key: number,
  out: THREE.Color,
  pal: Palette,
): void {
  // zone = nearest capsule's zone
  let best = 1e9;
  let zone: number = ZONE.body;
  for (const b of OSPREY_BONES) {
    const d = boneDistance(b, x, y, z);
    if (d < best) {
      best = d;
      zone = b.zone;
    }
  }
  const ax = Math.abs(x);

  if (zone === ZONE.body) {
    // dark mantle above, white below: split on height against the spine
    // line, softened by which way the skin faces
    const yMid = 0.305 + 0.12 * z;
    const dorsal = smooth01(((y - yMid) + 0.05 * ny + 0.012) / 0.045);
    out.copy(pal.white).lerp(pal.brown, dorsal);
    // the necklace: a speckled brown band across the upper chest
    if (dorsal < 0.5 && z > 0.075 && z < 0.155 && y > 0.265 && y < 0.33) {
      if (hash1(key * 1.71 + 3.3) < 0.4) out.lerp(pal.brown, 0.55);
    }
    // faint feather rows on the brown back
    if (dorsal > 0.5) {
      const row = Math.sin(z * (Math.PI * 2 / 0.04) + ax * 9);
      out.multiplyScalar(1 - 0.07 * Math.max(0, row) * dorsal);
    }
  } else if (zone === ZONE.head) {
    out.copy(pal.white);
    // the eye-stripe: beak gape, through the eye, down the nape — a band
    // around a segment in the (z, y) plane, on the sides of the head only
    const z0 = 0.255, y0 = 0.4525, z1 = 0.125, y1 = 0.408;
    const t = clamp01(((z - z0) * (z1 - z0) + (y - y0) * (y1 - y0)) / ((z1 - z0) ** 2 + (y1 - y0) ** 2));
    const dz = z - (z0 + (z1 - z0) * t), dy = y - (y0 + (y1 - y0) * t);
    const dStripe = Math.hypot(dz, dy);
    const side = smooth01((ax - 0.012) / 0.012);
    const stripe = smooth01((0.015 - dStripe) / 0.007) * side;
    out.lerp(pal.stripe, stripe);
    // nape streaks where the stripe dives toward the mantle
    if (z < 0.13 && y < 0.42) out.lerp(pal.brown, smooth01((0.13 - z) / 0.05) * 0.8);
  } else if (zone === ZONE.wing) {
    // upperwing dark; underwing pale and barred with a dark carpal patch
    const under = smooth01((-ny - 0.25) / 0.4);
    out.copy(pal.brown).lerp(pal.underwing, under);
    if (under > 0.3) {
      const bar = Math.sin(z * (Math.PI * 2 / 0.05) + ax * 4);
      out.multiplyScalar(1 - 0.16 * Math.max(0, bar) * under);
      const dWrist = Math.hypot(ax - WRIST[0], y - WRIST[1], z - WRIST[2]);
      out.lerp(pal.brownDeep, under * smooth01((0.05 - dWrist) / 0.03) * 0.85);
    }
    // outer hand-wing darkens to near-black primary tips
    const hand = bone("handL");
    const hz = clamp01((hand.head[2] - z) / (hand.head[2] - hand.tail[2]));
    if (ax > 0.03) out.lerp(pal.brownDeep, smooth01((hz - 0.55) / 0.45) * 0.8);
  } else if (zone === ZONE.tail) {
    const under = smooth01((-ny - 0.2) / 0.4);
    out.copy(pal.tail).lerp(pal.underwing, under * 0.7);
    const band = Math.sin((z + 0.2) * (Math.PI * 2 / 0.046));
    out.multiplyScalar(1 - 0.22 * Math.max(0, band));
    if (z < -0.405) out.lerp(pal.brownDeep, 0.55); // dark subterminal band
  } else if (zone === ZONE.beak) {
    out.copy(pal.beak);
    if (z < 0.264) out.lerp(pal.cere, smooth01((0.264 - z) / 0.012) * 0.85);
  } else {
    // legs, feet, toes — pale gray-blue
    out.copy(pal.leg);
  }

  out.multiplyScalar(0.93 + 0.14 * hash1(key));
}

// ---- the mesh ------------------------------------------------------------------

export function buildOsprey(opts: BuildOptions = {}): OspreyMesh {
  const t0 = performance.now();
  const res = opts.res ?? 72;
  const style = opts.style ?? "faceted";
  const fieldOpts: FieldOptions = {
    radiusScale: opts.radiusScale,
    blendScale: opts.blendScale,
    count: opts.count,
  };

  const net = surfaceNets(
    (x, y, z) => ospreyField(x, y, z, fieldOpts),
    FIELD_BOUNDS.min,
    FIELD_BOUNDS.max,
    res,
  );

  const pal = makePalette();
  const c = new THREE.Color();
  const geometry = new THREE.BufferGeometry();

  if (style === "smooth") {
    // indexed mesh, one vertex per cell, normals straight from the field
    const nVerts = net.positions.length / 3;
    const normals = new Float32Array(nVerts * 3);
    const colors = new Float32Array(nVerts * 3);
    for (let v = 0; v < nVerts; v++) {
      const x = net.positions[v * 3], y = net.positions[v * 3 + 1], z = net.positions[v * 3 + 2];
      const [gx, gy, gz] = ospreyGradient(x, y, z, fieldOpts);
      normals[v * 3] = gx;
      normals[v * 3 + 1] = gy;
      normals[v * 3 + 2] = gz;
      paint(x, y, z, gy, v, c, pal);
      colors[v * 3] = c.r;
      colors[v * 3 + 1] = c.g;
      colors[v * 3 + 2] = c.b;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(net.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(net.indices, 1));
  } else {
    // faceted: un-share the vertices so each triangle owns its normal and
    // color. The face normal comes from the cross product, sign-checked
    // against the field gradient (the gradient always knows which way is out).
    const nTris = net.indices.length / 3;
    const positions = new Float32Array(nTris * 9);
    const normals = new Float32Array(nTris * 9);
    const colors = new Float32Array(nTris * 9);
    for (let t = 0; t < nTris; t++) {
      const i0 = net.indices[t * 3], i1 = net.indices[t * 3 + 1], i2 = net.indices[t * 3 + 2];
      const ax = net.positions[i0 * 3], ay = net.positions[i0 * 3 + 1], az = net.positions[i0 * 3 + 2];
      const bx = net.positions[i1 * 3], by = net.positions[i1 * 3 + 1], bz = net.positions[i1 * 3 + 2];
      const cx = net.positions[i2 * 3], cy = net.positions[i2 * 3 + 1], cz = net.positions[i2 * 3 + 2];

      let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      let nyf = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const len = Math.hypot(nx, nyf, nz) || 1;
      nx /= len; nyf /= len; nz /= len;

      const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, mz = (az + bz + cz) / 3;
      const [gx, gy, gz] = ospreyGradient(mx, my, mz, fieldOpts);
      if (nx * gx + nyf * gy + nz * gz < 0) {
        nx = -nx; nyf = -nyf; nz = -nz;
      }

      paint(mx, my, mz, nyf, t, c, pal);

      for (let k = 0; k < 3; k++) {
        const src = [i0, i1, i2][k];
        positions[t * 9 + k * 3] = net.positions[src * 3];
        positions[t * 9 + k * 3 + 1] = net.positions[src * 3 + 1];
        positions[t * 9 + k * 3 + 2] = net.positions[src * 3 + 2];
        normals[t * 9 + k * 3] = nx;
        normals[t * 9 + k * 3 + 1] = nyf;
        normals[t * 9 + k * 3 + 2] = nz;
        colors[t * 9 + k * 3] = c.r;
        colors[t * 9 + k * 3 + 1] = c.g;
        colors[t * 9 + k * 3 + 2] = c.b;
      }
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }

  if (opts.skin) {
    const pos = geometry.getAttribute("position").array as Float32Array;
    const { skinIndex, skinWeight } = computeSkinWeights(pos, opts.weightPower ?? WEIGHT_POWER_DEFAULT);
    geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
    geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
  }

  return {
    geometry,
    vertexCount: geometry.getAttribute("position").count,
    triangleCount: net.indices.length / 3,
    cells: net.cells,
    buildMs: performance.now() - t0,
  };
}

// ---- riders: eyes and talons --------------------------------------------------
// Neither is in the field. Growing a nine-millimeter glossy eyeball — or a
// four-millimeter claw — out of a distance field would need a lattice fine
// enough to waste; they are meshes parented to where their bones will be.
// `pivot` re-bases rest-pose world positions into a parent's local frame so
// the rig can hang them off a joint.

export function addEyes(parent: THREE.Object3D, pivot: [number, number, number] = [0, 0, 0]): void {
  const irisMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHex(PLUMAGE.iris, THREE.SRGBColorSpace),
    roughness: 0.25,
    flatShading: true,
  });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x0b0908, roughness: 0.15 });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): void => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x - pivot[0], y - pivot[1], z - pivot[2]);
    parent.add(m);
  };
  const iris = new THREE.IcosahedronGeometry(0.0095, 1);
  const pupil = new THREE.SphereGeometry(0.0048, 10, 8);
  const glint = new THREE.SphereGeometry(0.0021, 8, 6);
  const [ex, ey, ez] = EYE_L;
  for (const sx of [1, -1]) {
    add(iris, irisMat, sx * ex, ey, ez);
    add(pupil, pupilMat, sx * (ex + 0.003), ey, ez + 0.005);
    add(glint, glintMat, sx * (ex + 0.0045), ey + 0.0028, ez + 0.0062);
  }
}

// One curved black claw per toe, planted at the toe capsule's far end and
// curling down. Returns the group per side so the rig can attach it to the
// foot joint.
export function makeTalons(side: "L" | "R"): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHex(PLUMAGE.talon, THREE.SRGBColorSpace),
    roughness: 0.35,
    flatShading: true,
  });
  const up = new THREE.Vector3(0, 1, 0);
  for (const toeName of ["toeIn", "toeMid", "toeOut", "toeBack"]) {
    const t = bone(toeName + side);
    const head = new THREE.Vector3(...t.tail);
    // claw direction: onward along the toe, pitched down into the ground
    const dir = new THREE.Vector3(t.tail[0] - t.head[0], 0, t.tail[2] - t.head[2])
      .normalize()
      .multiplyScalar(0.55);
    dir.y = -0.85;
    dir.normalize();
    const len = 0.02;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.0036, len, 7), mat);
    // ConeGeometry's apex points +y; aim the apex along dir, base sunk
    // into the toe tip
    cone.quaternion.setFromUnitVectors(up, dir);
    cone.position.copy(head).addScaledVector(dir, len * 0.32);
    group.add(cone);
  }
  return group;
}
