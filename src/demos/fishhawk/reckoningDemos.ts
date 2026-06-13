// Demos for reckoning.html — performance, honestly. Every system Fish Hawk runs
// is on at once here, and the question is the only one that matters for a game:
// does it hold sixty? The hero is the full world with the post-fx stack and a
// live frame budget, plus the quality knobs that let you trade richness for
// headroom and watch the number move. The figures isolate the budget (where the
// milliseconds go, and how a preset redistributes them) and the single heaviest
// knob (cloud raymarch steps).

import * as THREE from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { clock, wind } from "../../lib/spine";
import { ChaseCamera, StickControls, damp, type FlightCommands } from "../../lib/flight";
import { PostFxStack } from "../../lib/postfx";
import { makeStage, PilotOverlay } from "./stage";
import { PlayerBird, steerToward } from "./bird";
import {
  buildGameWorld,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_LOW,
  type GameWorld,
  type WorldQuality,
} from "./world";
import { RingPulse, addOrbit, fmtHour } from "./ringPulse";
import { StatusLine } from "./hud";

const freshCommands = (): FlightCommands => ({ bank: 0, pitch: 0, effort: 0, tuck: 0 });
const HOME = { x: 60, z: 300 };

/** A rolling average of frame time (ms) → fps, smoothed so the readout is calm. */
class FrameMeter {
  ms = 16.7;
  fps = 60;
  private acc = 0;
  private n = 0;
  private last = performance.now();

  tick(): void {
    const now = performance.now();
    this.acc += now - this.last;
    this.last = now;
    this.n++;
    if (this.n >= 12) {
      this.ms = this.acc / this.n;
      this.fps = 1000 / Math.max(0.1, this.ms);
      this.acc = 0;
      this.n = 0;
    }
  }
}

// ---- hero: everything on, holding sixty -------------------------------------------------

export async function mountHeroReckoning(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await makeStage(el, { aspect: 0.52, fov: 55, far: 5600 });

  clock.setHour(17.9); // golden hour: the hatch is full, the load is heaviest
  const prevSpeed = clock.speed;
  clock.speed = 0.25;
  wind.speed = 2.0;
  ctx.onDispose(() => {
    clock.speed = prevSpeed;
  });

  // The world is rebuildable so the knobs can change its weight live.
  let quality: WorldQuality = { ...QUALITY_HIGH };
  const bird = new PlayerBird();
  let world: GameWorld = buildGameWorld(ctx.scene, {
    hour: () => clock.hour,
    focus: () => ({ x: bird.body.pos.x, z: bird.body.pos.z }),
    conductWeather: true,
    quality,
    life: true,
    lifeCenter: HOME,
    ridgeLift: true,
  });
  const pulse = new RingPulse(["rise", "splash"]);
  ctx.scene.add(pulse.group, bird.group);
  bird.reset(HOME.x - 150, 36, HOME.z - 120, 0.6, 11);

  // The full cinematic stack: hour-keyed grade + bloom, and the speed effects
  // (DOF + streaks) reading the published FlightState. This is the post Fish
  // Hawk ships with, so its cost is part of the budget.
  let post = new PostFxStack(ctx.renderer, ctx.scene, ctx.camera, {
    grade: true,
    bloom: true,
    speed: true,
    motionBlur: false,
  });

  const rebuildWorld = (): void => {
    world.dispose();
    world = buildGameWorld(ctx.scene, {
      hour: () => clock.hour,
      focus: () => ({ x: bird.body.pos.x, z: bird.body.pos.z }),
      conductWeather: true,
      quality,
      life: true,
      lifeCenter: HOME,
      ridgeLift: true,
    });
  };

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
    "A/D bank · W/S pitch · Space flap · Shift tuck — every system is on; watch the fps",
  );

  const meter = new FrameMeter();
  const status = new StatusLine(el);

  ctx.shell.button("low", () => {
    quality = { ...QUALITY_LOW };
    rebuildWorld();
  });
  ctx.shell.button("medium", () => {
    quality = { ...QUALITY_MEDIUM };
    rebuildWorld();
  });
  ctx.shell.button("high", () => {
    quality = { ...QUALITY_HIGH };
    rebuildWorld();
  });
  ctx.shell.slider({
    label: "cloud steps",
    min: 0,
    max: 20,
    step: 2,
    value: quality.cloudSteps,
    onInput: (v) => {
      quality = { ...quality, cloudSteps: v };
      rebuildWorld();
    },
  });
  ctx.shell.slider({
    label: "fish",
    min: 0,
    max: 120,
    step: 10,
    value: quality.fish,
    onInput: (v) => {
      quality = { ...quality, fish: v };
      rebuildWorld();
    },
  });
  ctx.shell.button("toggle bloom", () => {
    post.bloomScale = post.bloomScale > 0 ? 0 : 1;
  });
  ctx.shell.setInfo(
    () => `${meter.fps.toFixed(0)} fps · ${meter.ms.toFixed(1)} ms · clouds ${quality.cloudSteps} · ${quality.fish} fish`,
  );

  const cmds = freshCommands();
  let idleA = 0;
  let shake = 0;

  ctx.onDispose(() => {
    controls.detach();
    overlay.dispose();
    status.dispose();
    bird.dispose();
    world.dispose();
    pulse.dispose();
    post.dispose();
  });

  return ctx.finish(
    (t, dt) => {
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
      } else if (bird.state === "air") {
        idleA += dt * 0.22;
        steerToward(bird.body, cmds, HOME.x + Math.cos(idleA) * 85, 34, HOME.z + Math.sin(idleA) * 85);
      } else if (bird.state === "float") {
        cmds.effort = 1;
      }

      bird.update(dt, t, cmds);
      bird.softBounds(430, dt);
      world.update(dt, t);
      pulse.update(dt);

      chase.update(ctx.camera, bird.body, dt, t);
      shake = damp(shake, bird.body.stall, 6, dt);
      if (shake > 0.02) {
        ctx.camera.position.x += (Math.random() - 0.5) * 0.06 * shake;
        ctx.camera.position.y += (Math.random() - 0.5) * 0.06 * shake;
      }

      post.update(dt, { t, focusDistance: chase.distance + chase.aimAhead });
      status.set(
        `${meter.fps.toFixed(0)} fps\n${meter.ms.toFixed(1)} ms/frame\n${fmtHour(clock.hour)}`,
      );
    },
    () => {
      post.render();
      meter.tick();
    },
  );
}

// ---- Step 1: where the milliseconds go --------------------------------------------------
// The same world, orbiting, with a frame-time bar split by the cost classes a
// preset moves: sky (clouds dominate), water, terrain, life, post. We can't read
// the GPU's per-pass timers from here, so the split is an honest ESTIMATE built
// from each preset's known weights — the prose says so. The point is the SHAPE:
// clouds and water are most of the bill, and the presets trade them down first.

const COST_MODEL = (q: WorldQuality): { label: string; ms: number; color: string }[] => {
  // Rough per-system millisecond estimates at 1×, calibrated to feel right on an
  // M-series laptop; the figure is about proportion, not a profiler.
  const sky = 1.2 + q.cloudSteps * 0.42;
  const water = 1.0 + q.waterCells * 0.012;
  const terrain = 0.8 + q.terrainCells * 0.006;
  const life =
    0.4 + q.fish * 0.018 + q.hatch * 0.006 + q.swallows * 0.02 + (q.geese ? 0.5 : 0) + (q.eagle ? 0.3 : 0);
  const post = 2.4; // grade + bloom + speed, fixed-ish per frame
  return [
    { label: "sky", ms: sky, color: "#7aa2ff" },
    { label: "water", ms: water, color: "#5fd0e6" },
    { label: "terrain", ms: terrain, color: "#8fc98a" },
    { label: "life", ms: life, color: "#e6b35f" },
    { label: "post", ms: post, color: "#c98ad0" },
  ];
};

export async function mountBudget(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await makeStage(el, { aspect: 0.6, fov: 52, far: 4200 });

  let quality: WorldQuality = { ...QUALITY_HIGH };
  let world: GameWorld = buildGameWorld(ctx.scene, {
    hour: () => 18.0,
    focus: () => HOME,
    conductWeather: false,
    quality,
    life: true,
    lifeCenter: HOME,
  });
  wind.speed = 1.6;

  const rebuild = (): void => {
    world.dispose();
    world = buildGameWorld(ctx.scene, {
      hour: () => 18.0,
      focus: () => HOME,
      conductWeather: false,
      quality,
      life: true,
      lifeCenter: HOME,
    });
  };

  // The stacked budget bar, a DOM overlay.
  const panel = document.createElement("div");
  panel.style.cssText =
    "position:absolute;left:.7rem;top:.7rem;right:.7rem;pointer-events:none;" +
    "font:600 .68rem ui-monospace,Menlo,monospace;color:#cdd6ee;text-shadow:0 1px 2px rgba(0,0,0,.6);";
  ctx.shell.canvas.parentElement?.appendChild(panel);
  const headEl = document.createElement("div");
  headEl.style.cssText = "margin-bottom:.3rem;color:#eaf0ff;";
  panel.appendChild(headEl);
  const bar = document.createElement("div");
  bar.style.cssText =
    "display:flex;height:1.1rem;border-radius:.4rem;overflow:hidden;border:1px solid rgba(122,162,255,.3);background:rgba(10,11,16,.6);";
  panel.appendChild(bar);
  const legend = document.createElement("div");
  legend.style.cssText = "display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.3rem;";
  panel.appendChild(legend);

  const renderBudget = (): void => {
    const parts = COST_MODEL(quality);
    const total = parts.reduce((a, p) => a + p.ms, 0);
    const budget = 16.7; // the 60-fps line
    headEl.textContent = `est. ${total.toFixed(1)} ms / frame  ·  budget 16.7 ms (60 fps)  ·  ${total <= budget ? "under" : "OVER"}`;
    bar.replaceChildren();
    legend.replaceChildren();
    for (const p of parts) {
      const seg = document.createElement("div");
      seg.style.cssText = `width:${(p.ms / Math.max(total, budget)) * 100}%;background:${p.color};`;
      bar.appendChild(seg);
      const key = document.createElement("span");
      key.innerHTML = `<span style="display:inline-block;width:.6rem;height:.6rem;border-radius:2px;background:${p.color};vertical-align:middle"></span> ${p.label} ${p.ms.toFixed(1)}`;
      legend.appendChild(key);
    }
  };

  ctx.shell.button("low", () => {
    quality = { ...QUALITY_LOW };
    rebuild();
    renderBudget();
  });
  ctx.shell.button("medium", () => {
    quality = { ...QUALITY_MEDIUM };
    rebuild();
    renderBudget();
  });
  ctx.shell.button("high", () => {
    quality = { ...QUALITY_HIGH };
    rebuild();
    renderBudget();
  });
  ctx.shell.setInfo(() => `clouds ${quality.cloudSteps} · ${quality.fish} fish · ${quality.waterCells} water cells`);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(HOME.x, 2, HOME.z),
    distance: 95,
    azimuth: 0.7,
    polar: 0.3,
    drift: 0.015,
  });

  renderBudget();

  ctx.onDispose(() => {
    orbit.dispose();
    panel.remove();
    world.dispose();
  });

  return ctx.finish((t, dt) => {
    world.update(dt, t);
    orbit.update(dt);
  });
}

// ---- Step 2: the heaviest knob ----------------------------------------------------------
// The single most expensive thing in the world is the volumetric cloud march.
// Slide its step count from 0 (flat sky, cheapest) to 20 (lush, dearest) over an
// orbiting world and watch the measured fps move with it — the clearest example
// of a scaling knob earning its place.

export async function mountKnobs(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await makeStage(el, { aspect: 0.6, fov: 52, far: 4600 });

  let cloudSteps = 14;
  let quality: WorldQuality = { ...QUALITY_MEDIUM, cloudSteps };
  let world: GameWorld = buildGameWorld(ctx.scene, {
    hour: () => 11.0,
    focus: () => HOME,
    conductWeather: false,
    quality,
    life: true,
    lifeCenter: HOME,
  });
  wind.speed = 2.4; // some cloud to actually march

  const rebuild = (): void => {
    world.dispose();
    quality = { ...QUALITY_MEDIUM, cloudSteps };
    world = buildGameWorld(ctx.scene, {
      hour: () => 11.0,
      focus: () => HOME,
      conductWeather: false,
      quality,
      life: true,
      lifeCenter: HOME,
    });
  };

  const meter = new FrameMeter();
  ctx.shell.slider({
    label: "cloud raymarch steps",
    min: 0,
    max: 20,
    step: 2,
    value: cloudSteps,
    onInput: (v) => {
      cloudSteps = v;
      rebuild();
    },
  });
  ctx.shell.setInfo(
    () =>
      `${meter.fps.toFixed(0)} fps · ${meter.ms.toFixed(1)} ms · ${cloudSteps} steps ${cloudSteps === 0 ? "(flat sky)" : ""}`,
  );

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(HOME.x, 6, HOME.z),
    distance: 80,
    azimuth: 0.9,
    polar: 0.34,
    drift: 0.02,
  });

  ctx.onDispose(() => {
    orbit.dispose();
    world.dispose();
  });

  return ctx.finish(
    (t, dt) => {
      world.update(dt, t);
      orbit.update(dt);
    },
    () => {
      ctx.renderer.render(ctx.scene, ctx.camera);
      meter.tick();
    },
  );
}
