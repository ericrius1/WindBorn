// The weather state machine (weather.html derives it). Three named states —
// calm, breezy, storm — each a set of TARGETS: wind speed, gustiness,
// overcast, cloud cover, rain rate. The machine never snaps; every live
// value eases toward its target with its own time constant, because real
// fronts arrive over minutes, not frames.
//
// The machine WRITES the spine wind (one wind field for the whole world: see
// src/lib/spine/wind.ts) and EMITS rain on the disturbance bus — each drop
// is an honest `disturb({kind: "rain"})` event that any listener (ripple
// rings today, the fluid sim and the rain-patter synthesizer later) can
// answer. Sky modules read `overcast`, `cloudCover` and `flash` from here.

import { disturb, wind } from "../spine";

export type WeatherKind = "calm" | "breezy" | "storm";

export interface WeatherTargets {
  /** Mean wind speed, m/s. */
  windSpeed: number;
  /** Spine gustiness, 0..1. */
  gustiness: number;
  /** Sky greyness, 0..1 (the atmosphere's `overcast` uniform). */
  overcast: number;
  /** Cloud layer coverage target, 0..1. */
  cloudCover: number;
  /** Raindrops per second across the focus disc. */
  rainRate: number;
}

export const WEATHER_TARGETS: Record<WeatherKind, WeatherTargets> = {
  calm: { windSpeed: 1.2, gustiness: 0.3, overcast: 0.06, cloudCover: 0.22, rainRate: 0 },
  breezy: { windSpeed: 5.5, gustiness: 0.55, overcast: 0.34, cloudCover: 0.46, rainRate: 0 },
  storm: { windSpeed: 11, gustiness: 0.85, overcast: 0.94, cloudCover: 0.86, rainRate: 260 },
};

/** The cycle the auto mode walks: storms build and decay through breezy. */
const CYCLE: WeatherKind[] = ["calm", "breezy", "storm", "breezy"];

export interface WeatherSystemOptions {
  /** Where rain falls: a disc on the lake. */
  focusX?: number;
  focusZ?: number;
  focusRadius?: number;
  /** Write the spine wind each update (true for live scenes). */
  driveWind?: boolean;
  /** Seconds a state holds before auto mode moves on (± half, random). */
  dwell?: number;
}

export class WeatherSystem {
  state: WeatherKind = "calm";
  /** When true the machine cycles by itself; force a state to take over. */
  auto = false;

  // Live (eased) values — read these, not the targets.
  windSpeed = WEATHER_TARGETS.calm.windSpeed;
  gustiness = WEATHER_TARGETS.calm.gustiness;
  overcast = WEATHER_TARGETS.calm.overcast;
  cloudCover = WEATHER_TARGETS.calm.cloudCover;
  rainRate = 0;
  /** Lightning, 0..1; spikes during storms and decays in ~0.4 s. */
  flash = 0;

  onChange: ((state: WeatherKind) => void) | null = null;

  focusX: number;
  focusZ: number;
  focusRadius: number;
  driveWind: boolean;

  private dwellTarget: number;
  private dwellTime = 0;
  private cycleIndex = 0;
  private rainAcc = 0;
  private readonly baseDwell: number;

  constructor(options: WeatherSystemOptions = {}) {
    this.focusX = options.focusX ?? 0;
    this.focusZ = options.focusZ ?? 0;
    this.focusRadius = options.focusRadius ?? 28;
    this.driveWind = options.driveWind ?? true;
    this.baseDwell = options.dwell ?? 18;
    this.dwellTarget = this.baseDwell;
  }

  /** Force a state (also resets the auto dwell timer). */
  set(state: WeatherKind): void {
    if (state === this.state) return;
    this.state = state;
    this.cycleIndex = CYCLE.lastIndexOf(state);
    this.dwellTime = 0;
    this.dwellTarget = this.baseDwell * (0.75 + Math.random() * 0.5);
    this.onChange?.(state);
  }

  /** Fraction of the way each value has converged to its target (rough). */
  get settled(): number {
    const t = WEATHER_TARGETS[this.state];
    const d =
      Math.abs(this.windSpeed - t.windSpeed) / 11 + Math.abs(this.overcast - t.overcast);
    return Math.max(0, 1 - d);
  }

  update(dt: number): void {
    // ---- auto transitions ------------------------------------------------------
    if (this.auto) {
      this.dwellTime += dt;
      if (this.dwellTime > this.dwellTarget) {
        this.cycleIndex = (this.cycleIndex + 1) % CYCLE.length;
        const next = CYCLE[this.cycleIndex];
        this.state = next;
        this.dwellTime = 0;
        this.dwellTarget = this.baseDwell * (0.75 + Math.random() * 0.5);
        this.onChange?.(next);
      }
    }

    // ---- ease toward targets ------------------------------------------------------
    // Each quantity has its own time constant: wind shifts in ~6 s, the sky
    // greys over ~9, rain arrives fast (~3) because a squall line is a wall.
    const t = WEATHER_TARGETS[this.state];
    const ease = (tau: number): number => 1 - Math.exp(-dt / tau);
    this.windSpeed += (t.windSpeed - this.windSpeed) * ease(6);
    this.gustiness += (t.gustiness - this.gustiness) * ease(6);
    this.overcast += (t.overcast - this.overcast) * ease(9);
    this.cloudCover += (t.cloudCover - this.cloudCover) * ease(11);
    this.rainRate += (t.rainRate - this.rainRate) * ease(3);

    if (this.driveWind) {
      wind.speed = this.windSpeed;
      wind.gustiness = this.gustiness;
    }

    // ---- rain onto the bus -----------------------------------------------------------
    // Fractional accumulator: 260 drops/s at 60 fps is ~4.3 per frame; the
    // remainder carries so the long-run rate is exact.
    this.rainAcc += this.rainRate * dt;
    let drops = Math.floor(this.rainAcc);
    this.rainAcc -= drops;
    drops = Math.min(drops, 48); // a stall shouldn't dump a monsoon at once
    for (let i = 0; i < drops; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * this.focusRadius;
      disturb({
        kind: "rain",
        x: this.focusX + Math.cos(a) * r,
        z: this.focusZ + Math.sin(a) * r,
        energy: 0.0008 + Math.random() * 0.0022,
        radius: 0.05,
      });
    }

    // ---- lightning ----------------------------------------------------------------------
    this.flash = Math.max(0, this.flash - dt * 2.4);
    if (this.state === "storm" && this.overcast > 0.75 && Math.random() < dt * 0.16) {
      this.flash = 0.55 + Math.random() * 0.45;
    }
  }
}
