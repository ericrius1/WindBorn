// The assembled chain — the one object reckoning.html and game.html mount.
//
// Order is the whole design, and it is fixed:
//
//   scene pass (linear HDR, optional velocity MRT)
//     resamplers   motion blur → dive DOF → wet lens → radial streaks
//                  (anything that MOVES pixels runs on the linear frame,
//                  before any color work, so refracted and blurred taps
//                  match their surroundings after grading)
//     linear grade exposure + white balance — gains that still act like light
//     bloom        thresholded on linear HDR, added back before the tone map
//   tone map + encode (renderOutput — the renderer's own curve)
//     display grade lift/gamma/gain, contrast, saturation, vignette
//     overlays     framing guides, shutter flash (UI, not light)
//
// Every stage is optional at build time (the chain compiles only what a
// scene asks for) and continuous at runtime (uniforms fade each stage in
// and out). grade.html through fieldnotes.html derive the stages one at a
// time; this file is just them, stacked.

import { PostProcessing } from "three/webgpu";
import type { Node, PassNode, PerspectiveCamera, Renderer, Scene, TextureNode } from "three/webgpu";
import { mrt, output, pass, renderOutput, vec4, velocity } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import type BloomNode from "three/addons/tsl/display/BloomNode.js";
import { clock } from "../spine";
import type { SurfaceCrossing } from "../underwater/crossing";
import { Grade } from "./grade";
import { SpeedEffects, cocDofNode, radialStreakNode, velocityBlurNode } from "./speed";
import { WetLensFx } from "./wetLens";
import { PhotoMode } from "./photo";

type NodeV4 = Node<"vec4">;

export interface PostFxStackOptions {
  /** Hour-keyed exposure/WB/LGG/contrast/saturation/vignette. Default on. */
  grade?: boolean;
  /** Thresholded HDR bloom, strength/threshold keyed to the hour. Default on. */
  bloom?: boolean;
  /** Dive DOF + radial streaks reading the published FlightState. */
  speed?: boolean;
  /** Velocity-buffer motion blur (adds an MRT target to the scene pass). */
  motionBlur?: boolean;
  /** Underwater grade swap, meniscus band, droplets — needs a SurfaceCrossing. */
  wetLens?: boolean;
  /** Photo-mode overlays (framing guides + shutter flash) and controller. */
  photo?: boolean;
  /** Key the grade to the spine clock every update(). Default true. */
  keyGradeToClock?: boolean;
  /** Motion-blur shutter, 0..1 of frame-to-frame motion. */
  shutter?: number;
}

export interface PostFxFrame {
  /** Scene simulated seconds (the wet lens times droplets off this). */
  t: number;
  /** Override the grade hour (defaults to the spine clock). */
  hour?: number;
  /** Camera→subject distance in meters, for the DOF focal plane. */
  focusDistance?: number;
  /** The scene's crossing state machine, if the camera can submerge. */
  crossing?: SurfaceCrossing;
  /** Water height under the camera (pairs with `crossing`). */
  waterY?: number;
}

export class PostFxStack {
  readonly post: PostProcessing;
  readonly scenePass: PassNode;
  /** Always present — neutral until apply()/setHour() says otherwise. */
  readonly grade = new Grade();
  readonly bloomNode: BloomNode | null = null;
  readonly speed: SpeedEffects | null = null;
  readonly wetLens: WetLensFx | null = null;
  readonly photo: PhotoMode | null = null;

  /** Scales the hour-keyed bloom (0 disables without a rebuild). */
  bloomScale = 1;

  private readonly camera: PerspectiveCamera;
  private readonly keyToClock: boolean;
  private readonly hasGrade: boolean;

  constructor(renderer: Renderer, scene: Scene, camera: PerspectiveCamera, options: PostFxStackOptions = {}) {
    const {
      grade: useGrade = true,
      bloom: useBloom = true,
      speed: useSpeed = false,
      motionBlur = false,
      wetLens: useWet = false,
      photo: usePhoto = false,
      keyGradeToClock = true,
      shutter = 0.7,
    } = options;

    this.camera = camera;
    this.keyToClock = keyGradeToClock;
    this.hasGrade = useGrade;

    this.scenePass = pass(scene, camera);
    if (motionBlur) this.scenePass.setMRT(mrt({ output, velocity }));
    const sceneTex = this.scenePass.getTextureNode("output") as TextureNode;

    // ---- linear HDR: the resamplers ------------------------------------------
    let c: NodeV4 = sceneTex;

    if (motionBlur) {
      const velocityTex = this.scenePass.getTextureNode("velocity") as TextureNode;
      c = velocityBlurNode(sceneTex, velocityTex, shutter, 10, c);
    }

    if (useSpeed) {
      this.speed = new SpeedEffects();
      const depthTex = this.scenePass.getTextureNode("depth") as TextureNode;
      c = cocDofNode(
        sceneTex,
        depthTex,
        {
          focusDistance: this.speed.focusDistance,
          focalRange: this.speed.focalRange,
          maxCoc: this.speed.maxCoc,
          near: camera.near,
          far: camera.far,
        },
        c,
      );
    }

    if (useWet) {
      this.wetLens = new WetLensFx();
      c = this.wetLens.node(vec4(c), sceneTex);
    }

    if (useSpeed && this.speed) {
      c = radialStreakNode(sceneTex, vec4(c), {
        amount: this.speed.streak,
        center: this.speed.streakCenter,
        fringe: this.speed.fringe,
      });
    }

    // ---- linear HDR: light-like color work ------------------------------------
    if (useGrade) {
      c = vec4(this.grade.linearNode(c.rgb), c.a);
    }

    if (useBloom) {
      const b = bloom(c, 0.4, 0.45, 0.8);
      this.bloomNode = b;
      c = c.add(b);
    }

    // ---- tone map + encode, then display-referred work -------------------------
    c = renderOutput(c);

    if (useGrade) {
      c = vec4(this.grade.displayNode(c.rgb), c.a);
    }

    if (usePhoto) {
      this.photo = new PhotoMode();
      c = this.photo.guides.node(vec4(c));
      c = this.photo.flashNode(vec4(c));
    }

    this.post = new PostProcessing(renderer);
    this.post.outputColorTransform = false; // renderOutput above already did it
    this.post.outputNode = c;
  }

  /**
   * Settle every uniform for this frame. Call once per frame, after the
   * scene has moved and before render().
   */
  update(dt: number, frame: PostFxFrame): void {
    const hour = frame.hour ?? (this.keyToClock ? clock.hour : null);
    if (this.hasGrade && hour !== null) {
      const s = this.grade.setHour(hour);
      if (this.bloomNode) {
        this.bloomNode.strength.value = s.bloomStrength * this.bloomScale;
        this.bloomNode.threshold.value = s.bloomThreshold;
      }
    } else if (this.bloomNode) {
      this.bloomNode.strength.value = 0.4 * this.bloomScale;
    }

    if (this.speed) {
      this.speed.update(dt, frame.focusDistance ?? 18);
    }

    if (this.wetLens && frame.crossing) {
      this.wetLens.update(this.camera, frame.waterY ?? 0, frame.crossing, frame.t);
    }
  }

  render(): void {
    this.post.render();
  }

  dispose(): void {
    this.photo?.dispose();
    this.scenePass.dispose();
    this.post.dispose();
  }
}
