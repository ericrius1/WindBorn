// The game's skeleton: the few numbers a day of being an osprey turns on, and
// the localStorage save that lets a day end and the next one begin. Everything
// visible in Fish Hawk is a function of the world clock and the systems already
// built; this module is the small layer of *consequence* on top — the reasons
// to fly beyond the flying.
//
// Three quantities and a save file:
//
//   hunger    0 (full) … 1 (starving). Rises while awake, drops on a meal.
//   day       which in-game day we are on (0-based). Sleeping at the nest
//             advances it.
//   nestStage 0 … NEST_STAGES, the home growing across days as you feed there.
//
// Daylight is not stored — it IS the world clock. `daylight01` reads the hour
// and reports how much usable light is left, because a missed dive costs
// daylight, never progress. There are no fail states: starve and the day still
// ends, you just wake hungrier.

export const NEST_STAGES = 4;

/** The save shape persisted to localStorage. Plain JSON, versioned. */
export interface SaveData {
  version: number;
  day: number;
  hunger: number;
  nestStage: number;
  /** Feeds banked toward the next nest stage. */
  nestProgress: number;
  /** Total fish caught across the whole save — a soft lifetime score. */
  caught: number;
  /** Journal moment ids witnessed (mirrors the photo journal's set). */
  witnessed: string[];
}

const SAVE_VERSION = 2;
export const DEFAULT_SAVE_KEY = "fishhawk:save";

export function freshSave(): SaveData {
  return {
    version: SAVE_VERSION,
    day: 0,
    hunger: 0.35,
    nestStage: 0,
    nestProgress: 0,
    caught: 0,
    witnessed: [],
  };
}

/** Tuning for how a day wears on the bird. All rates per real second. */
export interface GameStateTuning {
  /** Hunger gained per second while awake and flying. */
  hungerRate: number;
  /** Hunger a single caught fish removes (a big fish more, see dive weight). */
  mealValue: number;
  /** Below this hunger, the bird is comfortable; above, the score nags. */
  comfort: number;
  /** Feeds needed to advance one nest stage (grows with stage). */
  feedsPerStage: number;
}

export const DEFAULT_TUNING: GameStateTuning = {
  hungerRate: 1 / 240, // ~4 minutes of flying from full to starving
  mealValue: 0.42,
  comfort: 0.55,
  feedsPerStage: 3,
};

/**
 * The mutable game state. Construct it (loading any save), advance it each
 * frame with the seconds elapsed, and call the verbs — `feed`, `sleep` — when
 * the world reports the player did the thing. It never reads three or the GPU;
 * it is the part of Fish Hawk you could play in a spreadsheet.
 */
export class GameState {
  day = 0;
  /** 0 full … 1 starving. */
  hunger = 0.35;
  nestStage = 0;
  nestProgress = 0;
  caught = 0;

  readonly witnessed = new Set<string>();
  readonly tuning: GameStateTuning;

  /** Fired when a meal is eaten (carry the fish weight 0..1 for a bigger bite). */
  onFeed: ((weight: number) => void) | null = null;
  /** Fired when the nest advances a stage. */
  onNestStage: ((stage: number) => void) | null = null;
  /** Fired when a new day begins (after sleep). */
  onNewDay: ((day: number) => void) | null = null;

  private readonly key: string;

  constructor(options: { saveKey?: string; tuning?: Partial<GameStateTuning>; load?: boolean } = {}) {
    this.key = options.saveKey ?? DEFAULT_SAVE_KEY;
    this.tuning = { ...DEFAULT_TUNING, ...options.tuning };
    if (options.load ?? true) this.load();
  }

  /** Advance the awake clock: hunger creeps up. dt is real seconds. */
  advance(dt: number): void {
    this.hunger = clamp01(this.hunger + dt * this.tuning.hungerRate);
  }

  /**
   * A caught fish goes down the hatch (in the air, or at the nest). `weight`
   * 0..1 scales how much hunger it answers — a fat trout is a real meal.
   * Returns the hunger after eating.
   */
  feed(weight = 0.5): number {
    const bite = this.tuning.mealValue * (0.6 + 0.8 * clamp01(weight));
    this.hunger = clamp01(this.hunger - bite);
    this.caught += 1;
    this.onFeed?.(weight);
    this.save();
    return this.hunger;
  }

  /**
   * Eat AT the nest: the meal counts toward growing the home. Feeds bank up;
   * enough of them advance a stage. No grind — `feedsPerStage` is small and
   * fixed, and stages cap at NEST_STAGES.
   */
  feedAtNest(weight = 0.5): { hunger: number; advanced: boolean } {
    const hunger = this.feed(weight);
    let advanced = false;
    if (this.nestStage < NEST_STAGES) {
      this.nestProgress += 1;
      const need = this.feedsPerStage(this.nestStage);
      if (this.nestProgress >= need) {
        this.nestProgress = 0;
        this.nestStage += 1;
        advanced = true;
        this.onNestStage?.(this.nestStage);
      }
    }
    this.save();
    return { hunger, advanced };
  }

  /** Feeds required to advance OUT of a given stage (gentle growth). */
  feedsPerStage(stage: number): number {
    return this.tuning.feedsPerStage + stage; // 3, 4, 5, 6 …
  }

  /** 0..1 progress toward the next nest stage. */
  get nestProgress01(): number {
    if (this.nestStage >= NEST_STAGES) return 1;
    return clamp01(this.nestProgress / this.feedsPerStage(this.nestStage));
  }

  /**
   * Roost for the night: the day rolls over, hunger eases a little overnight
   * (a resting bird burns less), and the new day starts. There is no penalty
   * for going to bed hungry — you just wake closer to the edge.
   */
  sleep(): number {
    this.day += 1;
    // A night's rest is metabolically cheap but not free.
    this.hunger = clamp01(this.hunger * 0.85 + 0.05);
    this.onNewDay?.(this.day);
    this.save();
    return this.day;
  }

  /** Record a witnessed journal moment (mirrors the photo journal). */
  witness(id: string): boolean {
    if (this.witnessed.has(id)) return false;
    this.witnessed.add(id);
    this.save();
    return true;
  }

  /** A soft status word the HUD can show without a number. */
  get hungerWord(): string {
    if (this.hunger < 0.25) return "full";
    if (this.hunger < this.tuning.comfort) return "fed";
    if (this.hunger < 0.8) return "hungry";
    return "starving";
  }

  /**
   * Daylight left in the day, 0..1, read straight from the clock hour. Light
   * runs from first glow (~5) to last light (~21); a missed dive spends this,
   * never the save. Pass the current `clock.hour`.
   */
  static daylight01(hour: number): number {
    const DAWN = 5.0;
    const DUSK = 21.0;
    if (hour <= DAWN) return 1;
    if (hour >= DUSK) return 0;
    return clamp01(1 - (hour - DAWN) / (DUSK - DAWN));
  }

  /** True in the dark hours when the bird should be roosting. */
  static isNight(hour: number): boolean {
    return hour >= 21.4 || hour <= 4.6;
  }

  // ---- persistence -------------------------------------------------------------

  toSave(): SaveData {
    return {
      version: SAVE_VERSION,
      day: this.day,
      hunger: this.hunger,
      nestStage: this.nestStage,
      nestProgress: this.nestProgress,
      caught: this.caught,
      witnessed: [...this.witnessed],
    };
  }

  apply(data: SaveData): void {
    this.day = data.day | 0;
    this.hunger = clamp01(data.hunger);
    this.nestStage = Math.min(NEST_STAGES, Math.max(0, data.nestStage | 0));
    this.nestProgress = Math.max(0, data.nestProgress | 0);
    this.caught = Math.max(0, data.caught | 0);
    this.witnessed.clear();
    for (const id of data.witnessed ?? []) this.witnessed.add(id);
  }

  save(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.toSave()));
    } catch {
      /* storage unavailable: the game still plays, it just forgets */
    }
  }

  load(): boolean {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return false;
      const data = JSON.parse(raw) as SaveData;
      // Forward-compatible: an older save (or a corrupt one) is salvaged field
      // by field, never thrown away wholesale.
      this.apply({ ...freshSave(), ...data });
      return true;
    } catch {
      return false;
    }
  }

  /** Wipe the save and start over from a fresh bird. */
  reset(): void {
    this.apply(freshSave());
    this.save();
  }

  /** True if a save exists in storage (for a "continue" vs "new game" menu). */
  static hasSave(key = DEFAULT_SAVE_KEY): boolean {
    try {
      return localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  }
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
