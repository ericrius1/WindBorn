// The segment table's second job: a skeleton. Every row becomes a joint — a
// THREE.Bone holding one rotation — chained by the table's parent column.
// Forward kinematics is the chain rule of poses: a joint's world matrix is
// its parent's world matrix times its own little translation and rotation,
// and the skin matrix that moves vertices is world × inverse(rest world):
// "undo where the bone was born, apply where it is now". The weights that
// decide *which* vertices each bone moves were written down at loft time —
// every ring knows which joints it belongs to, because we placed it there.

import * as THREE from "three/webgpu";
import { OSPREY_BONES, BONE_INDEX } from "./skeleton";

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

// Attach a rider (eyes, a feather, anything rigid) to a joint: convert its
// rest-pose world position into the bone's local frame. Rest bones are
// world-aligned translations, so local = world − head.
export function attachRider(rig: OspreyRig, boneName: string, obj: THREE.Object3D): void {
  const def = OSPREY_BONES[BONE_INDEX.get(boneName)!];
  obj.position.sub(new THREE.Vector3(...def.head));
  rig.bone(boneName).add(obj);
}

// ---- skeleton x-ray ------------------------------------------------------------
// Joints drawn as stretched octahedra plus beads at the pivots. One instanced
// mesh each; update() re-poses them from the rig.

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

  dispose(): void {
    this.bones.geometry.dispose();
    (this.bones.material as THREE.Material).dispose();
    this.beads.geometry.dispose();
    (this.beads.material as THREE.Material).dispose();
  }
}

const IDENT_Q = new THREE.Quaternion();
const ONE_V = new THREE.Vector3(1, 1, 1);
