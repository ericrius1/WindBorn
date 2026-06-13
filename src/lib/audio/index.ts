// The Ear's library — procedural audio for the whole site.
//
//   context   one shared AudioContext behind one master limiter
//   noise     white/pink noise buffers and looping sources
//   wind      airspeed-driven wind synth (whoosh, hiss, scream, whump, buffet)
//   water     splash/lap/rain synthesis listening on the disturbance bus
//   call      two-voice syrinx + terrain-timed echo taps
//   score     adaptive music layers keyed to altitude / hour / weather
//
// The attach* functions below are the one-call mounts: each wires a synth to
// the live spine singletons (flightState, wind field, world clock,
// disturbance bus), returns { update(dt), dispose() }, and that's the whole
// integration. An interlude or the game calls four functions, ticks update
// in its loop, and has the complete soundscape.

export {
  audioContext,
  masterBus,
  setMasterGain,
  audioRunning,
  resumeAudio,
  onAudioStateChange,
  glide,
} from "./context";
export { whiteNoiseBuffer, pinkNoiseBuffer, noiseSource } from "./noise";
export { WindSynth, windCurves, stillAir, type WindTelemetry } from "./wind";
export {
  WaterAudio,
  scheduleSplash,
  scheduleRainGrain,
  type WaterAudioOptions,
  type SplashVoiceOptions,
} from "./water";
export {
  OspreyCall,
  EchoNetwork,
  computeEchoTaps,
  type CallOptions,
  type EchoTap,
  type EchoTapOptions,
} from "./call";
export {
  AdaptiveScore,
  layerWeights,
  equalPowerWeights,
  noteHz,
  type ScoreInputs,
} from "./score";

import { flightState } from "../flight/state";
import { clock, wind } from "../spine";
import { Vector3 } from "three";
import { masterBus } from "./context";
import { WindSynth } from "./wind";
import { WaterAudio } from "./water";
import { OspreyCall, EchoNetwork, computeEchoTaps } from "./call";
import { AdaptiveScore } from "./score";

export interface AudioMount {
  update(dt: number): void;
  dispose(): void;
}

const windSample = new Vector3();

/** Wind audio wired to the live FlightState and the spine wind field. */
export function attachWindAudio(destination: AudioNode = masterBus()): AudioMount & {
  synth: WindSynth;
} {
  const synth = new WindSynth(destination);
  let t = 0;
  return {
    synth,
    update(dt: number) {
      t += dt;
      const s = flightState;
      wind.sample(s.x, s.y, s.z, t, windSample);
      const gust = wind.speed > 0.05 ? windSample.length() / wind.speed : 1;
      synth.update(
        {
          airspeed: s.airspeed,
          flapping: s.flapping,
          flapPhase: s.flapPhase,
          stall: s.stall,
          tuck: s.tuck,
          gust,
        },
        dt,
      );
    },
    dispose: () => synth.dispose(),
  };
}

/** Water audio listening on the disturbance bus, ears at the bird. */
export function attachWaterAudio(destination: AudioNode = masterBus()): AudioMount & {
  water: WaterAudio;
} {
  const water = new WaterAudio({
    destination,
    listener: () => ({ x: flightState.x, z: flightState.z }),
  });
  let t = 0;
  return {
    water,
    update(dt: number) {
      t += dt;
      water.update(t, dt);
    },
    dispose: () => water.dispose(),
  };
}

export interface CallAudioOptions {
  destination?: AudioNode;
  /** Terrain query for echo timing; defaults to the canonical basin. */
  heightAt?: (x: number, z: number) => number;
  /** Seconds between echo-tap refreshes as the bird moves (default 0.5). */
  refreshInterval?: number;
}

/** The bird's voice + the valley's answer, taps tracking the bird. */
export function attachCallAudio(opts: CallAudioOptions = {}): AudioMount & {
  call(urgency?: number): number;
} {
  const destination = opts.destination ?? masterBus();
  const echo = new EchoNetwork(destination);
  const voice = new OspreyCall(destination);
  voice.output.connect(echo.input);
  let heightAt = opts.heightAt;
  const interval = opts.refreshInterval ?? 0.5;
  let timer = interval; // refresh on first update
  return {
    call(urgency = 0.4) {
      return voice.call({ urgency });
    },
    update(dt: number) {
      timer += dt;
      if (timer < interval) return;
      timer = 0;
      if (!heightAt) {
        // Lazy import keeps the terrain math out of pages that never call.
        void import("../terrain").then((m) => {
          heightAt ??= m.terrainHeightAt;
        });
        return;
      }
      const s = flightState;
      echo.setTaps(
        computeEchoTaps(s.x, Math.max(s.y, 2), s.z, {
          heightAt,
          heading: s.heading,
        }),
      );
    },
    dispose() {
      voice.dispose();
      echo.dispose();
    },
  };
}

/** The adaptive score keyed to the world clock, altitude, and weather. */
export function attachScoreAudio(destination: AudioNode = masterBus()): AudioMount & {
  score: AdaptiveScore;
} {
  const score = new AdaptiveScore(destination);
  return {
    score,
    update(dt: number) {
      // Weather tension: calm under ~4.5 m/s of wind, full storm by ~9.
      // TODO(ear): read the real weather state machine from src/lib/sky once
      // Air & Light publishes one; the wind-speed knee is the stand-in.
      const t = Math.min(1, Math.max(0, (wind.speed - 4.5) / 4.5));
      score.update(
        { altitude: flightState.altitude, hour: clock.hour, storm: t * t * (3 - 2 * t) },
        dt,
      );
    },
    dispose: () => score.dispose(),
  };
}

/** Everything at once — the full Fish Hawk soundscape in one call. */
export function attachSoundscape(destination: AudioNode = masterBus()): AudioMount & {
  call(urgency?: number): number;
  parts: { wind: AudioMount; water: AudioMount; calls: AudioMount; score: AudioMount };
} {
  const windM = attachWindAudio(destination);
  const waterM = attachWaterAudio(destination);
  const callsM = attachCallAudio({ destination });
  const scoreM = attachScoreAudio(destination);
  return {
    parts: { wind: windM, water: waterM, calls: callsM, score: scoreM },
    call: (urgency?: number) => callsM.call(urgency),
    update(dt: number) {
      windM.update(dt);
      waterM.update(dt);
      callsM.update(dt);
      scoreM.update(dt);
    },
    dispose() {
      windM.dispose();
      waterM.dispose();
      callsM.dispose();
      scoreM.dispose();
    },
  };
}
