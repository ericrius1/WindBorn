// The water as a medium — what being *inside* the lake does to light.
//
// Above the surface, distance is nearly free: air barely touches a view ray.
// Below, every meter charges the Beer–Lambert toll (the same coefficients the
// surface shader uses in depths.html), and what the absorption removes the
// water hands back as its own glow. This module owns that glow: the ambient
// color of the medium at a given depth, the fog that pulls every object
// toward it, the tint sunlight has left by the time it reaches a depth, and
// a camera-following dome that stands in for "water in every direction".

import { BackSide, Mesh, MeshBasicNodeMaterial, SphereGeometry, Vector3 } from "three/webgpu";
import { color, exp, float, mix, normalize, positionLocal, pow, smoothstep, uniform, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { beerLambert } from "../water/opticsNodes";

type NodeF = Node<"float">;
type NodeV3 = Node<"vec3">;

/** Per-channel absorption of the lake, 1/m — red dies first. Matches the
 *  coefficients the surface material uses, so the water you swim through is
 *  the water you looked into from above. */
export const UNDER_ABSORB = new Vector3(0.42, 0.09, 0.035);

/** What the medium glows near the surface (sunlit scatter)… */
export const MEDIUM_SHALLOW = 0x1d5a70;
/** …and what it fades to where no light is left. */
export const MEDIUM_DEEP = 0x041119;

/**
 * The ambient color of the water itself at `depth` meters below the surface:
 * a sunlit teal that drains toward blue-black. This is the fog color, the
 * void color, and the "what the absorption gave back" term, all one node.
 */
export function mediumColorNode(depth: NodeF): NodeV3 {
  return mix(color(MEDIUM_SHALLOW), color(MEDIUM_DEEP), smoothstep(0.0, 14.0, depth));
}

/**
 * Tint of direct sunlight after it has crossed `depth` meters of water along
 * a sun ray of vertical component `sunY` (path = depth / sunY): Beer–Lambert
 * per channel. By 3 m the sun is already green-white; by 10 m it is teal.
 */
export function sunTintAtDepth(depth: NodeF, sunY: NodeF, absorb: NodeV3): NodeV3 {
  const path = depth.div(sunY.max(0.25));
  return beerLambert(absorb, path);
}

/**
 * Underwater distance fog: pull `color` toward the medium color as the view
 * path grows. `density` is 1/m-ish; 0.06 reads as a clear mountain lake,
 * 0.25 as glacial-flour murk.
 */
export function underwaterFog(color: NodeV3, fogColor: NodeV3, dist: NodeF, density: NodeF): NodeV3 {
  const f = float(1).sub(exp(dist.mul(density).negate()));
  return mix(color, fogColor, f.clamp(0, 1));
}

/** Uniform handles a DepthDome exposes so demos can drive it per frame. */
export interface DepthDome {
  mesh: Mesh;
  /** Camera depth below the surface, meters (≥ 0). Set every frame. */
  camDepth: { value: number };
  /** Direction toward the sun (unit). Copy from the sky each frame. */
  sunDirection: { value: Vector3 };
  dispose(): void;
}

/**
 * A camera-following sphere, rendered inside-out, that *is* the water in
 * every direction the scene has no geometry: brighter toward the surface,
 * black below, with a soft warm bias toward the sun's azimuth. Demos copy
 * the camera position onto `mesh.position` each frame so the void never
 * shows an edge.
 */
export function makeDepthDome(radius = 240): DepthDome {
  const camDepth = uniform(1);
  const sunDirection = uniform(new Vector3(0.6, 0.6, 0.4));

  const geometry = new SphereGeometry(radius, 40, 20);
  const material = new MeshBasicNodeMaterial({ side: BackSide });

  const dir = normalize(positionLocal);
  const base = mediumColorNode(camDepth.add(dir.y.negate().mul(6)).max(0));
  // Looking up from depth, the ceiling glows; the glow dies as we sink.
  const upGlow = smoothstep(-0.1, 0.9, dir.y)
    .mul(exp(camDepth.mul(-0.16)))
    .mul(0.5);
  // A faint warm lobe toward the sun's azimuth — the bright side of the lake.
  const sunSide = dir.xz
    .dot(normalize(sunDirection.xz))
    .mul(0.5)
    .add(0.5)
    .pow(2)
    .mul(0.18)
    .mul(exp(camDepth.mul(-0.2)));
  material.colorNode = base.mul(upGlow.add(sunSide).add(1)).add(
    vec3(0.32, 0.5, 0.5).mul(pow(smoothstep(0.2, 1.0, dir.y), 3)).mul(exp(camDepth.mul(-0.3))),
  );

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    camDepth,
    sunDirection,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
