// Demos for nest.html — the home that grows. Progression in Fish Hawk is
// deliberately gentle: carry a catch to the snag on the north-shore point, eat
// there, and a few meals at a time the nest fills in across days. The hero flies
// catches home to the real NEST_SNAG and watches the cup build; the figures
// isolate the stages (a scrub of the growing mesh, no flying) and the gentle-
// goal model (the no-grind math, proven in plain DOM).

import * as THREE from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { clock, wind } from "../../lib/spine";
import { ChaseCamera, StickControls, damp, type FlightCommands } from "../../lib/flight";
import { makeSnagGeometry, NEST_SNAG } from "../../lib/terrain";
import { buildFish } from "../../lib/underwater";
import {
  GameState,
  NEST_STAGES,
  nestGoal,
  nestStageInfo,
} from "../../lib/game";
import { makeStage, PilotOverlay } from "./stage";
import { PlayerBird, steerToward } from "./bird";
import { buildGameWorld, QUALITY_MEDIUM } from "./world";
import { RingPulse, addOrbit, fmtHour } from "./ringPulse";
import { buildNestMesh } from "./nestMesh";
import { StatusLine, Toast } from "./hud";

const freshCommands = (): FlightCommands => ({ bank: 0, pitch: 0, effort: 0, tuck: 0 });
const HOME = { x: 60, z: 300 };

/** The snag mesh + the growing nest, planted at NEST_SNAG (or any placement). */
function plantNest(scene: THREE.Scene): { nest: ReturnType<typeof buildNestMesh>; top: THREE.Vector3; dispose(): void } {
  const { geometry, perchOffsets } = makeSnagGeometry();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8d8474, roughness: 1, metalness: 0 });
  const snag = new THREE.Mesh(geometry, mat);
  snag.position.set(NEST_SNAG.x, NEST_SNAG.y, NEST_SNAG.z);
  snag.scale.setScalar(NEST_SNAG.scale);
  snag.rotation.y = -NEST_SNAG.yaw;
  scene.add(snag);

  // The spar top in world space — where the nest sits and the bird lands.
  const o = perchOffsets[0];
  const top = new THREE.Vector3(
    NEST_SNAG.x + o.x * NEST_SNAG.scale,
    NEST_SNAG.y + o.y * NEST_SNAG.scale,
    NEST_SNAG.z + o.z * NEST_SNAG.scale,
  );

  const nest = buildNestMesh(1.6, 5);
  nest.group.position.copy(top);
  scene.add(nest.group);

  return {
    nest,
    top,
    dispose() {
      scene.remove(snag, nest.group);
      geometry.dispose();
      mat.dispose();
      nest.dispose();
    },
  };
}

// ---- hero: carry it home -----------------------------------------------------------------

export async function mountHeroNest(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await makeStage(el, { aspect: 0.52, fov: 55, far: 5600 });

  clock.setHour(8.5);
  const prevSpeed = clock.speed;
  const prevDay = clock.dayLength;
  clock.speed = 1;
  clock.dayLength = 260;
  wind.speed = 1.6;
  ctx.onDispose(() => {
    clock.speed = prevSpeed;
    clock.dayLength = prevDay;
  });

  // The hero's own save so it can show a few stages without touching the real
  // game; start a couple of stages in so the nest already reads as a home.
  const game = new GameState({ saveKey: "fishhawk:nest-hero", load: false });
  game.nestStage = 1;

  const bird = new PlayerBird();
  const world = buildGameWorld(ctx.scene, {
    hour: () => clock.hour,
    focus: () => ({ x: bird.body.pos.x, z: bird.body.pos.z }),
    conductWeather: false,
    quality: QUALITY_MEDIUM,
    life: true,
    lifeCenter: HOME,
    ridgeLift: true,
  });
  const pulse = new RingPulse(["rise", "splash"]);
  const planted = plantNest(ctx.scene);
  planted.nest.setStage(game.nestStage, game.nestProgress01);
  ctx.scene.add(pulse.group, bird.group);
  bird.reset(HOME.x - 120, 32, HOME.z - 90, 0.6, 11);

  const school = world.school!;
  const catchFish = buildFish(0.3);
  catchFish.swim.value = 0.25;
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
    bird.group.add(catchFish.group);
    catchFish.group.position.set(0, -0.3, 0.12);
    catchFish.group.rotation.set(0, 0, 0);
    return { mass: 0.42, weight: 0.46 };
  };

  const status = new StatusLine(el);
  const toast = new Toast(el);
  game.onNestStage = (stage) => {
    toast.show(`Nest: ${nestStageInfo(stage).name} — ${nestStageInfo(stage).note}`, 4.5);
  };

  // Feeding at the nest: when the carrying bird settles near the spar top, the
  // catch goes toward the home and the cup grows.
  let fedThisVisit = false;
  const feedAtNest = (): void => {
    if (!bird.carrying || fedThisVisit) return;
    const fish = bird.carried!;
    bird.group.remove(catchFish.group);
    bird.carried = null;
    const r = game.feedAtNest(fish.weight);
    planted.nest.setStage(game.nestStage, game.nestProgress01);
    fedThisVisit = true;
    if (!r.advanced) toast.show(nestGoal(game.nestStage, game.hungerWord), 3.4);
  };

  const chase = new ChaseCamera();
  chase.distance = 6;
  chase.height = 1.9;
  chase.aimAhead = 6;
  chase.fovSpeedGain = 1.1;
  chase.breathe = 0.6;
  chase.flapBob = 0.6;

  const controls = new StickControls();
  controls.expo = 0.45;
  controls.attach(ctx.shell.canvas);
  const overlay = new PilotOverlay(
    ctx.shell.canvas,
    "A/D bank · W/S pitch · Space flap · Shift tuck — fish the bay, then carry the catch to the snag",
  );

  ctx.shell.button("reset flight", () => {
    bird.group.remove(catchFish.group);
    bird.reset(HOME.x - 120, 32, HOME.z - 90, 0.6, 11);
    chase.reset();
    fedThisVisit = false;
  });
  ctx.shell.button("reset nest", () => {
    game.nestStage = 0;
    game.nestProgress = 0;
    planted.nest.setStage(0, 0);
  });
  ctx.shell.setInfo(() => {
    const info = nestStageInfo(game.nestStage);
    return `day ${game.day + 1} · nest: ${info.name} (${game.nestStage}/${NEST_STAGES}) · ${game.hungerWord}`;
  });

  const cmds = freshCommands();
  let idleMode: "cruise" | "lineup" | "home" = "cruise";
  let idleTimer = 0;
  let idleFloat = 0;
  let shake = 0;
  let dayMark = clock.dayCount;

  ctx.onDispose(() => {
    controls.detach();
    overlay.dispose();
    status.dispose();
    toast.dispose();
    bird.dispose();
    catchFish.dispose();
    world.dispose();
    planted.dispose();
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

    const nearNest = Math.hypot(bird.body.pos.x - planted.top.x, bird.body.pos.z - planted.top.z) < 6;
    if (overlay.focused) {
      controls.update(dt);
      cmds.bank = controls.bank;
      cmds.pitch = controls.pitch;
      cmds.effort = controls.effort;
      cmds.tuck = controls.tuck;
      bird.aim = HOME;
      idleMode = "cruise";
      idleTimer = 0;
      idleFloat = 0;
      // A player who flies low over the nest with a fish feeds it.
      if (bird.carrying && nearNest && bird.body.pos.y - planted.top.y < 4) feedAtNest();
    } else {
      idleTimer += dt;
      if (bird.state === "air") {
        if (bird.carrying) {
          // Carry it home and skim the spar top to feed.
          steerToward(bird.body, cmds, planted.top.x, planted.top.y + 1.5, planted.top.z);
          if (nearNest) {
            feedAtNest();
            idleMode = "cruise";
            idleTimer = 0;
          }
        } else if (idleMode === "lineup") {
          bird.aim = HOME;
          steerToward(bird.body, cmds, HOME.x, 4, HOME.z);
          if (Math.hypot(bird.body.pos.x - HOME.x, bird.body.pos.z - HOME.z) < 26) {
            cmds.tuck = 1;
            cmds.pitch = -1;
            cmds.effort = 0;
          }
          if (idleTimer > 12) {
            idleMode = "cruise";
            idleTimer = 0;
          }
        } else {
          const a = Math.atan2(bird.body.pos.z - HOME.z, bird.body.pos.x - HOME.x) + 0.5;
          steerToward(bird.body, cmds, HOME.x + Math.cos(a) * 70, 30, HOME.z + Math.sin(a) * 70);
          if (idleTimer > 9) {
            idleMode = "lineup";
            idleTimer = 0;
          }
          fedThisVisit = false;
        }
      } else if (bird.state === "float") {
        idleFloat += dt;
        if (idleFloat > 3) cmds.effort = 1;
      }
    }
    if (!bird.carrying) fedThisVisit = false;

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

    toast.update(dt);
    status.set(
      `${fmtHour(clock.hour)}   day ${game.day + 1}\n` +
        `nest ${nestStageInfo(game.nestStage).name}\n` +
        `${bird.carrying ? "carrying home" : game.hungerWord}`,
    );
  });
}

// ---- Step 1: the stages, scrubbed --------------------------------------------------------
// No flying. Orbit the snag and feed it: each "feed at nest" advances the
// GameState, the cup grows stage by stage, and the journal note for the new
// stage appears. The growth is the whole point — a handful of meals add up to a
// place a brood could begin.

export async function mountStages(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await makeStage(el, { aspect: 0.6, fov: 48, far: 4200 });

  const world = buildGameWorld(ctx.scene, {
    hour: () => 8.5,
    focus: () => ({ x: NEST_SNAG.x, z: NEST_SNAG.z }),
    conductWeather: false,
    quality: { ...QUALITY_MEDIUM, fish: 30, swallows: 8, geese: false, eagle: false },
    life: true,
    lifeCenter: HOME,
  });
  wind.speed = 1.2;

  const game = new GameState({ saveKey: "fishhawk:nest-figure", load: false });
  const planted = plantNest(ctx.scene);
  planted.nest.setStage(game.nestStage, game.nestProgress01);

  const note = document.createElement("div");
  note.style.cssText =
    "position:absolute;left:.7rem;bottom:.7rem;max-width:78%;pointer-events:none;" +
    "font:600 .72rem ui-sans-serif,system-ui,sans-serif;color:#d7dbe6;" +
    "text-shadow:0 1px 3px rgba(0,0,0,.7);line-height:1.45;";
  ctx.shell.canvas.parentElement?.appendChild(note);
  const showNote = (): void => {
    const info = nestStageInfo(game.nestStage);
    note.textContent = `${info.name} (${game.nestStage}/${NEST_STAGES})  ·  ${info.note}`;
  };
  showNote();

  ctx.shell.button("feed at nest", () => {
    game.feedAtNest(0.5);
    planted.nest.setStage(game.nestStage, game.nestProgress01);
    showNote();
  });
  ctx.shell.button("reset nest", () => {
    game.nestStage = 0;
    game.nestProgress = 0;
    planted.nest.setStage(0, 0);
    showNote();
  });
  ctx.shell.setInfo(
    () => `feeds to next stage: ${game.nestStage >= NEST_STAGES ? "—" : game.feedsPerStage(game.nestStage)} · banked ${game.nestProgress}`,
  );

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(planted.top.x, planted.top.y + 1, planted.top.z),
    distance: 14,
    azimuth: NEST_SNAG.yaw + Math.PI,
    polar: 0.18,
    drift: 0.02,
  });

  ctx.onDispose(() => {
    orbit.dispose();
    note.remove();
    world.dispose();
    planted.dispose();
  });

  return ctx.finish((t, dt) => {
    world.update(dt, t);
    orbit.update(dt);
  });
}

// ---- Step 2: gentle goals, no grind ------------------------------------------------------
// Pure DOM. The progression model laid bare: the feeds-per-stage curve (3, 4,
// 5, 6 — small and fixed), and the single line of encouragement nestGoal()
// returns for each stage and hunger word. Proof there is no quota, no timer,
// nothing to top up — just a nudge you can ignore.

export function mountGoals(el: HTMLElement): Demo {
  el.classList.add("demo");
  const wrap = document.createElement("div");
  wrap.style.cssText =
    "display:grid;gap:.8rem;padding:1rem;font:400 .85rem/1.5 ui-sans-serif,system-ui,sans-serif;color:#d7dbe6;";
  el.appendChild(wrap);

  const game = new GameState({ saveKey: "fishhawk:nest-goals", load: false });

  // The cost curve.
  const curve = document.createElement("div");
  curve.style.cssText = "display:grid;gap:.4rem;";
  wrap.appendChild(curve);
  const ch = document.createElement("div");
  ch.style.cssText = "font:600 .78rem ui-monospace,Menlo,monospace;color:#9aa4c2;";
  ch.textContent = "meals to build each stage (small, fixed, never grows steep):";
  curve.appendChild(ch);
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:.5rem;flex-wrap:wrap;";
  for (let s = 0; s < NEST_STAGES; s++) {
    const cell = document.createElement("div");
    cell.style.cssText =
      "padding:.4rem .6rem;border-radius:.5rem;border:1px solid rgba(122,162,255,.28);" +
      "background:rgba(122,162,255,.08);font-size:.78rem;text-align:center;";
    const next = nestStageInfo(s + 1).name;
    cell.innerHTML = `<div style="color:#eaf0ff;font-weight:600">${game.feedsPerStage(s)} meals</div>` +
      `<div style="color:#9aa4c2;font-size:.7rem">→ ${next}</div>`;
    row.appendChild(cell);
  }
  curve.appendChild(row);

  // The goal line, across hunger states, for a scrubbable stage.
  const goalBox = document.createElement("div");
  goalBox.style.cssText =
    "display:grid;gap:.45rem;padding:.7rem .8rem;border-radius:.6rem;" +
    "background:rgba(10,11,16,.5);border:1px solid rgba(122,162,255,.2);";
  wrap.appendChild(goalBox);

  let stage = 0;
  const stageLabel = document.createElement("div");
  stageLabel.style.cssText = "font:600 .8rem ui-sans-serif,system-ui;color:#eaf0ff;";
  goalBox.appendChild(stageLabel);

  const goalLines = document.createElement("div");
  goalLines.style.cssText = "display:grid;gap:.3rem;font-size:.8rem;color:#cdd6ee;";
  goalBox.appendChild(goalLines);

  const render = (): void => {
    const info = nestStageInfo(stage);
    stageLabel.textContent = `Stage ${stage}/${NEST_STAGES} · ${info.name}`;
    goalLines.replaceChildren();
    for (const word of ["full", "fed", "hungry", "starving"]) {
      const line = document.createElement("div");
      const g = nestGoal(stage, word);
      line.innerHTML = `<span style="color:#9aa4c2">when ${word}:</span> ${g}`;
      goalLines.appendChild(line);
    }
  };

  const controls = document.createElement("div");
  controls.style.cssText = "display:flex;gap:.5rem;flex-wrap:wrap;";
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
  button("− stage", () => (stage = Math.max(0, stage - 1)));
  button("+ stage", () => (stage = Math.min(NEST_STAGES, stage + 1)));

  render();
  return { frame: () => {}, dispose: () => el.replaceChildren() };
}
