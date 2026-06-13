// The hunt, without a HUD. Real ospreys fish by sight from sixty meters up,
// and the only "UI" they get is the lake itself: a fish near the surface throws
// a glint, a cruising fish drags a shadow, a feeding fish leaves a rise ring.
// Fish Hawk refuses markers for the same reason — the ecosystem already
// telegraphs everything, and learning to read it IS the spotting skill.
//
// This module is the math behind that reading. It never draws anything. It
// takes the live fish + rise data the Alive series publishes and scores how
// *spottable* and how *worth diving* each candidate is, so the game can lean
// the camera, warm the audio, or simply let a good chance feel obvious without
// ever painting a reticle on a fish.

export interface HuntFish {
  x: number;
  y: number; // depth, negative below the surface
  z: number;
  /** Horizontal speed, m/s — fast cruisers throw readable shadows. */
  speed: number;
}

export interface HuntRise {
  x: number;
  z: number;
  /** Simulated time of the rise; freshness decays from it. */
  time: number;
}

export interface HuntCandidate {
  x: number;
  z: number;
  /** Best fish depth at this spot (negative below surface). */
  depth: number;
  /** 0..1 how strongly the surface telegraphs a fish here, right now. */
  telegraph: number;
  /** 0..1 how good a dive this would be (telegraph × reachability). */
  worth: number;
  /** Meters from the spotter, horizontal. */
  range: number;
  /** Which signal sells it: a glint, a shadow, or a rise ring. */
  cue: HuntCue;
}

export type HuntCue = "glint" | "shadow" | "rise" | "none";

export interface HuntParams {
  /** Surface chop hides glints; pass the wind speed (m/s). */
  windSpeed: number;
  /** How fresh a rise still reads, seconds. */
  riseMemory: number;
  /** A fish shallower than this glints; deeper only shows as a shadow. */
  glintDepth: number;
  /** Beyond this depth there's nothing to see at all. */
  visibleDepth: number;
  /** The spot must be within this range to be worth committing to a dive. */
  reach: number;
}

export const DEFAULT_HUNT: HuntParams = {
  windSpeed: 1.5,
  riseMemory: 12,
  glintDepth: 1.8,
  visibleDepth: 6.5,
  reach: 120,
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * How visible a single fish is from above, 0..1, given the surface state. A
 * shallow fish on glass is obvious; the same fish under chop, or deep, fades.
 * This is the per-fish glint/shadow term — the rise ring is added separately.
 */
export function fishTelegraph(fish: HuntFish, params: HuntParams): { value: number; cue: HuntCue } {
  const depth = -fish.y; // meters below surface, ≥ 0
  if (depth > params.visibleDepth) return { value: 0, cue: "none" };

  // Chop scatters the specular glint that betrays a shallow fish: calm water
  // mirrors, a breeze frosts it over.
  const chop = clamp01((params.windSpeed - 1) / 5);

  if (depth <= params.glintDepth) {
    // A glint: bright, but the first thing chop kills.
    const shallow = 1 - smooth(0, params.glintDepth, depth);
    const glint = shallow * (1 - 0.85 * chop);
    // A fast shallow fish also drags a shadow you can read through light chop.
    const shadow = smooth(0.4, 2.2, fish.speed) * (1 - 0.5 * chop) * 0.6;
    if (glint >= shadow) return { value: clamp01(glint), cue: "glint" };
    return { value: clamp01(shadow), cue: "shadow" };
  }

  // Deeper: no glint, only the moving shadow of a cruising fish, and only if
  // it's actually moving and not too deep.
  const fade = 1 - smooth(params.glintDepth, params.visibleDepth, depth);
  const shadow = smooth(0.5, 2.5, fish.speed) * fade * (1 - 0.4 * chop);
  return { value: clamp01(shadow * 0.8), cue: "shadow" };
}

/**
 * The freshest rise still reads as a ring. Returns 0..1 by age. Rises are the
 * loudest cue — a fish that just broke the surface is a fish you know is there.
 */
export function riseFreshness(rise: HuntRise, now: number, params: HuntParams): number {
  const age = now - rise.time;
  if (age < 0 || age > params.riseMemory) return 0;
  return 1 - smooth(0, params.riseMemory, age);
}

/**
 * Score the whole scene from a spotter's position and gather candidates,
 * sorted best-first. Glints and shadows come from the fish; rise rings come
 * from the rise list and pull nearby fish's worth up (a rise says "this fish
 * is feeding, near the surface, right now"). The result is everything the game
 * needs to make spotting feel fair without a single marker.
 */
export function scanForFish(
  spotter: { x: number; z: number },
  fish: HuntFish[],
  rises: HuntRise[],
  now: number,
  params: HuntParams = DEFAULT_HUNT,
): HuntCandidate[] {
  const out: HuntCandidate[] = [];

  for (const f of fish) {
    const tel = fishTelegraph(f, params);
    if (tel.value < 0.04) continue;
    const range = Math.hypot(f.x - spotter.x, f.z - spotter.z);

    // A nearby rise super-charges the cue: did this fish just break water?
    let riseBoost = 0;
    let cue = tel.cue;
    for (const r of rises) {
      const fresh = riseFreshness(r, now, params);
      if (fresh <= 0) continue;
      const d = Math.hypot(r.x - f.x, r.z - f.z);
      if (d < 4) {
        const b = fresh * (1 - d / 4);
        if (b > riseBoost) {
          riseBoost = b;
          cue = "rise";
        }
      }
    }

    const telegraph = clamp01(tel.value + riseBoost * 0.7);
    // Worth diving: visible AND reachable. Beyond reach, the chance is real but
    // not yours; the score falls off so the game never nags you toward a fish
    // across the whole lake.
    const reachable = 1 - smooth(params.reach * 0.5, params.reach, range);
    const depth = -f.y;
    // Shallow fish are easier strikes; the dive math agrees.
    const easyDepth = 1 - smooth(1.5, params.visibleDepth, depth);
    const worth = clamp01(telegraph * (0.35 + 0.65 * reachable) * (0.4 + 0.6 * easyDepth));

    out.push({ x: f.x, z: f.z, depth: f.y, telegraph, worth, range, cue });
  }

  out.sort((a, b) => b.worth - a.worth);
  return out;
}

/**
 * The single best chance right now, or null if the water reads empty. The game
 * uses this to bias the chase camera a touch toward a good fish and to warm the
 * audio — never to draw on the fish.
 */
export function bestChance(candidates: HuntCandidate[]): HuntCandidate | null {
  return candidates.length > 0 && candidates[0].worth > 0.12 ? candidates[0] : null;
}
