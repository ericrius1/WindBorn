// The lake surface — the shared material every later series floats on,
// assembled across The Mirror:
//
//   skin.html        Fresnel mix of reflection over the water body + glint
//   ripples.html     wave-table displacement and analytic normals
//   mirrorworld.html optional planar reflection, perturbed by the normal
//   depths.html      optional analytic lakebed: refraction + Beer–Lambert
//   stillwater.html  rings from the disturbance bus; the whole thing
//
// One mesh, one node material, everything optional but the skin. The CPU
// side of this surface is the spine's ambient water provider: with
// choppiness = ampScale = 1, `waterHeightAt(x, z, t)` lands exactly on the
// rendered vertices, which is what lets later series glue floating bodies
// to the water you see.
//
// The mesh expects to sit at the world origin (lake mean surface y = 0).

import { Color, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Vector3 } from "three/webgpu";
import {
  cameraPosition,
  float,
  max,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  reflect,
  refract,
  uniform,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { wind } from "../spine";
import { createWaveUniforms, waveHeightNode, waveSlopeNode, type WaveUniformInit, type WaveUniforms } from "./waveNodes";
import { beerLambert, f0FromIor, fresnelSchlick, sunGlint, WATER_IOR } from "./opticsNodes";
import type { PlanarReflection } from "./planarReflection";
import type { RippleRings } from "./rippleRings";
import type { DawnSky } from "./dawnSky";

type NodeF = Node<"float">;
type NodeV2 = Node<"vec2">;
type NodeV3 = Node<"vec3">;

/** What the water reflects and which sun makes the glints. */
export interface LakeEnvironment {
  sunDirection: DawnSky["sunDirection"];
  sunColor: DawnSky["sunColor"];
  skyColor(dir: NodeV3): NodeV3;
}

/** An analytic lakebed: world-space height (negative = below the surface)
 *  and an albedo for a point on the bed. */
export interface LakeBed {
  heightNode(xz: NodeV2): NodeF;
  colorNode(point: NodeV3): NodeV3;
}

export interface LakeSurfaceOptions {
  env: LakeEnvironment;
  /** Side length of the square surface mesh, meters. */
  size?: number;
  /** Grid segments per side. */
  segments?: number;
  /** How many table waves displace vertices (the rest live in normals). */
  vertexWaves?: number;
  /** Planar reflection; omit to reflect the analytic sky only. */
  reflection?: PlanarReflection | null;
  /** Disturbance-bus rings; omit for a bus-deaf surface. */
  rings?: RippleRings | null;
  /** Analytic lakebed; omit for opaque deep water. */
  bed?: LakeBed | null;
  /** Initial wave uniform values. */
  waves?: WaveUniformInit;
}

export class LakeSurface {
  readonly mesh: Mesh;
  readonly waves: WaveUniforms;

  /** Index of refraction (1.333 for fresh water). */
  readonly ior = uniform(WATER_IOR);
  /** Microfacet roughness for the sun glint. */
  readonly roughness = uniform(0.08);
  /** Screen-space reflection distortion per unit of normal tilt. */
  readonly distortion = uniform(0.09);
  /** Multiplies the absorption coefficients: 0 = gin-clear, larger = murk. */
  readonly clarity = uniform(1);
  /** 1 = Snell-bent view rays into the bed, 0 = naive straight-down rays. */
  readonly refraction = uniform(1);
  /** Per-channel absorption, 1/m. Red dies first. */
  readonly absorb = uniform(new Vector3(0.42, 0.09, 0.035));
  /** What scattering hands back when the path gets long: deep-water color. */
  readonly scatter = uniform(new Color(0x0a2531));

  private geometry: PlaneGeometry;
  private material: MeshBasicNodeMaterial;

  constructor(options: LakeSurfaceOptions) {
    const {
      env,
      size = 400,
      segments = 256,
      vertexWaves = 3,
      reflection = null,
      rings = null,
      bed = null,
      waves,
    } = options;

    this.waves = createWaveUniforms(waves);
    const u = this.waves;

    this.geometry = new PlaneGeometry(size, size, segments, segments);
    this.geometry.rotateX(-Math.PI / 2); // +y up; local xz == world xz at origin

    const material = new MeshBasicNodeMaterial();
    this.material = material;

    // ---- vertex: displace by the long waves (+ rings) -----------------------
    const xzLocal = positionLocal.xz;
    let height: NodeF = waveHeightNode(xzLocal, u, vertexWaves);
    if (rings) height = height.add(rings.contributionNode(xzLocal, u.time).x);
    material.positionNode = positionLocal.add(vec3(0, height, 0));

    // ---- fragment: analytic normal from the full table (+ rings) ------------
    const xz = positionWorld.xz;
    let slope: NodeV2 = waveSlopeNode(xz, u);
    if (rings) {
      const c = rings.contributionNode(xz, u.time);
      slope = slope.add(c.yz);
    }
    const normal = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));
    const view = normalize(cameraPosition.sub(positionWorld));
    const cosTheta = normal.dot(view).clamp(0, 1);
    const fresnel = fresnelSchlick(cosTheta, f0FromIor(this.ior));

    // ---- what bounces off: planar reflection or the analytic sky ------------
    let reflected: NodeV3;
    if (reflection) {
      reflected = reflection.colorNode(normal.xz.mul(this.distortion));
    } else {
      const r = reflect(view.negate(), normal);
      const skyDir = normalize(vec3(r.x, max(r.y, 0.02), r.z));
      reflected = env.skyColor(skyDir);
    }

    // ---- what comes from below: refracted bed or deep scatter ---------------
    let body: NodeV3;
    if (bed) {
      const eta = float(1).div(this.ior);
      const bent = refract(view.negate(), normal, eta);
      // The refraction slider lets depths.html switch Snell on and off.
      const down = normalize(mix(vec3(0, -1, 0), bent, this.refraction));
      const sink = max(down.y.negate(), 0.08); // vertical sink rate of the ray
      // March to the bed: first guess from the depth right here, one
      // refinement where that guess lands (the bed is gentle by contract).
      const d0 = positionWorld.y.sub(bed.heightNode(positionWorld.xz)).max(0.01);
      const t0 = d0.div(sink);
      const p1 = positionWorld.add(down.mul(t0));
      const t1 = t0.add(p1.y.sub(bed.heightNode(p1.xz)).div(sink));
      const path = t1.clamp(0.01, 200);
      const hit = positionWorld.add(down.mul(path));
      // Light the bed cheaply: overhead sky plus a sun term.
      const bedLight = env
        .skyColor(vec3(0, 1, 0))
        .mul(0.55)
        .add(env.sunColor.mul(env.sunDirection.y.clamp(0, 1)).mul(0.18));
      const bedColor = bed.colorNode(hit).mul(bedLight);
      // Beer–Lambert both ways is the honest model; one way reads better and
      // the difference is a constant the clarity slider eats anyway.
      const transmit = beerLambert(this.absorb.mul(this.clarity), path);
      body = bedColor.mul(transmit).add(this.scatter.rgb.mul(float(1).sub(transmit)));
    } else {
      body = this.scatter.rgb;
    }

    // ---- assemble the skin ---------------------------------------------------
    const glint = sunGlint(normal, view, env.sunDirection, this.roughness)
      .mul(fresnel.clamp(0.02, 1))
      .mul(env.sunColor);
    material.colorNode = mix(body, reflected, fresnel).add(glint);

    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false; // displaced verts vs. flat bounding box
  }

  /**
   * Per-frame sync: drive time and read the spine wind so the rendered
   * surface stays glued to what `waterHeightAt` reports.
   */
  update(t: number, syncWind = true): void {
    this.waves.time.value = t;
    if (syncWind) {
      this.waves.windDirection.value = wind.direction;
      this.waves.windSpeed.value = wind.speed;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
