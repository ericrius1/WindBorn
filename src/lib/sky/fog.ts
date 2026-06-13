// Aerial perspective and height fog, derived once and reused by every scene
// that has a far shore (mist.html does the deriving).
//
// Air thins exponentially with altitude: ρ(y) = ρ₀·e^(−y/H). Integrating
// that density along a straight ray from camera (y₀) to point (y₁), length D,
// gives a CLOSED FORM for the optical depth — no marching required:
//
//   τ = ρ₀ · D · e^(−y₀/H) · G(Δ),  G(Δ) = (1 − e^(−Δ)) / Δ,  Δ = (y₁ − y₀)/H
//
// (G → 1 as the ray goes level; the limit is exactly the constant-density
// fog everyone hard-codes.) The fraction of the scene that survives is
// Beer–Lambert again: T = e^(−τ); what replaces it is in-scattered sky —
// the fog color — plus a warm boost when looking toward the sun, which is
// the Mie forward lobe wearing a different hat.
//
// Two layers ship: AIR (deep slab, kilometers — distant ridges go blue) and
// MIST (a few meters thick, dense — the lake's dawn exhalation). They sum in
// optical depth, which is how transparent things stack in the real world.

import { Color, Vector2 } from "three/webgpu";
import { dot, exp, float, mix, normalize, pow, select, uniform, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { fbm3 } from "./noise3";

type NodeF = Node<"float">;
type NodeV3 = Node<"vec3">;

export interface HeightFogInit {
  /** Sea-level (lake-level) air extinction, 1/m. ~8e-5 clear, 4e-4 humid. */
  airDensity?: number;
  /** Scale height of the air layer, meters. */
  airHeight?: number;
  /** Mist extinction at the water surface, 1/m. 0 = no mist. */
  mistDensity?: number;
  /** Scale height of the mist layer, meters — it hugs the water. */
  mistHeight?: number;
  /** What far things fade toward (palette.fog is the usual source). */
  fogColor?: Color;
  /** Strength of the warm glow when looking sunward (0 disables). */
  sunGlow?: number;
}

export function createHeightFog(init: HeightFogInit = {}) {
  const airDensity = uniform(init.airDensity ?? 1.6e-4);
  const airHeight = uniform(init.airHeight ?? 900);
  const mistDensity = uniform(init.mistDensity ?? 0);
  const mistHeight = uniform(init.mistHeight ?? 7);
  const fogColor = uniform(init.fogColor ?? new Color(0xbccddc));
  const sunGlow = uniform(init.sunGlow ?? 0.5);
  /** 0 = a uniform blanket, 1 = ragged wisps (noise-modulated mist). */
  const mistPatchiness = uniform(0.55);
  /** World-space drift of the wisps; integrate the spine wind into it. */
  const mistDrift = uniform(new Vector2(0, 0));

  /** Optical depth of one exponential layer along camera→point. Evaluated
   *  in the numerically stable form ρ₀·d·(e^(−y₀/H) − e^(−y₁/H))/Δ — the
   *  factored G(Δ) version overflows when a high camera looks far down. */
  function layerDepth(camPos: NodeV3, worldPos: NodeV3, density: NodeF, scaleH: NodeF): NodeF {
    const d = worldPos.sub(camPos).length().max(1e-3);
    const a0 = camPos.y.div(scaleH).clamp(-30, 60);
    const a1 = worldPos.y.div(scaleH).clamp(-30, 60);
    const delta = a1.sub(a0);
    // The Δ→0 limit (a level ray) is handled explicitly: e^(−a0)·(1 − Δ/2).
    const g = select(
      delta.abs().lessThan(1e-4),
      exp(a0.negate()).mul(float(1).sub(delta.mul(0.5))),
      exp(a0.negate()).sub(exp(a1.negate())).div(delta),
    );
    return density.mul(d).mul(g).clamp(0, 60);
  }

  /** Total transmittance camera→point through both layers (0 = swallowed). */
  function transmittanceNode(camPos: NodeV3, worldPos: NodeV3): NodeF {
    const air = layerDepth(camPos, worldPos, airDensity, airHeight);
    let mist = layerDepth(camPos, worldPos, mistDensity, mistHeight);
    // Wisps: modulate the mist column by drifting fBm sampled where the ray
    // lands. (The closed form assumed a horizontally uniform layer; one
    // sample at the far end is the declared approximation.)
    const wisp = fbm3(
      vec3(worldPos.x.add(mistDrift.x).mul(1 / 38), worldPos.y.mul(1 / 12), worldPos.z.add(mistDrift.y).mul(1 / 38)),
      2,
      311,
    );
    mist = mist.mul(mix(float(1), wisp.mul(1.7), mistPatchiness));
    return exp(air.add(mist).negate());
  }

  /**
   * Apply the fog to a shaded color. Optionally pass the sun's direction and
   * (HDR) color to warm the fog in the sunward half of the sky — aerial
   * perspective's directional half.
   */
  function applyNode(
    shaded: NodeV3,
    camPos: NodeV3,
    worldPos: NodeV3,
    sun?: { direction: NodeV3; color: NodeV3 },
  ): NodeV3 {
    const T = transmittanceNode(camPos, worldPos);
    let fc: NodeV3 = fogColor.rgb;
    if (sun) {
      const view = normalize(worldPos.sub(camPos));
      const toward = dot(view, sun.direction).clamp(0, 1);
      fc = fc.add(sun.color.mul(pow(toward, 6)).mul(sunGlow).mul(0.12));
    }
    return mix(fc, shaded, T);
  }

  return {
    airDensity,
    airHeight,
    mistDensity,
    mistHeight,
    fogColor,
    sunGlow,
    mistPatchiness,
    mistDrift,
    layerDepth,
    transmittanceNode,
    applyNode,
  };
}

export type HeightFog = ReturnType<typeof createHeightFog>;

// ---- CPU twins ---------------------------------------------------------------------

/** Optical depth of one exponential layer, CPU side (for readouts and
 *  anything that wants to know how far it can see). Twin of the shader. */
export function layerDepthCpu(
  camY: number,
  pointY: number,
  dist: number,
  density: number,
  scaleH: number,
): number {
  const clamp = (v: number): number => Math.min(60, Math.max(-30, v));
  const a0 = clamp(camY / scaleH);
  const a1 = clamp(pointY / scaleH);
  const delta = a1 - a0;
  const g =
    Math.abs(delta) < 1e-4
      ? Math.exp(-a0) * (1 - delta * 0.5)
      : (Math.exp(-a0) - Math.exp(-a1)) / delta;
  return Math.min(60, Math.max(0, density * dist * g));
}

/** Fraction of a distant object's light that survives the air. */
export function transmittanceCpu(camY: number, pointY: number, dist: number, density: number, scaleH: number): number {
  return Math.exp(-layerDepthCpu(camY, pointY, dist, density, scaleH));
}

/**
 * The dawn-mist schedule: how much lake mist exists at a clock hour, 0..1.
 * Mist condenses in the cold hours before dawn (the water is warmer than the
 * air, and the air over it saturates), holds through first light, and burns
 * off as the morning sun heats the air above its dew point. A smaller wave
 * returns after sunset as the land cools.
 */
export function mistAmountForHour(hour: number): number {
  const s = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const dawn = s(3.2, 5.0, hour) * (1 - s(7.2, 9.6, hour));
  const dusk = 0.45 * s(20.3, 22.5, hour);
  const smallHours = 0.45 * (1 - s(1.5, 3.4, hour)); // carry-over past midnight
  return Math.min(1, dawn + dusk + smallHours);
}
