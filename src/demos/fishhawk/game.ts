// The Game controller — Fish Hawk assembled. This is the one object the finale
// mounts: a small state machine (title → playing → paused, with photo / settings
// / credits as overlays) wrapped around the pieces every earlier post built. It
// owns no rendering tricks of its own; it is the wiring diagram made runnable.
//
//   world      buildGameWorld — sky + lake + basin + ecosystem on one clock
//   bird       the player osprey (flight + body + the spine glue)
//   state      GameState — hunger, daylight, day, nest, the real save
//   hunt       scanForFish/bestChance — the no-marker camera lean
//   dive       scoreDive/makeCatch — every surface entry graded, a fish rolled
//   nest       feedAtNest + the growing snag mesh at NEST_SNAG
//   post       PostFxStack — hour grade, bloom, speed, photo overlays
//   audio      attachSoundscape — gesture-gated wind/water/calls/score
//   journal    the witness verb, persisted, mirrored into the save
//
// The full loop: soar the wind, spot by reading the water, dive a scored strike
// into a real fluid window, feed the hunger, carry catches to the nest to build
// it across days, and witness the day turn. Roosting at the nest after dark
// rolls the day over. No fail states — a missed dive spends light, never
// progress.

import * as THREE from "three/webgpu";
import { clock, onDisturbance, waterHeightAt, wind } from "../../lib/spine";
import { ChaseCamera, StickControls, flightState, damp, type FlightCommands } from "../../lib/flight";
import { terrainHeightAt, terrainHeightNode, NEST_SNAG, registerRidgeLift } from "../../lib/terrain";
import { FluidSim, SimSurface, SpraySystem, installSimProvider } from "../../lib/fluid";
import { BubblePlume, LensOverlay, Spray, SurfaceCrossing, buildFish, makeDepthDome } from "../../lib/underwater";
import { PostFxStack } from "../../lib/postfx";
import { Journal, type MomentContext } from "../../lib/postfx";
import {
  attachSoundscape,
  audioRunning,
  onAudioStateChange,
  resumeAudio,
  type AudioMount,
} from "../../lib/audio";
import {
  GameState,
  NEST_STAGES,
  scanForFish,
  bestChance,
  scoreDive,
  makeCatch,
  nestStageInfo,
  nestGoal,
  DEFAULT_HUNT,
  type DiveEntry,
  type HuntFish,
  type HuntRise,
} from "../../lib/game";
import type { Stage } from "./stage";
import { PilotOverlay } from "./stage";
import { PlayerBird, steerToward } from "./bird";
import {
  buildGameWorld,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_LOW,
  type GameWorld,
  type WorldQuality,
} from "./world";
import { RingPulse, fmtHour } from "./ringPulse";
import { buildNestMesh } from "./nestMesh";
import { StatusLine, Toast, Panel, buildCredits } from "./hud";

const freshCommands = (): FlightCommands => ({ bank: 0, pitch: 0, effort: 0, tuck: 0 });
const HOME = { x: 60, z: 300 };

const QUALITY_PRESETS: Record<string, WorldQuality> = {
  low: QUALITY_LOW,
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
};

const GRADE_WORD: Record<string, string> = {
  clean: "Clean catch.",
  good: "Got one.",
  scrappy: "Scrappy — but it counts.",
  miss: "Missed. Daylight spent, nothing lost.",
};

export type GamePhase = "title" | "playing" | "paused";

export interface GameOptions {
  /** Quality preset name. Default "medium". */
  quality?: "low" | "medium" | "high";
  /** localStorage save key. Default the canonical "fishhawk:save". */
  saveKey?: string;
  /** A smaller chromeless build for an in-article figure. */
  compact?: boolean;
}

function readFish(world: GameWorld): HuntFish[] {
  const s = world.school;
  if (!s) return [];
  return s.fish.map((f) => ({
    x: f.position.x,
    y: f.position.y,
    z: f.position.z,
    speed: Math.hypot(f.velocity.x, f.velocity.z),
  }));
}
function readRises(world: GameWorld): HuntRise[] {
  const s = world.school;
  if (!s) return [];
  return s.rises.map((r) => ({ x: r.x, z: r.z, time: r.time }));
}

/**
 * Build the whole game on a prepared Stage. The returned object exposes a
 * `frame(t, dt)` to drive from the stage loop, a `render()` (post or raw), the
 * DOM controls (menus), and a `dispose()` that tears down every subsystem,
 * including the audio graph and GPU targets.
 */
export class Game {
  phase: GamePhase = "title";
  private readonly state: GameState;
  private readonly saveKey: string;
  private readonly journal: Journal;
  private world: GameWorld;
  private quality: WorldQuality;
  private readonly bird = new PlayerBird();
  private readonly chase = new ChaseCamera();
  private readonly controls = new StickControls();
  private readonly overlay: PilotOverlay;
  private readonly pulse = new RingPulse(["rise", "splash"]);

  // The Splash window + Under's submarine moment.
  private readonly sim: FluidSim;
  private readonly surface: SimSurface;
  private readonly spray: SpraySystem;
  private readonly shed = new Spray(260);
  private readonly plume = new BubblePlume(180);
  private readonly crossing = new SurfaceCrossing();
  private readonly lens: LensOverlay;
  private readonly depthDome: ReturnType<typeof makeDepthDome>;

  private readonly post: PostFxStack;
  private readonly catchFish: ReturnType<typeof buildFish>;
  private readonly nest: ReturnType<typeof buildNestMesh>;
  private readonly nestTop = new THREE.Vector3();

  // Chrome.
  private readonly status: StatusLine;
  private readonly toast: Toast;
  private readonly panel: Panel;

  // Audio (lazy, gesture-gated).
  private sound: (AudioMount & { call(urgency?: number): number }) | null = null;
  private readonly offAudio: () => void;

  // Teardown.
  private readonly disposers: (() => void)[] = [];
  private readonly cmds = freshCommands();
  private idleA = 0;
  private idleFloat = 0;
  private shake = 0;
  private splashKick = 0;
  private dayMark = 0;
  private fedThisVisit = false;
  private lastScoreGrade = "";
  private camGoal = new THREE.Vector3();
  private shedAt = new THREE.Vector3();
  private prevBirdState = this.bird.state;
  private soundOn = false;

  constructor(
    private readonly stage: Stage,
    private readonly compact: boolean,
    options: GameOptions = {},
  ) {
    const scene = stage.scene;
    const camera = stage.camera;

    this.saveKey = options.saveKey ?? "fishhawk:save";
    this.state = new GameState({ saveKey: this.saveKey, load: true });
    this.journal = new Journal("fishhawk:journal");
    // Mirror any journal moments already witnessed into the save's set.
    for (const m of this.journal.witnessed()) this.state.witness(m.id);
    this.dayMark = clock.dayCount;

    this.quality = { ...QUALITY_PRESETS[options.quality ?? "medium"] };

    // -- the world ----------------------------------------------------------------------
    clock.setHour(6.4);
    clock.speed = 1;
    clock.dayLength = 720; // a twelve-minute day: long enough to feel, short to finish
    this.world = buildGameWorld(scene, {
      hour: () => clock.hour,
      focus: () => ({ x: this.bird.body.pos.x, z: this.bird.body.pos.z }),
      conductWeather: true,
      quality: this.quality,
      life: true,
      lifeCenter: HOME,
      ridgeLift: false, // ridge lift registered once below so a rebuild doesn't double it
    });
    const offLift = registerRidgeLift();
    this.disposers.push(offLift);

    // -- the splash window ----------------------------------------------------------------
    this.sim = new FluidSim(stage.renderer, {
      resolution: this.compact ? 128 : 160,
      worldSize: 28,
      center: HOME,
      depth: {
        node: (xz) => terrainHeightNode(xz).negate(),
        cpu: (x: number, z: number) => -terrainHeightAt(x, z),
      },
      mirror: true,
    });
    this.disposers.push(this.sim.attachToBus());
    this.disposers.push(installSimProvider(this.sim));
    this.surface = new SimSurface(this.sim, { env: this.world.atmosphere, extent: 2600, depthTint: true });
    (this.surface.mesh.material as THREE.MeshBasicNodeMaterial).side = THREE.DoubleSide;
    scene.add(this.surface.mesh);

    this.spray = new SpraySystem(stage.renderer, { count: this.compact ? 1024 : 2048, sim: this.sim });
    this.plume.attachToBus();
    scene.add(this.spray.sprite, this.shed.mesh, this.plume.mesh, this.pulse.group);

    // -- bird + the catch -----------------------------------------------------------------
    scene.add(this.bird.group);
    this.bird.reset(HOME.x - 150, 34, HOME.z - 110, 0.6, 11);
    this.catchFish = buildFish(0.3);
    this.catchFish.swim.value = 0.25;

    // The school the dive aims at; tryGrab finds the nearest fish to the talons,
    // and onEntry grades the dive and decides (by score) if it sticks.
    this.bird.aim = HOME;
    this.bird.tryGrab = (x, y, z, radius) => {
      const school = this.world.school;
      if (!school) return null;
      let best = -1;
      let bestD = radius;
      for (let i = 0; i < school.fish.length; i++) {
        const p = school.fish[i].position;
        const d = Math.hypot(p.x - x, p.y - y, p.z - z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best < 0) return null;
      school.fish[best].position.set(HOME.x - 20, -9, HOME.z - 30);
      return null; // the scored roll in onEntry owns the catch
    };
    this.bird.onEntry = (entry: DiveEntry) => this.onDiveEntry(entry);

    // -- the submarine moment -------------------------------------------------------------
    scene.add(camera);
    this.lens = new LensOverlay(camera, { grade: false });
    this.depthDome = makeDepthDome(280);
    this.depthDome.mesh.visible = false;
    scene.add(this.depthDome.mesh);

    // -- the nest -------------------------------------------------------------------------
    this.nest = buildNestMesh(1.6, 5);
    this.placeNest(scene);
    this.nest.setStage(this.state.nestStage, this.state.nestProgress01);

    // -- camera + input -------------------------------------------------------------------
    this.chase.distance = 6;
    this.chase.height = 1.9;
    this.chase.aimAhead = 6;
    this.chase.fovSpeedGain = 1.1;
    this.chase.fovKickGain = 0.4;
    this.chase.breathe = 0.6;
    this.chase.flapBob = 0.6;
    this.controls.expo = 0.45;
    this.overlay = new PilotOverlay(
      stage.shell.canvas,
      "A/D bank · W/S pitch · Space flap · Shift tuck · Esc to pause",
    );

    // -- post -----------------------------------------------------------------------------
    this.post = new PostFxStack(stage.renderer, scene, camera, {
      grade: true,
      bloom: true,
      speed: true,
      photo: true,
      wetLens: true,
    });

    // -- chrome ---------------------------------------------------------------------------
    this.status = new StatusLine(this.overlay.layer);
    this.toast = new Toast(this.overlay.layer);
    this.panel = new Panel(this.overlay.layer);

    // -- audio (gesture-gated) ------------------------------------------------------------
    this.offAudio = onAudioStateChange(() => {
      if (audioRunning()) this.ensureSound();
    });

    // -- splash kick + crown --------------------------------------------------------------
    this.disposers.push(
      onDisturbance((d) => {
        if (d.kind !== "splash" || d.energy < 0.3) return;
        this.spray.emit({ x: d.x, z: d.z, energy: d.energy, radius: 0.5 });
        const dist = Math.hypot(d.x - this.bird.body.pos.x, d.z - this.bird.body.pos.z);
        if (dist < 12) this.splashKick = Math.min(1, this.splashKick + d.energy * 0.6);
      }),
    );

    // -- photo toggle wiring --------------------------------------------------------------
    this.post.photo!.onToggle = (active) => {
      if (active) this.controls.detach();
      else if (this.phase === "playing") this.controls.attach(stage.shell.canvas);
    };

    this.showTitle();
  }

  // ---- nest placement -----------------------------------------------------------------

  private placeNest(scene: THREE.Scene): void {
    // The spar top in world space — where the cup sits and the bird lands.
    const top = this.nestTop;
    top.set(NEST_SNAG.x, NEST_SNAG.y + 1.0 * NEST_SNAG.scale, NEST_SNAG.z);
    this.nest.group.position.copy(top);
    scene.add(this.nest.group);
  }

  private ensureSound(): void {
    if (!this.sound) this.sound = attachSoundscape();
    this.soundOn = true;
  }

  // ---- the dive, scored ----------------------------------------------------------------

  private onDiveEntry(entry: DiveEntry): void {
    const score = scoreDive(entry);
    this.lastScoreGrade = score.grade;
    if (Math.random() < score.probability) {
      const fish = makeCatch(score);
      this.bird.carried = fish;
      this.bird.group.add(this.catchFish.group);
      this.catchFish.group.position.set(0, -0.3, 0.12);
      this.catchFish.group.rotation.set(0, 0, 0);
    }
    if (this.phase === "playing") this.toast.show(GRADE_WORD[score.grade], 2.4);
    this.sound?.call(score.grade === "clean" ? 0.8 : 0.4);
  }

  private dropCatch(eatInAir: boolean): void {
    if (!this.bird.carried) return;
    const fish = this.bird.carried;
    this.bird.group.remove(this.catchFish.group);
    this.bird.carried = null;
    if (eatInAir) this.state.feed(fish.weight); // eat on the wing
  }

  private feedAtNest(): void {
    if (!this.bird.carried || this.fedThisVisit) return;
    const fish = this.bird.carried;
    this.bird.group.remove(this.catchFish.group);
    this.bird.carried = null;
    const r = this.state.feedAtNest(fish.weight);
    this.nest.setStage(this.state.nestStage, this.state.nestProgress01);
    this.fedThisVisit = true;
    if (r.advanced) {
      const info = nestStageInfo(this.state.nestStage);
      this.toast.show(`The nest grows: ${info.name}. ${info.note}`, 5);
      this.state.witness(`nest-${this.state.nestStage}`);
    } else {
      this.toast.show(nestGoal(this.state.nestStage, this.state.hungerWord), 3.4);
    }
  }

  // ---- menus ----------------------------------------------------------------------------

  showTitle(): void {
    this.phase = "title";
    this.controls.detach();
    this.panel.clear();
    this.panel.title("Fish Hawk");
    this.panel.para(
      "An osprey on a glacial lake. Soar the wind, read the water for fish, dive a scored strike, carry the catch home, and watch the day turn. No way to lose — only daylight to spend.",
    );
    const hasSave = GameState.hasSave(this.saveKey) || this.state.caught > 0 || this.state.day > 0;
    const specs: { label: string; primary?: boolean; onClick: () => void }[] = [];
    if (hasSave) specs.push({ label: "Continue", primary: true, onClick: () => this.startPlaying() });
    specs.push({
      label: hasSave ? "New bird" : "Begin",
      primary: !hasSave,
      onClick: () => {
        this.state.reset();
        this.nest.setStage(0, 0);
        this.startPlaying();
      },
    });
    specs.push({ label: "Settings", onClick: () => this.showSettings("title") });
    specs.push({ label: "Credits", onClick: () => this.showCredits("title") });
    this.panel.buttons(specs);
    this.panel.open();
  }

  private startPlaying(): void {
    this.phase = "playing";
    this.panel.close();
    this.controls.attach(this.stage.shell.canvas);
    this.dayMark = clock.dayCount;
    if (!this.soundOn) this.toast.show("Click a sound button in the panel to hear the wind.", 3.2);
  }

  pause(): void {
    if (this.phase !== "playing") return;
    this.phase = "paused";
    this.controls.detach();
    this.panel.clear();
    this.panel.title("Paused");
    this.panel.para(`Day ${this.state.day + 1} · ${this.state.hungerWord} · ${this.state.caught} caught · nest ${nestStageInfo(this.state.nestStage).name}`);
    this.panel.buttons([
      { label: "Resume", primary: true, onClick: () => this.resume() },
      { label: "Photo mode", onClick: () => this.enterPhoto() },
      { label: "Settings", onClick: () => this.showSettings("pause") },
      { label: "Credits", onClick: () => this.showCredits("pause") },
      { label: "Quit to title", onClick: () => this.showTitle() },
    ]);
    this.panel.open();
  }

  resume(): void {
    this.phase = "playing";
    this.panel.close();
    this.controls.attach(this.stage.shell.canvas);
  }

  private enterPhoto(): void {
    this.panel.close();
    this.phase = "playing";
    this.post.photo!.enter(this.stage.camera, this.stage.shell.canvas);
    this.stage.shell.canvas.focus();
    this.toast.show("Photo mode · drag to look, WASD to move, Enter to capture, Esc to exit", 4);
  }

  private showSettings(back: "title" | "pause"): void {
    this.panel.clear();
    this.panel.title("Settings");
    this.panel.para("Quality scales the world's heaviest systems. Sound is gesture-gated by the browser — click to start it.");
    const qualityRow = this.panel.buttons([
      { label: "Quality: low", onClick: () => this.setQuality("low") },
      { label: "Quality: medium", onClick: () => this.setQuality("medium") },
      { label: "Quality: high", onClick: () => this.setQuality("high") },
    ]);
    void qualityRow;
    this.panel.buttons([
      {
        label: this.soundOn ? "Sound: on" : "Click for sound",
        onClick: () => {
          this.ensureSound();
          void resumeAudio();
        },
      },
    ]);
    this.panel.buttons([
      { label: "Back", primary: true, onClick: () => (back === "title" ? this.showTitle() : this.pause()) },
    ]);
  }

  private setQuality(name: "low" | "medium" | "high"): void {
    this.quality = { ...QUALITY_PRESETS[name] };
    this.world.dispose();
    this.world = buildGameWorld(this.stage.scene, {
      hour: () => clock.hour,
      focus: () => ({ x: this.bird.body.pos.x, z: this.bird.body.pos.z }),
      conductWeather: true,
      quality: this.quality,
      life: true,
      lifeCenter: HOME,
      ridgeLift: false,
    });
    this.toast.show(`Quality: ${name}`, 1.6);
  }

  private showCredits(back: "title" | "pause"): void {
    buildCredits(this.panel, () => (back === "title" ? this.showTitle() : this.pause()));
    this.panel.open();
  }

  // ---- the frame ------------------------------------------------------------------------

  frame(t: number, dt: number): void {
    // Photo mode freezes the world: clock paused (by PhotoMode), and we stop
    // simulating the bird/world by feeding a zero dt to the sim steps below.
    const photo = this.post.photo!;
    const active = this.phase === "playing" && !photo.active;

    if (this.phase !== "title") clock.advance(active ? dt : 0);

    // Day rollover: roosting after dark advances the day. We detect the clock's
    // own day count crossing (a full wrap) OR a deliberate night roost at the nest.
    if (clock.dayCount !== this.dayMark) {
      this.dayMark = clock.dayCount;
      this.state.sleep();
      this.nest.setStage(this.state.nestStage, this.state.nestProgress01);
    }
    if (active) this.state.advance(dt);

    // -- input / autopilot ---------------------------------------------------------------
    this.cmds.bank = 0;
    this.cmds.pitch = 0;
    this.cmds.effort = 0;
    this.cmds.tuck = 0;
    const nearNest =
      Math.hypot(this.bird.body.pos.x - this.nestTop.x, this.bird.body.pos.z - this.nestTop.z) < 7;

    if (active && this.overlay.focused) {
      this.controls.update(dt);
      this.cmds.bank = this.controls.bank;
      this.cmds.pitch = this.controls.pitch;
      this.cmds.effort = this.controls.effort;
      this.cmds.tuck = this.controls.tuck;
      this.bird.aim = HOME;
      if (this.bird.carrying && nearNest && this.bird.body.pos.y - this.nestTop.y < 5) this.feedAtNest();
    } else if (active && this.bird.state === "air") {
      // The attract-mode / hands-off autopilot: lazy circuits over the bay, the
      // occasional committed dive, carry home to feed when holding a fish.
      if (this.bird.carrying) {
        steerToward(this.bird.body, this.cmds, this.nestTop.x, this.nestTop.y + 1.5, this.nestTop.z);
        if (nearNest) this.feedAtNest();
      } else {
        this.idleA += dt * 0.2;
        steerToward(
          this.bird.body,
          this.cmds,
          HOME.x + Math.cos(this.idleA) * 80,
          32,
          HOME.z + Math.sin(this.idleA) * 80,
        );
      }
    } else if (active && this.bird.state === "float") {
      this.idleFloat += dt;
      if (this.idleFloat > 4) this.cmds.effort = 1;
    }
    if (!this.bird.carrying) this.fedThisVisit = false;

    if (active) {
      this.bird.update(dt, t, this.cmds);
      this.bird.softBounds(430, dt);
      if (this.bird.carrying && this.bird.state === "float" && this.prevBirdState !== "float")
        this.dropCatch(true);
      this.prevBirdState = this.bird.state;

      this.world.update(dt, t);
      this.sim.moveTo(this.bird.body.pos.x, this.bird.body.pos.z);
      this.sim.step(dt);
      this.surface.update(t);
      this.spray.update(dt);
      this.plume.update(dt, t);
      this.pulse.update(dt);

      const water = waterHeightAt(this.bird.body.pos.x, this.bird.body.pos.z, t);
      if (this.bird.wet > 0.03 && this.bird.body.pos.y > water + 0.15) {
        this.shedAt.set(this.bird.body.pos.x, this.bird.body.pos.y + 0.2, this.bird.body.pos.z);
        this.shed.emit(this.shedAt, this.bird.body.vel, this.bird.wet * 170, dt, 0.3, 0.8);
      }
      this.shed.update(dt, t);
    }

    // -- camera ----------------------------------------------------------------------------
    const camera = this.stage.camera;
    if (photo.active) {
      photo.update(camera, dt);
    } else if (this.bird.state === "plunge") {
      const yaw = Math.atan2(this.bird.body.vel.x, this.bird.body.vel.z);
      this.camGoal.set(
        this.bird.body.pos.x - Math.sin(yaw) * 3.2,
        Math.max(this.bird.body.pos.y + 0.55, -2.0),
        this.bird.body.pos.z - Math.cos(yaw) * 3.2,
      );
      camera.position.lerp(this.camGoal, Math.min(1, dt * 3));
      camera.lookAt(this.bird.body.pos);
    } else {
      this.chase.update(camera, this.bird.body, dt, t);
      // The hunt as a soft attention: lean the camera a touch toward the best
      // chance — never a marker. The whole "targeting system".
      if (active && this.bird.state === "air") {
        const cand = scanForFish(
          { x: this.bird.body.pos.x, z: this.bird.body.pos.z },
          readFish(this.world),
          readRises(this.world),
          t,
          { ...DEFAULT_HUNT, windSpeed: wind.speed },
        );
        const best = bestChance(cand);
        if (best) {
          camera.lookAt(
            THREE.MathUtils.lerp(this.bird.body.pos.x, best.x, 0.1 * best.worth),
            this.bird.body.pos.y,
            THREE.MathUtils.lerp(this.bird.body.pos.z, best.z, 0.1 * best.worth),
          );
        }
      }
    }
    this.shake = damp(this.shake, this.bird.body.stall + this.splashKick, 6, dt);
    this.splashKick = Math.max(0, this.splashKick - dt * 2.5);
    if (this.shake > 0.02 && !photo.active) {
      camera.position.x += (Math.random() - 0.5) * 0.07 * this.shake;
      camera.position.y += (Math.random() - 0.5) * 0.07 * this.shake;
    }

    // -- the lens --------------------------------------------------------------------------
    const camWater = waterHeightAt(camera.position.x, camera.position.z, t);
    const event = this.crossing.update(camera.position.y, camWater, dt);
    this.lens.notify(event, t);
    this.lens.update(camera, camWater, this.crossing, t);
    this.depthDome.mesh.visible = this.crossing.submergence > 0.04;
    this.depthDome.mesh.position.copy(camera.position);
    this.depthDome.camDepth.value = Math.max(0, -camera.position.y);
    this.depthDome.sunDirection.value.copy(this.world.atmosphere.sunDirection.value);

    // -- audio + journal + post ------------------------------------------------------------
    if (this.sound && audioRunning()) this.sound.update(dt);
    if (active) this.captureMoments();

    this.post.update(dt, {
      t,
      crossing: this.crossing,
      waterY: camWater,
      focusDistance: this.chase.distance + this.chase.aimAhead,
    });

    this.toast.update(dt);
    this.updateStatus();
  }

  private captureMoments(): void {
    const ctx: MomentContext = {
      hour: clock.hour,
      windSpeed: wind.speed,
      underwater: this.crossing.submergence > 0.2,
      flight: flightState,
    };
    const fresh = this.journal.capture(ctx);
    for (const m of fresh) {
      this.state.witness(m.id);
      this.toast.show(`Witnessed: ${m.title}. ${m.note}`, 4.5);
    }
  }

  private updateStatus(): void {
    if (this.phase === "title") {
      this.status.set("");
      return;
    }
    const light = Math.round(GameState.daylight01(clock.hour) * 100);
    const phase =
      this.bird.state === "plunge"
        ? "DIVE"
        : this.bird.carrying
          ? "carrying home"
          : this.bird.state === "float"
            ? "resting"
            : this.lastScoreGrade
              ? `last: ${this.lastScoreGrade}`
              : "hunting";
    this.status.set(
      `${fmtHour(clock.hour)}   day ${this.state.day + 1}\n` +
        `daylight ${light}%   ${this.state.hungerWord}\n` +
        `nest ${nestStageInfo(this.state.nestStage).name} (${this.state.nestStage}/${NEST_STAGES})\n` +
        `${phase}` +
        (this.post.photo!.active ? "   · PHOTO" : ""),
    );
  }

  /** Hook keyboard for pause/photo capture. Call once after construction. */
  bindKeys(): () => void {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === "Escape") {
        if (this.post.photo!.active) {
          this.post.photo!.exit();
          this.toast.show("Back to the lake.", 1.6);
        } else if (this.phase === "playing") this.pause();
        else if (this.phase === "paused") this.resume();
      } else if ((e.code === "KeyP" || e.code === "KeyF") && this.phase === "playing") {
        if (!this.post.photo!.active) this.enterPhoto();
      } else if (e.code === "Enter" && this.post.photo!.active) {
        const moments = this.post.photo!.shutter(this.journal, {
          hour: clock.hour,
          windSpeed: wind.speed,
          underwater: this.crossing.submergence > 0.2,
          flight: flightState,
        });
        for (const m of moments) this.state.witness(m.id);
        this.toast.show(moments.length ? `Captured: ${moments[0].title}` : "Captured.", 2);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }

  render(): void {
    this.post.render();
  }

  dispose(): void {
    this.offAudio();
    this.sound?.dispose();
    this.sound = null;
    for (const d of this.disposers) d();
    this.controls.detach();
    this.overlay.dispose();
    this.status.dispose();
    this.toast.dispose();
    this.panel.dispose();
    this.lens.dispose();
    this.depthDome.dispose();
    this.bird.dispose();
    this.catchFish.dispose();
    this.nest.dispose();
    this.world.dispose();
    this.surface.dispose();
    this.sim.dispose();
    this.spray.dispose();
    this.shed.dispose();
    this.plume.dispose();
    this.pulse.dispose();
    this.post.dispose();
  }
}
