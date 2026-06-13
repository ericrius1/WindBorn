// The wet lens — the dive transition as a post-process.
//
// Crossing the Lens (lens.html) treated the camera housing as geometry: two
// quads parented to the camera, multiplying and alpha-blending whatever was
// behind them. That works, but a quad can only paint OVER the frame. Once
// the frame is a texture we can do what water on glass actually does:
// REFRACT it. Droplets bend the image behind them, the meniscus band
// magnifies the half-world below the line, and the underwater grade becomes
// one more per-pixel function in the chain instead of a translucent sticker.
//
// The CPU side is identical to lens.html on purpose: the same
// SurfaceCrossing state machine decides above/below, the same one-point
// projection puts the waterline on the screen. Only the GPU side changed
// addresses — from "a quad in front of the lens" to "a function of the
// frame".

import { Vector3 } from "three/webgpu";
import {
  Fn,
  clamp,
  color,
  exp,
  float,
  fract,
  length,
  luminance,
  mix,
  screenSize,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node, PerspectiveCamera, TextureNode } from "three/webgpu";
import { wind } from "../spine";
import type { CrossingEvent, SurfaceCrossing } from "../underwater/crossing";

type NodeF = Node<"float">;
type NodeV4 = Node<"vec4">;

const DROPLETS = 14;

export interface WetLensFxOptions {
  /** The meniscus band where the waterline crosses the lens. */
  band?: boolean;
  /** Refracting droplet streaks after an exit. */
  droplets?: boolean;
  /** The depth-keyed underwater grade. */
  grade?: boolean;
}

export class WetLensFx {
  /** Water filter at zero depth; deepens with camera depth automatically. */
  readonly tint = uniform(new Vector3(0.52, 0.78, 0.85));
  /** Meniscus band half-width in screen heights. */
  readonly bandWidth = uniform(0.016);
  /** How hard droplets bend the frame (uv units at a droplet edge). */
  readonly refraction = uniform(0.035);

  // CPU-driven state (mirrors lens.html's overlay exactly)
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

  private options: Required<WetLensFxOptions>;
  private exits = 0;
  private fwd = new Vector3();
  private probe = new Vector3();

  constructor(options: WetLensFxOptions = {}) {
    this.options = {
      band: options.band ?? true,
      droplets: options.droplets ?? true,
      grade: options.grade ?? true,
    };
  }

  /** The waterline in screen uv, wobbled by waves sliding across the glass. */
  private lineAt(x: NodeF): NodeF {
    return this.lineY
      .add(sin(x.mul(43).add(this.time.mul(2.6))).mul(this.wobble))
      .add(sin(x.mul(91).sub(this.time.mul(4.1))).mul(this.wobble.mul(0.45)));
  }

  /**
   * The whole treatment as one node: `base` is the upstream chain's color at
   * this pixel (linear HDR), `sceneTex` is the frame texture the droplets and
   * the band refract. Returns linear HDR — tone mapping and the hour grade
   * run downstream, which is exactly why refracted taps match their
   * surroundings: per-pixel grading commutes with resampling.
   */
  node(base: NodeV4, sceneTex: TextureNode): NodeV4 {
    const opts = this.options;
    return Fn(() => {
      const x = uv().x;
      const y = uv().y;
      const line = this.lineAt(x);
      const aspect = screenSize.x.div(screenSize.y);

      // ---- where the frame gets resampled: droplets + band magnification ----
      const offset = vec2(0).toVar();
      const dropMask = float(0).toVar();
      const spec = float(0).toVar();

      if (opts.droplets) {
        for (let i = 0; i < DROPLETS; i++) {
          // three hashes per droplet, reseeded per exit — zero allocations
          const h1 = fract(sin(this.seed.add(i * 17.31 + 1.7)).mul(43758.55));
          const h2 = fract(sin(this.seed.add(i * 31.77 + 9.1)).mul(27183.29));
          const h3 = fract(sin(this.seed.add(i * 11.13 + 3.3)).mul(36717.41));
          const age = this.time.sub(this.exitTime).sub(h2.mul(0.5));
          const life = h3.mul(0.9).add(1.3);
          const alive = smoothstep(float(0), float(0.04), age).mul(
            smoothstep(life, life.mul(0.55), age),
          );
          // the head slides down, accelerating as the film feeds it
          const head = float(0.95).sub(age.mul(age.mul(0.16).add(0.08)));
          const px = x.sub(h1.mul(0.9).add(0.05)).mul(aspect);
          const dy = y.sub(head);
          // the bulb: a smooth height bump; its gradient is the refraction
          const r = h2.mul(0.012).add(0.012);
          const d2 = px.mul(px).add(dy.mul(dy));
          const bulb = exp(d2.div(r.mul(r)).negate()).mul(alive);
          // the tail: a thinner ridge trailing up from the head
          const tail = h3.mul(0.12).add(0.06);
          const seg = dy.sub(clamp(dy, float(0), tail));
          const dTail = length(vec2(px.mul(2.2), seg));
          const ridge = exp(dTail.mul(dTail).div(r.mul(r).mul(0.5)).negate())
            .mul(alive)
            .mul(0.55);
          const h = bulb.add(ridge);
          // height gradient → normal → small-angle refraction offset.
          // ∂h/∂x of the gaussian is −2x/r²·h; the constants fold into one.
          const grad = vec2(px, dy).mul(h).mul(-2).div(r.mul(r).max(1e-5));
          offset.addAssign(grad.mul(this.refraction).mul(0.01));
          dropMask.assign(dropMask.max(smoothstep(0.05, 0.4, h)));
          // a glint where the bulb's slope faces the upper-left key light
          spec.addAssign(
            smoothstep(0.12, 0.55, grad.x.negate().add(grad.y)).mul(bulb).mul(0.5),
          );
        }
      }

      if (opts.band) {
        // inside the band, just below the line, the meniscus magnifies:
        // compress sample coordinates toward the line (water bends rays down)
        const below = smoothstep(this.bandWidth, this.bandWidth.negate(), y.sub(line));
        const squash = below.mul(this.splitActive.max(this.submerge)).mul(this.bandWidth).mul(2);
        offset.addAssign(vec2(0, squash));
      }

      // ---- resample the frame through the wet glass --------------------------
      const wet = sceneTex.sample(uv().add(offset));
      const colr = mix(base, wet, dropMask.max(offset.length().mul(40).clamp(0, 1))).toVar();

      // ---- the two color worlds: depth-keyed multiply grade ------------------
      if (opts.grade) {
        const belowLine = smoothstep(float(0.004), float(-0.004), y.sub(line));
        const mask = this.submerge.max(belowLine.mul(this.splitActive)).clamp(0, 1);
        // deeper camera, harder filter — red first, as always
        const deepen = vec3(
          exp(this.camDepth.mul(-0.34)),
          exp(this.camDepth.mul(-0.075)),
          exp(this.camDepth.mul(-0.03)),
        );
        const waterGrade = vec3(this.tint.x, this.tint.y, this.tint.z).mul(deepen);
        let under = colr.rgb.mul(waterGrade);
        // the medium also scatters: drained colors converge, slightly, on teal
        under = mix(under, vec3(luminance(under)).mul(vec3(0.6, 0.9, 1.0)), this.camDepth.mul(0.04).clamp(0, 0.35));
        colr.rgb.assign(mix(colr.rgb, under, mask));
        // entering: one gulp of dark as the water swallows the lens
        const flash = exp(this.time.sub(this.enterTime).max(0).mul(-5.5)).mul(0.35);
        colr.rgb.assign(mix(colr.rgb, color(0x06222d), flash.clamp(0, 1)));
      }

      if (opts.band) {
        // the dark meniscus body with a brightened core where the film lenses light
        const g = y.sub(line).div(this.bandWidth.max(1e-4));
        const bandA = exp(g.mul(g).negate()).mul(this.bandStrength);
        const core = exp(g.mul(g).mul(9).negate()).mul(this.bandStrength).mul(0.5);
        colr.rgb.assign(mix(colr.rgb, color(0x0a2832), bandA.mul(0.85)));
        colr.rgb.addAssign(color(0xbfe4ee).mul(core).mul(0.6));
      }

      if (opts.droplets) {
        colr.rgb.addAssign(color(0xdcf2fa).mul(spec));
      }

      return vec4(colr.rgb, base.a);
    })();
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

  /** Per-frame: project the waterline, sync every uniform — the same
   *  1.5 m probe-point projection lens.html derives. */
  update(camera: PerspectiveCamera, waterY: number, crossing: SurfaceCrossing, t: number): void {
    this.time.value = t;
    this.submerge.value = crossing.submergence;
    this.camDepth.value = Math.max(0, crossing.depth);
    this.bandStrength.value = crossing.proximity;
    this.splitActive.value = Math.max(0, 1 - Math.abs(crossing.depth) / 0.14);
    this.wobble.value = crossing.proximity * (0.005 + wind.speed * 0.002);

    camera.getWorldDirection(this.fwd);
    this.probe.copy(camera.position).addScaledVector(this.fwd, 1.5);
    this.probe.y = waterY;
    this.probe.project(camera);
    const ndcY = Number.isFinite(this.probe.y) ? this.probe.y : -4;
    this.lineY.value = Math.max(-1.5, Math.min(1.5, ndcY)) * 0.5 + 0.5;
  }
}
