// The painted mountain: altitude- and slope-driven surface color for the
// basin. One fragment-stage node graph reads world height and the surface
// normal and decides, per pixel, whether it is lakebed silt, beach gravel,
// meadow, forest floor, scree, bare rock, or snow. No textures — bands,
// slope tests, and a little noise to break the contour lines.
//
// The same builder powers the false-color teaching modes in the Treeline
// post (altitude bands only, slope only) so the demos and the real material
// are provably the same logic with parts switched off.

import { color, float, fract, mix, smoothstep, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { fbm2Node } from "./terrainNodes";

type NodeF = Node<"float">;
type NodeV3 = Node<"vec3">;

const asFloat = (v: NodeF | number): NodeF => (typeof v === "number" ? float(v) : v);

// The site-wide altitude lines, meters above the lake (world y).
export const TREELINE = 240;
export const SNOWLINE = 330;

export interface SurfaceColorOptions {
  /** Altitude where trees stop. Number or a live uniform. Default 240. */
  treeline?: NodeF | number;
  /** Altitude where snow holds. Number or a live uniform. Default 330. */
  snowline?: NodeF | number;
  /**
   * "full"     — the real material
   * "altitude" — quantized altitude bands only (the layer-cake lie)
   * "slope"    — slope heat map only
   * "treeline" — full material plus a highlight of the tree band
   */
  mode?: "full" | "altitude" | "slope" | "treeline";
  /** 0 disables the noise that breaks band edges. Default 1. */
  dither?: NodeF | number;
}

export function terrainSurfaceColor(
  world: NodeV3,
  normal: NodeV3,
  opts: SurfaceColorOptions = {},
): NodeV3 {
  const y = world.y;
  const up = normal.y; // 1 = flat, 0 = vertical wall
  const mode = opts.mode ?? "full";

  // -- teaching modes ----------------------------------------------------------
  if (mode === "altitude") {
    // Hard 40 m bands on a cold-to-warm ramp: reads like a contour map,
    // which is exactly the point of the demo that uses it.
    const t = y.div(40).floor().mul(40).div(600).clamp(0, 1);
    const low = mix(color("#27435f"), color("#5d7a3a"), t.mul(3).clamp(0, 1));
    const mid = mix(low, color("#8d8a82"), t.sub(0.33).mul(3).clamp(0, 1));
    return mix(mid, color("#eef2f7"), t.sub(0.66).mul(3).clamp(0, 1));
  }
  if (mode === "slope") {
    const steep = float(1).sub(up);
    const a = mix(color("#2e6b46"), color("#e8c067"), smoothstep(0.05, 0.35, steep));
    return mix(a, color("#d04f4f"), smoothstep(0.35, 0.65, steep));
  }

  // -- the real material ---------------------------------------------------------
  const treeline = asFloat(opts.treeline ?? TREELINE);
  const snowline = asFloat(opts.snowline ?? SNOWLINE);
  const dither = asFloat(opts.dither ?? 1);

  // Two cheap noise fields: a broad moisture field (meadow patchiness) and
  // a finer one that dithers every band edge so no contour survives.
  const xz = world.xz;
  const moist = fbm2Node(xz.mul(1 / 170), { octaves: 2, seed: 901 });
  const grain = fbm2Node(xz.mul(1 / 23), { octaves: 2, seed: 902 });
  const wob = grain.mul(dither); // ±1-ish band wobble

  // Base: meadow, drier on the moisture field's highs.
  let c: NodeV3 = mix(color("#5d7a3a"), color("#8a9151"), moist.mul(0.5).add(0.5));

  // Forest floor (under the conifers): mid altitudes, gentle ground.
  const forestW = smoothstep(3, 12, y)
    .mul(float(1).sub(smoothstep(treeline.sub(18), treeline.add(18), y.add(wob.mul(22)))))
    .mul(smoothstep(0.7, 0.8, up));
  c = mix(c, color("#3a4f2c"), forestW.mul(0.85));

  // Beach gravel in a thin strip around y = 0.
  const beach = float(1).sub(smoothstep(0.4, 2.5, y.add(wob.mul(0.7))));
  c = mix(c, color("#9a8f76"), beach.clamp(0, 1));

  // Bare rock takes over as the ground steepens.
  const rockW = smoothstep(0.28, 0.5, float(1).sub(up).add(wob.mul(0.05)));
  // faint sedimentary banding on the rock so cliffs read as cliffs
  const strata = fract(y.mul(1 / 14).add(grain.mul(0.4))).sub(0.5).abs().mul(0.18);
  const rock = vec3(float(0.42).add(strata), float(0.4).add(strata), float(0.38).add(strata));
  c = mix(c, rock, rockW);

  // Scree: loose talus aprons — mid-steep ground above the forest.
  const screeBand = smoothstep(0.18, 0.3, float(1).sub(up)).mul(
    float(1).sub(smoothstep(0.42, 0.55, float(1).sub(up))),
  );
  const screeW = screeBand.mul(smoothstep(treeline.mul(0.55), treeline, y.add(wob.mul(30))));
  c = mix(c, color("#8d8a82"), screeW.mul(0.9));

  // Snow: above the snowline, where it can rest; dithered edge.
  const snowW = smoothstep(snowline.sub(28), snowline.add(28), y.add(wob.mul(34))).mul(
    smoothstep(0.55, 0.72, up),
  );
  c = mix(c, color("#eef2f7"), snowW);

  // Under water: silt, darkening with depth (the lakebed post tints the
  // water column itself; this keeps the bed believable through it).
  const uw = float(1).sub(smoothstep(-0.6, 0.4, y));
  const silt = mix(color("#3c4034"), color("#23291f"), smoothstep(-2, -22, y));
  c = mix(c, silt, uw);

  if (mode === "treeline") {
    // Paint the live tree band so you can see exactly what the Forest post
    // will read: forest-floor weight is the planting mask.
    c = mix(c, color("#7aa2ff"), forestW.mul(0.5));
  }

  return c;
}

/** Roughness companion: snow and wet silt are smoother than rock. */
export function terrainRoughness(world: NodeV3, normal: NodeV3, opts: SurfaceColorOptions = {}): NodeF {
  const snowline = asFloat(opts.snowline ?? SNOWLINE);
  const snowW = smoothstep(snowline.sub(28), snowline.add(28), world.y).mul(
    smoothstep(0.55, 0.72, normal.y),
  );
  const uw = float(1).sub(smoothstep(-0.6, 0.4, world.y));
  return float(0.95).sub(snowW.mul(0.25)).sub(uw.mul(0.3));
}
