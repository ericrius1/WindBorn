// TSL builders for the ambient wave field — the GPU half of the parity pair.
// These unroll the same five-wave table as ./ambientWaves.ts (which mirrors
// src/lib/spine/water.ts) into shader expressions, so the surface the GPU
// displaces and shades is the surface the CPU's `waterHeightAt` reports.
//
// Everything is keyed off a small set of uniforms (`WaveUniforms`) so demos
// can drive wind speed/direction/choppiness from sliders, or sync them from
// the spine wind field each frame (see LakeSurface.update).

import { cos, float, normalize, sin, uniform, vec2, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { wind } from "../spine";
import { BASE_AMP_PER_WIND, WAVE_TABLE, chopWeight } from "./ambientWaves";

type NodeF = Node<"float">;
type NodeV2 = Node<"vec2">;
type NodeV3 = Node<"vec3">;

export interface WaveUniformInit {
  windDirection?: number;
  windSpeed?: number;
  choppiness?: number;
  ampScale?: number;
  time?: number;
}

export function createWaveUniforms(init: WaveUniformInit = {}) {
  return {
    /** Seconds. Drive this from your demo clock so CPU queries can share it. */
    time: uniform(init.time ?? 0),
    /** Radians around +y, matching `wind.direction` in the spine. */
    windDirection: uniform(init.windDirection ?? wind.direction),
    /** m/s, matching `wind.speed` in the spine. */
    windSpeed: uniform(init.windSpeed ?? wind.speed),
    /** 1 = spine parity; >1 tilts energy into the short waves. */
    choppiness: uniform(init.choppiness ?? 1),
    /** Master amplitude scale; 0 = glass, 1 = spine parity. */
    ampScale: uniform(init.ampScale ?? 1),
  };
}

export type WaveUniforms = ReturnType<typeof createWaveUniforms>;

/** Wind-scaled base amplitude node: 0.035 · windSpeed · ampScale. */
function baseAmp(u: WaveUniforms): NodeF {
  return u.windSpeed.mul(BASE_AMP_PER_WIND).mul(u.ampScale);
}

/**
 * Surface height at horizontal position `xz` (world meters) — the exact TSL
 * transcription of `ambientWaveHeight`. The loop over the table is unrolled
 * at build time; only wind direction/speed/choppiness/time are uniforms.
 *
 * `count` limits the sum to the first N table waves. Vertex displacement
 * typically uses the 3 longest waves (the short capillary dressing is
 * millimeters tall — far below vertex spacing) while fragment normals always
 * use all 5.
 */
export function waveHeightNode(xz: NodeV2, u: WaveUniforms, count = WAVE_TABLE.length): NodeF {
  let h: NodeF = float(0);
  for (let i = 0; i < Math.min(count, WAVE_TABLE.length); i++) {
    const w = WAVE_TABLE[i];
    const k = (Math.PI * 2) / w.wavelength;
    const a = u.windDirection.add(w.angle);
    const phase = xz.x.mul(cos(a)).add(xz.y.mul(sin(a))).mul(k).add(u.time.mul(w.speed * k));
    // chopWeight is uniform-dependent, so it stays a node: chop^(i/(N-1))
    const cw = u.choppiness.pow(i / (WAVE_TABLE.length - 1));
    h = h.add(sin(phase).mul(w.amp).mul(cw));
  }
  return h.mul(baseAmp(u));
}

/** Analytic (∂h/∂x, ∂h/∂z) — differentiated by hand, like the CPU twin. */
export function waveSlopeNode(xz: NodeV2, u: WaveUniforms, count = WAVE_TABLE.length): NodeV2 {
  let sx: NodeF = float(0);
  let sz: NodeF = float(0);
  for (let i = 0; i < Math.min(count, WAVE_TABLE.length); i++) {
    const w = WAVE_TABLE[i];
    const k = (Math.PI * 2) / w.wavelength;
    const a = u.windDirection.add(w.angle);
    const dx = cos(a);
    const dz = sin(a);
    const phase = xz.x.mul(dx).add(xz.y.mul(dz)).mul(k).add(u.time.mul(w.speed * k));
    const cw = u.choppiness.pow(i / (WAVE_TABLE.length - 1));
    const c = cos(phase).mul(w.amp * k).mul(cw);
    sx = sx.add(c.mul(dx));
    sz = sz.add(c.mul(dz));
  }
  return vec2(sx, sz).mul(baseAmp(u));
}

/** Unit surface normal from the analytic slope: normalize(−∂x, 1, −∂z). */
export function waveNormalNode(xz: NodeV2, u: WaveUniforms): NodeV3 {
  const s = waveSlopeNode(xz, u);
  return normalize(vec3(s.x.negate(), 1, s.y.negate()));
}

/** CPU evaluation of the same uniforms — convenience for parity demos. */
export function waveParamsFromUniforms(u: WaveUniforms) {
  return {
    windDirection: u.windDirection.value,
    windSpeed: u.windSpeed.value,
    choppiness: u.choppiness.value,
    ampScale: u.ampScale.value,
  };
}

// Re-export the table constants so demo code can label its diagrams without
// importing two modules.
export { WAVE_TABLE, BASE_AMP_PER_WIND, chopWeight };
