// The fish, built directly: a loft of elliptical rings along a straight
// spine (the same kit that lofted the osprey), plus fin planes — tail,
// dorsal, pectorals — merged and faceted. Unit length 1 m, nose at +z,
// so an instance's scale IS the fish's length in meters.
//
// The swim is a material, not an animation: a traveling lateral wave bends
// the body in the vertex stage, amplitude growing toward the tail, with a
// per-instance phase from the instance index — three hundred fish swim out
// of step for free.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PlaneGeometry,
} from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { float, hash, instanceIndex, mix, positionLocal, sin, smoothstep, time, uniform, vec3, vertexColor } from "three/tsl";
import { facetGeometry, loftStations, type LoftStation } from "../bird/loft";
import type { Fish } from "./school";

// -- palette: a lake trout seen in lake light ---------------------------------
const BACK = 0x35442c; // olive back
const FLANK = 0x9fb3a8; // silver flank
const BELLY = 0xe5e3d2; // cream belly
const FIN = 0x55604a;

function paintFlat(geo: BufferGeometry, hex: number): BufferGeometry {
  geo.deleteAttribute("uv");
  const n = geo.getAttribute("position").count;
  const c = new Color(hex);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  return geo;
}

const FISH_STATIONS: LoftStation[] = [
  { pos: [0, 0.0, -0.5], rx: 0.008, ry: 0.02 }, // peduncle
  { pos: [0, 0.004, -0.32], rx: 0.028, ry: 0.06 },
  { pos: [0, 0.008, -0.1], rx: 0.05, ry: 0.094 }, // mid body
  { pos: [0, 0.008, 0.12], rx: 0.053, ry: 0.09 }, // shoulder
  { pos: [0, 0.004, 0.3], rx: 0.04, ry: 0.066 }, // gill
  { pos: [0, 0.0, 0.42], rx: 0.02, ry: 0.036 }, // snout
  { pos: [0, -0.004, 0.5], rx: 0.005, ry: 0.01 }, // nose
];

const _back = new Color(BACK);
const _flank = new Color(FLANK);
const _belly = new Color(BELLY);

/** Unit-length faceted trout: body loft + tail fan + dorsal + pectorals. */
export function makeFishGeometry(): BufferGeometry {
  const body = loftStations(FISH_STATIONS, {
    segments: 10,
    rings: 18,
    paint: (u, theta, _pos, out) => {
      // up = +1 on the back, −1 on the belly; countershading in two blends
      const up = Math.sin(theta);
      if (up > 0) out.copy(_flank).lerp(_back, Math.min(1, up * 1.6));
      else out.copy(_flank).lerp(_belly, Math.min(1, -up * 1.4));
      // darker head cap
      if (u > 0.82) out.lerp(_back, (u - 0.82) * 2.2 * Math.max(0, up + 0.4));
    },
  });
  body.deleteAttribute("uv");

  const parts: BufferGeometry[] = [facetGeometry(body, { jitter: 0.07 })];
  body.dispose();

  // tail fan: a vertical plane aft of the peduncle, forked by its shape
  const tail = new BufferGeometry();
  // two triangles sharing the peduncle root, lobes up and down
  // x = 0 plane; z negative is aft
  const tv = new Float32Array([
    // upper lobe
    0, 0, -0.5, 0, 0.09, -0.64, 0, 0.01, -0.56,
    // lower lobe
    0, 0, -0.5, 0, -0.01, -0.56, 0, -0.085, -0.63,
    // web between lobes
    0, 0, -0.5, 0, 0.01, -0.56, 0, -0.01, -0.56,
  ]);
  tail.setAttribute("position", new BufferAttribute(tv, 3));
  paintFlat(tail, FIN);
  parts.push(facetGeometry(tail, { jitter: 0.05 }));
  tail.dispose();

  // dorsal fin: a small triangle on the back
  const dorsal = new BufferGeometry();
  dorsal.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([0, 0.09, 0.05, 0, 0.155, -0.06, 0, 0.085, -0.12]), 3),
  );
  paintFlat(dorsal, FIN);
  parts.push(facetGeometry(dorsal, { jitter: 0.05 }));
  dorsal.dispose();

  // pectoral fins: two small angled quads behind the gills
  for (const side of [1, -1]) {
    const pec = new PlaneGeometry(0.1, 0.045);
    pec.rotateY(Math.PI / 2 + side * 0.5);
    pec.rotateZ(side * 0.45);
    pec.translate(side * 0.045, -0.03, 0.22);
    paintFlat(pec, FIN);
    parts.push(facetGeometry(pec, { jitter: 0.05 }));
    pec.dispose();
  }

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

export interface FishMaterialKit {
  material: MeshStandardNodeMaterial;
  /** Tail-beat frequency, Hz (uniform — scale with cruise speed if you like). */
  setFrequency(hz: number): void;
}

/**
 * Vertex-colored fish material with the swim wave baked into the vertex
 * stage: x-offset = sin(ωt + φ(instance) − k·z) · A · envelope(z), where the
 * envelope is ~0 at the nose and 1 at the tail. DoubleSide so the fin planes
 * read from both flanks.
 */
export function makeFishMaterial(): FishMaterialKit {
  const uFreq = uniform(2.4);
  const uAmp = uniform(0.045);

  const material = new MeshStandardNodeMaterial();
  material.side = DoubleSide;

  const ph = hash(float(instanceIndex).add(91.7)).mul(Math.PI * 2);
  const z = positionLocal.z;
  // traveling wave, head to tail; k chosen so about one wavelength fits the body
  const wave = sin(time.mul(uFreq).mul(Math.PI * 2).add(ph).sub(z.mul(5.0)));
  const envelope = mix(float(0.12), float(1.0), smoothstep(-0.5, 0.35, z).oneMinus());
  material.positionNode = positionLocal.add(vec3(wave.mul(uAmp).mul(envelope), 0, 0));

  const bright = hash(float(instanceIndex).add(7.3)).mul(0.25).add(0.85);
  material.colorNode = vertexColor().mul(bright);
  material.roughnessNode = float(0.55);
  material.metalnessNode = float(0.0);

  return {
    material,
    setFrequency: (hz: number) => {
      uFreq.value = hz;
    },
  };
}

// -- instance bookkeeping ---------------------------------------------------------

const _m = new Matrix4();

/**
 * Write the school into an InstancedMesh: position from the sim, yaw from
 * the velocity, pitch from the climb rate, scale = body length.
 */
export function fillFishInstances(mesh: InstancedMesh, fish: readonly Fish[]): void {
  const count = Math.min(fish.length, mesh.instanceMatrix.count);
  for (let i = 0; i < count; i++) {
    const f = fish[i];
    const v = f.velocity;
    const hs = Math.max(1e-5, Math.hypot(v.x, v.z));
    const yaw = Math.atan2(v.x, v.z); // nose +z: rotate +z toward velocity
    const pitch = Math.atan2(v.y, hs);
    const s = f.size;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    // R = Ry(yaw) · Rx(-pitch), columns scaled by s — nose up when climbing
    _m.set(
      cy * s, -sy * sp * s, sy * cp * s, f.position.x,
      0, cp * s, sp * s, f.position.y,
      -sy * s, -cy * sp * s, cy * cp * s, f.position.z,
      0, 0, 0, 1,
    );
    mesh.setMatrixAt(i, _m);
  }
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
}

// -- glints --------------------------------------------------------------------------
// The hunt's first telegraph: a fish cruising shallow catches the low sun on
// its flank and throws a streak of light off the surface. Rendered as a pool
// of additive quads lying ON the water at y ≈ 0, stretched along the fish's
// heading; brightness and length come from how shallow the fish is and a
// slow per-fish flash cycle (the body rolling through the reflection angle).

export class GlintField {
  readonly mesh: InstancedMesh;
  /** Global glint strength (sun height / roughness knob for demos). */
  intensity = 1;

  private readonly geometry: PlaneGeometry;
  private readonly material: MeshBasicNodeMaterial;
  private readonly max: number;

  constructor(max = 300) {
    this.max = max;
    this.geometry = new PlaneGeometry(1, 0.24);
    this.geometry.rotateX(-Math.PI / 2); // lie flat on the surface
    this.material = new MeshBasicNodeMaterial();
    this.material.transparent = true;
    this.material.blending = AdditiveBlending;
    this.material.depthWrite = false;
    // hot core fading along the streak
    const a = positionLocal.x.abs().mul(2).oneMinus().max(0);
    this.material.colorNode = vec3(1.0, 0.9, 0.7).mul(a.mul(a));
    this.mesh = new InstancedMesh(this.geometry, this.material, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  /**
   * One call per frame: scan the school, place a streak over every fish
   * shallower than `glintDepth`, sized by shallowness × flash phase.
   */
  update(fish: readonly Fish[], t: number, glintDepth = -0.9): void {
    let w = 0;
    for (let i = 0; i < fish.length && w < this.max; i++) {
      const f = fish[i];
      if (f.position.y < glintDepth) continue;
      const shallow = 1 - f.position.y / glintDepth; // 0 at the limit, 1 at surface
      const flash = Math.max(0, Math.sin(t * (1.1 + f.seed * 1.7) + f.seed * 31)) ** 4;
      const s = shallow * (0.25 + 0.75 * flash) * this.intensity;
      if (s < 0.04) continue;
      const v = f.velocity;
      const yaw = Math.atan2(v.x, v.z);
      const len = f.size * (0.8 + 2.2 * s);
      const wid = 0.25 + 0.6 * s;
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      // streak's local +x along the heading (plane local x is world x pre-yaw)
      _m.set(
        sy * len, 0, cy * wid, f.position.x,
        0, 1, 0, 0.015,
        cy * len, 0, -sy * wid, f.position.z,
        0, 0, 0, 1,
      );
      this.mesh.setMatrixAt(w++, _m);
    }
    this.mesh.count = w;
    if (w > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
