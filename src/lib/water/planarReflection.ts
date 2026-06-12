// Planar reflection for the lake (mirrorworld.html). The idea, from first
// principles: everything a flat mirror at y = 0 shows you is exactly what a
// second camera, placed at your eye's mirror image *below* the plane, would
// see looking back up. So each frame we:
//
//   1. mirror the main camera across y = 0 (negate the y of its position,
//      forward, and up vectors);
//   2. render the scene from that virtual camera into a texture, with the
//      water itself hidden;
//   3. in the water material, sample that texture at the fragment's screen
//      position — x-flipped, because re-orthonormalizing the mirrored frame
//      through lookAt() un-mirrors handedness and flips the image — and let
//      the rippled normal nudge the sample around.
//
// The virtual camera also gets an oblique near plane clipped to y = 0
// (Lengyel's trick: overwrite the projection's third row so NDC z = 0 falls
// exactly on the water plane), so geometry below the surface never leaks
// into the reflection.

import {
  HalfFloatType,
  Matrix4,
  PerspectiveCamera,
  Plane,
  RenderTarget,
  Vector3,
  Vector4,
} from "three/webgpu";
import type { Object3D, Scene, WebGPURenderer } from "three/webgpu";
import { screenUV, texture, vec2 } from "three/tsl";
import type { Node } from "three/webgpu";

type NodeV2 = Node<"vec2">;
type NodeV3 = Node<"vec3">;

const _dir = new Vector3();
const _up = new Vector3();
const _look = new Vector3();
const _plane = new Plane();
const _normal = new Vector3(0, 1, 0);
const _q = new Vector4();
const _clip = new Vector4();
const _proj = new Matrix4();
const _origin = new Vector3();

export class PlanarReflection {
  readonly target: RenderTarget;
  readonly camera = new PerspectiveCamera();
  private hidden: { object: Object3D; visible: boolean }[] = [];

  constructor(width = 512, height = 512) {
    this.target = new RenderTarget(width, height, { type: HalfFloatType });
  }

  setSize(width: number, height: number): void {
    this.target.setSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  }

  /**
   * Reflection radiance for the current fragment. `offset` (optional) is a
   * screen-space distortion in UV units — feed it the rippled normal's xz.
   */
  colorNode(offset?: NodeV2): NodeV3 {
    let uvN: NodeV2 = vec2(screenUV.x.oneMinus(), screenUV.y);
    if (offset) uvN = uvN.add(offset).clamp(0.001, 0.999);
    return texture(this.target.texture, uvN).rgb;
  }

  /**
   * Mirror `mainCamera` across y = 0, then render `scene` into the target
   * with `hide` (the water mesh, usually) invisible. Call once per frame,
   * before the main render.
   */
  render(renderer: WebGPURenderer, scene: Scene, mainCamera: PerspectiveCamera, hide: Object3D[] = []): void {
    mainCamera.updateMatrixWorld();
    const p = mainCamera.matrixWorld.elements;
    const camY = p[13];
    if (camY < 0.005) return; // eye at/under the surface: keep last frame

    // Mirror position, forward, and up across the plane (y → −y).
    const vc = this.camera;
    vc.position.set(p[12], -camY, p[14]);
    mainCamera.getWorldDirection(_dir);
    _dir.y = -_dir.y;
    _up.setFromMatrixColumn(mainCamera.matrixWorld, 1);
    _up.y = -_up.y;
    vc.up.copy(_up);
    _look.copy(vc.position).add(_dir);
    vc.lookAt(_look);
    vc.updateMatrixWorld(true);

    // Keep both cameras in the renderer's coordinate system up front, or the
    // renderer rebuilds the projection we're about to shape on first use.
    if (mainCamera.coordinateSystem !== renderer.coordinateSystem) {
      mainCamera.coordinateSystem = renderer.coordinateSystem;
      mainCamera.updateProjectionMatrix();
    }
    vc.coordinateSystem = renderer.coordinateSystem;

    // Same lens as the main camera…
    _proj.copy(mainCamera.projectionMatrix);

    // …with an oblique near plane on y = 0 (camera-space plane → third row).
    _plane.setFromNormalAndCoplanarPoint(_normal, _origin);
    _plane.applyMatrix4(vc.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const e = _proj.elements;
    _q.set(
      (Math.sign(_clip.x) + e[8]) / e[0],
      (Math.sign(_clip.y) + e[9]) / e[5],
      -1,
      (1 + e[10]) / e[14],
    );
    _clip.multiplyScalar(1 / _clip.dot(_q));
    e[2] = _clip.x;
    e[6] = _clip.y;
    e[10] = _clip.z; // WebGPU NDC: z in [0, 1]
    e[14] = _clip.w;
    vc.projectionMatrix.copy(_proj);

    // Hide the water (and anything else asked), render, restore.
    this.hidden.length = 0;
    for (const object of hide) {
      this.hidden.push({ object, visible: object.visible });
      object.visible = false;
    }
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(scene, vc);
    renderer.setRenderTarget(prevTarget);
    for (const h of this.hidden) h.object.visible = h.visible;
    this.hidden.length = 0;
  }

  dispose(): void {
    this.target.dispose();
  }
}
