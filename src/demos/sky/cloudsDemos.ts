// Demos for clouds.html — raymarched cumulus on the spine wind.
// Part 3 of Air & Light.

import { Vector3 } from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { wind } from "../../lib/spine";
import {
  CloudLayer,
  createAtmosphere,
  createSkyPalette,
  skyColors,
  sunDirection,
  sunElevationDeg,
} from "../../lib/sky";
import { addOrbit, fmtHour, makeCalmWater, skyCtx } from "./kit";

const _w = new Vector3();

// Copy the atmosphere's current light into a cloud layer, with the palette's
// ambient as the slab's skylight.
function syncCloudLight(
  clouds: CloudLayer,
  atm: ReturnType<typeof createAtmosphere>,
  pal: ReturnType<typeof createSkyPalette>,
  hour: number,
): void {
  skyColors(hour, pal);
  sunDirection(hour, clouds.sunDirection.value);
  clouds.sunColor.value.copy(atm.sunColor.value);
  clouds.ambient.value.copy(pal.ambient).multiplyScalar(0.55 + pal.ambientIntensity * 1.3);
}

// ---- hero: the cloud layer over the lake ------------------------------------------------

export async function mountCloudsHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  // The hero runs the march at 62% internal resolution and lets CSS stretch
  // it — the budget trick the essay explains. The readout owns up to it.
  const ctx = await skyCtx(el, { aspect: 0.5, fov: 46, far: 9000, renderScale: 0.62 });

  let hour = 10.4;
  const atm = createAtmosphere(hour, { stars: false });
  ctx.scene.add(atm.makeDome());

  const clouds = new CloudLayer({ steps: 20, lightSteps: 4 });
  ctx.scene.add(clouds.makeDome());

  const pal = createSkyPalette();
  syncCloudLight(clouds, atm, pal, hour);

  const water = makeCalmWater({ env: atm, size: 2400, segments: 160 });
  ctx.scene.add(water.mesh);

  wind.speed = 4;

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 4, 0),
    distance: 36,
    polar: 0.3,
    azimuth: -2.2,
    maxPolar: 1.1,
    drift: 0.004,
  });

  ctx.shell.slider({
    label: "coverage",
    min: 0.05,
    max: 0.9,
    step: 0.01,
    value: clouds.coverage.value,
    onInput: (v) => (clouds.coverage.value = v),
  });
  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 14,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.slider({
    label: "hour",
    min: 5,
    max: 20,
    step: 0.05,
    value: hour,
    onInput: (v) => {
      hour = v;
      atm.setHour(hour);
      syncCloudLight(clouds, atm, pal, hour);
    },
  });
  ctx.shell.setInfo(() => {
    wind.sample(0, 1075, 0, 0, _w);
    return `${fmtHour(hour)} · drift ${_w.length().toFixed(1)} m/s at 1.1 km · 20 steps at 62% res`;
  });

  ctx.onDispose(() => {
    atm.dispose();
    clouds.dispose();
    water.dispose();
    orbit.dispose();
    wind.speed = 3;
  });
  return ctx.finish((t, dt) => {
    clouds.update(dt, t);
    water.update(t);
    orbit.update(dt);
  });
}

// ---- Step 1: the density field, unlit ------------------------------------------------------

export async function mountCloudField(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { fov: 50, far: 9000, renderScale: 0.75 });

  const atm = createAtmosphere(11, { stars: false });
  ctx.scene.add(atm.makeDome());

  const clouds = new CloudLayer({ steps: 16, lightSteps: 2, unlit: true });
  ctx.scene.add(clouds.makeDome());

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 6, 0),
    distance: 30,
    polar: 0.45,
    azimuth: 0.8,
    maxPolar: 1.2,
  });

  ctx.shell.slider({
    label: "coverage",
    min: 0.05,
    max: 0.95,
    step: 0.01,
    value: 0.45,
    onInput: (v) => (clouds.coverage.value = v),
  });
  ctx.shell.slider({
    label: "edge erosion",
    min: 0,
    max: 1,
    step: 0.01,
    value: clouds.erode.value,
    onInput: (v) => (clouds.erode.value = v),
  });
  ctx.shell.slider({
    label: "slab base (m)",
    min: 300,
    max: 1200,
    step: 10,
    value: clouds.base.value,
    onInput: (v) => {
      clouds.base.value = v;
      clouds.top.value = Math.max(clouds.top.value, v + 300);
    },
  });
  ctx.shell.setInfo(() => "density only — no lighting · 16 steps");

  ctx.onDispose(() => {
    atm.dispose();
    clouds.dispose();
    orbit.dispose();
  });
  return ctx.finish((t, dt) => {
    clouds.update(dt, t);
    orbit.update(dt);
  });
}

// ---- Step 2: Beer–Lambert, powder, silver linings --------------------------------------------

export async function mountCloudLight(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { fov: 50, far: 9000, renderScale: 0.75 });

  let hour = 16.5;
  const atm = createAtmosphere(hour, { stars: false });
  ctx.scene.add(atm.makeDome());

  const clouds = new CloudLayer({ steps: 18, lightSteps: 5 });
  clouds.coverage.value = 0.5;
  ctx.scene.add(clouds.makeDome());

  const pal = createSkyPalette();
  syncCloudLight(clouds, atm, pal, hour);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 6, 0),
    distance: 30,
    polar: 0.32,
    azimuth: 2.6, // start looking sunward: silver linings live here
    maxPolar: 1.2,
  });

  ctx.shell.slider({
    label: "hour (sun angle)",
    min: 5,
    max: 20.5,
    step: 0.05,
    value: hour,
    onInput: (v) => {
      hour = v;
      atm.setHour(hour);
      syncCloudLight(clouds, atm, pal, hour);
    },
  });
  ctx.shell.slider({
    label: "extinction σ (1/m)",
    min: 0.004,
    max: 0.09,
    step: 0.002,
    value: clouds.sigma.value,
    onInput: (v) => (clouds.sigma.value = v),
  });
  ctx.shell.setInfo(
    () => `sun ${sunElevationDeg(hour).toFixed(1)}° · look toward the sun for the silver lining`,
  );

  ctx.onDispose(() => {
    atm.dispose();
    clouds.dispose();
    orbit.dispose();
  });
  return ctx.finish((t, dt) => {
    clouds.update(dt, t);
    orbit.update(dt);
  });
}

// ---- Step 3: one wind, surface to cloud base ---------------------------------------------------

export async function mountCloudWind(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { fov: 48, far: 9000, renderScale: 0.75 });

  const hour = 9.6;
  const atm = createAtmosphere(hour, { stars: false });
  ctx.scene.add(atm.makeDome());

  const clouds = new CloudLayer({ steps: 16, lightSteps: 4 });
  clouds.coverage.value = 0.5;
  ctx.scene.add(clouds.makeDome());

  const pal = createSkyPalette();
  syncCloudLight(clouds, atm, pal, hour);

  // Ripples below read the very same field the clouds drift on.
  const water = makeCalmWater({ env: atm, size: 2400, segments: 192 });
  ctx.scene.add(water.mesh);

  wind.speed = 5;

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 3, 0),
    distance: 26,
    polar: 0.34,
    azimuth: -2.3,
    maxPolar: 1.1,
  });

  ctx.shell.slider({
    label: "wind direction (°)",
    min: 0,
    max: 360,
    step: 1,
    value: (wind.direction * 180) / Math.PI,
    onInput: (v) => (wind.direction = (v * Math.PI) / 180),
  });
  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 14,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.setInfo(() => {
    wind.sample(0, 1, 0, 0, _w);
    const lo = _w.length();
    wind.sample(0, 1075, 0, 0, _w);
    return `same field · ${lo.toFixed(1)} m/s at the surface, ${_w.length().toFixed(1)} m/s at cloud base`;
  });

  ctx.onDispose(() => {
    atm.dispose();
    clouds.dispose();
    water.dispose();
    orbit.dispose();
    wind.speed = 3;
    wind.direction = 0.6;
  });
  return ctx.finish((t, dt) => {
    clouds.update(dt, t);
    water.update(t);
    orbit.update(dt);
  });
}
