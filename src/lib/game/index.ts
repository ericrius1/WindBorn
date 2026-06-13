// Fish Hawk — the game's brain. Pure state and scoring, no GPU, no three: the
// part of the game you could run in a spreadsheet. The demo layer mounts this
// against the live world; reckoning.html stresses it; game.html ships it.
//
//   state       hunger / daylight / day / nest-stage with localStorage save
//   hunt        spotting math: glint/shadow/rise telegraphing, no markers
//   dive        dive scoring (angle/speed/aim/depth) and the carried-fish load
//   nest        the snag nest growing across days
//   controller  the top-level Game that wires spine + libs + postfx (in demos)

export {
  GameState,
  NEST_STAGES,
  DEFAULT_TUNING,
  DEFAULT_SAVE_KEY,
  freshSave,
  clamp01,
  type SaveData,
  type GameStateTuning,
} from "./state";
export {
  scanForFish,
  bestChance,
  fishTelegraph,
  riseFreshness,
  DEFAULT_HUNT,
  type HuntFish,
  type HuntRise,
  type HuntCandidate,
  type HuntCue,
  type HuntParams,
} from "./hunt";
export {
  scoreDive,
  leadTarget,
  timeToImpact,
  makeCatch,
  carryEffect,
  BIG_FISH_KG,
  DEFAULT_DIVE,
  type DiveEntry,
  type DiveScore,
  type DiveGrade,
  type DiveParams,
  type CarriedFish,
  type CarryEffect,
} from "./dive";
export {
  NEST_STAGE_INFO,
  nestStageInfo,
  nestBuild,
  nestGoal,
  type NestStageInfo,
} from "./nest";
