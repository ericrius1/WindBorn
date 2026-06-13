// The composed surface: one mesh that renders BOTH the live simulation and
// the ambient lake around it, with no seam anywhere — the visual half of
// the provider swap in ./provider.ts.
//
// Geometry: a single "graded sheet". The core is a uniform lattice that
// matches the sim grid one-to-one; outside the core, column and row spacing
// grows geometrically out to `extent` meters. One index buffer, no
// T-junctions, no cracks. The mesh rides the sim window (snapped to whole
// cells), so core vertices always sit exactly on sim samples.
//
// Shading: the same optics recipe as The Mirror's LakeSurface — ambient
// wave-table displacement and analytic slopes (src/lib/water/waveNodes),
// Fresnel over a deep-water body, sun glint (src/lib/water/opticsNodes) —
// plus three Splash additions: the sim height (faded by the window blend),
// the foam channel, and an optional Beer–Lambert depth tint read from the
// sim's own bathymetry buffer.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshBasicNodeMaterial,
  Vector3,
} from "three/webgpu";
import {
  cameraPosition,
  float,
  max,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  reflect,
  smoothstep,
  uniform,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { wind } from "../spine";
import type { LakeEnvironment } from "../water";
import {
  beerLambert,
  createWaveUniforms,
  f0FromIor,
  fresnelSchlick,
  sunGlint,
  WATER_IOR,
  waveHeightNode,
  waveSlopeNode,
  type WaveUniformInit,
} from "../water";
import type { FluidSim } from "./sim";

type NodeV3 = Node<"vec3">;

/**
 * One axis of the graded sheet: uniform spacing `s` across [-coreHalf,
 * coreHalf], then geometric growth out to ±extent.
 */
function gradedAxis(coreHalf: number, cells: number, extent: number, growth: number): number[] {
  const s = (coreHalf * 2) / cells;
  const core: number[] = [];
  for (let i = 0; i <= cells; i++) core.push(-coreHalf + i * s);
  const outer: number[] = [];
  let pos = coreHalf;
  let w = s;
  while (pos < extent) {
    w *= growth;
    pos = Math.min(pos + w, extent);
    outer.push(pos);
  }
  const neg = outer.map((v) => -v).reverse();
  return [...neg, ...core, ...outer];
}

/** A flat indexed grid over the cross product of two coordinate arrays. */
export function makeGradedSheetGeometry(
  coreSize: number,
  coreCells: number,
  extent: number,
  growth = 1.45,
): BufferGeometry {
  const axis = gradedAxis(coreSize / 2, coreCells, Math.max(extent, coreSize / 2), growth);
  const n = axis.length;
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  let p = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      positions[p] = axis[i];
      positions[p + 2] = axis[j];
      normals[p + 1] = 1;
      p += 3;
    }
  }
  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let q = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n + 1;
      const d = a + n;
      indices[q++] = a;
      indices[q++] = c;
      indices[q++] = b;
      indices[q++] = a;
      indices[q++] = d;
      indices[q++] = c;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("normal", new BufferAttribute(normals, 3));
  geo.setIndex(new BufferAttribute(indices, 1));
  return geo;
}

export interface SimSurfaceOptions {
  env: LakeEnvironment;
  /** How far the ambient apron reaches beyond the window, meters. Default
   *  1200. Pass 0 for a bare sim-sized patch (tank demos). */
  extent?: number;
  /** Geometric growth of quad size outside the core. Default 1.45. */
  growth?: number;
  /** Table waves that displace vertices (rest live in normals). Default 3. */
  vertexWaves?: number;
  /** Initial wave uniforms (wind speed/direction/choppiness/amp). */
  waves?: WaveUniformInit;
  /** Shade the body by Beer–Lambert over the sim's depth buffer. */
  depthTint?: boolean;
}

export class SimSurface {
  readonly mesh: Mesh;
  readonly waves;

  readonly ior = uniform(WATER_IOR);
  readonly roughness = uniform(0.08);
  /** Per-channel absorption, 1/m (depthTint only). */
  readonly absorb = uniform(new Vector3(0.42, 0.09, 0.035));
  readonly clarity = uniform(1);
  readonly scatter = uniform(new Color(0x0a2531));
  readonly bedColor = uniform(new Color(0x8a7c5a));
  readonly foamColor = uniform(new Color(0xdfeef4));
  /** 1 = draw a diagnostic ring where the blend rim sits. */
  readonly showWindow = uniform(0);

  private readonly geometry: BufferGeometry;
  private readonly material: MeshBasicNodeMaterial;

  constructor(private readonly sim: FluidSim, options: SimSurfaceOptions) {
    const {
      env,
      extent = 1200,
      growth = 1.45,
      vertexWaves = 3,
      waves,
      depthTint = false,
    } = options;

    this.waves = createWaveUniforms(waves);
    const u = this.waves;

    this.geometry = makeGradedSheetGeometry(sim.worldSize, sim.res - 1, extent, growth);

    const material = new MeshBasicNodeMaterial();
    this.material = material;

    // ---- vertex: ambient waves + faded sim height ---------------------------
    const worldXZ = positionLocal.xz.add(sim.centerUniform);
    const fade = sim.fadeNode(worldXZ);
    const field = sim.fieldNode(worldXZ);
    const height = waveHeightNode(worldXZ, u, vertexWaves).add(field.x.mul(fade));
    material.positionNode = positionLocal.add(vec3(0, height, 0));

    // Sim slope, foam and fade ride to the fragment stage as varyings (the
    // sim has no detail between lattice points, so interpolation is exact
    // enough; ambient slopes stay analytic per fragment, like LakeSurface).
    const simSlope = sim.slopeNode(worldXZ).mul(fade);
    const vSim = varying(vec4(simSlope.x, simSlope.y, field.w.mul(fade), fade));

    // ---- fragment: the Mirror's skin over the composed slope ----------------
    const slope = waveSlopeNode(positionWorld.xz, u).add(vSim.xy);
    const normal = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));
    const view = normalize(cameraPosition.sub(positionWorld));
    const cosTheta = normal.dot(view).clamp(0, 1);
    const fresnel = fresnelSchlick(cosTheta, f0FromIor(this.ior));

    const r = reflect(view.negate(), normal);
    const skyDir = normalize(vec3(r.x, max(r.y, 0.02), r.z));
    const reflected = env.skyColor(skyDir);

    let body: NodeV3;
    if (depthTint) {
      const d = sim.depthNode(positionWorld.xz);
      // Down to the bed and back, with a refraction-ish path stretch.
      const path = d.mul(2.2).add(0.05);
      const transmit = beerLambert(this.absorb.mul(this.clarity), path);
      const bedLight = env
        .skyColor(vec3(0, 1, 0))
        .mul(0.55)
        .add(env.sunColor.mul(env.sunDirection.y.clamp(0, 1)).mul(0.18));
      body = this.bedColor.rgb.mul(bedLight).mul(transmit).add(this.scatter.rgb.mul(float(1).sub(transmit)));
    } else {
      body = this.scatter.rgb;
    }

    const glint = sunGlint(normal, view, env.sunDirection, this.roughness)
      .mul(fresnel.clamp(0.02, 1))
      .mul(env.sunColor);

    const foamMask = smoothstep(0.05, 0.5, vSim.z).mul(0.92);
    const foamLight = env.skyColor(vec3(0, 1, 0)).mul(0.85).add(env.sunColor.mul(0.05));
    let color: NodeV3 = mix(body, reflected, fresnel).add(glint.mul(float(1).sub(foamMask)));
    color = mix(color, this.foamColor.rgb.mul(foamLight), foamMask);

    // Diagnostic rim: paint the blend band when showWindow = 1.
    const rim = smoothstep(0.01, 0.1, vSim.w).mul(float(1).sub(smoothstep(0.45, 0.95, vSim.w)));
    color = mix(color, vec3(1.0, 0.55, 0.25), rim.mul(this.showWindow).mul(0.5));
    material.colorNode = color;

    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
  }

  /**
   * Per-frame sync: drive wave time, read the spine wind, and keep the
   * sheet centered on the sim window. Call after sim.moveTo()/step().
   */
  update(t: number, syncWind = true): void {
    this.waves.time.value = t;
    if (syncWind) {
      this.waves.windDirection.value = wind.direction;
      this.waves.windSpeed.value = wind.speed;
    }
    this.mesh.position.set(this.sim.center.x, 0, this.sim.center.y);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
