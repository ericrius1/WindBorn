// The capsule table's second job: a skeleton. Every row becomes a joint — a
// THREE.Bone holding one rotation — chained by the table's parent column.
// Forward kinematics is the chain rule of poses: a joint's world matrix is
// its parent's world matrix times its own little translation and rotation,
// and the skin matrix that moves vertices is world × inverse(rest world):
// "undo where the bone was born, apply where it is now". The weights that
// decide *which* vertices each bone moves come from the same capsules that
// shaped the field, asked a different question.

import * as THREE from "three/webgpu";
import { OSPREY_BONES, BONE_INDEX, boneDistance } from "./skeleton";

export const WEIGHT_POWER_DEFAULT = 2.6;

// Skin weights by proximity: a vertex is influenced by the capsules it lives
// near, with closeness sharpened by a power. Each vertex keeps its best four
// influences, normalized to sum to one, because the GPU eats vec4s.
export function computeSkinWeights(
  positions: Float32Array,
  power: number,
): { skinIndex: Uint16Array; skinWeight: Float32Array } {
  const nVerts = positions.length / 3;
  const skinIndex = new Uint16Array(nVerts * 4);
  const skinWeight = new Float32Array(nVerts * 4);
  const nBones = OSPREY_BONES.length;
  const dist = new Float32Array(nBones);
  const eps = 0.008; // softens 1/d at the surface; also the "touching" scale

  for (let v = 0; v < nVerts; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    for (let j = 0; j < nBones; j++) dist[j] = Math.max(0, boneDistance(OSPREY_BONES[j], x, y, z));
    // top four bones by closeness (insertion into four slots)
    let i0 = -1, i1 = -1, i2 = -1, i3 = -1;
    for (let j = 0; j < nBones; j++) {
      const d = dist[j];
      if (i0 < 0 || d < dist[i0]) { i3 = i2; i2 = i1; i1 = i0; i0 = j; }
      else if (i1 < 0 || d < dist[i1]) { i3 = i2; i2 = i1; i1 = j; }
      else if (i2 < 0 || d < dist[i2]) { i3 = i2; i2 = j; }
      else if (i3 < 0 || d < dist[i3]) { i3 = j; }
    }
    const picks = [i0, i1, i2, i3];
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const w = Math.pow(1 / (dist[picks[k]] + eps), power);
      skinIndex[v * 4 + k] = picks[k];
      skinWeight[v * 4 + k] = w;
      sum += w;
    }
    for (let k = 0; k < 4; k++) skinWeight[v * 4 + k] /= sum;
  }
  return { skinIndex, skinWeight };
}

// The runtime skeleton: one THREE.Bone per table row. Rest pose is pure
// translation (each bone sits at its head, world-aligned), so the bind
// inverse is just a translation by −head — and a joint's rotation axes read
// as world axes, which keeps pose tables honest. The IK thinks in directions
// instead and never notices.
export interface OspreyRig {
  root: THREE.Bone; // the body; everything hangs off it
  bones: THREE.Bone[]; // parallel to OSPREY_BONES
  skeleton: THREE.Skeleton;
  bone(name: string): THREE.Bone;
  setEulerDeg(name: string, x: number, y: number, z: number): void;
  reset(): void;
}

export function createOspreyRig(): OspreyRig {
  const bones: THREE.Bone[] = OSPREY_BONES.map((b) => {
    const bn = new THREE.Bone();
    bn.name = b.name;
    return bn;
  });
  for (let i = 0; i < OSPREY_BONES.length; i++) {
    const def = OSPREY_BONES[i];
    const p = def.parent ? BONE_INDEX.get(def.parent) : undefined;
    if (p !== undefined) {
      bones[p].add(bones[i]);
      const ph = OSPREY_BONES[p].head;
      bones[i].position.set(def.head[0] - ph[0], def.head[1] - ph[1], def.head[2] - ph[2]);
    } else {
      bones[i].position.set(...def.head);
    }
  }
  const inverses = OSPREY_BONES.map(
    (b) => new THREE.Matrix4().makeTranslation(-b.head[0], -b.head[1], -b.head[2]),
  );
  const skeleton = new THREE.Skeleton(bones, inverses);
  const root = bones[BONE_INDEX.get("body")!];

  const get = (name: string): THREE.Bone => {
    const i = BONE_INDEX.get(name);
    if (i === undefined) throw new Error(`no joint ${name}`);
    return bones[i];
  };

  return {
    root,
    bones,
    skeleton,
    bone: get,
    setEulerDeg(name, x, y, z) {
      get(name).rotation.set((x * Math.PI) / 180, (y * Math.PI) / 180, (z * Math.PI) / 180);
    },
    reset() {
      for (let i = 0; i < bones.length; i++) {
        bones[i].rotation.set(0, 0, 0);
        bones[i].scale.set(1, 1, 1);
        const def = OSPREY_BONES[i];
        const p = def.parent ? BONE_INDEX.get(def.parent) : undefined;
        if (p !== undefined) {
          const ph = OSPREY_BONES[p].head;
          bones[i].position.set(def.head[0] - ph[0], def.head[1] - ph[1], def.head[2] - ph[2]);
        } else {
          bones[i].position.set(...def.head);
        }
      }
    },
  };
}

// Bind a geometry (with skin attributes) to a fresh rig. The SkinnedMesh is
// the GPU side of the bargain: for every vertex it computes Σ wᵢ · Mᵢ · v
// with the four weights we stored — linear blend skinning, the same formula
// since 1988.
export function createSkinnedOsprey(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
): { mesh: THREE.SkinnedMesh; rig: OspreyRig } {
  const rig = createOspreyRig();
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.add(rig.root);
  mesh.bind(rig.skeleton, new THREE.Matrix4());
  mesh.frustumCulled = false; // posed bounds outgrow the rest-pose box
  return { mesh, rig };
}

// Attach a rider (eyes, talons — anything not in the field) to a joint:
// convert its rest-pose world position into the bone's local frame. Rest
// bones are world-aligned translations, so local = world − head.
export function attachRider(rig: OspreyRig, boneName: string, obj: THREE.Object3D): void {
  const def = OSPREY_BONES[BONE_INDEX.get(boneName)!];
  obj.position.sub(new THREE.Vector3(...def.head));
  rig.bone(boneName).add(obj);
}

// ---- skeleton x-ray ------------------------------------------------------------
// Joints drawn as stretched octahedra (the Blender look) plus beads at the
// pivots. One instanced mesh each; update() re-poses them from the rig.

export class SkeletonViz {
  readonly group = new THREE.Group();
  private bones: THREE.InstancedMesh;
  private beads: THREE.InstancedMesh;
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private head = new THREE.Vector3();
  private tail = new THREE.Vector3();
  private tmpS = new THREE.Vector3();

  constructor(color = 0x7fd4ff) {
    const n = OSPREY_BONES.length;
    const geo = new THREE.OctahedronGeometry(1);
    geo.applyMatrix4(new THREE.Matrix4().makeScale(0.045, 0.5, 0.045));
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.5, 0));
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false });
    this.bones = new THREE.InstancedMesh(geo, mat, n);
    this.bones.renderOrder = 10;
    const beadMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false });
    this.beads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.006, 10, 8), beadMat, n);
    this.beads.renderOrder = 11;
    this.group.add(this.bones, this.beads);
  }

  update(rig: OspreyRig): void {
    rig.root.updateWorldMatrix(true, true);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < rig.bones.length; i++) {
      const def = OSPREY_BONES[i];
      const m = rig.bones[i].matrixWorld;
      this.head.setFromMatrixPosition(m);
      this.tail
        .set(def.tail[0] - def.head[0], def.tail[1] - def.head[1], def.tail[2] - def.head[2])
        .applyMatrix4(m);
      const dir = this.tail.sub(this.head);
      const len = dir.length() || 0.001;
      this.tmpQ.setFromUnitVectors(up, dir.normalize());
      this.tmpS.set(1, len, 1);
      this.tmpM.compose(this.head, this.tmpQ, this.tmpS);
      this.bones.setMatrixAt(i, this.tmpM);
      this.tmpM.compose(this.head, IDENT_Q, ONE_V);
      this.beads.setMatrixAt(i, this.tmpM);
    }
    this.bones.instanceMatrix.needsUpdate = true;
    this.beads.instanceMatrix.needsUpdate = true;
  }
}

const IDENT_Q = new THREE.Quaternion();
const ONE_V = new THREE.Vector3(1, 1, 1);
