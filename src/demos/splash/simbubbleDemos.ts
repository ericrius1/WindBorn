// Demos for simbubble.html — the moving sim window. Part 3 of The Splash:
// snap-to-lattice window shifts, the edge fade into ambient water, and the
// site-wide provider swap.

import { Group, Mesh, MeshBasicNodeMaterial, Vector2, Vector3 } from "three/webgpu";
import { mix, positionLocal, smoothstep, uniform, vec3 } from "three/tsl";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { mountScrolly, PAL, label, phase } from "../../lib/scrolly";
import { createDawnSky } from "../../lib/water";
import { disturb, waterHeightAt, waterNormalAt, wind } from "../../lib/spine";
import { buildOsprey } from "../../lib/bird/build";
import { OspreyAnimator } from "../../lib/bird/animator";
import { FluidSim, SimSurface, installSimProvider } from "../../lib/fluid";
import {
  addLights,
  addOrbit,
  disposeGroup,
  makeBall,
  makeTankGeometry,
  onTap,
  pickWaterPoint,
  splashCtx,
} from "./kit";

// ---- a heat-view mesh over the moving window -------------------------------------------

function makeFluidHeatMesh(sim: FluidSim) {
  const geometry = makeTankGeometry(sim.worldSize, sim.res);
  const material = new MeshBasicNodeMaterial();
  const exaggerate = uniform(2.5);
  const worldXZ = positionLocal.xz.add(sim.centerUniform);
  const field = sim.fieldNode(worldXZ);
  material.positionNode = positionLocal.add(vec3(0, field.x.mul(exaggerate), 0));
  const t01 = field.x.mul(7).clamp(-1, 1).mul(0.5).add(0.5);
  const trough = vec3(0.07, 0.19, 0.45);
  const zero = vec3(0.045, 0.06, 0.1);
  const crest = vec3(0.95, 0.97, 1.0);
  let c = mix(mix(trough, zero, smoothstep(0.0, 0.5, t01)), crest, smoothstep(0.5, 1.0, t01));
  // paint the blend rim so the window's anatomy is visible
  const fade = sim.fadeNode(worldXZ);
  const rim = smoothstep(0.01, 0.12, fade).mul(smoothstep(0.99, 0.5, fade));
  c = mix(c, vec3(1.0, 0.55, 0.25), rim.mul(0.45));
  material.colorNode = c;
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    exaggerate,
    sync() {
      mesh.position.set(sim.center.x, 0, sim.center.y);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ---- hero: the window follows the bird -----------------------------------------------------

export async function mountSimbubbleHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { aspect: 0.48, fov: 47, far: 4000 });
  const sky = createDawnSky(6.4);
  const dome = sky.makeDome();
  const removeLights = addLights(ctx.scene, sky.sunDirection.value as Vector3);

  const sim = new FluidSim(ctx.renderer, {
    resolution: 192,
    worldSize: 26,
    depth: 8,
  });
  const detach = sim.attachToBus();
  const surface = new SimSurface(sim, { env: sky, extent: 1400, waves: { windSpeed: 2.2 } });
  ctx.scene.add(dome, surface.mesh);

  // The action the window follows: an osprey working the surface in a slow
  // circuit, wingtips kissing the water on every low pass.
  const osprey = buildOsprey();
  const anim = new OspreyAnimator(osprey);
  osprey.group.rotation.order = "YXZ"; // yaw, then pitch, then roll
  ctx.scene.add(osprey.group);
  let angle = 0;
  const R = 11;
  let skimTimer = 0;
  const pos = new Vector3();

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.8, 0),
    distance: 21,
    polar: 0.3,
    azimuth: 1.9,
    drift: 0.01,
  });

  wind.speed = 2.2;
  ctx.shell.slider({
    label: "blend rim width (m)",
    min: 1,
    max: 9,
    step: 0.25,
    value: (1 - 0.7) * (sim.worldSize / 2),
    onInput: (v) => sim.setBlendStart(1 - v / (sim.worldSize / 2)),
  });
  ctx.shell.button("show window", () => {
    surface.showWindow.value = surface.showWindow.value > 0.5 ? 0 : 1;
  });
  ctx.shell.setInfo(
    () => `window center (${sim.center.x.toFixed(1)}, ${sim.center.y.toFixed(1)}) m · ${sim.res}² cells, always`,
  );

  ctx.onDispose(() => {
    detach();
    surface.dispose();
    osprey.dispose();
    removeLights();
    sky.dispose();
    orbit.dispose();
    sim.dispose();
  });
  return ctx.finish((t, dt) => {
    // the circuit: height breathes between skim passes and easy climbs
    angle += (4.6 / R) * dt;
    const swoop = Math.sin(t * 0.45);
    const y = 0.34 + Math.max(0, swoop) * 2.2 + Math.max(0, -swoop) * 0.06;
    pos.set(Math.cos(angle) * R, y, Math.sin(angle) * R);
    osprey.group.position.copy(pos);
    osprey.group.rotation.y = -angle; // forward (+z of the bird) along the tangent
    osprey.group.rotation.z = 0.34; // banked into the turn
    anim.gait01 += ((swoop > 0 ? 0.55 : 1.0) - anim.gait01) * Math.min(1, dt * 2);
    anim.bank = 0.4;
    anim.update(dt);

    // low passes brush the surface
    skimTimer -= dt;
    if (y < 0.45 && skimTimer <= 0) {
      skimTimer = 0.11;
      disturb({
        kind: "skim",
        x: pos.x,
        z: pos.z,
        energy: 0.06,
        radius: 0.3,
        vx: -Math.sin(angle) * 4.6,
        vz: Math.cos(angle) * 4.6,
      });
    }

    sim.moveTo(pos.x, pos.z);
    sim.step(dt);
    surface.update(t);
    sky.setHour(6.4 + Math.sin(t * 0.02) * 0.2);
    orbit.update(dt);
  });
}

// ---- scrolly: the shift pass -------------------------------------------------------------

export function mountWindowScrolly(el: HTMLElement): void {
  mountScrolly(el, {
    screens: 3.2,
    aspect: 0.52,
    steps: [
      {
        at: 0,
        text: "A fixed grid of cells, somewhere on the lake. The grid never grows; the lake never fits.",
      },
      {
        at: 0.3,
        text: "The action drifts. The window re-centers by whole cells — never fractions — so the copy is exact: cell (i, j) becomes cell (i+di, j+dj). No resampling, no blur.",
      },
      {
        at: 0.6,
        text: "Cells that slide in from the leading edge start empty: flat water. Cells that fall off the trailing edge are forgotten — their waves were about to be eaten by the sponge rim anyway.",
      },
      {
        at: 0.85,
        text: "Snap, shift, refill the depth column, keep integrating. The sim never knows it moved.",
      },
    ],
    draw(c, w, h, t) {
      const n = 11;
      const cell = Math.min((w * 0.5) / n, (h * 0.72) / n);
      const gw = cell * n;
      const cx = w * 0.5 - gw / 2;
      const cy = h * 0.5 - gw / 2;
      const slide = phase(t, 0.3, 0.9) * 3.2; // window travel, in cells
      const shifted = Math.floor(slide);
      // a fake wave pattern pinned to the WORLD, so shifting reads as motion
      const wave = (wx: number, wy: number): number =>
        Math.sin(wx * 1.1 + wy * 0.6) * Math.cos(wy * 0.9 - wx * 0.3);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const worldX = i + shifted;
          const fresh = i >= n - shifted; // entered from the leading edge
          const v = fresh && t < 0.92 ? 0 : wave(worldX, j);
          const px = cx + i * cell;
          const py = cy + j * cell;
          const m = Math.round(127 + v * 90);
          c.fillStyle = fresh && t < 0.92 ? "#10131c" : `rgb(${m * 0.35}, ${m * 0.55}, ${m * 0.85})`;
          c.fillRect(px + 1, py + 1, cell - 2, cell - 2);
        }
      }
      // grid frame
      c.strokeStyle = PAL.warm;
      c.lineWidth = 2;
      c.strokeRect(cx, cy, gw, gw);
      // the action marker, drifting right relative to the window
      const ax = cx + gw * 0.5 + (slide - shifted) * cell;
      c.fillStyle = PAL.warm;
      c.beginPath();
      c.arc(ax, cy + gw * 0.5, 6, 0, Math.PI * 2);
      c.fill();
      label(c, "the action", ax, cy + gw * 0.5 - 16, { color: PAL.warm, align: "center", size: 11 });
      if (shifted > 0) {
        label(c, `shifted ${shifted} cell${shifted > 1 ? "s" : ""} so far`, w * 0.5, cy + gw + 22, {
          color: PAL.muted,
          align: "center",
          mono: true,
          size: 12,
        });
        label(c, "new cells: flat", cx + gw - cell * 1.5, cy - 12, {
          color: PAL.muted,
          align: "center",
          size: 11,
        });
      }
    },
  });
}

// ---- Step 1: drag the window around --------------------------------------------------------

export async function mountFollowHeat(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const sim = new FluidSim(ctx.renderer, { resolution: 160, worldSize: 20, depth: 5 });
  const heat = makeFluidHeatMesh(sim);
  ctx.scene.add(heat.mesh);

  const target = new Vector2(0, 0);
  const marker = makeBall(0.35, 0xffb86b, new Vector3(0.5, 0.8, 0.3));
  ctx.scene.add(marker.mesh);

  // fixed high camera — this demo is about reading the grid, not orbiting it
  ctx.camera.position.set(0, 27, 10);
  ctx.camera.lookAt(0, 0, 0);

  // drag (or tap) anywhere: that's where the action is now
  let dragging = false;
  const canvas = ctx.shell.canvas;
  const setTarget = (e: PointerEvent): void => {
    const p = pickWaterPoint(e, canvas, ctx.camera);
    if (p) target.set(p.x, p.z);
  };
  const down = (e: PointerEvent): void => {
    dragging = true;
    setTarget(e);
  };
  const move = (e: PointerEvent): void => {
    if (dragging) setTarget(e);
  };
  const up = (): void => {
    dragging = false;
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  ctx.onDispose(() => {
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
  });

  let rainTimer = 0;
  let totalShifts = 0;
  const lastCenter = new Vector2();

  ctx.shell.button("re-center on origin", () => target.set(0, 0));
  ctx.shell.setInfo(
    () =>
      `center (${sim.center.x.toFixed(2)}, ${sim.center.y.toFixed(2)}) — snapped to ${sim.spacing.toFixed(3)} m cells · ${totalShifts} shift passes`,
  );

  ctx.onDispose(() => {
    heat.dispose();
    marker.dispose();
    sim.dispose();
  });
  return ctx.finish((_t, dt) => {
    rainTimer -= dt;
    if (rainTimer <= 0) {
      rainTimer = 0.4;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * sim.worldSize * 0.42;
      disturbInto(sim, sim.center.x + Math.cos(a) * r, sim.center.y + Math.sin(a) * r);
    }
    lastCenter.copy(sim.center);
    // The window chases the target gently — and snaps to whole cells.
    const cx = sim.center.x + (target.x - sim.center.x) * Math.min(1, dt * 2.5);
    const cz = sim.center.y + (target.y - sim.center.y) * Math.min(1, dt * 2.5);
    sim.moveTo(cx, cz);
    if (!lastCenter.equals(sim.center)) totalShifts++;
    sim.step(dt);
    heat.sync();
    marker.mesh.position.set(target.x, 0.4, target.y);
  });
}

function disturbInto(sim: FluidSim, x: number, z: number): void {
  sim.disturb({ kind: "rain", x, z, energy: 0.12, radius: 0.45 });
}

// ---- Step 2: the seam, made visible then invisible -------------------------------------------

export async function mountEdgeBlend(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const sky = createDawnSky(7.1);
  const dome = sky.makeDome();
  const sim = new FluidSim(ctx.renderer, { resolution: 160, worldSize: 18, depth: 6 });
  sim.hardEdge.value = 1; // start broken on purpose
  const surface = new SimSurface(sim, { env: sky, extent: 280, waves: { windSpeed: 2.6 } });
  ctx.scene.add(dome, surface.mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.1, 0),
    distance: 17,
    polar: 0.32,
    azimuth: 2.4,
  });

  let dripTimer = 0;
  ctx.shell.button("hard edge ↔ blended rim", () => {
    sim.hardEdge.value = sim.hardEdge.value > 0.5 ? 0 : 1;
  });
  ctx.shell.slider({
    label: "blend rim width (m)",
    min: 0.5,
    max: 8,
    step: 0.25,
    value: 2.7,
    onInput: (v) => sim.setBlendStart(1 - v / (sim.worldSize / 2)),
  });
  ctx.shell.setInfo(() =>
    sim.hardEdge.value > 0.5
      ? "hard cut: the sim ends mid-wave — watch the rim"
      : "blended: sim → ambient across the rim — the seam is gone",
  );

  ctx.onDispose(() => {
    surface.dispose();
    sky.dispose();
    orbit.dispose();
    sim.dispose();
  });
  return ctx.finish((t, dt) => {
    dripTimer -= dt;
    if (dripTimer <= 0) {
      dripTimer = 1.4;
      sim.disturb({ kind: "splash", x: 0, z: 0, energy: 0.55, radius: 0.55 });
    }
    sim.step(dt);
    surface.update(t);
    orbit.update(dt);
  });
}

// ---- Step 3: the provider swap ------------------------------------------------------------------

export async function mountFloatAnywhere(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const sky = createDawnSky(7.5);
  const dome = sky.makeDome();
  const sim = new FluidSim(ctx.renderer, { resolution: 160, worldSize: 16, depth: 7, mirror: true });
  const restoreProvider = installSimProvider(sim);
  const detach = sim.attachToBus();
  const surface = new SimSurface(sim, { env: sky, extent: 500, waves: { windSpeed: 2 } });
  ctx.scene.add(dome, surface.mesh);
  surface.showWindow.value = 1;

  // floats everywhere — none of them know the window exists
  const floats = new Group();
  const spots: Vector2[] = [];
  const upScratch = new Vector3();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.4;
    const r = 3 + (i % 3) * 7 + (i % 2) * 3;
    const ball = makeBall(0.26, [0xc25b2a, 0xb8902f, 0x90332a][i % 3], sky.sunDirection.value as Vector3);
    ball.mesh.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    spots.push(new Vector2(Math.cos(a) * r, Math.sin(a) * r));
    floats.add(ball.mesh);
  }
  ctx.scene.add(floats);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.2, 0),
    distance: 22,
    polar: 0.4,
    azimuth: 1.2,
    drift: 0.008,
  });

  const offTap = onTap(ctx.shell.canvas, (e) => {
    const p = pickWaterPoint(e, ctx.shell.canvas, ctx.camera);
    if (p) disturb({ kind: "splash", x: p.x, z: p.z, energy: 0.7, radius: 0.5 });
  });

  let windowAngle = 0;
  ctx.shell.button("show window on/off", () => {
    surface.showWindow.value = surface.showWindow.value > 0.5 ? 0 : 1;
  });
  ctx.shell.setInfo(
    () => "every float just calls waterHeightAt(x, z, t) — the same call as touchgo.html",
  );

  ctx.onDispose(() => {
    restoreProvider();
    detach();
    surface.dispose();
    disposeGroup(floats);
    sky.dispose();
    orbit.dispose();
    offTap();
    sim.dispose();
  });
  return ctx.finish((t, dt) => {
    // the window wanders on its own — floats pass in and out of it
    windowAngle += dt * 0.12;
    sim.moveTo(Math.cos(windowAngle) * 6, Math.sin(windowAngle) * 6);
    sim.step(dt);
    surface.update(t);
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const m = floats.children[i];
      m.position.y = waterHeightAt(s.x, s.y, t) - 0.05;
      waterNormalAt(s.x, s.y, t, upScratch);
      m.quaternion.setFromUnitVectors(UP, upScratch);
    }
    orbit.update(dt);
  });
}

const UP = new Vector3(0, 1, 0);
