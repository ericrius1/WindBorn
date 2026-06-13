// Demos for lakeday.html — Season 3's playable milestone. The hero is the
// deliverable: one accelerated day on the world clock, flown free, with the
// whole Air & Light sky, the whole Alive ecosystem, and the whole Ear
// soundscape conducted by a single hour. The in-article figures each isolate
// one strand the day weaves together: the hour as the one knob that re-keys
// every system, the afternoon weather front easing across the lake, and the
// dusk chain — hatch, rises, swallows — assembling at golden hour.

import * as THREE from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { clock, wind } from "../../lib/spine";
import { ChaseCamera, StickControls, damp, type FlightCommands } from "../../lib/flight";
import { hatchIntensity } from "../../lib/life";
import {
  attachSoundscape,
  audioRunning,
  onAudioStateChange,
  resumeAudio,
  type AudioMount,
} from "../../lib/audio";
import { interludeCtx, PilotOverlay } from "./firstflightScene";
import { PlayerBird, steerToward } from "./playerBird";
import { buildDayWorld } from "./dayWorld";
import { addOrbit, fmtHour } from "./valley";

const freshCommands = (): FlightCommands => ({ bank: 0, pitch: 0, effort: 0, tuck: 0 });

/** The bay the school and hatch live over, on the north shore. */
const LIFE_CENTER = { x: 60, z: 300 };

// ---- a gesture-gated soundscape mount --------------------------------------------
// Browsers refuse audio without a click, and demos lazy-mount offscreen, so the
// context starts suspended. This wires attachSoundscape but only ticks it while
// the context is actually running, and exposes a button + readout for the gate.
// dispose() tears the whole graph down — no sound survives teardown.

interface SoundscapeHandle {
  update(dt: number): void;
  dispose(): void;
  running(): boolean;
}

function mountSoundscape(addButton: (label: string, onClick: () => void) => void): SoundscapeHandle {
  let sound: (AudioMount & { call(urgency?: number): number }) | null = null;
  const ensure = (): void => {
    if (!sound) sound = attachSoundscape();
  };
  addButton("click to listen", () => {
    ensure();
    void resumeAudio();
  });
  // Keep the lazy graph from being built until the first gesture; if another
  // demo already started the context, build ours so this page has sound too.
  const offState = onAudioStateChange(() => {
    if (audioRunning()) ensure();
  });
  return {
    update(dt: number) {
      if (sound && audioRunning()) sound.update(dt);
    },
    running: () => audioRunning(),
    dispose() {
      offState();
      sound?.dispose();
      sound = null;
    },
  };
}

// ---- hero: the milestone ------------------------------------------------------------

export async function mountHeroLakeday(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await interludeCtx(el, { aspect: 0.52, fov: 55, far: 5600 });

  // Start at first light and run the day fast: a ten-minute day means the
  // whole arc — dawn mist, the noon front, the dusk hatch, moonrise — passes
  // in the time the reader spends flying. The slider owns dayLength below.
  clock.setHour(5.4);
  const prevSpeed = clock.speed;
  const prevDayLength = clock.dayLength;
  clock.speed = 1;
  clock.dayLength = 600;
  ctx.onDispose(() => {
    clock.speed = prevSpeed;
    clock.dayLength = prevDayLength;
  });

  const bird = new PlayerBird();

  // The whole world, conducted by the hour. Weather is scheduled (a front
  // crosses mid-afternoon), the ecosystem lives on the north shore, the focus
  // (rain, mist drift) follows the bird.
  const world = buildDayWorld(ctx.scene, {
    hour: () => clock.hour,
    focus: () => ({ x: bird.body.pos.x, z: bird.body.pos.z }),
    conductWeather: true,
    cloudSteps: 14,
    terrain: { coreSize: 900, coreCells: 180, extent: 2800 },
    water: { coreSize: 600, coreCells: 200, extent: 2800 },
    life: { fish: 80, hatch: 140, swallows: 26, geese: true, eagle: true },
    lifeCenter: LIFE_CENTER,
  });

  ctx.scene.add(bird.group);
  bird.reset(-120, 30, 40, 0.5, 11);

  const chase = new ChaseCamera();
  chase.distance = 6;
  chase.height = 1.9;
  chase.aimAhead = 6;
  chase.fovSpeedGain = 1.1;
  chase.fovKickGain = 0.4;
  chase.breathe = 0.6;
  chase.flapBob = 0.6;

  const controls = new StickControls();
  controls.expo = 0.45;
  controls.attach(ctx.shell.canvas);
  const overlay = new PilotOverlay(
    ctx.shell.canvas,
    "A/D bank · W/S pitch · Space flap · Shift tuck — fly the day; click to listen for the wind",
  );

  const sound = mountSoundscape((label, onClick) => ctx.shell.button(label, onClick));

  ctx.shell.slider({
    label: "day length (s)",
    min: 120,
    max: 1200,
    step: 30,
    value: clock.dayLength,
    onInput: (v) => {
      // Hold the hour across the rescale so the sky doesn't jump.
      const h = clock.hour;
      clock.dayLength = v;
      clock.setHour(h);
    },
  });
  ctx.shell.button("skip ahead 3 h", () => clock.setHour(clock.hour + 3));
  ctx.shell.button("reset flight", () => {
    bird.reset(-120, 30, 40, 0.5, 11);
    chase.reset();
  });
  ctx.shell.setInfo(() => {
    const b = bird.body;
    const state =
      bird.state === "air" ? "flying" : bird.state === "float" ? "floating" : "takeoff run";
    const weather = world.weather.state;
    const ear = sound.running() ? "sound on" : "muted";
    return `${fmtHour(clock.hour)} · ${weather} · ${ear} · ${state} · alt ${Math.max(0, b.pos.y).toFixed(0)} m`;
  });

  const cmds = freshCommands();
  let idleFloat = 0;
  let shake = 0;

  ctx.onDispose(() => {
    controls.detach();
    overlay.dispose();
    sound.dispose();
    bird.dispose();
    world.dispose();
  });

  return ctx.finish((t, dt) => {
    clock.advance(dt);

    cmds.bank = 0;
    cmds.pitch = 0;
    cmds.effort = 0;
    cmds.tuck = 0;
    if (overlay.focused) {
      controls.update(dt);
      cmds.bank = controls.bank;
      cmds.pitch = controls.pitch;
      cmds.effort = controls.effort;
      cmds.tuck = controls.tuck;
      idleFloat = 0;
    } else if (bird.state === "air") {
      // Nobody at the stick: a lazy circuit, drifting toward the bay so the
      // school and hatch are usually in frame.
      const a = Math.atan2(bird.body.pos.z - LIFE_CENTER.z * 0.5, bird.body.pos.x) + 0.5;
      steerToward(bird.body, cmds, Math.cos(a) * 110, 32, LIFE_CENTER.z * 0.5 + Math.sin(a) * 110);
      idleFloat = 0;
    } else {
      idleFloat += dt;
      if (idleFloat > 6) cmds.effort = 1;
    }

    bird.update(dt, t, cmds);
    bird.softBounds(430, dt);

    chase.update(ctx.camera, bird.body, dt, t);
    shake = damp(shake, bird.body.stall, 6, dt);
    if (shake > 0.02) {
      ctx.camera.position.x += (Math.random() - 0.5) * 0.07 * shake;
      ctx.camera.position.y += (Math.random() - 0.5) * 0.07 * shake;
    }

    world.update(dt, t);
    sound.update(dt);
  });
}

// ---- Step 1: the hour is the only knob -----------------------------------------------
// One DirectionalLight, one fog color, one set of fish appetites — and a single
// scrubbable hour driving all of them. No player here; a slow orbit and a
// scrub slider, so the reader can park the day at any minute and read it.

export async function mountConductor(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await interludeCtx(el, { aspect: 0.58, fov: 52, far: 4200 });

  let scrubHour = 6.0;
  let auto = true;
  const world = buildDayWorld(ctx.scene, {
    hour: () => scrubHour,
    focus: () => LIFE_CENTER,
    conductWeather: false, // this figure is about light, not weather
    cloudSteps: 10,
    terrain: { coreSize: 800, coreCells: 150, extent: 2600 },
    water: { coreSize: 500, coreCells: 170, extent: 2600 },
    life: { fish: 60, hatch: 110, swallows: 18, geese: false, eagle: false },
    lifeCenter: LIFE_CENTER,
  });
  wind.speed = 1.6;

  const hourSlider = ctx.shell.slider({
    label: "hour",
    min: 0,
    max: 24,
    step: 0.1,
    value: scrubHour,
    onInput: (v) => {
      scrubHour = v;
      auto = false; // grabbing the scrubber takes over from the auto sweep
    },
  });
  ctx.shell.button("resume sweep", () => (auto = true));
  ctx.shell.setInfo(() => {
    const hi = hatchIntensity(scrubHour);
    return `${fmtHour(scrubHour)} · hatch ${(hi * 100).toFixed(0)}% — one hour drives sky, fog, fish, and the moon`;
  });

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(LIFE_CENTER.x, 2, LIFE_CENTER.z),
    distance: 95,
    azimuth: 0.7,
    polar: 0.32,
    drift: 0.015,
  });

  ctx.onDispose(() => {
    orbit.dispose();
    world.dispose();
  });

  return ctx.finish((t, dt) => {
    if (auto) {
      // Sweep the day in ~40 s, wrapping at midnight; the slider follows.
      scrubHour = (scrubHour + dt * (24 / 40)) % 24;
      hourSlider.value = scrubHour.toFixed(1);
    }
    world.update(dt, t);
    orbit.update(dt);
  });
}

// ---- Step 2: the front crosses ----------------------------------------------------------
// The weather machine eases every value toward its target over its own time
// constant — a front is minutes, not a frame. Force calm / breezy / storm and
// watch the wind build, the whitecaps break, the sky grey, and the rain start
// stamping rings, all at their own pace.

export async function mountFront(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await interludeCtx(el, { aspect: 0.58, fov: 52, far: 4200 });

  // Park the clock at a bright midday so the front reads against blue sky.
  let hour = 12.5;
  const world = buildDayWorld(ctx.scene, {
    hour: () => hour,
    focus: () => LIFE_CENTER,
    conductWeather: false, // the buttons drive the machine directly
    cloudSteps: 12,
    terrain: { coreSize: 800, coreCells: 150, extent: 2600 },
    water: { coreSize: 500, coreCells: 180, extent: 2600 },
    life: null,
    lifeCenter: LIFE_CENTER,
  });

  ctx.shell.button("calm", () => world.weather.set("calm"));
  ctx.shell.button("breezy", () => world.weather.set("breezy"));
  ctx.shell.button("storm", () => world.weather.set("storm"));
  ctx.shell.setInfo(() => {
    const w = world.weather;
    return `${w.state} · wind ${w.windSpeed.toFixed(1)} m/s · overcast ${(w.overcast * 100).toFixed(0)}% · rain ${w.rainRate.toFixed(0)}/s`;
  });

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(LIFE_CENTER.x, 2, LIFE_CENTER.z),
    distance: 90,
    azimuth: 1.0,
    polar: 0.22,
    drift: 0.01,
  });

  ctx.onDispose(() => {
    orbit.dispose();
    world.dispose();
  });

  return ctx.finish((t, dt) => {
    hour += dt * 0.02; // a slow drift so the light is never dead static
    world.update(dt, t);
    orbit.update(dt);
  });
}

// ---- Step 3: the dusk chain assembles ---------------------------------------------------
// The payoff event. As the clock crosses into golden hour, hatchIntensity
// climbs: mayflies rise off the water, fish rise to them (stamping rings on
// the bus), and the swallows wake up to skim the same hatch. Scrub the dusk
// window and watch the whole food chain turn on in order.

export async function mountDusk(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await interludeCtx(el, { aspect: 0.58, fov: 50, far: 3600 });

  let hour = 19.4;
  const world = buildDayWorld(ctx.scene, {
    hour: () => hour,
    focus: () => LIFE_CENTER,
    conductWeather: false,
    cloudSteps: 8,
    terrain: { coreSize: 700, coreCells: 140, extent: 2400 },
    water: { coreSize: 460, coreCells: 180, extent: 2400 },
    life: { fish: 90, hatch: 180, swallows: 30, geese: false, eagle: false },
    lifeCenter: LIFE_CENTER,
  });
  wind.speed = 1.4;

  const hourSlider = ctx.shell.slider({
    label: "dusk hour",
    min: 17,
    max: 22,
    step: 0.05,
    value: hour,
    onInput: (v) => (hour = v),
  });
  let playing = true;
  ctx.shell.button("play / pause dusk", () => (playing = !playing));
  ctx.shell.setInfo(() => {
    const hi = hatchIntensity(hour);
    const rises = world.school ? world.school.rises.length : 0;
    return `${fmtHour(hour)} · hatch ${(hi * 100).toFixed(0)}% · ${rises} rises on the bus`;
  });

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(LIFE_CENTER.x, 1, LIFE_CENTER.z + 25),
    distance: 70,
    azimuth: 0.55,
    polar: 0.18,
    drift: 0.012,
  });

  ctx.onDispose(() => {
    orbit.dispose();
    world.dispose();
  });

  return ctx.finish((t, dt) => {
    if (playing) {
      hour = Math.min(22, hour + dt * 0.12);
      if (hour >= 22) hour = 19.0; // loop the window
      hourSlider.value = hour.toFixed(2);
    }
    world.update(dt, t);
    orbit.update(dt);
  });
}
