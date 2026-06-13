// The cloud layer: raymarched cumulus living in a slab of air between `base`
// and `top`, drawn on the inside of a dome and marched per fragment
// (clouds.html derives every term).
//
// The recipe:
//   density  — 3D value-noise fBm shaped by a vertical profile (flat-ish
//              base, domed top), thresholded by `coverage`, edges eroded by
//              a second, finer fBm. SDF-style field math — fine in shaders;
//              the no-SDF house rule is about character geometry.
//   march    — the view ray's slab crossing is split into N steps; each step
//              attenuates by Beer–Lambert e^(−σ·ρ·Δt) and adds in-scattered
//              sun and sky in proportion to what it absorbed.
//   light    — a short secondary march toward the sun gives self-shadowing;
//              the "powder" term re-brightens thin edges (multiple
//              scattering's cheapest impersonation).
//   phase    — two Henyey–Greenstein lobes (forward + back) plus a narrow
//              forward spike: the silver lining.
//
// Budget: steps and light steps are compile-time constants per instance;
// a per-pixel jitter (blue-ish noise from a hash) trades banding for grain.
// Heroes that want full-window glory render at reduced internal resolution
// instead of more steps — explained in the essay, visible in the readout.
//
// The drift offset is integrated on the CPU from the SPINE wind field,
// sampled at cloud altitude — the same field that ripples the lake and
// lifts the bird. One wind, one weather.

import { BackSide, Color, Mesh, MeshBasicNodeMaterial, SphereGeometry, Vector2, Vector3 } from "three/webgpu";
import {
  Break,
  Fn,
  If,
  Loop,
  cameraPosition,
  dot,
  exp,
  float,
  mix,
  normalize,
  positionWorld,
  pow,
  rand,
  screenUV,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { wind } from "../spine";
import { fbm3 } from "./noise3";

type NodeF = Node<"float">;
type NodeV3 = Node<"vec3">;

export interface CloudLayerOptions {
  /** Bottom of the cloud slab, meters. */
  base?: number;
  /** Top of the cloud slab, meters. */
  top?: number;
  /** Primary march steps (compile-time). 16 is budget, 24 is pretty. */
  steps?: number;
  /** Secondary (light) march steps (compile-time). */
  lightSteps?: number;
  /** Furthest slab entry distance still marched, meters. */
  maxDist?: number;
  /** Dome radius for makeDome(). */
  domeRadius?: number;
  /** Feature size of the large shape noise, meters. */
  shapeScale?: number;
  /** Feature size of the erosion noise, meters. */
  detailScale?: number;
  /** Skip all lighting: accumulate plain white density (teaching mode). */
  unlit?: boolean;
}

export class CloudLayer {
  /** 0 = empty sky, 1 = overcast deck. */
  readonly coverage = uniform(0.42);
  /** How aggressively the fine noise eats the edges (0..1). */
  readonly erode = uniform(0.42);
  /** Extinction coefficient σ, 1/m, at full density. */
  readonly sigma = uniform(0.028);
  /** World-space drift, integrated from the spine wind. */
  readonly drift = uniform(new Vector2(0, 0));
  /** Light: direction TOWARD the brightest body, and its HDR color. */
  readonly sunDirection = uniform(new Vector3(0.3, 0.8, 0.2));
  readonly sunColor = uniform(new Color(3.2, 3.05, 2.9));
  /** Skylight reaching the slab (the hemisphere fill). */
  readonly ambient = uniform(new Color(0.35, 0.42, 0.55));
  /** Slab bounds as live uniforms (sliders may move them). */
  readonly base = uniform(650);
  readonly top = uniform(1500);

  readonly steps: number;
  readonly lightSteps: number;

  private readonly maxDist: number;
  private readonly domeRadius: number;
  private readonly shapeScale: number;
  private readonly detailScale: number;
  private readonly unlit: boolean;
  private domes: Mesh[] = [];
  private windSample = new Vector3();

  constructor(options: CloudLayerOptions = {}) {
    this.base.value = options.base ?? 650;
    this.top.value = options.top ?? 1500;
    this.steps = options.steps ?? 20;
    this.lightSteps = options.lightSteps ?? 4;
    this.maxDist = options.maxDist ?? 9000;
    // Slightly inside the atmosphere's default dome (3800), so the
    // transparent march never depth-ties with the opaque sky behind it.
    this.domeRadius = options.domeRadius ?? 3600;
    this.shapeScale = options.shapeScale ?? 430;
    this.detailScale = options.detailScale ?? 92;
    this.unlit = options.unlit ?? false;
  }

  /**
   * Cloud density at a world point, 0..1. `detailed` adds the erosion pass
   * (the light march runs the cheap version).
   */
  densityNode(p: NodeV3, detailed: boolean): NodeF {
    const q = vec3(p.x.add(this.drift.x), p.y, p.z.add(this.drift.y));
    const thickness = this.top.sub(this.base).max(1);
    const hf = p.y.sub(this.base).div(thickness).clamp(0, 1);

    // Vertical profile: hard floor at the condensation level (cumulus bases
    // are flat because that's the altitude where rising air saturates),
    // soft dome above.
    const profile = smoothstep(0.0, 0.1, hf).mul(smoothstep(1.0, 0.42, hf));

    // Large shapes: 3-octave fBm, slightly squashed vertically so puffs are
    // wider than tall, the way fair-weather cumulus actually sit.
    const shape = fbm3(vec3(q.x, q.y.mul(1.6), q.z).mul(1 / this.shapeScale), 3, 7);

    // Coverage as a threshold: density is what pokes above (1 − coverage).
    let d: NodeF = shape
      .mul(profile)
      .sub(this.coverage.oneMinus())
      .div(this.coverage.max(0.08));

    if (detailed) {
      // Erosion: subtract fine noise, weighted toward the edges (low d), so
      // cores stay solid while rims go cauliflower.
      const det = fbm3(q.mul(1 / this.detailScale), 2, 91);
      d = d.sub(det.mul(this.erode).mul(d.clamp(0, 1).oneMinus()));
    }
    return d.clamp(0, 1);
  }

  /** Light surviving the path from `p` toward the sun (the secondary march),
   *  with the powder term folded in. */
  private lightEnergyNode(p: NodeV3): NodeF {
    const stepL = this.top.sub(this.base).div(this.lightSteps);
    // Clouds below the light's horizon still catch sky light via `ambient`;
    // clamping keeps the march pointed sensibly upward at dawn/dusk.
    const ld = vec3(this.sunDirection.x, this.sunDirection.y.max(0.12), this.sunDirection.z);
    let tau: NodeF = float(0);
    for (let i = 1; i <= this.lightSteps; i++) {
      const lp = p.add(ld.mul(stepL.mul(i)));
      tau = tau.add(this.densityNode(lp, false).mul(stepL).mul(this.sigma));
    }
    const beer = exp(tau.negate());
    const powder = exp(tau.mul(-2)).oneMinus();
    return mix(beer, beer.mul(powder), 0.55);
  }

  /** The full march: vec4(rgb, alpha) for a fragment on the dome. */
  marchNode(): Node<"vec4"> {
    const steps = this.steps;
    return Fn(() => {
      const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
      const lightAcc = vec3(0).toVar();
      const trans = float(1).toVar();
      const entry = float(0).toVar();

      If(dir.y.greaterThan(0.015), () => {
        const t0 = this.base.sub(cameraPosition.y).div(dir.y).max(0).toVar();
        const t1 = this.top.sub(cameraPosition.y).div(dir.y).min(this.maxDist).toVar();
        entry.assign(t0);

        If(t1.greaterThan(t0), () => {
          const dt = t1.sub(t0).div(steps).toVar();
          // Per-pixel jitter hides the step count as grain, not banding.
          const t = t0.add(rand(screenUV).mul(dt)).toVar();

          // Phase functions depend only on the ray, so they hoist out.
          const cosT = dot(dir, this.sunDirection);
          const hg = (g: number): NodeF => {
            const g2 = g * g;
            return float((1 - g2) * 0.25).div(pow(float(1 + g2).sub(cosT.mul(2 * g)).max(1e-4), 1.5));
          };
          // Forward + back lobes, plus the narrow spike that makes rims
          // blaze when the sun stands behind the cloud: the silver lining.
          const phase = hg(0.55).mul(0.65).add(hg(-0.25).mul(0.35)).add(hg(0.94).mul(0.7));

          Loop(steps, () => {
            const p = cameraPosition.add(dir.mul(t)).toVar();
            const den = this.densityNode(p, true).toVar();
            If(den.greaterThan(0.004), () => {
              const stepT = exp(den.mul(this.sigma).mul(dt).negate());
              const absorbed = trans.mul(stepT.oneMinus());
              if (this.unlit) {
                lightAcc.addAssign(vec3(1, 1, 1).mul(absorbed));
              } else {
                const hf = p.y.sub(this.base).div(this.top.sub(this.base)).clamp(0, 1);
                const sun = this.sunColor.rgb.mul(this.lightEnergyNode(p)).mul(phase);
                const sky = this.ambient.rgb.mul(hf.mul(0.65).add(0.35));
                lightAcc.addAssign(sun.add(sky).mul(absorbed));
              }
              trans.mulAssign(stepT);
            });
            t.addAssign(dt);
            If(trans.lessThan(0.02), () => {
              Break();
            });
          });
        });
      });

      // Un-premultiply against the TRUE coverage first, then fade the alpha
      // by entry distance so distant clouds sink into the haze (dividing by
      // the faded alpha would brighten exactly the clouds meant to vanish).
      const cover = trans.oneMinus();
      const rgb = lightAcc.div(cover.max(1e-3));
      const fade = exp(entry.div(3600).negate());
      return vec4(rgb, cover.mul(fade));
    })();
  }

  /** A BackSide dome carrying the march. Add it to the scene after the sky
   *  dome (it blends over whatever is behind). */
  makeDome(): Mesh {
    const geometry = new SphereGeometry(this.domeRadius, 32, 16);
    const material = new MeshBasicNodeMaterial({ side: BackSide });
    const res = this.marchNode();
    material.colorNode = res.rgb;
    material.opacityNode = res.a;
    material.transparent = true;
    material.depthWrite = false;
    material.fog = false;
    const mesh = new Mesh(geometry, material);
    mesh.renderOrder = 2; // after opaque sky dome, before nothing in particular
    this.domes.push(mesh);
    return mesh;
  }

  /**
   * Advect the layer on the spine wind, sampled at mid-slab altitude. Call
   * once per frame with the simulation time and dt in seconds.
   */
  update(dt: number, t: number): void {
    const mid = (this.base.value + this.top.value) * 0.5;
    wind.sample(0, mid, 0, t, this.windSample);
    // Drift opposes the sample sign-wise: density looks up p + drift, so
    // moving the FIELD with the wind means subtracting wind motion here.
    this.drift.value.x -= this.windSample.x * dt;
    this.drift.value.y -= this.windSample.z * dt;
  }

  /** Convenience: copy light + ambient from palette-ish values. */
  setLight(sunDir: Vector3, sunColor: Color, ambient: Color): void {
    this.sunDirection.value.copy(sunDir);
    this.sunColor.value.copy(sunColor);
    this.ambient.value.copy(ambient);
  }

  dispose(): void {
    for (const d of this.domes) {
      d.geometry.dispose();
      (d.material as MeshBasicNodeMaterial).dispose();
    }
    this.domes.length = 0;
  }
}
