// Demos for night.html — the moon's path, hashed stars, and moonlight on
// black water. Part 5 of Air & Light.

import {
  BufferAttribute,
  BufferGeometry,
  Line,
  LineBasicNodeMaterial,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Vector3,
} from "three/webgpu";
import { color } from "three/tsl";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { wind } from "../../lib/spine";
import { LakeSurface } from "../../lib/water";
import {
  Moon,
  celestialPole,
  createAtmosphere,
  moonDirectionLagged,
  moonElevationDeg,
  starVisibility,
  sunElevationDeg,
} from "../../lib/sky";
import { addOrbit, fmtHour, skyCtx } from "./kit";

// Night scenes push the tone-mapping exposure up — the renderer's stand-in
// for a dark-adapted eye. Each demo owns its renderer, so nothing leaks.
const NIGHT_EXPOSURE = 5;

// ---- hero: midnight on the lake ---------------------------------------------------------

export async function mountNightHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { aspect: 0.5, fov: 46, far: 9000 });
  ctx.renderer.toneMappingExposure = NIGHT_EXPOSURE;

  let hour = 23.4;
  const atm = createAtmosphere(hour);
  ctx.scene.add(atm.makeDome());

  const moon = new Moon();
  moon.update(hour);
  ctx.scene.add(moon.group);

  // The Mirror's lake, pointed at the moon: same environment seam, dimmer
  // sun. The glint code becomes the glitter path without being told.
  const lake = new LakeSurface({
    env: { sunDirection: atm.moonDirection, sunColor: atm.moonColor, skyColor: atm.skyColor },
    size: 1200,
    segments: 192,
  });
  // The daylight deep-scatter constant is too lively for night exposure.
  lake.scatter.value.setHex(0x02060a);
  ctx.scene.add(lake.mesh);

  wind.speed = 1.6;

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 2, 0),
    distance: 26,
    polar: 0.13,
    azimuth: 0.9,
    maxPolar: 0.8,
    drift: 0.003,
  });

  ctx.shell.slider({
    label: "hour",
    min: 18,
    max: 30,
    step: 0.05,
    value: hour,
    format: (v) => fmtHour(v % 24),
    onInput: (v) => {
      hour = v % 24;
      atm.setHour(hour);
      moon.update(hour);
    },
  });
  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 5,
    step: 0.05,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.setInfo(
    () =>
      `${fmtHour(hour)} · moon ${moonElevationDeg(hour).toFixed(1)}° · ` +
      `stars ${(starVisibility(sunElevationDeg(hour)) * 100).toFixed(0)}% · exposure ×${NIGHT_EXPOSURE}`,
  );

  ctx.onDispose(() => {
    atm.dispose();
    moon.dispose();
    lake.dispose();
    orbit.dispose();
    wind.speed = 3;
  });
  return ctx.finish((t, dt) => {
    lake.update(t);
    orbit.update(dt);
  });
}

// ---- Step 1: the moon's path, and phase as geometry --------------------------------------------

export async function mountMoonArc(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { fov: 52, far: 9000 });
  ctx.renderer.toneMappingExposure = NIGHT_EXPOSURE;

  let hour = 22;
  const atm = createAtmosphere(hour);
  ctx.scene.add(atm.makeDome(600));

  const groundGeo = new PlaneGeometry(1400, 1400);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new MeshBasicNodeMaterial();
  groundMat.colorNode = color(0x05070a);
  ctx.scene.add(new Mesh(groundGeo, groundMat));

  // A big demonstration moon close in, so the terminator reads.
  const moon = new Moon({ distance: 420, sizeScale: 14 });
  moon.update(hour);
  ctx.scene.add(moon.group);

  // The 24-hour track for the current lag.
  const N = 192;
  const arcPos = new Float32Array((N + 1) * 3);
  const arcGeo = new BufferGeometry();
  const arcAttr = new BufferAttribute(arcPos, 3);
  arcGeo.setAttribute("position", arcAttr);
  const arcMat = new LineBasicNodeMaterial({ transparent: true, opacity: 0.55 });
  const v = new Vector3();
  const rebuildArc = (): void => {
    for (let i = 0; i <= N; i++) {
      moonDirectionLagged((i / N) * 24, moon.lagHours, v).multiplyScalar(540);
      arcPos.set([v.x, v.y, v.z], i * 3);
    }
    arcAttr.needsUpdate = true;
  };
  rebuildArc();
  ctx.scene.add(new Line(arcGeo, arcMat));

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 30, 0),
    distance: 90,
    polar: 0.14,
    azimuth: 1.3,
    maxPolar: 0.7,
  });

  ctx.shell.slider({
    label: "hour",
    min: 18,
    max: 30,
    step: 0.05,
    value: hour,
    format: (val) => fmtHour(val % 24),
    onInput: (val) => {
      hour = val % 24;
      atm.setHour(hour);
      moon.update(hour);
    },
  });
  ctx.shell.slider({
    label: "moon lag behind sun (h)",
    min: 0.5,
    max: 23.5,
    step: 0.25,
    value: 12,
    onInput: (val) => {
      moon.lagHours = val;
      moon.update(hour);
      rebuildArc();
    },
  });
  ctx.shell.setInfo(() => {
    const lit = moon.litFraction(hour);
    const name =
      lit > 0.97 ? "full" : lit > 0.6 ? "gibbous" : lit > 0.4 ? "quarter" : lit > 0.05 ? "crescent" : "new";
    return `lit fraction ${(lit * 100).toFixed(0)}% · ${name} — phase is just geometry`;
  });

  ctx.onDispose(() => {
    atm.dispose();
    moon.dispose();
    groundGeo.dispose();
    groundMat.dispose();
    arcGeo.dispose();
    arcMat.dispose();
    orbit.dispose();
  });
  return ctx.finish((_t, dt) => {
    orbit.update(dt);
  });
}

// ---- Step 2: the star dome ------------------------------------------------------------------------

export async function mountStarDome(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { fov: 55, far: 9000 });
  ctx.renderer.toneMappingExposure = NIGHT_EXPOSURE;

  let hour = 23;
  const atm = createAtmosphere(hour, { stars: { intensity: 1.3 } });
  ctx.scene.add(atm.makeDome(600));

  const groundGeo = new PlaneGeometry(1400, 1400);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new MeshBasicNodeMaterial();
  groundMat.colorNode = color(0x05070a);
  ctx.scene.add(new Mesh(groundGeo, groundMat));

  // The axis the whole sky turns around.
  const pole = celestialPole().multiplyScalar(560);
  const axisGeo = new BufferGeometry();
  axisGeo.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([0, 0, 0, pole.x, pole.y, pole.z]), 3),
  );
  const axisMat = new LineBasicNodeMaterial({ transparent: true, opacity: 0.5 });
  ctx.scene.add(new Line(axisGeo, axisMat));

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 36, 0),
    distance: 90,
    polar: 0.3,
    azimuth: -1.4, // looking north, where the wheel is obvious
    maxPolar: 1.0,
  });

  ctx.shell.slider({
    label: "hour",
    min: 16,
    max: 32,
    step: 0.02,
    value: hour,
    format: (val) => fmtHour(val % 24),
    onInput: (val) => {
      hour = val % 24;
      atm.setHour(hour);
    },
  });
  ctx.shell.setInfo(() => {
    const vis = starVisibility(sunElevationDeg(hour));
    return `sun ${sunElevationDeg(hour).toFixed(0)}° · stars ${(vis * 100).toFixed(0)}% · the dome turns 15°/h around the pole`;
  });

  ctx.onDispose(() => {
    atm.dispose();
    groundGeo.dispose();
    groundMat.dispose();
    axisGeo.dispose();
    axisMat.dispose();
    orbit.dispose();
  });
  return ctx.finish((_t, dt) => {
    orbit.update(dt);
  });
}

// ---- Step 3: the glitter path -----------------------------------------------------------------------

export async function mountMoonGlitter(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { fov: 46, far: 9000 });
  ctx.renderer.toneMappingExposure = NIGHT_EXPOSURE;

  const hour = 23.4; // moon well up, sun long gone
  const atm = createAtmosphere(hour);
  ctx.scene.add(atm.makeDome());

  const moon = new Moon();
  moon.update(hour);
  ctx.scene.add(moon.group);

  const lake = new LakeSurface({
    env: { sunDirection: atm.moonDirection, sunColor: atm.moonColor, skyColor: atm.skyColor },
    size: 1200,
    segments: 192,
  });
  lake.scatter.value.setHex(0x02060a);
  ctx.scene.add(lake.mesh);

  wind.speed = 1.2;

  // Low to the water, looking along the path toward the moon.
  const moonAz = Math.atan2(moon.direction.z, moon.direction.x);
  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 1.2, 0),
    distance: 18,
    polar: 0.08,
    azimuth: moonAz + Math.PI, // camera opposite the moon: path runs toward it
    maxPolar: 0.6,
  });

  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 6,
    step: 0.05,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.slider({
    label: "micro-roughness",
    min: 0.02,
    max: 0.35,
    step: 0.005,
    value: 0.08,
    onInput: (v) => (lake.roughness.value = v),
  });
  ctx.shell.setInfo(() => {
    // Slope spread ∝ wind: the table's amplitudes are linear in wind speed.
    const sigma = 0.012 + wind.speed * 0.018;
    return `slope spread σ ≈ ${sigma.toFixed(3)} rad · path elongates ≈ ${(2 * sigma * 57.3).toFixed(1)}° along the view`;
  });

  ctx.onDispose(() => {
    atm.dispose();
    moon.dispose();
    lake.dispose();
    orbit.dispose();
    wind.speed = 3;
  });
  return ctx.finish((t, dt) => {
    lake.update(t);
    orbit.update(dt);
  });
}
