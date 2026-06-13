// The atmosphere: one single-scattering-inspired sky for the whole site.
//
// The model, from first principles (derived in air.html): a flat slab of air
// above the valley. A view ray crossing the slab at angle θ from the zenith
// travels an air mass m ≈ 1/cos θ times the vertical column. Along that path
// sunlight is scattered toward the eye by two populations —
//
//   · molecules (Rayleigh): coefficient βR ∝ 1/λ⁴, so blue scatters ~5×
//     more than red; phase (3/16π)(1 + cos²θ) — nearly isotropic;
//   · aerosols (Mie): coefficient βM nearly grey; strongly forward-peaked
//     phase (Henyey–Greenstein), which is the bright haze around the sun.
//
// One sample stands in for the integral: in-scatter ≈ E·T_sun·phase·(β/βe)
// ·(1 − T_view), where T = e^(−βe·path) is Beer–Lambert transmittance. The
// sun's own transmittance T_sun is what reddens everything at the horizon —
// sunset is not a painted color, it is white light minus its blue.
//
// The moon runs through the *same* formula as a second, much dimmer sun, and
// a hashed star field rides on top. `overcast` (0..1) flattens the whole
// thing toward storm grey, and `flash` is the weather system's lightning.
//
// This module replaces The Mirror's placeholder dawn sky: it keeps the same
// exported shape (sunDirection/sunColor uniforms + skyColor(dir) + setHour +
// makeDome), so a LakeSurface can take an Atmosphere as its environment
// without noticing the swap.

import { BackSide, Color, Mesh, MeshBasicNodeMaterial, SphereGeometry, Vector3 } from "three/webgpu";
import {
  acos,
  dot,
  exp,
  float,
  max,
  mix,
  normalize,
  positionWorld,
  pow,
  smoothstep,
  uniform,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { moonDirection, sunDirection, sunElevationDeg, moonElevationDeg } from "./palette";
import { starFieldNode, starVisibility, type StarFieldOptions } from "./stars";

type NodeV3 = Node<"vec3">;

// ---- the physical constants (per kilometer of sea-level air) -----------------

/** Rayleigh scattering coefficients, 1/km, at (680, 550, 440) nm. The 1/λ⁴
 *  law in three numbers: blue scatters 5.7× more than red. */
export const BETA_RAYLEIGH = /* @__PURE__ */ new Vector3(5.8e-3, 13.5e-3, 33.1e-3);
/** Mie (aerosol) scattering coefficient, 1/km — nearly wavelength-flat. */
export const BETA_MIE = 4.0e-3;
/** Effective vertical thickness of the molecular atmosphere, km. */
export const RAYLEIGH_THICKNESS = 8.0;
/** Effective vertical thickness of the aerosol layer, km. */
export const MIE_THICKNESS = 1.2;
/** Henyey–Greenstein anisotropy for aerosols: strongly forward. */
export const MIE_G = 0.76;

/** Spectrum of sunlight above the atmosphere — near-white, slightly warm. */
const SUN_SPECTRUM = /* @__PURE__ */ new Vector3(1.0, 0.96, 0.92);
/** HDR intensity for the direct sun (tuned against tone mapping). */
const SUN_INTENSITY = 3.6;
/** Moonlight relative to sunlight. The honest number is ~1/400,000; the
 *  playable one is ~1/250 — declared, because a game night you cannot see
 *  is not a night anyone will witness. The cool tint stands in for the
 *  eye's scotopic shift. */
const MOON_SPECTRUM = /* @__PURE__ */ new Vector3(0.62, 0.74, 1.0);
const MOON_INTENSITY = SUN_INTENSITY / 250;

// Flat-slab air mass: 1/max(sin e, ε). The ε keeps the horizon finite (a
// curved earth caps the real value near 38; we cap a bit lower and say so).
function airmass(sinElevation: number): number {
  return 1 / Math.max(sinElevation + 0.045, 0.035);
}

// CPU twin of the transmittance the shader uses, for the light uniforms:
// what is left of a body's light after its slant path through the slab.
function transmittance(sinElevation: number, mieScale: number, target: Vector3): Vector3 {
  const m = airmass(sinElevation);
  return target.set(
    Math.exp(-(BETA_RAYLEIGH.x * RAYLEIGH_THICKNESS + BETA_MIE * MIE_THICKNESS * mieScale) * m),
    Math.exp(-(BETA_RAYLEIGH.y * RAYLEIGH_THICKNESS + BETA_MIE * MIE_THICKNESS * mieScale) * m),
    Math.exp(-(BETA_RAYLEIGH.z * RAYLEIGH_THICKNESS + BETA_MIE * MIE_THICKNESS * mieScale) * m),
  );
}

export interface AtmosphereOptions {
  /** Hash-star field options; `stars: false` omits it from the dome. */
  stars?: StarFieldOptions | false;
}

const _t = new Vector3();

/**
 * Build the atmosphere. Uniforms (sun/moon direction and HDR color, overcast,
 * flash, rayleigh/mie scales), the `skyColor(dir)` radiance node, `setHour(h)`
 * to key everything to the world clock, and `makeDome()` for a BackSide dome.
 */
export function createAtmosphere(initialHour = 9, options: AtmosphereOptions = {}) {
  // ---- uniforms ----------------------------------------------------------------
  const sunDir = uniform(new Vector3(0, 1, 0));
  const sunColor = uniform(new Color(0)); // HDR: spectrum × transmittance × intensity
  const moonDir = uniform(new Vector3(0, -1, 0));
  const moonColor = uniform(new Color(0));
  /** Scales the Rayleigh optical depth (1 = clear mountain air). */
  const rayleigh = uniform(1);
  /** Scales the aerosol load (1 = clear; 3+ = hazy valley day). */
  const mie = uniform(1);
  /** Mie anisotropy (forward-peakedness of the haze glow). */
  const mieG = uniform(MIE_G);
  /** 0 = clear sky, 1 = full storm grey. The weather system drives this. */
  const overcast = uniform(0);
  /** Lightning, 0..1 — a brief whole-sky bump the weather system decays. */
  const flash = uniform(0);
  /** Star rotation (radians around the celestial pole) and visibility. */
  const starRotation = uniform(0);
  const starVis = uniform(0);

  let hourNow = initialHour;

  // ---- the radiance node ---------------------------------------------------------
  // Zenith optical depths; slant paths multiply these by the view air mass.
  const tauR0 = vec3(
    BETA_RAYLEIGH.x * RAYLEIGH_THICKNESS,
    BETA_RAYLEIGH.y * RAYLEIGH_THICKNESS,
    BETA_RAYLEIGH.z * RAYLEIGH_THICKNESS,
  );
  const tauM0 = BETA_MIE * MIE_THICKNESS;

  // In-scattered light from one body along the view ray.
  function inScatter(dir: NodeV3, bodyDir: NodeV3, bodyE: NodeV3, oneMinusT: NodeV3, weights: NodeV3): NodeV3 {
    const cosT = dot(dir, bodyDir);
    // Rayleigh phase: (3/16π)(1 + cos²θ), normalized shape only — the
    // absolute scale folds into the body intensity.
    const phR = cosT.mul(cosT).add(1).mul(3 / 4);
    // Henyey–Greenstein for the aerosols.
    const g = mieG;
    const g2 = g.mul(g);
    const phM = g2
      .oneMinus()
      .div(pow(g2.add(1).sub(g.mul(cosT).mul(2)).max(1e-4), 1.5))
      .mul(0.25);
    // Blend the two phase functions by each population's share of the
    // extinction (per channel — Rayleigh dominates in blue).
    const phase = weights.mul(phR).add(phM.mul(float(1).sub(weights)));
    return bodyE.mul(phase).mul(oneMinusT);
  }

  function skyColor(dir: NodeV3): NodeV3 {
    // View air mass through the slab, capped at the horizon.
    const m = float(1).div(max(dir.y, 0.0).add(0.045));

    // Per-channel optical depth and transmittance of the view path.
    const tR = tauR0.mul(rayleigh).mul(m);
    const tM = float(tauM0).mul(mie).mul(m);
    const tau = tR.add(tM);
    const T = vec3(exp(tau.x.negate()), exp(tau.y.negate()), exp(tau.z.negate()));
    const oneMinusT = T.oneMinus();
    // Rayleigh's per-channel share of the total extinction.
    const weights = tR.div(tau.max(1e-5));

    // Sun and moon, same formula, different energies.
    let L: NodeV3 = inScatter(dir, sunDir, vec3(sunColor.r, sunColor.g, sunColor.b), oneMinusT, weights);
    L = L.add(inScatter(dir, moonDir, vec3(moonColor.r, moonColor.g, moonColor.b), oneMinusT, weights));

    // Airglow + scattered starlight floor, so deep night is near-black, not
    // RGB zero. Slightly stronger toward the horizon (longer air column).
    L = L.add(vec3(0.0016, 0.0022, 0.0034).mul(m.mul(0.08).clamp(0.5, 1.6)));

    // The solar disc itself: transmitted (= reddened) direct light. ~0.53°
    // across in life; drawn at ~2° so it reads at game scale.
    const ang = acos(dot(dir, sunDir).clamp(0, 0.99999));
    const disc = smoothstep(0.02, 0.012, ang);
    const discL = vec3(sunColor.r, sunColor.g, sunColor.b).mul(disc).mul(12);

    // Overcast: collapse color toward a luminance-keyed storm grey, kill the
    // disc, keep a little horizon graduation so the sky still has depth.
    const lum = dot(L, vec3(0.2126, 0.7152, 0.0722));
    const storm = vec3(0.6, 0.65, 0.72).mul(lum.mul(0.85).add(0.012));
    const oc = overcast.clamp(0, 1);
    L = mix(L, storm, oc.mul(0.92)).add(discL.mul(oc.oneMinus().pow(3)));

    // Lightning: a cool flood from everywhere at once.
    L = L.add(vec3(0.85, 0.9, 1.0).mul(flash));

    // Stars last — they sit above the air, dimmed only by the night gate
    // (and the overcast deck, which is opaque to them).
    if (options.stars !== false) {
      L = L.add(starFieldNode(dir, starRotation, starVis.mul(oc.oneMinus()), options.stars));
    }
    return L;
  }

  // ---- keying to the clock ---------------------------------------------------------
  function setHour(hour: number): void {
    hourNow = hour;
    sunDirection(hour, sunDir.value);
    moonDirection(hour, moonDir.value);

    const se = Math.sin((sunElevationDeg(hour) * Math.PI) / 180);
    transmittance(se, mie.value, _t);
    // Fade direct sunlight out as the disc slips fully under the horizon.
    const horizon = Math.min(1, Math.max(0, (se + 0.045) / 0.07));
    sunColor.value.setRGB(
      SUN_SPECTRUM.x * _t.x * SUN_INTENSITY * horizon,
      SUN_SPECTRUM.y * _t.y * SUN_INTENSITY * horizon,
      SUN_SPECTRUM.z * _t.z * SUN_INTENSITY * horizon,
    );

    const me = Math.sin((moonElevationDeg(hour) * Math.PI) / 180);
    transmittance(me, mie.value, _t);
    const moonUp = Math.min(1, Math.max(0, (me + 0.045) / 0.07));
    moonColor.value.setRGB(
      MOON_SPECTRUM.x * _t.x * MOON_INTENSITY * moonUp,
      MOON_SPECTRUM.y * _t.y * MOON_INTENSITY * moonUp,
      MOON_SPECTRUM.z * _t.z * MOON_INTENSITY * moonUp,
    );

    starRotation.value = (hour / 24) * Math.PI * 2;
    starVis.value = starVisibility(sunElevationDeg(hour));
  }

  setHour(initialHour);

  // ---- the dome -------------------------------------------------------------------
  const domes: Mesh[] = [];

  function makeDome(radius = 3800): Mesh {
    const geometry = new SphereGeometry(radius, 48, 24);
    const material = new MeshBasicNodeMaterial({ side: BackSide });
    material.colorNode = skyColor(normalize(positionWorld));
    material.fog = false;
    const mesh = new Mesh(geometry, material);
    domes.push(mesh);
    return mesh;
  }

  function dispose(): void {
    for (const d of domes) {
      d.geometry.dispose();
      (d.material as MeshBasicNodeMaterial).dispose();
    }
    domes.length = 0;
  }

  return {
    // The Mirror-compatible seam: a LakeSurface env reads these three.
    sunDirection: sunDir,
    sunColor,
    skyColor,
    // The night extension: the same seam shape, pointed at the moon.
    moonDirection: moonDir,
    moonColor,
    // Weather and tuning knobs.
    rayleigh,
    mie,
    mieG,
    overcast,
    flash,
    // Clock plumbing.
    setHour,
    get hour(): number {
      return hourNow;
    },
    makeDome,
    dispose,
  };
}

export type Atmosphere = ReturnType<typeof createAtmosphere>;
