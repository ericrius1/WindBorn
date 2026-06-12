// A minimal stylized bird glyph for the Lift demos: a low-poly dart built
// directly from triangles — a diamond body, two crooked-wing panels per
// side, and a tail fan. Dark above, pale below, like the real bird seen
// against the sky.
//
// This is deliberately a stand-in. The New Feathers series builds the real
// osprey mesh and rig.
// TODO(lift): swap in src/lib/bird once its API is stable.

import * as THREE from "three/webgpu";
import { color, mix, smoothstep, normalWorld, float } from "three/tsl";
import type { FlightBody } from "./model";

const ZERO = new THREE.Vector3(0, 0, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

// Push one triangle into a flat position array.
function tri(out: number[], a: number[], b: number[], c: number[]): void {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

// Two triangles for a quad given in ring order.
function quad(out: number[], a: number[], b: number[], c: number[], d: number[]): void {
  tri(out, a, b, c);
  tri(out, a, c, d);
}

// Flip any triangle whose face normal points toward `center` — saves
// hand-checking the winding of every body facet.
function orientOutward(pos: number[], center: THREE.Vector3): void {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const mid = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 9) {
    a.fromArray(pos, i);
    b.fromArray(pos, i + 3);
    c.fromArray(pos, i + 6);
    n.subVectors(b, a).cross(mid.subVectors(c, a));
    mid.addVectors(a, b).add(c).divideScalar(3).sub(center);
    if (n.dot(mid) < 0) {
      // swap b and c
      for (let k = 0; k < 3; k++) {
        const t = pos[i + 3 + k];
        pos[i + 3 + k] = pos[i + 6 + k];
        pos[i + 6 + k] = t;
      }
    }
  }
}

function geometryFrom(pos: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Mirroring with a negative scale flips triangle winding; swap two vertices
// of every triangle to restore outward-facing normals.
function flipWinding(geo: THREE.BufferGeometry): void {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = pos.getComponent(i + 1, k);
      pos.setComponent(i + 1, k, pos.getComponent(i + 2, k));
      pos.setComponent(i + 2, k, a);
    }
  }
  pos.needsUpdate = true;
}

export class BirdGlyph {
  readonly group = new THREE.Group();
  private readonly leftWing = new THREE.Group();
  private readonly rightWing = new THREE.Group();
  private readonly material: THREE.MeshStandardNodeMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly q = new THREE.Quaternion();
  private readonly qPitch = new THREE.Quaternion();
  private readonly m = new THREE.Matrix4();

  constructor(scale = 1) {
    // One material: dark back, pale belly, split by which way the surface
    // faces. Real plumage arrives with the bird series.
    const mat = new THREE.MeshStandardNodeMaterial();
    const belly = smoothstep(float(-0.25), float(0.25), normalWorld.y.negate());
    mat.colorNode = mix(color(0x37322c), color(0xe9e4d8), belly);
    mat.roughnessNode = float(0.85);
    mat.flatShading = true;
    mat.side = THREE.DoubleSide;
    this.material = mat;

    // ---- body: a stretched diamond -------------------------------------
    const N = [0, 0.01, 0.3]; // nose
    const T = [0, 0.03, -0.26]; // tail
    const P = [0, 0.075, 0.04]; // top
    const B = [0, -0.06, 0.06]; // keel
    const L = [-0.075, 0.005, 0.05];
    const R = [0.075, 0.005, 0.05];
    const body: number[] = [];
    tri(body, N, P, L);
    tri(body, N, L, B);
    tri(body, N, B, R);
    tri(body, N, R, P);
    tri(body, T, L, P);
    tri(body, T, B, L);
    tri(body, T, R, B);
    tri(body, T, P, R);
    orientOutward(body, new THREE.Vector3(0, 0.01, 0.03));
    const bodyGeo = geometryFrom(body);
    this.geometries.push(bodyGeo);
    this.group.add(new THREE.Mesh(bodyGeo, mat));

    // ---- wings: two panels each, crooked at the elbow --------------------
    // Built for the left side (-x outward), relative to the shoulder pivot.
    const RL = [0, 0, 0.12];
    const RT = [0, 0, -0.1];
    const EL = [-0.36, 0.015, 0.14];
    const ET = [-0.36, 0.01, -0.08];
    const TL = [-0.74, 0, -0.02];
    const TT = [-0.74, 0, -0.18];
    const wing: number[] = [];
    quad(wing, RL, EL, ET, RT); // inner panel
    quad(wing, EL, TL, TT, ET); // outer panel, swept back
    const leftGeo = geometryFrom(wing);
    const rightGeo = leftGeo.clone();
    rightGeo.scale(-1, 1, 1);
    flipWinding(rightGeo);
    rightGeo.computeVertexNormals();
    this.geometries.push(leftGeo, rightGeo);

    this.leftWing.position.set(-0.06, 0.03, 0.05);
    this.rightWing.position.set(0.06, 0.03, 0.05);
    this.leftWing.add(new THREE.Mesh(leftGeo, mat));
    this.rightWing.add(new THREE.Mesh(rightGeo, mat));
    this.group.add(this.leftWing, this.rightWing);

    // ---- tail fan ----------------------------------------------------------
    const tail: number[] = [];
    const TR = [0, 0.02, -0.2];
    tri(tail, TR, [-0.11, 0.015, -0.42], [0, 0.02, -0.46]);
    tri(tail, TR, [0, 0.02, -0.46], [0.11, 0.015, -0.42]);
    const tailGeo = geometryFrom(tail);
    this.geometries.push(tailGeo);
    this.group.add(new THREE.Mesh(tailGeo, mat));

    this.group.scale.setScalar(scale);
  }

  // raise: wing angle in radians, + = tips above the shoulder.
  // fold: 0..1 sweeps the wings back (the dive tuck).
  setPose(raise: number, fold: number): void {
    const r = raise - fold * 0.25;
    this.leftWing.rotation.z = -r;
    this.rightWing.rotation.z = r;
    this.leftWing.rotation.y = -fold * 0.95;
    this.rightWing.rotation.y = fold * 0.95;
  }

  // Position + orient the glyph from the flight model: forward along the
  // airflow, rolled to the lift direction, pitched up by α, wings driven by
  // the wingbeat clock.
  applyBody(body: FlightBody): void {
    this.group.position.copy(body.pos);
    this.m.lookAt(body.forward, ZERO, body.up);
    this.q.setFromRotationMatrix(this.m);
    this.qPitch.setFromAxisAngle(X_AXIS, -body.alpha);
    this.q.multiply(this.qPitch);
    this.group.quaternion.copy(this.q);

    const amp = 0.04 + 0.55 * body.flapAmp;
    const raise = 0.12 + Math.sin(body.flapPhase) * amp;
    this.setPose(raise, body.tuck);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
  }
}
