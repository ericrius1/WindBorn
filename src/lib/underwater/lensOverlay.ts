// What the camera housing itself sees: the meniscus band where the
// waterline crosses the lens, the streaks that run down the glass after an
// exit, and the multiplicative color grade that turns "scene" into "scene,
// underwater".
//
// Everything lives on two quads parented to the camera (so the scene needs
// `scene.add(camera)`), sized to exactly fill the frustum:
//
//   · the GRADE quad multiplies the framebuffer — identity white in air,
//     a depth-keyed teal filter in water, split along the waterline while
//     the lens is half-submerged;
//   · the BAND quad alpha-blends the meniscus line and the droplets. The
//     droplets are fully procedural: a hash of (streak index, exit count)
//     decides where each one runs, so a dunk costs zero allocations.
//
// The waterline's screen position comes from one CPU projection per frame:
// take a point a meter and a half ahead of the camera, snap its height to
// the water surface, project it. Near the crossing — the only time the band
// is visible — that approximation is within a pixel or two of the truth.

import {
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  MultiplyBlending,
  PerspectiveCamera,
  PlaneGeometry,
  Vector3,
} from "three/webgpu";
import {
  Fn,
  clamp,
  color,
  exp,
  float,
  fract,
  length,
  mix,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { wind } from "../spine";
import type { SurfaceCrossing, CrossingEvent } from "./crossing";

type NodeF = Node<"float">;

const DROPLETS = 12;

export interface LensOverlayOptions {
  /** Meniscus band on/off (the two-worlds demo teaches the state first). */
  band?: boolean;
  /** Droplet streaks after an exit. */
  droplets?: boolean;
  /** The underwater multiply grade. */
  grade?: boolean;
}

export class LensOverlay {
  readonly group = new Group();

  /** Meniscus band half-width in screen heights. */
  readonly bandWidth = uniform(0.02);
  /** Water grade tint at zero depth; deepens with camDepth automatically. */
  readonly tint = uniform(new Vector3(0.52, 0.78, 0.85));

  private time = uniform(0);
  private lineY = uniform(-2);
  private submerge = uniform(0);
  private bandStrength = uniform(0);
  private splitActive = uniform(0);
  private wobble = uniform(0);
  private camDepth = uniform(0);
  private exitTime = uniform(-100);
  private enterTime = uniform(-100);
  private seed = uniform(0);
  private aspect: number;

  private quads: Mesh[] = [];
  private geometry: PlaneGeometry;
  private materials: MeshBasicNodeMaterial[] = [];
  private exits = 0;
  private fwd = new Vector3();
  private probe = new Vector3();

  constructor(camera: PerspectiveCamera, options: LensOverlayOptions = {}) {
    const { band = true, droplets = true, grade = true } = options;
    this.aspect = camera.aspect;

    this.geometry = new PlaneGeometry(1, 1);
    const d = Math.max(camera.near * 3, 0.12);
    const h = 2 * d * Math.tan(((camera.fov / 2) * Math.PI) / 180);

    const addQuad = (material: MeshBasicNodeMaterial, order: number): void => {
      material.depthTest = false;
      material.depthWrite = false;
      material.transparent = true;
      const mesh = new Mesh(this.geometry, material);
      mesh.position.set(0, 0, -d);
      mesh.scale.set(h * camera.aspect, h, 1);
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      this.quads.push(mesh);
      this.materials.push(material);
      this.group.add(mesh);
    };

    // The waterline in uv space, wobbled by the waves sliding across the glass.
    const lineAt = (x: NodeF) =>
      this.lineY
        .add(sin(x.mul(43).add(this.time.mul(2.6))).mul(this.wobble))
        .add(sin(x.mul(91).sub(this.time.mul(4.1))).mul(this.wobble.mul(0.45)));

    // ---- grade quad: multiply the frame toward the water's filter ------------
    if (grade) {
      const material = new MeshBasicNodeMaterial({ blending: MultiplyBlending });
      const below = smoothstep(float(0.004), float(-0.004), uv().y.sub(lineAt(uv().x)));
      const mask = this.submerge.max(below.mul(this.splitActive)).clamp(0, 1);
      // Deeper camera, harder filter — red first, as always.
      const deepen = vec3(
        exp(this.camDepth.mul(-0.34)),
        exp(this.camDepth.mul(-0.075)),
        exp(this.camDepth.mul(-0.03)),
      );
      const waterGrade = vec3(this.tint.x, this.tint.y, this.tint.z).mul(deepen);
      material.colorNode = mix(vec3(1), waterGrade, mask);
      addQuad(material, 997);
    }

    // ---- band quad: meniscus + droplets, alpha-blended ------------------------
    if (band || droplets) {
      const material = new MeshBasicNodeMaterial();
      const rgba = Fn(() => {
        const acc = vec4(0).toVar();
        const x = uv().x;
        const y = uv().y;

        if (band) {
          const sdf = y.sub(lineAt(x));
          const g = sdf.div(this.bandWidth.max(1e-4));
          // dark meniscus body, brightened core where the film lenses light
          const bandA = exp(g.mul(g).negate()).mul(this.bandStrength);
          const core = exp(g.mul(g).mul(9).negate()).mul(this.bandStrength).mul(0.5);
          acc.addAssign(vec4(color(0x0a2832).mul(bandA), bandA.mul(0.85)));
          acc.addAssign(vec4(color(0xbfe4ee).mul(core), core.mul(0.6)));
          // entering: one frame-long gulp of dark as the water swallows the lens
          const flash = exp(this.time.sub(this.enterTime).max(0).mul(-5.5)).mul(0.4);
          acc.addAssign(vec4(color(0x06222d).mul(flash), flash));
        }

        if (droplets) {
          for (let i = 0; i < DROPLETS; i++) {
            const h1 = fract(sin(this.seed.add(i * 17.31 + 1.7)).mul(43758.55));
            const h2 = fract(sin(this.seed.add(i * 31.77 + 9.1)).mul(27183.29));
            const h3 = fract(sin(this.seed.add(i * 11.13 + 3.3)).mul(36717.41));
            const age = this.time.sub(this.exitTime).sub(h2.mul(0.5));
            const life = h3.mul(0.9).add(1.1);
            const alive = smoothstep(float(0), float(0.04), age).mul(
              smoothstep(life, life.mul(0.55), age),
            );
            // the streak head slides down, accelerating as the film feeds it
            const head = float(0.95).sub(age.mul(age.mul(0.16).add(0.08)));
            const px = x.sub(h1.mul(0.9).add(0.05)).mul(this.aspect);
            const dy = y.sub(head);
            const tail = h3.mul(0.1).add(0.05);
            const seg = dy.sub(clamp(dy, float(0), tail));
            const dist = length(vec2(px, seg));
            const r = h2.mul(0.004).add(0.0045);
            const streak = smoothstep(r, r.mul(0.25), dist).mul(alive);
            const bulb = smoothstep(r.mul(2.1), r.mul(0.4), length(vec2(px, dy))).mul(alive).mul(0.8);
            const a = streak.mul(0.55).add(bulb);
            acc.addAssign(vec4(color(0xdcf2fa).mul(a), a));
          }
        }

        return acc;
      })();
      material.colorNode = rgba.rgb.div(rgba.a.max(1e-4));
      material.opacityNode = rgba.a.clamp(0, 0.92);
      addQuad(material, 999);
    }

    camera.add(this.group);
  }

  /** Call when the crossing state machine reports an event. */
  notify(event: CrossingEvent, t: number): void {
    if (event === "exit") {
      this.exits += 1;
      this.exitTime.value = t;
      this.seed.value = this.exits * 7.31;
    } else if (event === "enter") {
      this.enterTime.value = t;
    }
  }

  /** Per-frame: project the waterline, sync every uniform. */
  update(camera: PerspectiveCamera, waterY: number, crossing: SurfaceCrossing, t: number): void {
    this.time.value = t;
    this.submerge.value = crossing.submergence;
    this.camDepth.value = Math.max(0, crossing.depth);
    this.bandStrength.value = crossing.proximity;
    // the split grade only while the line is physically on the glass
    this.splitActive.value = Math.max(0, 1 - Math.abs(crossing.depth) / 0.14);
    this.wobble.value = crossing.proximity * (0.005 + wind.speed * 0.002);

    camera.getWorldDirection(this.fwd);
    this.probe.copy(camera.position).addScaledVector(this.fwd, 1.5);
    this.probe.y = waterY;
    this.probe.project(camera);
    const ndcY = Number.isFinite(this.probe.y) ? this.probe.y : -4;
    this.lineY.value = Math.max(-1.5, Math.min(1.5, ndcY)) * 0.5 + 0.5;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
