// Demos for firstcatch.html — Season 2's playable milestone. The hero is
// the deliverable: the Basin's valley and bathymetry, The Splash's moving
// fluid window, and Under's submarine moment, all hanging off the same
// player-driven bird that First Flight built. The in-article figures each
// isolate one seam: the surface as the HUD, the sim window chasing the
// dive, and the grab itself in slow motion.

import * as THREE from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { clock, onDisturbance, waterHeightAt, wind } from "../../lib/spine";
import { ChaseCamera, StickControls, damp, type FlightCommands } from "../../lib/flight";
import { createDawnSky, LakeSurface, RippleRings } from "../../lib/water";
import { registerRidgeLift, terrainHeightAt, terrainHeightNode } from "../../lib/terrain";
import { FluidSim, SimSurface, SpraySystem, installSimProvider } from "../../lib/fluid";
import {
  BubblePlume,
  FishCruiser,
  LensOverlay,
  Spray,
  SurfaceCeiling,
  SurfaceCrossing,
  buildFish,
  makeDepthDome,
} from "../../lib/underwater";
import {
  FishSchool,
  GlintField,
  fillFishInstances,
  makeFishGeometry,
  makeFishMaterial,
  type BottomSampler,
} from "../../lib/life";
import { interludeCtx, PilotOverlay } from "./firstflightScene";
import { PlayerBird, steerToward } from "./playerBird";
import { ScriptedDiver } from "./scriptedDive";
import { RingPulse, addOrbit, makeValleyTerrain, syncSunToSky, addBirdLights } from "./valley";

const freshCommands = (): FlightCommands => ({ bank: 0, pitch: 0, effort: 0, tuck: 0 });

/** The school's bay: shallows on the north shore where fish cruise. */
const HOME = { x: 60, z: 300 };

// ---- hero: the milestone ---------------------------------------------------------

export async function mountHeroFirstcatch(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await interludeCtx(el, { aspect: 0.52, fov: 55, far: 5600 });

  // One morning, gently advancing. The dawn-sky window tops out at nine.
  clock.setHour(7.0);
  const prevSpeed = clock.speed;
  clock.speed = 0.15;
  wind.speed = 2.2;
  ctx.onDispose(() => {
    clock.speed = prevSpeed;
  });

  const sky = createDawnSky(clock.hour);
  ctx.scene.add(sky.makeDome(3800));
  const lights = syncSunToSky(ctx.scene, sky);
  const terrain = makeValleyTerrain({ env: sky, coreSize: 900, coreCells: 180, extent: 2800 });
  ctx.scene.add(terrain.mesh);
  const offLift = registerRidgeLift();

  // The Splash, installed for real: a 28 m window that follows the bird,
  // its depth term read straight from the bathymetry, the provider swapped
  // so every waterHeightAt on the page answers with sim + ambient.
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
  const surface = new SimSurface(sim, { env: sky, extent: 2600, depthTint: true });
  // The plunge looks back up through this sheet; render both faces.
  (surface.mesh.material as THREE.MeshBasicNodeMaterial).side = THREE.DoubleSide;
  ctx.scene.add(surface.mesh);

  const spray = new SpraySystem(ctx.renderer, { count: 2048, sim });
  ctx.scene.add(spray.sprite);
  const shed = new Spray(260);
  const plume = new BubblePlume(180);
  plume.attachToBus();
  const rings = new RingPulse(["rise", "splash"]);
  ctx.scene.add(shed.mesh, plume.mesh, rings.group);

  // The quarry: a real school over the north-shore shallows. Rises go out
  // on the bus; the sim, the rings, and the bubbles all answer.
  const school = new FishSchool({ count: 90, homeX: HOME.x, homeZ: HOME.z, homeRadius: 55 });
  const fishGeo = makeFishGeometry();
  const fishKit = makeFishMaterial();
  const fishMesh = new THREE.InstancedMesh(fishGeo, fishKit.material, school.fish.length);
  fishMesh.frustumCulled = false;
  const glints = new GlintField(120);
  ctx.scene.add(fishMesh, glints.mesh);

  const bird = new PlayerBird();
  ctx.scene.add(bird.group);
  bird.reset(HOME.x - 170, 38, HOME.z - 120, 0.6, 11);

  // The catch: grabbing pulls the nearest schooling fish into the talons
  // (the school member dives for the deep hole; this mesh rides the bird).
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
    if (best < 0) return false;
    const f = school.fish[best];
    f.position.set(HOME.x - 20, -9, HOME.z - 30);
    f.velocity.set(0.4, -0.5, 0.3);
    bird.group.add(catchFish.group);
    catchFish.group.position.set(0, -0.3, 0.12);
    catchFish.group.rotation.set(0, 0, 0);
    return true;
  };
  const dropCatch = (): void => {
    bird.group.remove(catchFish.group);
    bird.carrying = false;
  };

  // The submarine moment, for the lens: crossing state + meniscus/droplet
  // overlay + a depth dome that stands in for "water in every direction".
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
    "A/D bank · W/S pitch · Space flap · Shift tuck — read the rings, dive steep, talons first",
  );

  // Crown spray + camera kick on every hard splash, wherever it came from.
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
    bird.reset(HOME.x - 170, 38, HOME.z - 120, 0.6, 11);
    chase.reset();
  });
  ctx.shell.setInfo(() => {
    const b = bird.body;
    const state =
      bird.state === "air"
        ? "flying"
        : bird.state === "float"
          ? "floating"
          : bird.state === "run"
            ? "takeoff run"
            : "PLUNGE";
    const entry = bird.entrySpeed > 0 ? ` · entry ${bird.entrySpeed.toFixed(1)} m/s` : "";
    const fish = bird.carrying ? " · fish aboard" : "";
    return `${state} · V ${b.airspeed.toFixed(1)} m/s · alt ${b.pos.y.toFixed(1)} m${entry}${fish}`;
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
    offSplash();
    offLift();
    controls.detach();
    overlay.dispose();
    lens.dispose();
    depthDome.dispose();
    bird.dispose();
    catchFish.dispose();
    fishGeo.dispose();
    fishKit.material.dispose();
    fishMesh.dispose();
    glints.dispose();
    school.fish.length = 0;
    terrain.dispose();
    lights.dispose();
    sky.dispose();
    surface.dispose();
    sim.dispose();
    spray.dispose();
    shed.dispose();
    plume.dispose();
    rings.dispose();
  });

  return ctx.finish((t, dt) => {
    clock.advance(dt);
    sky.setHour(Math.min(clock.hour, 8.9));
    lights.sync();

    // -- commands: the player, or the autopilot showing the loop ----------------
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
      idleMode = "cruise";
      idleTimer = 0;
    } else if (bird.state === "air") {
      idleTimer += dt;
      if (idleMode === "cruise") {
        const a = Math.atan2(bird.body.pos.z - HOME.z, bird.body.pos.x - HOME.x) + 0.55;
        steerToward(bird.body, cmds, HOME.x + Math.cos(a) * 75, 30, HOME.z + Math.sin(a) * 75);
        if (idleTimer > 16) {
          idleMode = "lineup";
          idleTimer = 0;
        }
      } else {
        // Carry the approach over the school, then commit.
        steerToward(bird.body, cmds, HOME.x, 4, HOME.z);
        const d = Math.hypot(bird.body.pos.x - HOME.x, bird.body.pos.z - HOME.z);
        if (d < 28) {
          cmds.tuck = 1;
          cmds.pitch = -1;
          cmds.effort = 0;
        }
        if (idleTimer > 14) {
          idleMode = "cruise"; // missed the line; go around
          idleTimer = 0;
        }
      }
      idleFloat = 0;
    } else if (bird.state === "float") {
      idleFloat += dt;
      if (idleFloat > 5) cmds.effort = 1;
    }
    if (bird.state === "plunge") {
      idleMode = "cruise";
      idleTimer = 0;
    }

    bird.update(dt, t, cmds);
    bird.softBounds(430, dt);

    // Floating with a catch is dinner: the fish stays down the hatch.
    if (bird.carrying && bird.state === "float" && prevState !== "float") dropCatch();
    prevState = bird.state;

    // -- the world ----------------------------------------------------------------
    school.update(dt, t, { hunger: 0.45 });
    fillFishInstances(fishMesh, school.fish);
    glints.update(school.fish, t, -1.0);

    sim.moveTo(bird.body.pos.x, bird.body.pos.z);
    sim.step(dt);
    surface.update(t);

    spray.update(dt);
    plume.update(dt, t);
    rings.update(dt);

    const water = waterHeightAt(bird.body.pos.x, bird.body.pos.z, t);
    if (bird.wet > 0.03 && bird.body.pos.y > water + 0.15) {
      shedAt.set(bird.body.pos.x, bird.body.pos.y + 0.2, bird.body.pos.z);
      shed.emit(shedAt, bird.body.vel, bird.wet * 170, dt, 0.3, 0.8);
    }
    shed.update(dt, t);

    // -- camera: chase in the air, a manual dip through the surface -----------------
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

    // -- the lens ----------------------------------------------------------------------
    const camWater = waterHeightAt(ctx.camera.position.x, ctx.camera.position.z, t);
    const event = crossing.update(ctx.camera.position.y, camWater, dt);
    lens.notify(event, t);
    lens.update(ctx.camera, camWater, crossing, t);
    depthDome.mesh.visible = crossing.submergence > 0.04;
    depthDome.mesh.position.copy(ctx.camera.position);
    depthDome.camDepth.value = Math.max(0, -ctx.camera.position.y);
    depthDome.sunDirection.value.copy(sky.sunDirection.value);
  });
}

// ---- Step 1: the surface is the HUD -------------------------------------------------

export async function mountTelegraph(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await interludeCtx(el, { aspect: 0.58, fov: 50, far: 1600 });

  const sky = createDawnSky(6.7);
  ctx.scene.add(sky.makeDome(1300));
  const lights = syncSunToSky(ctx.scene, sky);
  wind.speed = 1.4;

  const rings = new RippleRings();
  const lake = new LakeSurface({ env: sky, rings, size: 340, segments: 200 });
  ctx.scene.add(lake.mesh);
  let now = 0;
  const offBus = onDisturbance((d) => rings.add(d, now));
  const pulse = new RingPulse(["rise"]);
  ctx.scene.add(pulse.group);

  // A flat-bottomed tank stands in for the bathymetry: this figure is about
  // READING the surface, so everything below it is reduced to fish + depth.
  const tank: BottomSampler = {
    heightAt: () => -7,
    gradientAt: (_x: number, _z: number, target = new THREE.Vector2()) => target.set(0, 0),
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

  let hunger = 0.55;
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
    return `rises on the books: ${school.rises.length} (last 30 s) — chop hides glints, watch for rings`;
  });

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(0, 0, 0),
    distance: 62,
    azimuth: 0.9,
    polar: 0.55,
    drift: 0.02,
  });

  ctx.onDispose(() => {
    offBus();
    orbit.dispose();
    lights.dispose();
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

// ---- Step 2: the window follows the dive ----------------------------------------------

export async function mountWindow(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await interludeCtx(el, { aspect: 0.56, fov: 48, far: 2600 });

  const sky = createDawnSky(7.6);
  ctx.scene.add(sky.makeDome(2200));
  const lights = syncSunToSky(ctx.scene, sky);
  wind.speed = 1.8;

  const sim = new FluidSim(ctx.renderer, {
    resolution: 144,
    worldSize: 24,
    depth: {
      node: (xz) => terrainHeightNode(xz).negate(),
      cpu: (x: number, z: number) => -terrainHeightAt(x, z),
    },
    mirror: true,
  });
  const offBus = sim.attachToBus();
  const surface = new SimSurface(sim, { env: sky, extent: 1600 });
  surface.showWindow.value = 1;
  ctx.scene.add(surface.mesh);

  const spray = new SpraySystem(ctx.renderer, { count: 1024, sim });
  ctx.scene.add(spray.sprite);
  const offSplash = onDisturbance((d) => {
    if (d.kind === "splash" && d.energy > 0.3) spray.emit({ x: d.x, z: d.z, energy: d.energy, radius: 0.5 });
  });

  // The strike point wanders so the window has somewhere to go.
  let simT = 0;
  const target = (): { x: number; z: number } => ({
    x: Math.cos(simT * 0.13) * 9,
    z: Math.sin(simT * 0.09) * 9,
  });
  const diver = new ScriptedDiver({ altitude: 8.5, target, maxDepth: 2.0, hoverSeconds: 1.4 });
  ctx.scene.add(diver.osprey.group);
  const birdLights = addBirdLights(ctx.scene);

  ctx.shell.slider({
    label: "blend rim start",
    min: 0.4,
    max: 0.95,
    step: 0.05,
    value: 0.7,
    onInput: (v) => sim.setBlendStart(v),
  });
  ctx.shell.button("toggle hard edge", () => {
    sim.hardEdge.value = sim.hardEdge.value > 0.5 ? 0 : 1;
  });
  ctx.shell.setInfo(() => {
    const c = sim.center;
    return `${diver.phase} · window @ (${c.x.toFixed(1)}, ${c.y.toFixed(1)}) · ${sim.lastSubsteps} substeps · mirror ${sim.mirrorAge} frames old`;
  });

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(0, 0.5, 0),
    distance: 22,
    azimuth: 0.7,
    polar: 0.5,
  });
  const focus = new THREE.Vector3();

  ctx.onDispose(() => {
    offBus();
    offSplash();
    orbit.dispose();
    lights.dispose();
    birdLights.dispose();
    sky.dispose();
    diver.dispose();
    surface.dispose();
    sim.dispose();
    spray.dispose();
  });

  return ctx.finish((t, dt) => {
    simT = t;
    diver.update(dt, t);
    birdLights.update(-diver.pos.y);
    sim.moveTo(diver.pos.x, diver.pos.z);
    sim.step(dt);
    surface.update(t);
    spray.update(dt);
    focus.set(diver.pos.x, 0.5, diver.pos.z);
    orbit.target.lerp(focus, Math.min(1, dt * 1.6));
    orbit.update(dt);
  });
}

// ---- Step 3: the grab, slowed down -----------------------------------------------------

export async function mountGrab(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await interludeCtx(el, { aspect: 0.56, fov: 52, near: 0.05, far: 700 });

  const sky = createDawnSky(7.4);
  ctx.scene.add(sky.makeDome(600));
  const depthDome = makeDepthDome(220);
  ctx.scene.add(depthDome.mesh);
  const rings = new RippleRings();
  const ceiling = new SurfaceCeiling({ env: sky, size: 260, segments: 150, rings });
  ctx.scene.add(ceiling.mesh);
  let now = 0;
  const offBus = onDisturbance((d) => rings.add(d, now));
  const lights = addBirdLights(ctx.scene);
  wind.speed = 1.5;

  // A silty bed below the action, lit by the same depth-aware key.
  const bedGeo = new THREE.CircleGeometry(70, 40).rotateX(-Math.PI / 2);
  const bedMat = new THREE.MeshStandardMaterial({ color: 0x4c4634, roughness: 1, metalness: 0 });
  const bed = new THREE.Mesh(bedGeo, bedMat);
  bed.position.y = -3.0;
  ctx.scene.add(bed);

  const plume = new BubblePlume(160);
  plume.attachToBus();
  ctx.scene.add(plume.mesh);

  const fish = buildFish(0.34);
  ctx.scene.add(fish.group);
  const cruiser = new FishCruiser(fish, { radiusX: 1.2, radiusZ: 0.8, depth: 1.1, period: 13 });

  let grabRadius = 0.6;
  const diver = new ScriptedDiver({
    altitude: 7.5,
    target: () => ({ x: cruiser.x, z: cruiser.z }),
    maxDepth: 2.1,
    grab: (x, y, z) => {
      if (cruiser.caught) return false;
      const p = fish.group.position;
      if (Math.hypot(p.x - x, p.y - y, p.z - z) > grabRadius) return false;
      cruiser.caught = true;
      diver.osprey.group.add(fish.group);
      // carried head-first — a real osprey turns the catch to cut drag
      fish.group.position.set(0, 0.01, 0.1);
      fish.group.rotation.set(0, 0, 0);
      fish.swim.value = 0.25;
      return true;
    },
  });
  ctx.scene.add(diver.osprey.group);

  const releaseFish = (): void => {
    if (!cruiser.caught) return;
    ctx.scene.add(fish.group);
    fish.swim.value = 1;
    cruiser.caught = false;
  };

  let timeScale = 0.35;
  ctx.shell.slider({
    label: "time scale (slow-mo)",
    min: 0.15,
    max: 1,
    step: 0.05,
    value: timeScale,
    onInput: (v) => (timeScale = v),
  });
  ctx.shell.slider({
    label: "talon reach (m)",
    min: 0.25,
    max: 1.0,
    step: 0.05,
    value: grabRadius,
    onInput: (v) => (grabRadius = v),
  });
  ctx.shell.button("replay", () => {
    releaseFish();
    diver.reset();
  });
  ctx.shell.setInfo(() => {
    if (diver.carried) return `${diver.phase} · GRABBED`;
    const p = fish.group.position;
    const d = Math.hypot(p.x - diver.pos.x, p.y - diver.pos.y, p.z - diver.pos.z);
    return `${diver.phase} · talons ${d.toFixed(2)} m from the fish`;
  });

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(0, -1, 0),
    distance: 4.6,
    azimuth: 0.8,
    polar: 0.0,
    minPolar: -0.45,
    maxPolar: 0.12,
  });
  const focus = new THREE.Vector3();
  let wasCarried = false;

  ctx.onDispose(() => {
    offBus();
    orbit.dispose();
    lights.dispose();
    sky.dispose();
    ceiling.dispose();
    depthDome.dispose();
    bedGeo.dispose();
    bedMat.dispose();
    plume.dispose();
    fish.dispose();
    diver.dispose();
  });

  return ctx.finish((t, dt) => {
    now = t;
    const h = dt * timeScale;
    diver.update(h, t);
    cruiser.update(h, t);
    fish.time.value = t;
    plume.update(h, t);
    ceiling.update(t);
    lights.update(-diver.pos.y);

    // the loop reset releases the catch back to its ellipse
    if (wasCarried && !diver.carried) releaseFish();
    wasCarried = diver.carried;

    depthDome.mesh.position.copy(ctx.camera.position);
    depthDome.camDepth.value = Math.max(0, -ctx.camera.position.y);
    depthDome.sunDirection.value.copy(sky.sunDirection.value);

    focus.set(diver.pos.x, Math.min(-0.4, Math.max(-1.7, diver.pos.y)), diver.pos.z);
    orbit.target.lerp(focus, Math.min(1, dt * 1.6));
    orbit.update(dt);
  });
}
