// Demos for mist.html — aerial perspective, height fog, and the dawn mist.
// Part 2 of Air & Light.

import { Color, Vector3 } from "three/webgpu";
import { cameraPosition } from "three/tsl";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { clock, wind } from "../../lib/spine";
import { terrainHeightAt } from "../../lib/terrain";
import {
  createAtmosphere,
  createHeightFog,
  createSkyPalette,
  mistAmountForHour,
  skyColors,
  sunElevationDeg,
  transmittanceCpu,
} from "../../lib/sky";
import { addOrbit, fmtHour, makeCalmWater, makeTerrainMesh, skyCtx } from "./kit";

// Shared assembly: atmosphere + fogged terrain + fogged water. Each demo
// configures the same parts differently — that is rather the point.
interface MistScene {
  atm: ReturnType<typeof createAtmosphere>;
  fog: ReturnType<typeof createHeightFog>;
  setHour(h: number): void;
  update(t: number, dt: number): void;
  dispose(): void;
}

async function buildMistScene(
  ctx: Awaited<ReturnType<typeof skyCtx>>,
  opts: { hour: number; segments?: number; waterSegments?: number },
): Promise<MistScene> {
  const atm = createAtmosphere(opts.hour);
  ctx.scene.add(atm.makeDome());

  const pal = createSkyPalette();
  const ambient = new Color();
  const fog = createHeightFog();

  const terrain = makeTerrainMesh({
    size: 3600,
    segments: opts.segments ?? 192,
    sunDirection: atm.sunDirection,
    sunColor: atm.sunColor,
    ambient: { value: ambient },
    tint: (lit, world) =>
      fog.applyNode(lit, cameraPosition, world, { direction: atm.sunDirection, color: atm.sunColor.rgb }),
  });
  ctx.scene.add(terrain.mesh);

  const water = makeCalmWater({
    env: atm,
    size: 1100,
    segments: opts.waterSegments ?? 160,
    tint: (c, world) =>
      fog.applyNode(c, cameraPosition, world, { direction: atm.sunDirection, color: atm.sunColor.rgb }),
  });
  ctx.scene.add(water.mesh);

  const windV = new Vector3();

  const setHour = (h: number): void => {
    atm.setHour(h);
    skyColors(h, pal);
    ambient.copy(pal.ambient).multiplyScalar(0.45 + pal.ambientIntensity);
    fog.fogColor.value.copy(pal.fog);
  };
  setHour(opts.hour);

  return {
    atm,
    fog,
    setHour,
    update(t, dt) {
      water.update(t);
      // Wisps ride the same wind as everything else, sampled at nose height.
      wind.sample(0, 2, 0, t, windV);
      fog.mistDrift.value.x -= windV.x * dt;
      fog.mistDrift.value.y -= windV.z * dt;
    },
    dispose() {
      atm.dispose();
      terrain.dispose();
      water.dispose();
    },
  };
}

// ---- hero: dawn, and the lake exhaling ---------------------------------------------------

export async function mountMistHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { aspect: 0.5, fov: 46, far: 9000 });
  const scene = await buildMistScene(ctx, { hour: 5.6 });

  // Dawn defaults: a thin breathing valley haze plus the mist layer itself.
  scene.fog.airDensity.value = 2.4e-4;
  scene.fog.airHeight.value = 700;
  scene.fog.mistHeight.value = 6;

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 2.5, 0),
    distance: 34,
    polar: 0.13,
    azimuth: -2.35,
    maxPolar: 0.7,
    drift: 0.004,
  });

  clock.setHour(5.6);
  clock.speed = 7; // a slow dawn: ~1 clock hour every 3.5 s

  ctx.shell.slider({
    label: "world clock (hour)",
    min: 4,
    max: 11,
    step: 0.02,
    value: 5.6,
    onInput: (v) => {
      clock.setHour(v);
      clock.speed = 0;
    },
  });
  ctx.shell.button("play / pause the morning", () => {
    clock.speed = clock.speed > 0 ? 0 : 7;
  });
  ctx.shell.setInfo(() => {
    const mist = mistAmountForHour(clock.hour);
    return `${fmtHour(clock.hour)} · sun ${sunElevationDeg(clock.hour).toFixed(1)}° · mist ${(mist * 100).toFixed(0)}%`;
  });

  ctx.onDispose(() => {
    scene.dispose();
    orbit.dispose();
    clock.speed = 1;
  });
  return ctx.finish((t, dt) => {
    clock.advance(dt);
    if (clock.hour > 11 || clock.hour < 4) clock.setHour(4);
    scene.setHour(clock.hour);
    scene.fog.mistDensity.value = 0.16 * mistAmountForHour(clock.hour);
    scene.update(t, dt);
    orbit.update(dt);
  });
}

// ---- Step 1: aerial perspective on the ridges ----------------------------------------------

export async function mountAerialRidges(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { fov: 44, far: 9000 });
  const scene = await buildMistScene(ctx, { hour: 9.5, segments: 176 });

  scene.fog.mistDensity.value = 0; // air only today
  scene.fog.airHeight.value = 900;
  let density = 2.2e-4;
  scene.fog.airDensity.value = density;

  // Hang off the eastern slope (the rig's radius puts the eye near the
  // ridge at ~620 east), looking west across the lake at the far rim:
  // ridge behind ridge behind ridge.
  const ridgeY = terrainHeightAt(-600, -100) + 80;
  const look = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(-600, ridgeY, -100),
    distance: 1300,
    azimuth: -0.12,
    polar: 0.12,
    minPolar: 0.06,
    maxPolar: 0.4,
  });

  ctx.shell.slider({
    label: "air density β (1/m)",
    min: 0,
    max: 6e-4,
    step: 1e-5,
    value: density,
    format: (v) => v.toExponential(1),
    onInput: (v) => {
      density = v;
      scene.fog.airDensity.value = v;
    },
  });
  ctx.shell.setInfo(() => {
    const t1 = transmittanceCpu(60, 100, 1000, density, 900);
    const t3 = transmittanceCpu(60, 100, 3000, density, 900);
    return `surviving contrast: ${(t1 * 100).toFixed(0)}% at 1 km · ${(t3 * 100).toFixed(0)}% at 3 km`;
  });

  ctx.onDispose(() => {
    scene.dispose();
    look.dispose();
  });
  return ctx.finish((t, dt) => {
    scene.update(t, dt);
    look.update(dt);
  });
}

// ---- Step 2: the exponential layer --------------------------------------------------------

export async function mountHeightFog(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { fov: 46, far: 9000 });
  const scene = await buildMistScene(ctx, { hour: 8.2, segments: 176 });

  scene.fog.airDensity.value = 0.8e-4;
  scene.fog.mistDensity.value = 0.05;
  scene.fog.mistPatchiness.value = 0.25; // a smooth sea for the shape study
  let scaleH = 25;
  scene.fog.mistHeight.value = scaleH;

  // Hang over the outlet notch (the rim's one low gap), looking back in —
  // the only azimuth where a 900 m orbit clears the crest ring.
  const target = new Vector3(0, 30, 0);
  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target,
    distance: 900,
    azimuth: -0.55,
    polar: 0.3,
    minPolar: 0.14,
    maxPolar: 0.8,
  });

  ctx.shell.slider({
    label: "fog scale height H (m)",
    min: 3,
    max: 200,
    step: 1,
    log: true,
    value: scaleH,
    onInput: (v) => {
      scaleH = v;
      scene.fog.mistHeight.value = v;
    },
  });
  ctx.shell.slider({
    label: "fog density ρ₀ (1/m)",
    min: 0,
    max: 0.15,
    step: 0.002,
    value: 0.05,
    onInput: (v) => (scene.fog.mistDensity.value = v),
  });
  ctx.shell.setInfo(
    () => `ρ(y) = ρ₀·e^(−y/${scaleH.toFixed(0)}) · half the fog sits below ${(scaleH * 0.69).toFixed(0)} m`,
  );

  ctx.onDispose(() => {
    scene.dispose();
    orbit.dispose();
  });
  return ctx.finish((t, dt) => {
    scene.update(t, dt);
    orbit.update(dt);
  });
}

// ---- Step 3: the burn-off ------------------------------------------------------------------

export async function mountBurnoff(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { fov: 50, far: 9000 });
  const scene = await buildMistScene(ctx, { hour: 5.4 });

  scene.fog.airDensity.value = 1.6e-4;
  scene.fog.mistHeight.value = 5;
  let hour = 5.4;
  let patchiness = 0.65;
  scene.fog.mistPatchiness.value = patchiness;

  // Low over the water, close to the wisps.
  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(-10, 1.2, -6),
    distance: 17,
    azimuth: 2.7,
    polar: 0.09,
    maxPolar: 0.5,
  });

  const apply = (): void => {
    scene.setHour(hour);
    scene.fog.mistDensity.value = 0.18 * mistAmountForHour(hour);
  };
  apply();

  ctx.shell.slider({
    label: "hour",
    min: 4,
    max: 11,
    step: 0.02,
    value: hour,
    onInput: (v) => {
      hour = v;
      apply();
    },
  });
  ctx.shell.slider({
    label: "patchiness",
    min: 0,
    max: 1,
    step: 0.01,
    value: patchiness,
    onInput: (v) => {
      patchiness = v;
      scene.fog.mistPatchiness.value = v;
    },
  });
  ctx.shell.setInfo(() => {
    const m = mistAmountForHour(hour);
    const phase = hour < 5 ? "condensing" : hour < 7.2 ? "holding" : m > 0.02 ? "burning off" : "gone";
    return `${fmtHour(hour)} · mist ${(m * 100).toFixed(0)}% · ${phase}`;
  });

  ctx.onDispose(() => {
    scene.dispose();
    orbit.dispose();
  });
  return ctx.finish((t, dt) => {
    scene.update(t, dt);
    orbit.update(dt);
  });
}
