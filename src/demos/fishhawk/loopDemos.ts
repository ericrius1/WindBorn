// Demos for loop.html — the game's skeleton. The hero flies the whole loop on
// autopilot so the reader can watch the cycle (soar → spot → dive → feed →
// daylight spent → day rolls over) with the live state printed in the readout.
// The figures isolate the two ideas that make it a game and not a flight sim:
// the GameState as a thing you can advance and save, and daylight as the one
// resource a missed dive spends.

import * as THREE from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { clock, wind } from "../../lib/spine";
import { ChaseCamera, damp, type FlightCommands } from "../../lib/flight";
import { GameState } from "../../lib/game";
import { makeStage } from "./stage";
import { PlayerBird, steerToward } from "./bird";
import { buildGameWorld, QUALITY_MEDIUM } from "./world";
import { RingPulse, addOrbit, fmtHour } from "./ringPulse";
import { StatusLine } from "./hud";

const freshCommands = (): FlightCommands => ({ bank: 0, pitch: 0, effort: 0, tuck: 0 });
const HOME = { x: 60, z: 300 };

// ---- hero: the loop, flown on its own --------------------------------------------------

export async function mountHeroLoop(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await makeStage(el, { aspect: 0.52, fov: 55, far: 5600 });

  clock.setHour(7.5);
  const prevSpeed = clock.speed;
  const prevDay = clock.dayLength;
  clock.speed = 1;
  clock.dayLength = 240; // a fast day so the loop's whole cycle shows
  wind.speed = 1.8;
  ctx.onDispose(() => {
    clock.speed = prevSpeed;
    clock.dayLength = prevDay;
  });

  // A throwaway save key so the hero never stamps on the player's real game.
  const game = new GameState({ saveKey: "fishhawk:loop-hero", load: false });

  const bird = new PlayerBird();
  const world = buildGameWorld(ctx.scene, {
    hour: () => clock.hour,
    focus: () => ({ x: bird.body.pos.x, z: bird.body.pos.z }),
    conductWeather: true,
    quality: QUALITY_MEDIUM,
    life: true,
    lifeCenter: HOME,
    ridgeLift: true,
  });
  const pulse = new RingPulse(["rise", "splash"]);
  ctx.scene.add(pulse.group, bird.group);
  bird.reset(HOME.x - 150, 34, HOME.z - 120, 0.6, 11);

  // The catch hook: a fish in talon range becomes a carried CarriedFish.
  const school = world.school!;
  bird.tryGrab = (x, y, z, radius) => {
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
    return { mass: 0.4, weight: 0.45 };
  };
  bird.onCatch = (_e, fish) => game.feed(fish.weight);

  const chase = new ChaseCamera();
  chase.distance = 6;
  chase.height = 1.9;
  chase.aimAhead = 6;
  chase.fovSpeedGain = 1.1;
  chase.fovKickGain = 0.4;
  chase.breathe = 0.6;
  chase.flapBob = 0.6;

  const status = new StatusLine(el);

  ctx.shell.setInfo(() => {
    const phase =
      bird.state === "plunge"
        ? "DIVE"
        : bird.carrying
          ? "carrying"
          : bird.state === "float"
            ? "resting"
            : "soaring";
    return `day ${game.day + 1} · ${game.hungerWord} · ${phase}`;
  });

  const cmds = freshCommands();
  let idleMode: "cruise" | "lineup" = "cruise";
  let idleTimer = 0;
  let shake = 0;
  let dayMark = clock.dayCount;

  ctx.onDispose(() => {
    status.dispose();
    bird.dispose();
    world.dispose();
    pulse.dispose();
  });

  return ctx.finish((t, dt) => {
    clock.advance(dt);
    if (clock.dayCount !== dayMark) {
      dayMark = clock.dayCount;
      game.sleep();
    }
    game.advance(dt);

    cmds.bank = 0;
    cmds.pitch = 0;
    cmds.effort = 0;
    cmds.tuck = 0;
    if (bird.state === "air") {
      idleTimer += dt;
      if (idleMode === "cruise") {
        const a = Math.atan2(bird.body.pos.z - HOME.z, bird.body.pos.x - HOME.x) + 0.55;
        steerToward(bird.body, cmds, HOME.x + Math.cos(a) * 75, 30, HOME.z + Math.sin(a) * 75);
        if (idleTimer > 12) {
          idleMode = "lineup";
          idleTimer = 0;
        }
      } else {
        bird.aim = HOME;
        steerToward(bird.body, cmds, HOME.x, 4, HOME.z);
        const d = Math.hypot(bird.body.pos.x - HOME.x, bird.body.pos.z - HOME.z);
        if (d < 26) {
          cmds.tuck = 1;
          cmds.pitch = -1;
          cmds.effort = 0;
        }
        if (idleTimer > 12) {
          idleMode = "cruise";
          idleTimer = 0;
        }
      }
    } else if (bird.state === "float") {
      idleTimer += dt;
      if (idleTimer > 3) cmds.effort = 1;
    }
    if (bird.state === "plunge") {
      idleMode = "cruise";
      idleTimer = 0;
    }

    bird.update(dt, t, cmds);
    bird.softBounds(430, dt);

    world.update(dt, t);
    pulse.update(dt);

    chase.update(ctx.camera, bird.body, dt, t);
    shake = damp(shake, bird.body.stall, 6, dt);
    if (shake > 0.02) {
      ctx.camera.position.x += (Math.random() - 0.5) * 0.07 * shake;
      ctx.camera.position.y += (Math.random() - 0.5) * 0.07 * shake;
    }

    const light = Math.round(GameState.daylight01(clock.hour) * 100);
    status.set(
      `${fmtHour(clock.hour)}   day ${game.day + 1}\n` +
        `daylight ${light}%\n` +
        `${game.hungerWord}   caught ${game.caught}`,
    );
  });
}

// ---- Step 1: the state machine, in your hands ------------------------------------------
// No 3D — a small live panel of the GameState, with the verbs as buttons and a
// real localStorage save. Advance time, dive (spend daylight), feed, sleep, and
// reload the page: the save persists. This is the whole game in a spreadsheet.

export function mountStateMachine(el: HTMLElement): Demo {
  el.classList.add("demo");
  const SAVE_KEY = "fishhawk:loop-figure";
  const game = new GameState({ saveKey: SAVE_KEY });

  // A synthetic hour we can scrub independently of any scene clock.
  let hour = 8;

  const wrap = document.createElement("div");
  wrap.style.cssText =
    "display:grid;gap:.7rem;padding:1rem;font:400 .85rem/1.5 ui-sans-serif,system-ui,sans-serif;color:#d7dbe6;";
  el.appendChild(wrap);

  const bars = document.createElement("div");
  bars.style.cssText = "display:grid;gap:.5rem;";
  wrap.appendChild(bars);

  const meter = (label: string): { set: (v01: number, text: string) => void } => {
    const row = document.createElement("div");
    const head = document.createElement("div");
    head.style.cssText = "display:flex;justify-content:space-between;font-size:.78rem;color:#9aa4c2;";
    const name = document.createElement("span");
    name.textContent = label;
    const val = document.createElement("span");
    head.append(name, val);
    const track = document.createElement("div");
    track.style.cssText = "height:.55rem;border-radius:999px;background:rgba(122,162,255,.14);overflow:hidden;";
    const fill = document.createElement("div");
    fill.style.cssText = "height:100%;width:0%;background:linear-gradient(90deg,#7aa2ff,#9fd0ff);transition:width .25s;";
    track.appendChild(fill);
    row.append(head, track);
    bars.appendChild(row);
    return {
      set: (v01, text) => {
        fill.style.width = `${Math.round(Math.max(0, Math.min(1, v01)) * 100)}%`;
        val.textContent = text;
      },
    };
  };

  const hungerBar = meter("hunger");
  const daylightBar = meter("daylight");
  const nestBar = meter("nest");

  const line = document.createElement("div");
  line.style.cssText = "font:600 .78rem ui-monospace,Menlo,monospace;color:#9aa4c2;";
  wrap.appendChild(line);

  const controls = document.createElement("div");
  controls.style.cssText = "display:flex;flex-wrap:wrap;gap:.5rem;";
  wrap.appendChild(controls);

  const button = (label: string, fn: () => void): void => {
    const b = document.createElement("button");
    b.className = "demo-button";
    b.textContent = label;
    b.addEventListener("click", () => {
      fn();
      render();
    });
    controls.appendChild(b);
  };

  const render = (): void => {
    hungerBar.set(game.hunger, game.hungerWord);
    daylightBar.set(GameState.daylight01(hour), `${fmtHour(hour)}`);
    nestBar.set(
      game.nestStage / 4 + game.nestProgress01 / 4,
      `stage ${game.nestStage}/4`,
    );
    line.textContent = `day ${game.day + 1} · caught ${game.caught} · saved to localStorage["${SAVE_KEY}"]`;
  };

  button("+1 hour (fly)", () => {
    hour = Math.min(24, hour + 1);
    game.advance(120); // an hour of flying is a chunk of hunger
  });
  button("dive (spend 20 min)", () => {
    // A dive that misses spends daylight, never progress.
    hour = Math.min(24, hour + 1 / 3);
    game.advance(40);
  });
  button("catch & eat", () => game.feed(0.5));
  button("feed at nest", () => {
    const r = game.feedAtNest(0.5);
    if (r.advanced) line.textContent = `Nest advanced to stage ${game.nestStage}!`;
  });
  button("sleep → next day", () => {
    game.sleep();
    hour = 6;
  });
  button("reset save", () => {
    game.reset();
    hour = 6;
  });

  render();
  return { frame: () => {}, dispose: () => el.replaceChildren() };
}

// ---- Step 2: daylight is the budget ----------------------------------------------------
// An orbiting school over the bay with a scrubbable hour. The point is purely
// the daylight curve: read out how much usable light is left as the hour climbs,
// and watch the fish go quiet at midday and wake at the dusk hatch — the window
// when a dive is worth spending light on.

export async function mountDaylight(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await makeStage(el, { aspect: 0.58, fov: 52, far: 4200 });

  let hour = 6.0;
  let auto = true;
  const world = buildGameWorld(ctx.scene, {
    hour: () => hour,
    focus: () => HOME,
    conductWeather: false,
    quality: { ...QUALITY_MEDIUM, geese: false, eagle: false },
    life: true,
    lifeCenter: HOME,
  });
  wind.speed = 1.5;

  const hourSlider = ctx.shell.slider({
    label: "hour",
    min: 0,
    max: 24,
    step: 0.1,
    value: hour,
    onInput: (v) => {
      hour = v;
      auto = false;
    },
  });
  ctx.shell.button("resume", () => (auto = true));
  ctx.shell.setInfo(() => {
    const light = Math.round(GameState.daylight01(hour) * 100);
    const night = GameState.isNight(hour) ? " · roost" : "";
    return `${fmtHour(hour)} · daylight ${light}% · hatch ${(world.hatchNow * 100).toFixed(0)}%${night}`;
  });

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(HOME.x, 2, HOME.z),
    distance: 92,
    azimuth: 0.7,
    polar: 0.3,
    drift: 0.014,
  });

  ctx.onDispose(() => {
    orbit.dispose();
    world.dispose();
  });

  return ctx.finish((t, dt) => {
    if (auto) {
      hour = (hour + dt * (24 / 45)) % 24;
      hourSlider.value = hour.toFixed(1);
    }
    world.update(dt, t);
    orbit.update(dt);
  });
}
