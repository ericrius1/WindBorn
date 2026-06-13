// Demos for hunt.html — spotting without a HUD. The hero flies the bay and the
// reader learns to read it: glints off shallow fish, the moving shadow of a
// cruiser, the ring of a rise. The figures isolate the two ideas: that the
// surface state (chop) decides what is readable, and that the game's hunt
// scoring is a soft attention, never a marker — it leans the camera and warms
// the music toward the best chance, and that is all.

import * as THREE from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { clock, onDisturbance, wind } from "../../lib/spine";
import { ChaseCamera, StickControls, damp, type FlightCommands } from "../../lib/flight";
import { createDawnSky, LakeSurface, RippleRings } from "../../lib/water";
import {
  FishSchool,
  GlintField,
  fillFishInstances,
  makeFishGeometry,
  makeFishMaterial,
  type BottomSampler,
} from "../../lib/life";
import { scanForFish, bestChance, DEFAULT_HUNT, type HuntFish, type HuntRise } from "../../lib/game";
import { makeStage, PilotOverlay } from "./stage";
import { PlayerBird, steerToward } from "./bird";
import { buildGameWorld, QUALITY_MEDIUM } from "./world";
import { RingPulse, addOrbit, fmtHour } from "./ringPulse";

const freshCommands = (): FlightCommands => ({ bank: 0, pitch: 0, effort: 0, tuck: 0 });
const HOME = { x: 60, z: 300 };

/** Pull HuntFish/HuntRise out of a live FishSchool for the scoring functions. */
function readFish(school: FishSchool): HuntFish[] {
  return school.fish.map((f) => ({
    x: f.position.x,
    y: f.position.y,
    z: f.position.z,
    speed: Math.hypot(f.velocity.x, f.velocity.z),
  }));
}
function readRises(school: FishSchool): HuntRise[] {
  return school.rises.map((r) => ({ x: r.x, z: r.z, time: r.time }));
}

// ---- hero: read the water --------------------------------------------------------------

export async function mountHeroHunt(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await makeStage(el, { aspect: 0.52, fov: 55, far: 5600 });

  clock.setHour(18.6); // golden hour: the hatch is on, the water is talking
  const prevSpeed = clock.speed;
  clock.speed = 0.2;
  wind.speed = 1.4;
  ctx.onDispose(() => {
    clock.speed = prevSpeed;
  });

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
  ctx.scene.add(pulse.group, bird.group);
  bird.reset(HOME.x - 140, 40, HOME.z - 110, 0.6, 12);

  const school = world.school!;

  const chase = new ChaseCamera();
  chase.distance = 6.5;
  chase.height = 2.0;
  chase.aimAhead = 7;
  chase.fovSpeedGain = 1.0;
  chase.breathe = 0.5;
  chase.flapBob = 0.5;

  const controls = new StickControls();
  controls.expo = 0.45;
  controls.attach(ctx.shell.canvas);
  const overlay = new PilotOverlay(
    ctx.shell.canvas,
    "A/D bank · W/S pitch · Space flap · Shift tuck — there are no markers; read the glints and rings",
  );

  ctx.shell.slider({
    label: "wind (m/s)",
    min: 0,
    max: 5,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.button("reset flight", () => {
    bird.reset(HOME.x - 140, 40, HOME.z - 110, 0.6, 12);
    chase.reset();
  });
  ctx.shell.setInfo(() => {
    const cand = scanForFish(
      { x: bird.body.pos.x, z: bird.body.pos.z },
      readFish(school),
      readRises(school),
      lastT,
      { ...DEFAULT_HUNT, windSpeed: wind.speed },
    );
    const best = bestChance(cand);
    const cue = best ? `${best.cue} at ${best.range.toFixed(0)} m` : "open water";
    return `${fmtHour(clock.hour)} · ${cand.length} fish showing · best: ${cue}`;
  });

  const cmds = freshCommands();
  let idleA = 0;
  let shake = 0;
  let lastT = 0;

  ctx.onDispose(() => {
    controls.detach();
    overlay.dispose();
    bird.dispose();
    world.dispose();
    pulse.dispose();
  });

  return ctx.finish((t, dt) => {
    lastT = t;
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
      idleA += dt * 0.25;
      steerToward(bird.body, cmds, HOME.x + Math.cos(idleA) * 80, 32, HOME.z + Math.sin(idleA) * 80);
    } else if (bird.state === "float") {
      cmds.effort = 1;
    }

    bird.update(dt, t, cmds);
    bird.softBounds(430, dt);
    world.update(dt, t);
    pulse.update(dt);

    chase.update(ctx.camera, bird.body, dt, t);

    // The hunt as a soft attention: lean the camera a touch toward the best
    // chance — never a marker, just a hint the eye follows. This is the entire
    // "HUD".
    const cand = scanForFish(
      { x: bird.body.pos.x, z: bird.body.pos.z },
      readFish(school),
      readRises(school),
      t,
      { ...DEFAULT_HUNT, windSpeed: wind.speed },
    );
    const best = bestChance(cand);
    if (best && bird.state === "air") {
      ctx.camera.lookAt(
        THREE.MathUtils.lerp(bird.body.pos.x, best.x, 0.12 * best.worth),
        bird.body.pos.y,
        THREE.MathUtils.lerp(bird.body.pos.z, best.z, 0.12 * best.worth),
      );
    }

    shake = damp(shake, bird.body.stall, 6, dt);
    if (shake > 0.02) {
      ctx.camera.position.x += (Math.random() - 0.5) * 0.07 * shake;
      ctx.camera.position.y += (Math.random() - 0.5) * 0.07 * shake;
    }
  });
}

// ---- Step 1: the surface is the HUD ----------------------------------------------------
// Orbit a school in a flat tank and crank the wind: calm water mirrors a shallow
// fish as a glint, chop frosts it over and you're left reading shadows and rings.

export async function mountTelegraph(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await makeStage(el, { aspect: 0.58, fov: 50, far: 1600 });

  const sky = createDawnSky(18.4);
  ctx.scene.add(sky.makeDome(1300));
  wind.speed = 1.2;

  // Real lights so the standard-material fish read; key + fill from the sky.
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(40, 60, -30);
  const hemi = new THREE.HemisphereLight(0x90a8c8, 0x202830, 0.6);
  ctx.scene.add(sun, hemi);

  const rings = new RippleRings();
  const lake = new LakeSurface({ env: sky, rings, size: 340, segments: 200 });
  ctx.scene.add(lake.mesh);
  let now = 0;
  const offBus = onDisturbance((d) => rings.add(d, now));
  const pulse = new RingPulse(["rise"]);
  ctx.scene.add(pulse.group);

  const tank: BottomSampler = {
    heightAt: () => -7,
    gradientAt: (_x, _z, target = new THREE.Vector2()) => target.set(0, 0),
  };
  const school = new FishSchool(
    { count: 130, homeX: 0, homeZ: 0, homeRadius: 38, minColumnDepth: 2, maxColumnDepth: 30 },
    tank,
  );
  const fishGeo = makeFishGeometry();
  const fishKit = makeFishMaterial();
  const fishMesh = new THREE.InstancedMesh(fishGeo, fishKit.material, school.fish.length);
  fishMesh.frustumCulled = false;
  const glints = new GlintField(150);
  ctx.scene.add(fishMesh, glints.mesh);

  let hunger = 0.6;
  ctx.shell.slider({
    label: "feeding activity",
    min: 0,
    max: 1,
    step: 0.05,
    value: hunger,
    onInput: (v) => (hunger = v),
  });
  ctx.shell.slider({
    label: "wind (m/s)",
    min: 0,
    max: 5,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.setInfo(() => {
    const cand = scanForFish({ x: 0, z: 0 }, readFish(school), readRises(school), now, {
      ...DEFAULT_HUNT,
      windSpeed: wind.speed,
    });
    const glints = cand.filter((c) => c.cue === "glint").length;
    const shadows = cand.filter((c) => c.cue === "shadow").length;
    const rises = cand.filter((c) => c.cue === "rise").length;
    return `showing: ${glints} glints · ${shadows} shadows · ${rises} rises — chop hides glints first`;
  });

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(0, 0, 0),
    distance: 60,
    azimuth: 0.9,
    polar: 0.5,
    drift: 0.02,
  });

  ctx.onDispose(() => {
    offBus();
    orbit.dispose();
    ctx.scene.remove(sun, hemi);
    sun.dispose();
    hemi.dispose();
    sky.dispose();
    lake.dispose();
    pulse.dispose();
    fishGeo.dispose();
    fishKit.material.dispose();
    fishMesh.dispose();
    glints.dispose();
  });

  return ctx.finish((t, dt) => {
    now = t;
    school.update(dt, t, { hunger });
    fillFishInstances(fishMesh, school.fish);
    glints.update(school.fish, t, -1.0);
    pulse.update(dt);
    lake.update(t);
    orbit.update(dt);
  });
}

// ---- Step 2: attention without a marker ------------------------------------------------
// The same school, but now we visualize the hunt SCORING as a vignette that
// pulls toward the best chance — the literal thing the game does to the camera.
// Toggle it off to confirm: even with the help gone, the fish are still findable
// by eye, because the help was only ever a lean, never a label.

export async function mountAttention(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await makeStage(el, { aspect: 0.58, fov: 52, far: 1600 });

  const sky = createDawnSky(18.7);
  ctx.scene.add(sky.makeDome(1300));
  wind.speed = 1.3;
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(40, 60, -30);
  const hemi = new THREE.HemisphereLight(0x90a8c8, 0x202830, 0.6);
  ctx.scene.add(sun, hemi);

  const rings = new RippleRings();
  const lake = new LakeSurface({ env: sky, rings, size: 300, segments: 180 });
  ctx.scene.add(lake.mesh);
  let now = 0;
  const offBus = onDisturbance((d) => rings.add(d, now));
  const pulse = new RingPulse(["rise"]);
  ctx.scene.add(pulse.group);

  const tank: BottomSampler = {
    heightAt: () => -7,
    gradientAt: (_x, _z, target = new THREE.Vector2()) => target.set(0, 0),
  };
  const school = new FishSchool(
    { count: 90, homeX: 0, homeZ: 0, homeRadius: 32, minColumnDepth: 1.5, maxColumnDepth: 24 },
    tank,
  );
  const fishGeo = makeFishGeometry();
  const fishKit = makeFishMaterial();
  const fishMesh = new THREE.InstancedMesh(fishGeo, fishKit.material, school.fish.length);
  fishMesh.frustumCulled = false;
  const glints = new GlintField(120);
  ctx.scene.add(fishMesh, glints.mesh);

  // A soft halo (a flat ring) that drifts to the best chance — the attention.
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0x9fd0ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.9, 40).rotateX(-Math.PI / 2), haloMat);
  halo.position.y = 0.05;
  ctx.scene.add(halo);

  let assist = true;
  ctx.shell.button("toggle attention assist", () => (assist = !assist));
  ctx.shell.slider({
    label: "wind (m/s)",
    min: 0,
    max: 5,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.setInfo(() => {
    const cand = scanForFish({ x: 0, z: 0 }, readFish(school), readRises(school), now, {
      ...DEFAULT_HUNT,
      windSpeed: wind.speed,
    });
    const best = bestChance(cand);
    return assist
      ? best
        ? `attention: ${best.cue}, worth ${(best.worth * 100).toFixed(0)}%`
        : "attention: nothing worth a dive yet"
      : "assist off — find them by eye";
  });

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(0, 0, 0),
    distance: 50,
    azimuth: 0.8,
    polar: 0.42,
    drift: 0.015,
  });

  ctx.onDispose(() => {
    offBus();
    orbit.dispose();
    ctx.scene.remove(sun, hemi, halo);
    sun.dispose();
    hemi.dispose();
    sky.dispose();
    lake.dispose();
    pulse.dispose();
    fishGeo.dispose();
    fishKit.material.dispose();
    fishMesh.dispose();
    glints.dispose();
    halo.geometry.dispose();
    haloMat.dispose();
  });

  return ctx.finish((t, dt) => {
    now = t;
    school.update(dt, t, { hunger: 0.7 });
    fillFishInstances(fishMesh, school.fish);
    glints.update(school.fish, t, -1.0);
    pulse.update(dt);
    lake.update(t);
    orbit.update(dt);

    const best = bestChance(
      scanForFish({ x: 0, z: 0 }, readFish(school), readRises(school), t, {
        ...DEFAULT_HUNT,
        windSpeed: wind.speed,
      }),
    );
    if (assist && best) {
      halo.position.x += (best.x - halo.position.x) * Math.min(1, dt * 3);
      halo.position.z += (best.z - halo.position.z) * Math.min(1, dt * 3);
      haloMat.opacity += (0.22 * best.worth - haloMat.opacity) * Math.min(1, dt * 3);
      halo.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
    } else {
      haloMat.opacity += (0 - haloMat.opacity) * Math.min(1, dt * 4);
    }
  });
}
