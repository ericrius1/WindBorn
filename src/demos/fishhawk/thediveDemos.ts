// Demos for thedive.html — the centerpiece, scored. The flight model and the
// fluid plunge already make a dive FEEL right; this page is about whether it
// WORKED. The hero is the player diving a real fluid window at a real school,
// every surface entry graded by dive.ts and answered with a fish whose weight
// then changes the flight home. The figures isolate the scoring (a scripted
// dive with vigor/angle sliders feeding the four-factor breakdown) and the
// carry (what a heavy catch does to the bird).

import * as THREE from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { clock, onDisturbance, waterHeightAt, wind } from "../../lib/spine";
import { ChaseCamera, StickControls, damp, type FlightCommands } from "../../lib/flight";
import { createDawnSky, RippleRings } from "../../lib/water";
import { registerRidgeLift, terrainHeightAt, terrainHeightNode } from "../../lib/terrain";
import { FluidSim, SimSurface, SpraySystem, installSimProvider } from "../../lib/fluid";
import {
  BubblePlume,
  LensOverlay,
  Spray,
  SurfaceCeiling,
  SurfaceCrossing,
  buildFish,
  makeDepthDome,
} from "../../lib/underwater";
import {
  carryEffect,
  makeCatch,
  scoreDive,
  type CarriedFish,
  type DiveEntry,
  type DiveScore,
} from "../../lib/game";
import { makeStage, PilotOverlay } from "./stage";
import { PlayerBird, steerToward } from "./bird";
import { ScriptedDiver } from "./diver";
import { buildGameWorld, QUALITY_MEDIUM } from "./world";
import { RingPulse, addOrbit } from "./ringPulse";
import { StatusLine, Toast } from "./hud";

const freshCommands = (): FlightCommands => ({ bank: 0, pitch: 0, effort: 0, tuck: 0 });
const HOME = { x: 60, z: 300 };

/** A small underwater key/fill that loses red with depth — Under's recipe. */
function addBirdLights(scene: THREE.Scene): { update(depth: number): void; dispose(): void } {
  const hemi = new THREE.HemisphereLight(0x9db8d8, 0x1c2a28, 0.9);
  const sun = new THREE.DirectionalLight(0xffd9b3, 2.3);
  sun.position.set(-5, 6, 4);
  const rim = new THREE.DirectionalLight(0x6f87b8, 0.7);
  rim.position.set(4, 2, -6);
  scene.add(hemi, sun, rim);
  return {
    update(depth: number) {
      const d = Math.max(0, depth);
      sun.color.setRGB(Math.exp(-0.42 * d), 0.85 * Math.exp(-0.09 * d), 0.7 * Math.exp(-0.035 * d));
      hemi.intensity = 0.9 - Math.min(0.45, d * 0.12);
    },
    dispose() {
      scene.remove(hemi, sun, rim);
      sun.dispose();
      rim.dispose();
      hemi.dispose();
    },
  };
}

const GRADE_WORD: Record<string, string> = {
  clean: "clean catch",
  good: "good — fish aboard",
  scrappy: "scrappy, but you got one",
  miss: "missed — daylight spent, nothing lost",
};

// ---- hero: dive a real window, and find out if it worked -------------------------------

export async function mountHeroThedive(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await makeStage(el, { aspect: 0.52, fov: 55, far: 5600 });

  clock.setHour(7.6);
  const prevSpeed = clock.speed;
  clock.speed = 0.12;
  wind.speed = 1.8;
  ctx.onDispose(() => {
    clock.speed = prevSpeed;
  });

  const bird = new PlayerBird();
  const world = buildGameWorld(ctx.scene, {
    hour: () => clock.hour,
    focus: () => ({ x: bird.body.pos.x, z: bird.body.pos.z }),
    conductWeather: false,
    quality: { ...QUALITY_MEDIUM, waterCells: 0 }, // the sim sheet IS the lake here
    life: true,
    lifeCenter: HOME,
    ridgeLift: true,
  });
  const offLift = registerRidgeLift();

  // The Splash, installed for real: a 28 m window that follows the bird, depth
  // from the bathymetry, the provider swapped so every waterHeightAt answers
  // with sim + ambient. This is the water the entry angle is measured against.
  const sim = new FluidSim(ctx.renderer, {
    resolution: 160,
    worldSize: 28,
    center: HOME,
    depth: {
      node: (xz) => terrainHeightNode(xz).negate(),
      cpu: (x: number, z: number) => -terrainHeightAt(x, z),
    },
    mirror: true,
  });
  const offBus = sim.attachToBus();
  const restoreProvider = installSimProvider(sim);
  const surface = new SimSurface(sim, { env: world.atmosphere, extent: 2600, depthTint: true });
  (surface.mesh.material as THREE.MeshBasicNodeMaterial).side = THREE.DoubleSide;
  ctx.scene.add(surface.mesh);

  const spray = new SpraySystem(ctx.renderer, { count: 2048, sim });
  ctx.scene.add(spray.sprite);
  const shed = new Spray(260);
  const plume = new BubblePlume(180);
  plume.attachToBus();
  const pulse = new RingPulse(["rise", "splash"]);
  ctx.scene.add(shed.mesh, plume.mesh, pulse.group, bird.group);
  bird.reset(HOME.x - 165, 40, HOME.z - 120, 0.6, 11);

  const school = world.school!;
  const catchFish = buildFish(0.3);
  catchFish.swim.value = 0.25;

  // The hunt's worth picks the fish the dive is aiming at; the entry's miss is
  // measured against that aim, so the lead actually matters.
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
    const f = school.fish[best];
    f.position.set(HOME.x - 20, -9, HOME.z - 30);
    return null; // resolved in onEntry/onCatch via the scored roll below
  };

  // The scored grab: when a committed dive breaks the surface we grade the
  // entry, and only THEN decide (probabilistically, by the score) whether a fish
  // is in the talons — and how big. A clean steep fast dive lands a real fish; a
  // shallow slow miss spends daylight and nothing else.
  let lastScore: DiveScore | null = null;
  let lastFish: CarriedFish | null = null;
  const status = new StatusLine(el);
  const toast = new Toast(el);

  bird.onEntry = (entry: DiveEntry) => {
    const score = scoreDive(entry);
    lastScore = score;
    const hit = Math.random() < score.probability;
    if (hit) {
      const fish = makeCatch(score);
      lastFish = fish;
      bird.carried = fish;
      bird.group.add(catchFish.group);
      catchFish.group.position.set(0, -0.3, 0.12);
      catchFish.group.rotation.set(0, 0, 0);
    } else {
      lastFish = null;
    }
    toast.show(`${GRADE_WORD[score.grade]}  ·  ${(score.probability * 100).toFixed(0)}% chance`, 2.6);
  };
  const dropCatch = (): void => {
    bird.group.remove(catchFish.group);
    bird.carried = null;
  };

  // The submarine moment for the dip-through.
  ctx.scene.add(ctx.camera);
  const crossing = new SurfaceCrossing();
  const lens = new LensOverlay(ctx.camera);
  const depthDome = makeDepthDome(280);
  depthDome.mesh.visible = false;
  ctx.scene.add(depthDome.mesh);

  const chase = new ChaseCamera();
  chase.distance = 6;
  chase.height = 1.9;
  chase.aimAhead = 6;
  chase.fovSpeedGain = 1.1;
  chase.fovKickGain = 0.5;
  chase.breathe = 0.5;
  chase.flapBob = 0.6;

  const controls = new StickControls();
  controls.expo = 0.45;
  controls.attach(ctx.shell.canvas);
  const overlay = new PilotOverlay(
    ctx.shell.canvas,
    "A/D bank · W/S pitch · Space flap · Shift tuck — dive steep, fast, and lead the fish",
  );

  let splashKick = 0;
  const offSplash = onDisturbance((d) => {
    if (d.kind !== "splash" || d.energy < 0.3) return;
    spray.emit({ x: d.x, z: d.z, energy: d.energy, radius: 0.5 });
    const dist = Math.hypot(d.x - bird.body.pos.x, d.z - bird.body.pos.z);
    if (dist < 12) splashKick = Math.min(1, splashKick + d.energy * 0.6);
  });

  ctx.shell.slider({
    label: "wind (m/s)",
    min: 0,
    max: 5,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.button("reset flight", () => {
    dropCatch();
    bird.reset(HOME.x - 165, 40, HOME.z - 120, 0.6, 11);
    chase.reset();
    lastScore = null;
    lastFish = null;
  });
  ctx.shell.setInfo(() => {
    const e = bird.lastEntry;
    if (bird.state === "plunge")
      return e
        ? `PLUNGE · entry ${e.speed.toFixed(1)} m/s @ ${((e.angle * 180) / Math.PI).toFixed(0)}°`
        : "PLUNGE";
    if (lastScore)
      return `last dive: ${lastScore.grade} (${(lastScore.probability * 100).toFixed(0)}%)` +
        (lastFish ? ` · ${(lastFish.mass * 1000).toFixed(0)} g aboard` : "");
    return "line up a dive — read the rings, tuck, talons first";
  });

  const cmds = freshCommands();
  let idleMode: "cruise" | "lineup" = "cruise";
  let idleTimer = 0;
  let idleFloat = 0;
  let shake = 0;
  const camGoal = new THREE.Vector3();
  const shedAt = new THREE.Vector3();
  let prevState = bird.state;

  ctx.onDispose(() => {
    restoreProvider();
    offBus();
    offLift();
    offSplash();
    controls.detach();
    overlay.dispose();
    status.dispose();
    toast.dispose();
    lens.dispose();
    depthDome.dispose();
    bird.dispose();
    catchFish.dispose();
    world.dispose();
    surface.dispose();
    sim.dispose();
    spray.dispose();
    shed.dispose();
    plume.dispose();
    pulse.dispose();
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
      idleMode = "cruise";
      idleTimer = 0;
      idleFloat = 0;
    } else if (bird.state === "air") {
      idleTimer += dt;
      if (idleMode === "cruise") {
        const a = Math.atan2(bird.body.pos.z - HOME.z, bird.body.pos.x - HOME.x) + 0.55;
        steerToward(bird.body, cmds, HOME.x + Math.cos(a) * 70, 30, HOME.z + Math.sin(a) * 70);
        if (idleTimer > 13) {
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
        if (idleTimer > 13) {
          idleMode = "cruise";
          idleTimer = 0;
        }
      }
    } else if (bird.state === "float") {
      idleFloat += dt;
      if (idleFloat > 4) cmds.effort = 1;
    }
    if (bird.state === "plunge") {
      idleMode = "cruise";
      idleTimer = 0;
    }
    // The player aims by where they point the dive; the autopilot aims at HOME.
    if (overlay.focused && bird.state === "air") bird.aim = HOME;

    bird.update(dt, t, cmds);
    bird.softBounds(430, dt);

    if (bird.carrying && bird.state === "float" && prevState !== "float") dropCatch();
    prevState = bird.state;

    world.update(dt, t);
    sim.moveTo(bird.body.pos.x, bird.body.pos.z);
    sim.step(dt);
    surface.update(t);
    spray.update(dt);
    plume.update(dt, t);
    pulse.update(dt);

    const water = waterHeightAt(bird.body.pos.x, bird.body.pos.z, t);
    if (bird.wet > 0.03 && bird.body.pos.y > water + 0.15) {
      shedAt.set(bird.body.pos.x, bird.body.pos.y + 0.2, bird.body.pos.z);
      shed.emit(shedAt, bird.body.vel, bird.wet * 170, dt, 0.3, 0.8);
    }
    shed.update(dt, t);

    if (bird.state === "plunge") {
      const yaw = Math.atan2(bird.body.vel.x, bird.body.vel.z);
      camGoal.set(
        bird.body.pos.x - Math.sin(yaw) * 3.2,
        Math.max(bird.body.pos.y + 0.55, -2.0),
        bird.body.pos.z - Math.cos(yaw) * 3.2,
      );
      ctx.camera.position.lerp(camGoal, Math.min(1, dt * 3));
      ctx.camera.lookAt(bird.body.pos);
    } else {
      chase.update(ctx.camera, bird.body, dt, t);
    }
    shake = damp(shake, bird.body.stall + splashKick, 6, dt);
    splashKick = Math.max(0, splashKick - dt * 2.5);
    if (shake > 0.02) {
      ctx.camera.position.x += (Math.random() - 0.5) * 0.08 * shake;
      ctx.camera.position.y += (Math.random() - 0.5) * 0.08 * shake;
    }

    const camWater = waterHeightAt(ctx.camera.position.x, ctx.camera.position.z, t);
    const event = crossing.update(ctx.camera.position.y, camWater, dt);
    lens.notify(event, t);
    lens.update(ctx.camera, camWater, crossing, t);
    depthDome.mesh.visible = crossing.submergence > 0.04;
    depthDome.mesh.position.copy(ctx.camera.position);
    depthDome.camDepth.value = Math.max(0, -ctx.camera.position.y);
    depthDome.sunDirection.value.copy(world.atmosphere.sunDirection.value);

    toast.update(dt);
    const e = bird.lastEntry;
    status.set(
      `${bird.carrying ? "carrying" : bird.state === "plunge" ? "PLUNGE" : "hunting"}\n` +
        (e ? `entry ${e.speed.toFixed(1)} m/s · ${((e.angle * 180) / Math.PI).toFixed(0)}°\n` : "\n") +
        (lastScore ? `last: ${lastScore.grade}` : "no dive yet"),
    );
  });
}

// ---- Step 1: the four factors, scored -------------------------------------------------
// A scripted dive over a small fluid window, with sliders for the things the
// score reads: how hard the bird commits (down-speed → entry speed and angle)
// and from how high. A live scoreboard reads diver.lastEntry through scoreDive
// and breaks the probability into its four factors, so the product-of-factors
// is visible: starve any one and the whole dive fails.

export async function mountScoring(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await makeStage(el, { aspect: 0.62, fov: 50, far: 1600 });

  const sky = createDawnSky(7.8);
  ctx.scene.add(sky.makeDome(1200));
  wind.speed = 1.2;

  const sim = new FluidSim(ctx.renderer, { resolution: 128, worldSize: 18, mirror: true, depth: 4 });
  const offBus = sim.attachToBus();
  const surface = new SimSurface(sim, { env: sky, extent: 1200 });
  ctx.scene.add(surface.mesh);
  const spray = new SpraySystem(ctx.renderer, { count: 1024, sim });
  ctx.scene.add(spray.sprite);
  const offSplash = onDisturbance((d) => {
    if (d.kind === "splash" && d.energy > 0.3) spray.emit({ x: d.x, z: d.z, energy: d.energy, radius: 0.5 });
  });

  const lights = addBirdLights(ctx.scene);

  // A target the dive aims at, and a "fish" the diver tries to grab there.
  const target = { x: 0, z: 0 };
  let caught = false;
  const diver = new ScriptedDiver({
    altitude: 9,
    target: () => target,
    maxDepth: 2.0,
    hoverSeconds: 1.4,
    diveVigor: 1,
    grab: (x, _y, z) => {
      // The scripted catch is decided by the SCORE, not proximity: this figure
      // teaches the math, so a low-probability entry visibly fails to catch.
      if (caught || !diver.lastEntry) return false;
      const score = scoreDive(diver.lastEntry);
      const near = Math.hypot(x - target.x, z - target.z) < 1.2;
      if (near && Math.random() < score.probability) {
        caught = true;
        return true;
      }
      return false;
    },
  });
  ctx.scene.add(diver.osprey.group);

  // The scoreboard, a DOM overlay over the canvas.
  const board = document.createElement("div");
  board.style.cssText =
    "position:absolute;right:.7rem;top:.7rem;width:11.5rem;pointer-events:none;" +
    "font:600 .68rem ui-monospace,Menlo,monospace;color:#cdd6ee;" +
    "background:rgba(10,11,16,.7);border:1px solid rgba(122,162,255,.28);border-radius:.55rem;" +
    "padding:.55rem .65rem;text-shadow:0 1px 2px rgba(0,0,0,.6);";
  // The PilotOverlay-less stage: append to the canvas' parent.
  ctx.shell.canvas.parentElement?.appendChild(board);
  const factorRow = (label: string): { set: (v: number) => void } => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:.35rem;margin:.18rem 0;";
    const name = document.createElement("span");
    name.textContent = label;
    name.style.cssText = "width:3.1rem;color:#9aa4c2;";
    const track = document.createElement("div");
    track.style.cssText = "flex:1;height:.42rem;border-radius:999px;background:rgba(122,162,255,.16);overflow:hidden;";
    const fill = document.createElement("div");
    fill.style.cssText = "height:100%;width:0%;background:linear-gradient(90deg,#7aa2ff,#9fd0ff);";
    track.appendChild(fill);
    row.append(name, track);
    board.appendChild(row);
    return { set: (v) => (fill.style.width = `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`) };
  };
  const head = document.createElement("div");
  head.style.cssText = "font-size:.78rem;color:#eaf0ff;margin-bottom:.3rem;";
  board.appendChild(head);
  const fAngle = factorRow("angle");
  const fSpeed = factorRow("speed");
  const fAim = factorRow("aim");
  const fDepth = factorRow("depth");
  const probLine = document.createElement("div");
  probLine.style.cssText = "margin-top:.35rem;color:#9fd0ff;font-size:.74rem;";
  board.appendChild(probLine);

  let vigor = 1.0;
  ctx.shell.slider({
    label: "dive vigor",
    min: 0.45,
    max: 1.6,
    step: 0.05,
    value: vigor,
    onInput: (v) => {
      vigor = v;
      diver.diveVigor = v;
    },
  });
  ctx.shell.slider({
    label: "hover altitude (m)",
    min: 5,
    max: 14,
    step: 0.5,
    value: diver.altitude,
    onInput: (v) => (diver.altitude = v),
  });
  ctx.shell.slider({
    label: "lead offset (m)",
    min: -2,
    max: 2,
    step: 0.1,
    value: 0,
    onInput: (v) => (target.x = v),
  });
  ctx.shell.button("replay", () => {
    caught = false;
    diver.reset();
  });
  ctx.shell.setInfo(() => `${diver.phase} · vigor ${vigor.toFixed(2)} · entry ${diver.entrySpeed.toFixed(1)} m/s`);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(0, -0.4, 0),
    distance: 13,
    azimuth: 0.7,
    polar: 0.16,
    drift: 0.01,
  });
  const focus = new THREE.Vector3();
  let wasCaught = false;

  const render = (): void => {
    const e = diver.lastEntry;
    if (!e) {
      head.textContent = "no entry yet";
      return;
    }
    const s = scoreDive(e);
    head.textContent = `entry ${e.speed.toFixed(1)} m/s · ${((e.angle * 180) / Math.PI).toFixed(0)}°`;
    fAngle.set(s.angleScore);
    fSpeed.set(s.speedScore);
    fAim.set(s.aimScore);
    fDepth.set(s.depthScore);
    probLine.textContent = `catch ${(s.probability * 100).toFixed(0)}% — ${s.grade}${caught ? " · GRABBED" : ""}`;
  };

  ctx.onDispose(() => {
    offBus();
    offSplash();
    orbit.dispose();
    lights.dispose();
    board.remove();
    sky.dispose();
    diver.dispose();
    surface.dispose();
    sim.dispose();
    spray.dispose();
  });

  return ctx.finish((t, dt) => {
    if (wasCaught && !diver.carried) caught = false; // loop reset releases
    wasCaught = diver.carried;
    diver.update(dt, t);
    lights.update(-diver.pos.y);
    sim.moveTo(diver.pos.x, diver.pos.z);
    sim.step(dt);
    surface.update(t);
    spray.update(dt);
    focus.set(diver.pos.x, Math.min(0.2, Math.max(-1.4, diver.pos.y * 0.4)), diver.pos.z);
    orbit.target.lerp(focus, Math.min(1, dt * 1.6));
    orbit.update(dt);
    render();
  });
}

// ---- Step 2: the carry changes the flight ----------------------------------------------
// A scripted dive that always catches, then climbs home — once empty-taloned,
// once carrying a fish of a weight you set. The readout prints carryEffect's two
// numbers (less usable power, extra sink) and you watch the laden climb sag.

export async function mountCarry(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await makeStage(el, { aspect: 0.62, fov: 50, far: 1600 });

  const sky = createDawnSky(8.2);
  ctx.scene.add(sky.makeDome(1200));
  const lights = addBirdLights(ctx.scene);
  wind.speed = 1.2;

  const rings = new RippleRings();
  const ceiling = new SurfaceCeiling({ env: sky, size: 220, segments: 140, rings });
  ctx.scene.add(ceiling.mesh);
  let now = 0;
  const offBus = onDisturbance((d) => rings.add(d, now));

  // The diver and the fish it carries home.
  const catchFish = buildFish(0.32);
  let weight = 0.6;
  let load: CarriedFish = { mass: weight * 0.9, weight };
  const target = { x: 0, z: 0 };
  let carried = false;
  const diver = new ScriptedDiver({
    altitude: 8,
    target: () => target,
    maxDepth: 1.9,
    grab: (x, _y, z) => {
      if (carried) return false;
      if (Math.hypot(x - target.x, z - target.z) > 1.0) return false;
      carried = true;
      diver.osprey.group.add(catchFish.group);
      catchFish.group.position.set(0, 0.01, 0.1);
      catchFish.group.rotation.set(0, 0, 0);
      catchFish.swim.value = 0.2;
      return true;
    },
  });
  ctx.scene.add(diver.osprey.group);

  // The climb is where the carry shows: bleed the recover-phase climb speed by
  // the load's sink, scale the apparent effort. (The scripted diver climbs
  // kinematically, so we apply carryEffect as a slowing of its ascent.)
  const baseClimbY = new THREE.Vector3();

  ctx.shell.slider({
    label: "fish weight",
    min: 0,
    max: 1,
    step: 0.05,
    value: weight,
    onInput: (v) => {
      weight = v;
      load = { mass: 0.18 + v * 0.72, weight: v };
    },
  });
  ctx.shell.button("replay", () => {
    carried = false;
    diver.osprey.group.remove(catchFish.group);
    diver.reset();
  });
  ctx.shell.setInfo(() => {
    const eff = carryEffect(carried ? load : null);
    return carried
      ? `carrying ${(load.mass * 1000).toFixed(0)} g · power ×${eff.effortScale.toFixed(2)} · +${eff.sinkAccel.toFixed(2)} m/s² sink`
      : `${diver.phase} · empty talons`;
  });

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(0, -0.2, 0),
    distance: 11,
    azimuth: 0.8,
    polar: 0.2,
    drift: 0.012,
  });
  const focus = new THREE.Vector3();

  ctx.onDispose(() => {
    offBus();
    orbit.dispose();
    lights.dispose();
    sky.dispose();
    ceiling.dispose();
    diver.dispose();
    catchFish.dispose();
  });

  return ctx.finish((t, dt) => {
    now = t;
    diver.update(dt, t);
    // Apply the carry as a drag on the climb: a heavy fish keeps the bird lower.
    if (carried && (diver.phase === "climb" || diver.phase === "recover")) {
      const eff = carryEffect(load);
      baseClimbY.copy(diver.vel);
      diver.vel.y -= eff.sinkAccel * dt;
      diver.vel.y *= 1 - (1 - eff.effortScale) * 0.5;
    }
    catchFish.time.value = t;
    lights.update(-diver.pos.y);
    ceiling.update(t);
    focus.set(diver.pos.x, Math.min(2, Math.max(-1.2, diver.pos.y * 0.5)), diver.pos.z);
    orbit.target.lerp(focus, Math.min(1, dt * 1.6));
    orbit.update(dt);
  });
}
