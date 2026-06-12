// Demos for ripples.html — one traveling wave, the five-wave chorus, wind
// steering, and CPU/GPU parity. Part 2 of The Mirror.

import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  Vector3,
} from "three/webgpu";
import { cos, float, sin, uniform, vec2 } from "three/tsl";
import type { Node } from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { mountScrolly, PAL, label } from "../../lib/scrolly";
import { wind } from "../../lib/spine";
import {
  BASE_AMP_PER_WIND,
  LakeSurface,
  WAVE_TABLE,
  chopWeight,
  createDawnSky,
  createWaveUniforms,
  phaseSpeedCpu,
  waveHeightNode,
  waveSlopeNode,
} from "../../lib/water";
import { addOrbit, claySurfaceMaterial, fakeLitMaterial, makeBuoys, mirrorCtx } from "./kit";

type NodeV2 = Node<"vec2">;

// ---- hero: the wind-textured lake --------------------------------------------------

export async function mountRipplesHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { aspect: 0.48, fov: 48 });
  const sky = createDawnSky(7.2);
  const dome = sky.makeDome();
  const lake = new LakeSurface({ env: sky, size: 700, segments: 288, waves: { choppiness: 1.25 } });
  lake.roughness.value = 0.06;
  ctx.scene.add(dome, lake.mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.4, 0),
    distance: 17,
    polar: 0.15,
    azimuth: 2.5,
    maxPolar: 1.1,
    drift: 0.01,
  });

  wind.speed = 3.2;
  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 8,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.slider({
    label: "wind direction (°)",
    min: 0,
    max: 360,
    step: 1,
    value: (wind.direction * 180) / Math.PI,
    onInput: (v) => (wind.direction = (v * Math.PI) / 180),
  });
  ctx.shell.setInfo(() => `swell ≈ ${(BASE_AMP_PER_WIND * wind.speed * 0.4 * 100).toFixed(1)} cm`);

  ctx.onDispose(() => {
    lake.dispose();
    sky.dispose();
    orbit.dispose();
  });
  return ctx.finish((t, dt) => {
    lake.update(t);
    orbit.update(dt);
  });
}

// ---- Step 1: one traveling wave ------------------------------------------------------

export async function mountOneWave(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { fov: 46 });

  const wavelength = uniform(6);
  const amplitude = uniform(0.22);
  const direction = uniform(0.5);
  const speed = uniform(phaseSpeedCpu(6));
  const time = uniform(0);

  const phaseAt = (xz: NodeV2) => {
    const k = float(Math.PI * 2).div(wavelength);
    const d = xz.x.mul(cos(direction)).add(xz.y.mul(sin(direction)));
    return d.sub(speed.mul(time)).mul(k);
  };
  const material = claySurfaceMaterial({
    height: (xz) => amplitude.mul(sin(phaseAt(xz))),
    slope: (xz) => {
      const k = float(Math.PI * 2).div(wavelength);
      const c = amplitude.mul(k).mul(cos(phaseAt(xz)));
      return vec2(c.mul(cos(direction)), c.mul(sin(direction)));
    },
  });

  const geometry = new PlaneGeometry(40, 40, 280, 280);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  ctx.scene.add(mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0, 0),
    distance: 26,
    polar: 0.5,
    azimuth: 1.1,
  });

  ctx.shell.slider({
    label: "wavelength λ (m)",
    min: 0.3,
    max: 14,
    step: 0.1,
    log: true,
    value: wavelength.value,
    onInput: (v) => {
      wavelength.value = v;
      speed.value = phaseSpeedCpu(v);
    },
  });
  ctx.shell.slider({
    label: "amplitude A (m)",
    min: 0,
    max: 0.5,
    step: 0.01,
    value: amplitude.value,
    onInput: (v) => (amplitude.value = v),
  });
  ctx.shell.slider({
    label: "direction (°)",
    min: 0,
    max: 360,
    step: 1,
    value: (direction.value * 180) / Math.PI,
    onInput: (v) => (direction.value = (v * Math.PI) / 180),
  });
  ctx.shell.setInfo(() => `dispersion speed c = ${speed.value.toFixed(2)} m/s`);

  ctx.onDispose(() => {
    geometry.dispose();
    material.dispose();
    orbit.dispose();
  });
  return ctx.finish((t, dt) => {
    time.value = t;
    orbit.update(dt);
  });
}

// ---- the scrolly: five sines become a lake -------------------------------------------

export function mountWaveSumScrolly(el: HTMLElement): void {
  mountScrolly(el, {
    screens: 3.4,
    aspect: 0.55,
    steps: [
      { at: 0, text: "One sine wave: clean, regular, instantly fake. No real water looks like this." },
      { at: 0.28, text: "Add a second wave — different wavelength, speed, and heading — and the pattern stops repeating." },
      { at: 0.5, text: "A third and fourth break the rhythm further. Crests reinforce here, cancel there." },
      {
        at: 0.72,
        text: "Five waves, from an 11 m swell down to 45 cm capillary dressing: the profile stops looking designed. This exact table drives every lake surface on this site.",
      },
    ],
    draw(c, w, h, t) {
      const count = t < 0.28 ? 1 : t < 0.5 ? 2 : t < 0.61 ? 3 : t < 0.72 ? 4 : 5;
      const anim = t * 22;
      const xspan = 26; // meters across the panel
      const rowH = h * 0.085;
      const rowTop = h * 0.1;
      // individual components, faint
      for (let i = 0; i < 5; i++) {
        const wave = WAVE_TABLE[i];
        const active = i < count;
        const y0 = rowTop + i * rowH;
        c.strokeStyle = active ? PAL.accent : PAL.dim;
        c.globalAlpha = active ? 0.9 : 0.25;
        c.lineWidth = 1.2;
        c.beginPath();
        for (let px = 0; px <= w * 0.62; px += 2) {
          const x = (px / (w * 0.62)) * xspan;
          const k = (Math.PI * 2) / wave.wavelength;
          const y = y0 - Math.sin((x - wave.speed * anim * 0.08) * k) * wave.amp * rowH * 1.6;
          if (px === 0) c.moveTo(px + w * 0.03, y);
          else c.lineTo(px + w * 0.03, y);
        }
        c.stroke();
        c.globalAlpha = 1;
        label(c, `λ=${wave.wavelength} m`, w * 0.67, y0, {
          color: active ? PAL.text : PAL.dim,
          mono: true,
          size: 11,
        });
      }
      // the sum, bold
      const sumY = h * 0.74;
      label(c, `sum of ${count} wave${count > 1 ? "s" : ""}`, w * 0.03, sumY - h * 0.13, { color: PAL.warm });
      c.strokeStyle = PAL.warm;
      c.lineWidth = 2.2;
      c.beginPath();
      for (let px = 0; px <= w * 0.94; px += 2) {
        const x = (px / (w * 0.62)) * xspan;
        let y = 0;
        for (let i = 0; i < count; i++) {
          const wave = WAVE_TABLE[i];
          const k = (Math.PI * 2) / wave.wavelength;
          y += Math.sin((x - wave.speed * anim * 0.08) * k) * wave.amp;
        }
        const py = sumY - y * rowH * 1.6;
        if (px === 0) c.moveTo(px + w * 0.03, py);
        else c.lineTo(px + w * 0.03, py);
      }
      c.stroke();
    },
  });
}

// ---- Step 2: the five-wave chorus ----------------------------------------------------

export async function mountWaveChorus(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { fov: 46 });

  const waves = createWaveUniforms({ windSpeed: 3, choppiness: 1, windDirection: 0.6 });
  const material = claySurfaceMaterial({
    height: (xz) => waveHeightNode(xz, waves),
    slope: (xz) => waveSlopeNode(xz, waves),
  });
  const geometry = new PlaneGeometry(40, 40, 320, 320);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  ctx.scene.add(mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0, 0),
    distance: 24,
    polar: 0.45,
    azimuth: 1.2,
  });

  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 8,
    step: 0.1,
    value: waves.windSpeed.value,
    onInput: (v) => (waves.windSpeed.value = v),
  });
  ctx.shell.slider({
    label: "choppiness (spectrum tilt)",
    min: 0.3,
    max: 2.5,
    step: 0.05,
    value: 1,
    onInput: (v) => (waves.choppiness.value = v),
  });
  ctx.shell.setInfo(() => {
    const base = BASE_AMP_PER_WIND * waves.windSpeed.value;
    const amps = WAVE_TABLE.map((wave, i) =>
      (base * wave.amp * chopWeight(i, waves.choppiness.value) * 100).toFixed(1),
    );
    return `amps (cm): ${amps.join(" · ")}`;
  });

  ctx.onDispose(() => {
    geometry.dispose();
    material.dispose();
    orbit.dispose();
  });
  return ctx.finish((t, dt) => {
    waves.time.value = t;
    orbit.update(dt);
  });
}

// ---- Step 3: steered by the one wind field --------------------------------------------

const _windSample = new Vector3();

export async function mountWindSteer(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { fov: 48 });
  const sky = createDawnSky(7.4);
  const dome = sky.makeDome();
  const lake = new LakeSurface({ env: sky, size: 500, segments: 256 });
  ctx.scene.add(dome, lake.mesh);

  // The wind vane: a fat arrow floating 3 m over the lake, reading the same
  // field the waves do.
  const vane = new Group();
  const shaftGeometry = new CylinderGeometry(0.07, 0.07, 2.4, 10);
  shaftGeometry.rotateZ(-Math.PI / 2); // align along +x
  const headGeometry = new ConeGeometry(0.22, 0.7, 12);
  headGeometry.rotateZ(-Math.PI / 2);
  const vaneMaterial = fakeLitMaterial(0xd8aa54, sky.sunDirection);
  const shaft = new Mesh(shaftGeometry, vaneMaterial);
  const head = new Mesh(headGeometry, vaneMaterial);
  head.position.x = 1.55;
  vane.add(shaft, head);
  vane.position.set(0, 3, 0);
  ctx.scene.add(vane);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 1.2, 0),
    distance: 15,
    polar: 0.3,
    azimuth: 2.3,
    maxPolar: 1.2,
  });

  wind.speed = 3;
  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 8,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.slider({
    label: "wind direction (°)",
    min: 0,
    max: 360,
    step: 1,
    value: (wind.direction * 180) / Math.PI,
    onInput: (v) => (wind.direction = (v * Math.PI) / 180),
  });
  ctx.shell.setInfo(() => {
    const v = _windSample.length();
    return `wind.sample at vane: ${v.toFixed(1)} m/s (gusts included)`;
  });

  ctx.onDispose(() => {
    lake.dispose();
    sky.dispose();
    shaftGeometry.dispose();
    headGeometry.dispose();
    vaneMaterial.dispose();
    orbit.dispose();
  });
  return ctx.finish((t, dt) => {
    // Sample the actual field (mean + gusts) and let the water breathe with it.
    wind.sample(0, 3, 0, t, _windSample);
    const gustSpeed = _windSample.length();
    const gustDir = Math.atan2(_windSample.z, _windSample.x);
    lake.update(t, false);
    lake.waves.windSpeed.value = gustSpeed;
    lake.waves.windDirection.value = gustDir;
    vane.rotation.y = -gustDir;
    const s = 0.5 + gustSpeed * 0.22;
    vane.scale.set(s, 1, 1);
    orbit.update(dt);
  });
}

// ---- Step 4: the float test (CPU water == GPU water) -----------------------------------

export async function mountFloatParity(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { fov: 47 });
  const sky = createDawnSky(7.0);
  const dome = sky.makeDome();
  // Small and dense: all five table waves displace vertices here, so the
  // rendered surface IS the spine's waterHeightAt, sample for sample.
  const lake = new LakeSurface({ env: sky, size: 44, segments: 340, vertexWaves: 5 });
  ctx.scene.add(dome, lake.mesh);

  const buoys = makeBuoys(5, 9, sky.sunDirection);
  ctx.scene.add(buoys.group);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.2, 0),
    distance: 13,
    polar: 0.3,
    azimuth: 1.8,
    maxPolar: 1.2,
  });

  wind.speed = 3.5;
  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 8,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.button("scatter the floats", () => buoys.scatter());
  ctx.shell.setInfo(() => "buoy y = waterHeightAt(x, z, t) — no readback, same function");

  ctx.onDispose(() => {
    lake.dispose();
    buoys.dispose();
    sky.dispose();
    orbit.dispose();
  });
  return ctx.finish((t, dt) => {
    lake.update(t);
    buoys.update(t);
    orbit.update(dt);
  });
}
