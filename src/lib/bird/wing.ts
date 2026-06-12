// The wing as a mechanism. The capsule table gives three segments per side —
// humerus, forearm, hand — and this module turns "wingtip, be there" into
// joint rotations: a two-bone solve for shoulder and elbow, the hand laid
// along the remaining reach with its own sweep, and every blade rolled to
// face where the air will be. The fold, the M-shaped glide, the wingbeat,
// and every action pose are all just different places to put the target.

import * as THREE from "three/webgpu";
import { OSPREY_BONES, BONE_INDEX, type OspreyBone } from "./skeleton";
import { solveTwoBone, quatFromFrames, makeTwoBoneResult, type TwoBoneResult } from "./ik";
import type { OspreyRig } from "./rig";

export interface WingSide {
  sign: 1 | -1; // +1 = her left (+x), −1 = her right
  shoulder: THREE.Vector3;
  restDir: { hum: THREE.Vector3; fore: THREE.Vector3; hand: THREE.Vector3 };
  restNormal: THREE.Vector3; // the blade's flat axis at rest (the squash axis)
  len: { hum: number; fore: number; hand: number };
  names: { hum: string; fore: string; hand: string };
}

function boneDir(b: OspreyBone): THREE.Vector3 {
  return new THREE.Vector3(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]).normalize();
}
function boneLen(b: OspreyBone): number {
  return Math.hypot(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]);
}

function makeSide(suffix: "L" | "R"): WingSide {
  const hum = OSPREY_BONES[BONE_INDEX.get("humerus" + suffix)!];
  const fore = OSPREY_BONES[BONE_INDEX.get("forearm" + suffix)!];
  const hand = OSPREY_BONES[BONE_INDEX.get("hand" + suffix)!];
  const sign = suffix === "L" ? 1 : -1;
  return {
    sign,
    shoulder: new THREE.Vector3(...hum.head),
    restDir: { hum: boneDir(hum), fore: boneDir(fore), hand: boneDir(hand) },
    restNormal: new THREE.Vector3(sign, 0, 0),
    len: { hum: boneLen(hum), fore: boneLen(fore), hand: boneLen(hand) },
    names: { hum: "humerus" + suffix, fore: "forearm" + suffix, hand: "hand" + suffix },
  };
}

export const WINGS: { L: WingSide; R: WingSide } = { L: makeSide("L"), R: makeSide("R") };

export function wingReach(side: WingSide = WINGS.L): number {
  return side.len.hum + side.len.fore + side.len.hand;
}

export interface WingSolveOptions {
  pole?: THREE.Vector3; // elbow bias, body space; default back and slightly up
  twist?: number; // radians; + pitches the leading edge up (flare), − down (power)
}

export interface WingSolveResult {
  elbow: THREE.Vector3;
  wrist: THREE.Vector3;
  tip: THREE.Vector3;
  clamped: boolean;
}

export function makeWingSolveResult(): WingSolveResult {
  return { elbow: new THREE.Vector3(), wrist: new THREE.Vector3(), tip: new THREE.Vector3(), clamped: false };
}

export const DEFAULT_POLE = new THREE.Vector3(0, 0.35, -1).normalize();

const sTwo: TwoBoneResult = makeTwoBoneResult();
const wTarget = new THREE.Vector3();
const handDir = new THREE.Vector3();
const nHint = new THREE.Vector3();
const nBone = new THREE.Vector3();
const qHum = new THREE.Quaternion();
const qFore = new THREE.Quaternion();
const qHand = new THREE.Quaternion();
const qTwist = new THREE.Quaternion();
const qInv = new THREE.Quaternion();
const pole = new THREE.Vector3();

// Solve one wing so its tip lands on `target` (body space) and write the
// three local quaternions into the rig. The hand is handled by successive
// approximation: guess its direction, pull the two-bone target back by one
// hand-length, solve, re-aim the hand from wherever the wrist actually
// landed, solve once more — two passes land within a feather's width.
export function applyWingTip(
  rig: OspreyRig,
  side: WingSide,
  target: THREE.Vector3,
  opts: WingSolveOptions = {},
  out?: WingSolveResult,
): WingSolveResult {
  const { shoulder, len } = side;
  pole.copy(opts.pole ?? DEFAULT_POLE);
  pole.x *= side.sign;
  const twist = opts.twist ?? 0;

  handDir.subVectors(target, shoulder).normalize();
  for (let pass = 0; pass < 2; pass++) {
    wTarget.copy(target).addScaledVector(handDir, -len.hand);
    solveTwoBone(shoulder, wTarget, len.hum, len.fore, pole, sTwo);
    handDir.subVectors(target, sTwo.end).normalize();
    if (handDir.lengthSq() < 1e-8) handDir.copy(sTwo.lowerDir);
  }

  // blade roll: folded against the body the normal points sideways; spread,
  // it faces up. Blend by how far laterally the wing actually got, then
  // twist about each bone's own axis — the hand carries the most (primaries
  // are the propeller blades).
  const spread = Math.min(1, Math.abs(target.x - shoulder.x) / (wingReach(side) * 0.8));
  nHint.set(side.sign * (1 - spread), spread, 0).normalize();

  const setBone = (
    name: string,
    restDir: THREE.Vector3,
    dir: THREE.Vector3,
    twistShare: number,
    parentQ: THREE.Quaternion | null,
    outQ: THREE.Quaternion,
  ): void => {
    nBone.copy(nHint);
    if (twist !== 0 && twistShare !== 0) {
      qTwist.setFromAxisAngle(dir, side.sign * twist * twistShare);
      nBone.applyQuaternion(qTwist);
    }
    quatFromFrames(restDir, side.restNormal, dir, nBone, outQ);
    const local = rig.bone(name).quaternion.copy(outQ);
    if (parentQ) local.premultiply(qInv.copy(parentQ).invert());
  };

  setBone(side.names.hum, side.restDir.hum, sTwo.upperDir, 0.25, null, qHum);
  setBone(side.names.fore, side.restDir.fore, sTwo.lowerDir, 0.6, qHum, qFore);
  setBone(side.names.hand, side.restDir.hand, handDir, 1.0, qFore, qHand);

  const r = out ?? makeWingSolveResult();
  r.elbow.copy(sTwo.elbow);
  r.wrist.copy(sTwo.end);
  r.tip.copy(sTwo.end).addScaledVector(handDir, len.hand);
  r.clamped = sTwo.clamped;
  return r;
}

// ---- target builders --------------------------------------------------------

const foldedTip = new THREE.Vector3();
const extendedTip = new THREE.Vector3();
const arcTip = new THREE.Vector3();

// The unfold: one scalar from sleeping silhouette to full span. f = 0 puts
// the tip back at its rest-pose position (the folded Z part 1 sculpted);
// f = 1 reaches it out level with the shoulder at ~97% of full extension.
// In between the tip rides an arc on the shoulder's sphere and the elbow,
// biased backward by the pole, passes through every fold the real wing
// makes. `sweep` slides the extended tip fore (+) or aft (−), in meters.
export function unfoldTarget(side: WingSide, f: number, sweep = 0, out = new THREE.Vector3()): THREE.Vector3 {
  const hand = OSPREY_BONES[BONE_INDEX.get(side.names.hand)!];
  foldedTip.set(...hand.tail);
  const reach = wingReach(side);
  extendedTip
    .copy(side.shoulder)
    .add(arcTip.set(side.sign * reach * 0.97, reach * 0.02, -reach * 0.06 + sweep));
  // lerp through the shoulder's sphere: direction slerps, radius lerps
  const a = foldedTip.sub(side.shoulder);
  const b = extendedTip.sub(side.shoulder);
  const ra = a.length(), rb = b.length();
  a.normalize();
  b.normalize();
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const ang = Math.acos(dot);
  const s = Math.sin(ang) || 1e-6;
  out.copy(a).multiplyScalar(Math.sin((1 - f) * ang) / s).addScaledVector(b, Math.sin(f * ang) / s);
  out.multiplyScalar(THREE.MathUtils.lerp(ra * 0.985, rb, f)).add(side.shoulder);
  return out;
}

// A pose-space tip target: extension 0..1 (folded → full reach), lift and
// sweep in meters relative to the shoulder. This is the coordinate system
// the gaits and the action poses both speak.
export function tipFromParams(
  side: WingSide,
  ext: number,
  lift: number,
  sweep: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  if (ext < 0.32) {
    // near the body the honest fold arc beats a straight offset
    unfoldTarget(side, Math.max(0, ext / 0.32) * 0.32, sweep * 0.5, out);
    out.y += lift * (ext / 0.32) * 0.5;
    return out;
  }
  const reach = wingReach(side);
  const lateral = Math.sqrt(Math.max(0.05, ext * ext - (lift / reach) ** 2)) * reach;
  out.set(side.shoulder.x + side.sign * lateral, side.shoulder.y + lift, side.shoulder.z + sweep);
  return out;
}

// Tail fan: the one capsule spreads by scaling sideways along its bone — the
// skinned vertices ride the bone's scale just like they ride its rotation.
export function setTail(rig: OspreyRig, spread01: number, pitchDeg: number, yawDeg: number): void {
  const tail = rig.bone("tailFan");
  tail.scale.set(THREE.MathUtils.lerp(1, 2.6, spread01), 1, 1);
  tail.rotation.set((pitchDeg * Math.PI) / 180, (yawDeg * Math.PI) / 180, 0);
}
