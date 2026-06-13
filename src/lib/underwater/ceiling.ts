// The surface seen from below — the ceiling of the underwater world.
//
// Same plane, same wave table, opposite physics. From above, the surface is
// mostly mirror (Fresnel favors reflection toward grazing angles). From
// below, the roles invert hard: view rays within the critical angle of
// vertical refract OUT into the sky — the whole 180° of sky compressed into
// a ~97° cone, Snell's window — and beyond that angle there is no transmitted
// solution at all. Total internal reflection: the underside of the lake is a
// perfect mirror showing the world below back to itself.
//
//   sin θc = 1 / n     →     θc = asin(1/1.333) ≈ 48.6°
//
// The mesh is the same kind of displaced plane LakeSurface uses (so the two
// surfaces agree vertex-for-vertex when a camera crosses between them), but
// rendered BackSide: visible only from underneath.

import { BackSide, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Vector4 } from "three/webgpu";
import {
  Fn,
  Loop,
  cameraPosition,
  dot,
  float,
  length,
  max,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  refract,
  step,
  uniform,
  uniformArray,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import {
  createWaveUniforms,
  waveHeightNode,
  waveSlopeNode,
  type WaveUniformInit,
  type WaveUniforms,
} from "../water/waveNodes";
import { fresnelExact, WATER_IOR } from "../water/opticsNodes";
import type { LakeEnvironment } from "../water/lakeSurface";
import type { RippleRings } from "../water/rippleRings";
import { wind } from "../spine";
import { mediumColorNode, underwaterFog } from "./medium";

type NodeF = Node<"float">;
type NodeV2 = Node<"vec2">;
type NodeV3 = Node<"vec3">;

/** Critical angle in radians for refractive index n: asin(1/n). */
export function criticalAngle(ior = WATER_IOR): number {
  return Math.asin(1 / ior);
}

/** Radius of Snell's window on the surface above a point `depth` meters
 *  down: r = depth · tan θc (≈ 1.13 · depth for water). */
export function windowRadius(depth: number, ior = WATER_IOR): number {
  return depth * Math.tan(criticalAngle(ior));
}

export const MAX_MARKERS = 6;

export interface SurfaceCeilingOptions {
  env: LakeEnvironment;
  /** Side length of the square ceiling mesh, meters. */
  size?: number;
  /** Grid segments per side. */
  segments?: number;
  /** How many table waves displace vertices (normals always use all). */
  vertexWaves?: number;
  /** Disturbance-bus rings perturbing the underside, or null. */
  rings?: RippleRings | null;
  /** Up to MAX_MARKERS glowing points below the surface whose total-internal
   *  reflections the mirror region shows: (x, y, z, glow gain), y < 0. */
  markers?: Vector4[] | null;
  /** Initial wave uniform values. */
  waves?: WaveUniformInit;
}

export class SurfaceCeiling {
  readonly mesh: Mesh;
  readonly waves: WaveUniforms;

  /** Index of refraction; the critical angle follows it: asin(1/n). */
  readonly ior = uniform(WATER_IOR);
  /** Underwater extinction for the fog toward the ceiling, 1/m. */
  readonly turbidity = uniform(0.05);
  /** Multiplies the sky seen through the window. */
  readonly windowGain = uniform(1);
  /** Multiplies the mirrored glow outside the window. */
  readonly mirrorGain = uniform(1);

  private geometry: PlaneGeometry;
  private material: MeshBasicNodeMaterial;
  private markerData: Vector4[] | null = null;

  constructor(options: SurfaceCeilingOptions) {
    const {
      env,
      size = 200,
      segments = 160,
      vertexWaves = 3,
      rings = null,
      markers = null,
      waves,
    } = options;

    this.waves = createWaveUniforms(waves);
    const u = this.waves;

    this.geometry = new PlaneGeometry(size, size, segments, segments);
    this.geometry.rotateX(-Math.PI / 2); // +y up; rendered BackSide = from below

    const material = new MeshBasicNodeMaterial({ side: BackSide });
    this.material = material;

    // ---- vertex: identical displacement to the topside surface ---------------
    let height: NodeF = waveHeightNode(positionLocal.xz, u, vertexWaves);
    if (rings) height = height.add(rings.contributionNode(positionLocal.xz, u.time).x);
    material.positionNode = positionLocal.add(vec3(0, height, 0));

    // ---- fragment ------------------------------------------------------------
    const xz = positionWorld.xz;
    let slope: NodeV2 = waveSlopeNode(xz, u);
    if (rings) slope = slope.add(rings.contributionNode(xz, u.time).yz);
    const nUp = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));

    // The ray travels from the camera UP to this point on the underside.
    const incident = normalize(positionWorld.sub(cameraPosition));
    const nDown = nUp.negate();

    // Water → air: eta = n. Inside the critical angle this is the exit
    // direction into the sky; beyond it refract() returns the zero vector.
    const bent = refract(incident, nDown, this.ior);
    const inWindow = step(1e-4, dot(bent, bent));
    // Where TIR zeroes the vector, substitute straight-up so the normalize
    // below never sees a zero (NaN × 0 is still NaN — mix can't save us).
    const exitDir = normalize(mix(vec3(0, 1, 0), bent, inWindow));

    // Reflectance for the water-side ray. Reciprocity: the fraction reflected
    // at internal angle θw equals the air-side Fresnel at the conjugate angle
    // θa — and cos θa is just the exit direction's vertical component. As the
    // ray approaches the critical angle, θa → 90° and F → 1: the window dims
    // smoothly into the mirror instead of cutting.
    const fresnel = fresnelExact(exitDir.y.clamp(0, 1), this.ior);
    const transmitShare = float(1).sub(fresnel).mul(inWindow);

    // ---- through the window: the sky, compressed ------------------------------
    const sky = env.skyColor(exitDir);
    const sunAmt = dot(exitDir, env.sunDirection).clamp(0, 1);
    const sunImage = pow(sunAmt, 750).mul(2.2).add(pow(sunAmt, 24).mul(0.22));
    const windowColor = sky.add(env.sunColor.mul(sunImage)).mul(this.windowGain);

    // ---- outside the window: the mirror ---------------------------------------
    const mirrored = reflect(incident, nDown); // heads back down into the lake
    const camDepth = cameraPosition.y.negate().max(0.05);
    const lookDownDepth = camDepth.add(mirrored.y.negate().clamp(0, 1).mul(9));
    let mirrorColor: NodeV3 = mediumColorNode(lookDownDepth).mul(this.mirrorGain);
    if (markers) {
      this.markerData = markers.slice(0, MAX_MARKERS);
      while (this.markerData.length < MAX_MARKERS) this.markerData.push(new Vector4(0, -1, 0, 0));
      const arr = uniformArray<"vec4">(this.markerData as unknown[], "vec4");
      const glow = Fn(() => {
        const acc = vec3(0).toVar();
        Loop(MAX_MARKERS, ({ i }) => {
          const m = arr.element(i);
          // The flat-mirror image of a point at (x, −d, z) sits at (x, +d, z);
          // the mirror shows it where the reflected ray points at the image.
          const image = vec3(m.x, m.y.negate(), m.z);
          const toImage = image.sub(positionWorld);
          const dist = length(toImage).add(1e-3);
          const align = dot(mirrored, toImage.div(dist)).clamp(0, 1);
          const sharp = dist.mul(dist).mul(700).clamp(300, 30000);
          const spot = pow(align, sharp).mul(m.w).div(dist.mul(0.18).add(1));
          acc.addAssign(vec3(0.62, 0.92, 1.0).mul(spot));
        });
        return acc;
      })();
      mirrorColor = mirrorColor.add(glow.mul(this.mirrorGain));
    }

    // ---- assemble + underwater fog --------------------------------------------
    const combined = windowColor
      .mul(transmitShare)
      .add(mirrorColor.mul(float(1).sub(transmitShare)));
    const dist = length(positionWorld.sub(cameraPosition));
    const fogColor = mediumColorNode(camDepth.mul(0.6));
    material.colorNode = underwaterFog(combined, fogColor, dist, max(this.turbidity, 0.001));

    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
  }

  /** Move marker `i` (markers must have been passed at construction). */
  setMarker(i: number, x: number, y: number, z: number, gain: number): void {
    this.markerData?.[i]?.set(x, y, z, gain);
  }

  /** Per-frame sync — drive with the same t as the topside surface so the
   *  two meshes stay glued vertex-for-vertex through a crossing. */
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
