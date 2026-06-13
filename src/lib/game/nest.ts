// The nest — the home that grows. Fish Hawk's progression is deliberately
// gentle: there is no grind, no resource bar to top up, no timer. You carry
// catches back to the snag on the north-shore promontory (terrain's NEST_SNAG),
// eat there, and a few meals at a time the nest fills in across days — bare
// spar, first sticks, a real cup, a lined bowl, and finally a nest with the
// season's brood. It is a way to feel a handful of days add up to something,
// and that is the whole of it.
//
// This module is the description of those stages and the geometry-free model of
// "how built is the nest". The actual sticks are meshed in the demo layer from
// this data; the state (which stage, how close to the next) lives in GameState.

import { NEST_STAGES } from "./state";

export interface NestStageInfo {
  /** 0 … NEST_STAGES. */
  stage: number;
  /** Short name for the HUD/journal. */
  name: string;
  /** The journal line earned on reaching this stage. */
  note: string;
  /** Visible build amount 0..1 for the mesh (sticks faded in over stages). */
  build: number;
  /** Cup radius in meters at this stage (a nest grows outward and up). */
  radius: number;
  /** Cup rim height above the spar top, meters. */
  rim: number;
}

/**
 * The five states of home. Stage 0 is the bare snag you claim on arrival;
 * each meal-funded stage adds material until the brood arrives. The notes
 * double as journal entries — building the nest is itself a thing witnessed.
 */
export const NEST_STAGE_INFO: NestStageInfo[] = [
  {
    stage: 0,
    name: "Bare spar",
    note: "A dead pine on the point, and a flat crown wide enough to stand on. Home, claimed.",
    build: 0,
    radius: 0.35,
    rim: 0.0,
  },
  {
    stage: 1,
    name: "First sticks",
    note: "A few branches wedged into the crown. It would not hold an egg, but it is a start.",
    build: 0.3,
    radius: 0.55,
    rim: 0.12,
  },
  {
    stage: 2,
    name: "The cup",
    note: "A real bowl now, deep enough to disappear into. The ospreys before you built like this.",
    build: 0.6,
    radius: 0.75,
    rim: 0.28,
  },
  {
    stage: 3,
    name: "Lined",
    note: "Moss and grass packed into the cup. Soft. The kind of place a thing could begin.",
    build: 0.85,
    radius: 0.85,
    rim: 0.36,
  },
  {
    stage: 4,
    name: "The brood",
    note: "Three pale eggs in the lined cup, and a reason to be a fish hawk that goes past hunger.",
    build: 1,
    radius: 0.9,
    rim: 0.4,
  },
];

export function nestStageInfo(stage: number): NestStageInfo {
  const i = Math.min(NEST_STAGES, Math.max(0, stage | 0));
  return NEST_STAGE_INFO[i];
}

/** Smoothly interpolated build amount between stages, for a growing animation. */
export function nestBuild(stage: number, progress01: number): number {
  const a = nestStageInfo(stage).build;
  const b = nestStageInfo(Math.min(NEST_STAGES, stage + 1)).build;
  return a + (b - a) * Math.min(1, Math.max(0, progress01));
}

/**
 * A gentle goal for the day, phrased as encouragement, never a quota. The game
 * shows one line of this at most — a nudge toward the nest, easy to ignore.
 */
export function nestGoal(stage: number, hungerWord: string): string {
  if (stage >= NEST_STAGES) {
    return hungerWord === "starving" || hungerWord === "hungry"
      ? "The brood is in. Fish for yourself now — fly for the joy of it."
      : "The nest is finished. The lake is yours to wander.";
  }
  const next = nestStageInfo(stage + 1).name.toLowerCase();
  if (hungerWord === "starving") return "Eat first. Then bring one home for the nest.";
  return `Carry a catch to the snag to build toward the ${next}.`;
}
