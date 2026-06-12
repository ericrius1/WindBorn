// Expanding capillary rings from disturbance-bus events — the Mirror's
// analytic stand-in for a real fluid response (The Splash replaces the
// physics later; the bus contract stays the same).
//
// Each event becomes one ring: a narrow wave packet whose radius grows at a
// fixed phase speed, fading by time and by geometric spreading. A fixed-size
// rotating pool of rings lives in a uniform array; the surface shader loops
// over the pool and sums height + slope contributions.

import { Vector4 } from "three/webgpu";
import { Fn, Loop, cos, exp, float, length, sin, uniform, uniformArray, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import type { Disturbance } from "../spine";

type NodeF = Node<"float">;
type NodeV2 = Node<"vec2">;
type NodeV3 = Node<"vec3">;

export const MAX_RINGS = 10;

export class RippleRings {
  // Per ring: (center x, center z, birth time, amplitude in meters).
  private data = Array.from({ length: MAX_RINGS }, () => new Vector4(0, 0, -1e4, 0));
  readonly rings = uniformArray<"vec4">(this.data as unknown[], "vec4");
  private cursor = 0;

  /** Ring phase speed, m/s — capillary packets crawl, they don't race. */
  readonly speed = uniform(0.65);
  /** Crest-to-crest wavelength of the packet, meters. */
  readonly wavelength = uniform(0.45);
  /** Gaussian half-width of the packet, meters. */
  readonly width = uniform(0.55);
  /** Exponential time decay, 1/s. */
  readonly damping = uniform(0.55);

  /** Feed a disturbance-bus event into the pool at simulation time `t`. */
  add(d: Disturbance, t: number): void {
    // Energy → amplitude: a raindrop (~0.001 J) is millimeters, a fish rise
    // (~0.05) about a centimeter, a full strike (~1.0) a few centimeters.
    const amp = Math.min(0.06 * Math.sqrt(Math.max(d.energy, 0)), 0.12);
    this.data[this.cursor].set(d.x, d.z, t, amp);
    this.cursor = (this.cursor + 1) % MAX_RINGS;
  }

  /** Forget every ring (e.g. when a demo resets its clock). */
  clear(): void {
    for (const v of this.data) v.set(0, 0, -1e4, 0);
  }

  /**
   * Summed contribution at horizontal position `xz` and time `time`:
   * returns vec3(height, ∂h/∂x, ∂h/∂z). The slope is derived by hand so the
   * shader normal stays analytic, exactly like the ambient wave table.
   */
  contributionNode(xz: NodeV2, time: NodeF): NodeV3 {
    return Fn(() => {
      const acc = vec3(0).toVar();
      const k = float(Math.PI * 2).div(this.wavelength);
      const w2 = this.width.mul(this.width);
      const spreadQ = 0.6; // geometric spreading factor: 1 / (1 + q·r)

      Loop(MAX_RINGS, ({ i }) => {
        const ring = this.rings.element(i);
        // Clamp the age: a 60 s old ring is silence, and an unbounded age
        // would push the packet math into inf · 0 = NaN territory.
        const dt = time.sub(ring.z).clamp(0, 60);
        const d = xz.sub(ring.xy);
        const r = length(d).add(1e-3);
        // Wave packet centered where the ring front has reached: s = r − c·dt.
        const s = r.sub(this.speed.mul(dt));
        const env = exp(s.mul(s).negate().div(w2));
        const spread = float(1).div(r.mul(spreadQ).add(1));
        const decay = exp(dt.mul(this.damping).negate());
        const live = ring.w.mul(decay); // amplitude after time decay
        const phase = s.mul(k);
        const sinP = sin(phase);
        const h = live.mul(env).mul(sinP).mul(spread);
        // dh/dr: product rule over packet × carrier × spreading.
        const dEnv = s.mul(-2).div(w2); // env'/env
        const dhdr = live
          .mul(env)
          .mul(spread)
          .mul(cos(phase).mul(k).add(sinP.mul(dEnv)))
          .sub(h.mul(spreadQ).mul(spread));
        const dir = d.div(r);
        acc.addAssign(vec3(h, dhdr.mul(dir.x), dhdr.mul(dir.y)));
      });

      return acc;
    })();
  }
}
