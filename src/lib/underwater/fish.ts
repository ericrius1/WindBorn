// A minimal fish for the grab moment — directly meshed, per the house rule:
// elliptical cross-section rings lofted along the body axis, a forked tail
// plane, a dorsal triangle. Countershaded the way real fish are: dark back
// (invisible from above against the deep), pale belly (invisible from below
// against Snell's window) — which is exactly why the osprey hunts the angled
// view, where the flank flashes.
//
// The swim wiggle is a vertex-shader sine that grows toward the tail, so the
// CPU never touches the geometry.
//
// TODO(under): swap in src/lib/life's real schooling fish once Alive ships.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import { clamp, positionLocal, sin, uniform, vec3 } from "three/tsl";

interface FishStation {
  z: number; // fraction of length, −0.5 tail … +0.5 snout
  rx: number; // half-width fraction
  ry: number; // half-height fraction
  yOff?: number;
}

const STATIONS: FishStation[] = [
  { z: -0.5, rx: 0.012, ry: 0.03 }, // caudal peduncle
  { z: -0.34, rx: 0.035, ry: 0.065 },
  { z: -0.14, rx: 0.052, ry: 0.085 },
  { z: 0.06, rx: 0.058, ry: 0.09 }, // max girth, forward of middle
  { z: 0.24, rx: 0.048, ry: 0.075 },
  { z: 0.38, rx: 0.032, ry: 0.05 }, // head
  { z: 0.5, rx: 0.008, ry: 0.014 }, // snout
];

const RING = 10;

export interface Fish {
  group: Group;
  /** Drive this every frame so the tail keeps beating. */
  time: { value: number };
  /** Wiggle amplitude multiplier: 1 cruising, 0 limp (carried). */
  swim: { value: number };
  length: number;
  dispose(): void;
}

export function buildFish(length = 0.34): Fish {
  const back = new Color(0x27402c);
  const belly = new Color(0xb9c8bd);
  const fin = new Color(0x3d5343);

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // ---- the body loft -------------------------------------------------------
  for (const s of STATIONS) {
    for (let i = 0; i < RING; i++) {
      const a = (i / RING) * Math.PI * 2;
      const sy = Math.sin(a);
      positions.push(Math.cos(a) * s.rx * length, sy * s.ry * length + (s.yOff ?? 0), s.z * length);
      // countershading by height within the ring
      const t = Math.pow(Math.max(0, sy * 0.5 + 0.5), 1.4);
      const c = belly.clone().lerp(back, t);
      colors.push(c.r, c.g, c.b);
    }
  }
  for (let s = 0; s < STATIONS.length - 1; s++) {
    for (let i = 0; i < RING; i++) {
      const j = (i + 1) % RING;
      const a = s * RING + i;
      const b = s * RING + j;
      const c = (s + 1) * RING + i;
      const d = (s + 1) * RING + j;
      indices.push(a, c, b, b, c, d);
    }
  }

  // ---- fins: flat planes, fish-colored (DoubleSide material shows both) ----
  const pushFin = (pts: [number, number, number][]): void => {
    const base = positions.length / 3;
    for (const [x, y, z] of pts) {
      positions.push(x, y, z);
      colors.push(fin.r, fin.g, fin.b);
    }
    for (let i = 1; i + 1 < pts.length; i++) {
      indices.push(base, base + i, base + i + 1);
    }
  };
  const L = length;
  // forked caudal fin in the vertical plane
  pushFin([
    [0, 0, -0.5 * L],
    [0, 0.16 * L, -0.68 * L],
    [0, 0.05 * L, -0.6 * L],
    [0, -0.05 * L, -0.6 * L],
    [0, -0.16 * L, -0.68 * L],
  ]);
  // dorsal fin
  pushFin([
    [0, 0.08 * L, 0.05 * L],
    [0, 0.16 * L, -0.04 * L],
    [0, 0.07 * L, -0.12 * L],
  ]);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 });
  material.side = DoubleSide; // the fins are single quads
  const time = uniform(0);
  const swim = uniform(1);
  // The tail-beat: lateral sine traveling head→tail, amplitude enveloped so
  // the head barely moves and the tail writes the whole wave.
  const zNorm = positionLocal.z.div(length); // −0.7 … 0.5 incl. tail fin
  const envelope = clamp(zNorm.negate().add(0.3), 0, 1.1);
  const sway = sin(zNorm.mul(7).sub(time.mul(9))).mul(envelope).mul(swim).mul(0.06 * length);
  material.positionNode = positionLocal.add(vec3(sway, 0, 0));

  const mesh = new Mesh(geometry, material);
  const group = new Group();
  group.add(mesh);

  return {
    group,
    time,
    swim,
    length,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export interface CruiseOptions {
  centerX?: number;
  centerZ?: number;
  radiusX?: number;
  radiusZ?: number;
  depth?: number;
  /** Seconds per lap. */
  period?: number;
  phase?: number;
}

/** Drives a fish around a slow ellipse at depth — enough behavior to be
 *  worth diving at. The dive cycle reads `x/z/depth` to aim the strike. */
export class FishCruiser {
  caught = false;

  private cx: number;
  private cz: number;
  private rx: number;
  private rz: number;
  private omega: number;
  private theta: number;
  depth: number;

  constructor(readonly fish: Fish, opts: CruiseOptions = {}) {
    this.cx = opts.centerX ?? 0;
    this.cz = opts.centerZ ?? 0;
    this.rx = opts.radiusX ?? 1.6;
    this.rz = opts.radiusZ ?? 1.0;
    this.depth = opts.depth ?? 0.9;
    this.omega = (Math.PI * 2) / (opts.period ?? 16);
    this.theta = opts.phase ?? 0;
  }

  get x(): number {
    return this.cx + Math.cos(this.theta) * this.rx;
  }
  get z(): number {
    return this.cz + Math.sin(this.theta) * this.rz;
  }

  update(dt: number, t: number): void {
    this.fish.time.value = t;
    if (this.caught) return;
    this.theta += this.omega * dt;
    const g = this.fish.group;
    g.position.set(this.x, -this.depth + Math.sin(t * 0.7) * 0.06, this.z);
    // face along the velocity of the ellipse
    const dx = -Math.sin(this.theta) * this.rx;
    const dz = Math.cos(this.theta) * this.rz;
    g.rotation.y = Math.atan2(dx, dz);
    g.rotation.z = Math.sin(this.theta * 2) * 0.06; // lean into the turn
  }
}
