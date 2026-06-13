// Dive scoring — the centerpiece. The flight model and the fluid plunge already
// make a dive *feel* right; this module decides whether it *worked*. A real
// osprey commits from a hover or a glide, tucks, falls feet-first, and hits the
// water on a steep line timed to where the fish will be — not where it is. We
// score exactly those things: entry angle, entry speed, and the lead on a
// moving target, combined into a catch probability and, when it lands, a fish
// with a weight that then changes how the bird flies home.
//
// Pure numbers. The grab itself still happens in the plunge (PlayerBird.tryGrab
// asks the world for a fish in talon range); this module tells the world how
// likely that grab should be and how heavy the prize is.

export interface DiveEntry {
  /** Speed at the moment of entry, m/s. */
  speed: number;
  /** Entry angle below horizontal, radians (π/2 = straight down). */
  angle: number;
  /** Horizontal miss distance from the fish at entry, meters. */
  miss: number;
  /** Fish depth at the strike, meters below surface (≥ 0). */
  depth: number;
}

export interface DiveScore {
  /** 0..1 probability the talons close on the fish. */
  probability: number;
  /** Per-factor breakdown, each 0..1, for readouts and teaching. */
  angleScore: number;
  speedScore: number;
  aimScore: number;
  depthScore: number;
  /** A letter grade for the HUD-less feedback (the splash sells the rest). */
  grade: DiveGrade;
}

export type DiveGrade = "clean" | "good" | "scrappy" | "miss";

export interface DiveParams {
  /** The ideal entry angle, radians (steep but not vertical). */
  bestAngle: number;
  /** Entry speed that maxes the score, m/s (ospreys hit 15–30 m/s). */
  bestSpeed: number;
  /** Speed below which there's not enough punch to reach a fish, m/s. */
  minSpeed: number;
  /** Talon reach — a miss inside this is forgiven, m. */
  reach: number;
  /** Below this depth the catch gets steeply harder. */
  comfortDepth: number;
}

export const DEFAULT_DIVE: DiveParams = {
  bestAngle: 1.15, // ~66° below horizontal: steep, the classic osprey line
  bestSpeed: 19,
  minSpeed: 7,
  reach: 0.7,
  comfortDepth: 1.6,
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Score a completed entry. Each factor is independent and readable:
 *
 *   angle  — a shallow entry skips; vertical wastes the lead. Peaks at bestAngle.
 *   speed  — too slow and you can't reach the fish; faster helps with
 *            diminishing returns and a tiny penalty for a reckless smash.
 *   aim    — the horizontal miss against the talon reach. This is the big one.
 *   depth  — a surface fish is a gift; a deep one needs a fast, true dive.
 *
 * The probability is their weighted product (a product, not a sum, because a
 * dive fails if ANY factor is bad — perfect aim at walking speed still misses).
 */
export function scoreDive(entry: DiveEntry, params: DiveParams = DEFAULT_DIVE): DiveScore {
  // Angle: a smooth peak at bestAngle, tolerant within ~25°.
  const angleErr = Math.abs(entry.angle - params.bestAngle);
  const angleScore = clamp01(1 - smooth(0.25, 0.9, angleErr));

  // Speed: ramps up from minSpeed, plateaus near bestSpeed, gentle over-speed
  // penalty (a too-hard hit blows past the fish and stuns the strike).
  const ramp = smooth(params.minSpeed, params.bestSpeed, entry.speed);
  const over = smooth(params.bestSpeed * 1.5, params.bestSpeed * 2.4, entry.speed) * 0.3;
  const speedScore = clamp01(ramp - over);

  // Aim: the miss against talon reach. Inside reach is near-certain; just
  // outside falls off fast — this is what the lead on a moving fish buys you.
  const aimScore = clamp01(1 - smooth(params.reach * 0.6, params.reach * 2.4, entry.miss));

  // Depth: free at the surface, hard past comfortDepth.
  const depthScore = clamp01(1 - smooth(params.comfortDepth, params.comfortDepth + 3, entry.depth));

  // Weighted product: aim dominates, then speed, then angle, then depth.
  const probability = clamp01(
    Math.pow(aimScore, 1.3) *
      Math.pow(speedScore, 0.9) *
      Math.pow(angleScore, 0.7) *
      Math.pow(depthScore, 0.6),
  );

  return {
    probability,
    angleScore,
    speedScore,
    aimScore,
    depthScore,
    grade: gradeFor(probability),
  };
}

function gradeFor(p: number): DiveGrade {
  if (p >= 0.78) return "clean";
  if (p >= 0.5) return "good";
  if (p >= 0.22) return "scrappy";
  return "miss";
}

/**
 * Where a fish cruising at constant velocity will be after `tti` seconds — the
 * lead the dive has to aim for. The plunge takes time to fall; aiming at the
 * fish's *current* spot is how you miss.
 */
export function leadTarget(
  fish: { x: number; z: number; vx: number; vz: number },
  tti: number,
): { x: number; z: number } {
  return { x: fish.x + fish.vx * tti, z: fish.z + fish.vz * tti };
}

/**
 * Time-to-impact estimate for a tuck from a height, used to compute the lead.
 * A folded osprey accelerates under gravity with little drag; this is the
 * ballistic estimate the AI (and the dive-scoring figure) uses to pick a lead.
 */
export function timeToImpact(height: number, entrySpeedDown = 0, g = 9.81): number {
  // height = v0·t + ½·g·t²  →  solve for t.
  const a = 0.5 * g;
  const b = Math.max(0, entrySpeedDown);
  const c = -Math.max(0, height);
  const disc = Math.sqrt(b * b - 4 * a * c);
  return (-b + disc) / (2 * a);
}

// ---- the carry: a fish changes how you fly --------------------------------------

export interface CarriedFish {
  /** Fish mass, kg (a lake trout an osprey can lift: ~0.2–0.9 kg). */
  mass: number;
  /** 0..1 normalized weight for hunger/score (mass / a big-fish reference). */
  weight: number;
}

/** A big fish for normalization — at this mass, weight reads 1.0. */
export const BIG_FISH_KG = 0.9;

/** Roll a fish for a successful catch: shallower, cleaner strikes tend bigger. */
export function makeCatch(score: DiveScore, rng: () => number = Math.random): CarriedFish {
  // A clean dive can land a better fish; a scrappy one usually grabs a small
  // one. Bias the roll by the grade, keep it within an osprey's lifting range.
  const base = 0.18 + (rng() * 0.5 + 0.5 * score.probability) * 0.7;
  const mass = Math.min(BIG_FISH_KG, Math.max(0.18, base));
  return { mass, weight: clamp01(mass / BIG_FISH_KG) };
}

export interface CarryEffect {
  /** Multiply the bird's flap effort by this (a load is work). */
  effortScale: number;
  /** Extra downward acceleration from the dead weight, m/s². */
  sinkAccel: number;
}

/**
 * What carrying a fish does to flight. An osprey turns a big catch head-first to
 * cut drag, but it still costs power and trim — heavier fish, more penalty.
 * These feed straight into the player-bird's air step.
 */
export function carryEffect(fish: CarriedFish | null): CarryEffect {
  if (!fish) return { effortScale: 1, sinkAccel: 0 };
  const w = clamp01(fish.weight);
  return {
    effortScale: 1 - 0.22 * w, // up to ~22% less usable power at full load
    sinkAccel: 0.35 + 0.6 * w, // 0.35–0.95 m/s² of extra sink
  };
}
