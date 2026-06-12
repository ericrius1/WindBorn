// The optics of the air–water interface, as TSL nodes. Three ideas, each
// derived in The Mirror's essays:
//
//   · Fresnel reflectance — how much light bounces off the surface instead of
//     entering it, as a function of view angle (skin.html);
//   · Beer–Lambert transmittance — how light dies, channel by channel, along
//     a path through the water (depths.html);
//   · the sun glint — a bare-bones microfacet specular for the glitter path
//     (skin.html).
//
// Everything is a pure function of nodes, so demos can feed uniforms or
// constants and the same math lands in every material on the site.

import { dot, exp, float, max, pow, reflect, sqrt, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

type NodeF = Node<"float">;
type NodeV3 = Node<"vec3">;

/** Index of refraction of fresh water. Air is 1 by definition. */
export const WATER_IOR = 1.333;

/**
 * Normal-incidence reflectance from the index of refraction:
 *   F₀ = ((n − 1) / (n + 1))²
 * Water's n = 1.333 gives F₀ ≈ 0.0204 — looking straight down, only ~2% of
 * the light reflects.
 */
export function f0FromIor(ior: NodeF): NodeF {
  const r = ior.sub(1).div(ior.add(1));
  return r.mul(r);
}

/**
 * Schlick's approximation of unpolarized Fresnel reflectance:
 *   F(θ) = F₀ + (1 − F₀)(1 − cos θ)⁵
 * `cosTheta` is the cosine of the angle between the surface normal and the
 * direction to the eye, already clamped to [0, 1].
 */
export function fresnelSchlick(cosTheta: NodeF, f0: NodeF): NodeF {
  const m = float(1).sub(cosTheta).clamp(0, 1);
  return f0.add(float(1).sub(f0).mul(pow(m, 5)));
}

/**
 * The exact unpolarized dielectric Fresnel reflectance, for comparing against
 * Schlick in the skin essay. Light arrives from air (n₁ = 1) into a medium of
 * index `ior` (n₂):
 *   sin θt = sin θi / n            (Snell)
 *   Rs = ((cos θi − n cos θt) / (cos θi + n cos θt))²
 *   Rp = ((cos θt − n cos θi) / (cos θt + n cos θi))²
 *   F  = (Rs + Rp) / 2
 */
export function fresnelExact(cosTheta: NodeF, ior: NodeF): NodeF {
  const c1 = cosTheta.clamp(0, 1);
  const sin2t = float(1).sub(c1.mul(c1)).div(ior.mul(ior));
  const c2 = sqrt(max(float(1).sub(sin2t), 0));
  const nC2 = ior.mul(c2);
  const nC1 = ior.mul(c1);
  const rs = c1.sub(nC2).div(c1.add(nC2));
  const rp = c2.sub(nC1).div(c2.add(nC1));
  return rs.mul(rs).add(rp.mul(rp)).mul(0.5);
}

/**
 * Beer–Lambert transmittance along a path of length `dist` meters through
 * water with per-channel absorption coefficients `absorb` (units 1/m):
 *   T = e^(−a · d), per channel.
 * Red has the largest coefficient, so it dies first — which is the whole
 * story of why deep water is blue-green.
 */
export function beerLambert(absorb: NodeV3, dist: NodeF): NodeV3 {
  const a = absorb.mul(dist).negate();
  return vec3(exp(a.x), exp(a.y), exp(a.z));
}

/**
 * The sun glint: a Phong-lobe stand-in for a microfacet distribution. The
 * surface is treated as a field of tiny mirrors whose slopes spread with
 * roughness; the lobe exponent comes from the classic mapping
 *   s = 2 / r² − 2
 * so r → 0 gives a near-delta mirror spike and larger r smears the glint
 * into the long glitter path. Returns a scalar intensity; multiply by the
 * sun color (HDR) outside.
 */
export function sunGlint(normal: NodeV3, view: NodeV3, sunDir: NodeV3, roughness: NodeF): NodeF {
  const r2 = max(roughness.mul(roughness), 1e-4);
  const shininess = float(2).div(r2).sub(2).max(2);
  const r = reflect(view.negate(), normal);
  const a = dot(r, sunDir).clamp(0, 1);
  // Cheap energy compensation: sharper lobes concentrate the same light into
  // fewer pixels, so they should peak brighter.
  const gain = shininess.mul(0.02).add(0.4);
  return pow(a, shininess).mul(gain);
}

/**
 * Deep-water phase speed of a surface wave of wavelength λ, the dispersion
 * relation used in ripples.html (CPU twin lives in the essays' demos):
 *   c(λ) = √(gλ/2π + 2πσ/(ρλ))
 * Gravity carries the long waves, surface tension (σ ≈ 0.072 N/m) carries
 * the short capillary ones; the slowest wave sits near λ ≈ 1.7 cm.
 */
export function phaseSpeed(wavelength: NodeF): NodeF {
  const g = 9.81;
  const sigmaOverRho = 0.072 / 1000;
  const twoPi = Math.PI * 2;
  const grav = wavelength.mul(g / twoPi);
  const cap = float(twoPi * sigmaOverRho).div(wavelength);
  return sqrt(grav.add(cap));
}

/** CPU twin of `phaseSpeed`, for slider readouts. */
export function phaseSpeedCpu(wavelength: number): number {
  const twoPi = Math.PI * 2;
  return Math.sqrt((9.81 * wavelength) / twoPi + (twoPi * 0.072) / (1000 * wavelength));
}
