// Caustics, from first principles: the rippled surface refracts the sun's
// parallel rays, and the lakebed brightness at a point is how much the
// refraction map squeezed the light that landed there.
//
// Small-slope derivation. A surface facet tilted by slope ∇h deflects the
// refracted ray from vertical by roughly (1 − 1/n)·∇h (Snell, linearized),
// so after falling `d` meters the ray lands displaced by
//
//   P(x) = x + β·∇h(x),    β = d·(1 − 1/n)
//
// Light that uniformly entered the surface now carries the density of that
// map: intensity ∝ 1 / |det J| with J = I + β·H, H the Hessian of h. Where
// neighboring rays converge, det J → 0 and the floor flares — those are the
// caustic filaments. Our wave table is a sum of sines, so H is analytic:
// no texture, no render-to-target, just second derivatives.
//
// God rays are the same number marched through the volume: the brightness a
// sun ray carries at depth is the caustic value where it entered, so shafts
// are caustics extruded along the sun direction and dimmed by Beer–Lambert.

import { AdditiveBlending, Mesh, MeshBasicNodeMaterial, PerspectiveCamera, PlaneGeometry } from "three/webgpu";
import {
  Fn,
  Loop,
  cameraPosition,
  cos,
  dot,
  float,
  fract,
  normalize,
  positionWorld,
  sin,
  step,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { BASE_AMP_PER_WIND, WAVE_TABLE, type WaveUniforms } from "../water/waveNodes";
import { beerLambert, WATER_IOR } from "../water/opticsNodes";
import type { LakeEnvironment } from "../water/lakeSurface";
import { UNDER_ABSORB } from "./medium";

type NodeF = Node<"float">;
type NodeV2 = Node<"vec2">;

/** β per meter of depth: the linearized Snell deflection gain, 1 − 1/n. */
export const BETA_PER_METER = 1 - 1 / WATER_IOR;

/**
 * Focusing factor of the refraction map at horizontal position `xz`:
 * 1 / |det(I + β·H)|, with H the analytic Hessian of the ambient wave table.
 * Returns ~1 on flat water, spikes where rays converge, dips in the dark
 * anti-caustic pools. `count` limits the table (3 is plenty for god rays).
 */
export function causticFocusNode(xz: NodeV2, u: WaveUniforms, beta: NodeF, count = WAVE_TABLE.length): NodeF {
  const base = u.windSpeed.mul(BASE_AMP_PER_WIND).mul(u.ampScale);
  let hxx: NodeF = float(0);
  let hzz: NodeF = float(0);
  let hxz: NodeF = float(0);
  const n = Math.min(count, WAVE_TABLE.length);
  for (let i = 0; i < n; i++) {
    const w = WAVE_TABLE[i];
    const k = (Math.PI * 2) / w.wavelength;
    const a = u.windDirection.add(w.angle);
    const dx = cos(a);
    const dz = sin(a);
    const phase = xz.x.mul(dx).add(xz.y.mul(dz)).mul(k).add(u.time.mul(w.speed * k));
    const cw = u.choppiness.pow(i / (WAVE_TABLE.length - 1));
    // h_i = A sin(φ)  ⇒  ∂²h/∂x² = −A·k²·dx²·sin(φ), and so on.
    const s = sin(phase).mul(w.amp * k * k).mul(cw);
    hxx = hxx.sub(s.mul(dx).mul(dx));
    hzz = hzz.sub(s.mul(dz).mul(dz));
    hxz = hxz.sub(s.mul(dx).mul(dz));
  }
  hxx = hxx.mul(base).mul(beta);
  hzz = hzz.mul(base).mul(beta);
  hxz = hxz.mul(base).mul(beta);
  const det = hxx.add(1).mul(hzz.add(1)).sub(hxz.mul(hxz));
  return float(1).div(det.abs().max(0.06));
}

/**
 * Tone-shaped caustic light: focus^sharp · gain. Multiply onto a lakebed's
 * albedo together with the depth-tinted sun color. `sharp` ≈ 1.5–2.5 thins
 * the filaments; `gain` sets how hard they burn.
 */
export function causticLightNode(xz: NodeV2, u: WaveUniforms, beta: NodeF, gain: NodeF, sharp: NodeF): NodeF {
  return causticFocusNode(xz, u, beta).pow(sharp).mul(gain);
}

export interface GodRayOptions {
  /** Shared wave uniforms — the same table that lights the bed. */
  waves: WaveUniforms;
  /** The scene's sun (the dawn sky's uniforms work directly). */
  env: Pick<LakeEnvironment, "sunDirection" | "sunColor">;
  /** Raymarch steps (16 holds 60 fps comfortably). */
  steps?: number;
  /** How far along the view ray to march, meters. */
  maxDist?: number;
}

/**
 * Screen-space god rays: a full-screen quad parented to the camera that
 * marches each view ray through the water, accumulating the caustic value at
 * each sample's sun-entry point, Beer–Lambert-dimmed by the sun path and the
 * view path. Additive — render order keeps it above the scene.
 *
 * The scene MUST contain the camera (`scene.add(camera)`) for the quad to
 * render. Call `dispose()` when done.
 */
export class GodRayScreen {
  readonly mesh: Mesh;
  /** Overall shaft brightness. */
  readonly gain = uniform(0.045);
  /** Filament sharpening exponent for the marched caustic. */
  readonly sharp = uniform(1.35);
  /** View-path extinction added on top of the sun-path toll, 1/m. */
  readonly extinction = uniform(0.5);

  private geometry: PlaneGeometry;
  private material: MeshBasicNodeMaterial;
  private absorb = uniform(UNDER_ABSORB.clone());

  constructor(camera: PerspectiveCamera, options: GodRayOptions) {
    const { waves: u, env, steps = 16, maxDist = 14 } = options;

    this.geometry = new PlaneGeometry(1, 1);
    const material = new MeshBasicNodeMaterial({
      transparent: true,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.material = material;

    material.colorNode = Fn(() => {
      const sum = vec3(0).toVar();
      // The quad rides the near plane, so fragment world position minus the
      // camera position IS the per-pixel view ray. No basis uniforms needed.
      const rd = normalize(positionWorld.sub(cameraPosition));
      const jitter = fract(sin(dot(uv(), vec2(12.9898, 78.233))).mul(43758.5453));
      const stepLen = maxDist / steps;
      Loop(steps, ({ i }) => {
        const s = float(i).add(jitter).mul(stepLen);
        const p = cameraPosition.add(rd.mul(s));
        const under = step(p.y, float(0)); // 1 only below the surface
        const depth = p.y.negate().max(0.0);
        const sunY = env.sunDirection.y.max(0.18);
        // Sun ray through p entered the surface here:
        const entry = p.xz.add(env.sunDirection.xz.mul(depth.div(sunY)));
        const beta = depth.mul(BETA_PER_METER);
        const bright = causticFocusNode(entry, u, beta, 3).pow(this.sharp);
        // Toll: sun path down to p, plus the view path back to the camera.
        const tint = beerLambert(this.absorb, depth.div(sunY).add(s.mul(this.extinction)));
        sum.addAssign(tint.mul(bright).mul(under).mul(stepLen));
      });
      return sum.mul(this.gain).mul(env.sunColor);
    })();

    this.mesh = new Mesh(this.geometry, material);
    this.mesh.renderOrder = 90;
    this.mesh.frustumCulled = false;

    // Size the quad to exactly fill the frustum at half a meter out.
    const d = Math.max(camera.near * 2, 0.5);
    const h = 2 * d * Math.tan(((camera.fov / 2) * Math.PI) / 180);
    this.mesh.position.set(0, 0, -d);
    this.mesh.scale.set(h * camera.aspect, h, 1);
    camera.add(this.mesh);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
