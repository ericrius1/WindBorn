// Demos for caustics.html — projected caustics, depth fog, god rays, and
// bubble columns. Part 3 of Under.

import * as THREE from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { mountScrolly, PAL, label, lerp } from "../../lib/scrolly";
import { wind, disturb, onDisturbance } from "../../lib/spine";
import { RippleRings, createDawnSky, createWaveUniforms } from "../../lib/water";
import { WATER_IOR } from "../../lib/water/opticsNodes";
import {
  BETA_PER_METER,
  BubblePlume,
  GodRayScreen,
  SurfaceCeiling,
  makeDepthDome,
} from "../../lib/underwater";
import { addOrbit, makeSandBed, pickPlanePoint, underCtx } from "./kit";

// ---- hero: the lit room ---------------------------------------------------------------

export async function mountCausticsHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await underCtx(el, { aspect: 0.48, fov: 60 });

  const sky = createDawnSky(7.6);
  const skyDome = sky.makeDome();
  const depthDome = makeDepthDome(200);
  const rings = new RippleRings();
  const ceiling = new SurfaceCeiling({ env: sky, size: 220, segments: 160, rings });
  const bed = makeSandBed({ env: sky, waves: ceiling.waves, depth: 2.4, size: 70, segments: 110 });
  const rays = new GodRayScreen(ctx.camera, { waves: ceiling.waves, env: sky, steps: 16, maxDist: 12 });
  const plume = new BubblePlume(220);
  plume.attachToBus();
  ctx.scene.add(skyDome, depthDome.mesh, ceiling.mesh, bed.mesh, plume.mesh);

  let simT = 0;
  const unsub = onDisturbance((d) => rings.add(d, simT));

  // click (or tap) the water: a strike lands there
  const canvas = ctx.shell.canvas;
  let downAt = 0;
  const onDown = (): void => {
    downAt = performance.now();
  };
  const onUp = (e: PointerEvent): void => {
    if (performance.now() - downAt > 220) return; // it was a drag
    const p = pickPlanePoint(e, canvas, ctx.camera, 0);
    if (p && Math.hypot(p.x, p.z) < 30) {
      disturb({ kind: "splash", x: p.x, z: p.z, energy: 0.9, radius: 0.4 });
    }
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);

  ctx.onDispose(() => {
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointerup", onUp);
    unsub();
    rays.dispose();
    plume.dispose();
    ceiling.dispose();
    bed.dispose();
    depthDome.dispose();
    sky.dispose();
  });

  const orbit = addOrbit(canvas, ctx.camera, {
    target: new THREE.Vector3(0, -1.3, 0),
    distance: 4.2,
    azimuth: 0.5,
    polar: 0.04,
    minPolar: -0.5,
    maxPolar: 0.16,
    drift: 0.012,
  });
  ctx.onDispose(() => orbit.dispose());

  wind.speed = 2.2;
  ctx.shell.slider({
    label: "hour",
    min: 5.4,
    max: 8.8,
    step: 0.05,
    value: 7.6,
    onInput: (v) => sky.setHour(v),
  });
  ctx.shell.slider({
    label: "choppiness",
    min: 0.6,
    max: 2.6,
    step: 0.05,
    value: 1.2,
    onInput: (v) => (ceiling.waves.choppiness.value = v),
  });
  ceiling.waves.choppiness.value = 1.2;
  ctx.shell.setInfo(() => `click the water to strike it · ${plume.count} bubbles`);

  return ctx.finish((t, dt) => {
    simT = t;
    ceiling.update(t);
    plume.update(dt, t);
    depthDome.mesh.position.copy(ctx.camera.position);
    depthDome.camDepth.value = Math.max(0, -ctx.camera.position.y);
    depthDome.sunDirection.value.copy(sky.sunDirection.value);
    orbit.update(dt);
  });
}

// ---- the scrolly: rays bunching -----------------------------------------------------------

export function mountFocusScrolly(el: HTMLElement): void {
  const n = WATER_IOR;
  mountScrolly(el, {
    screens: 3.4,
    aspect: 0.56,
    steps: [
      { at: 0, text: "Parallel sunlight arrives at a rippled surface. Every ray is identical until it touches water." },
      {
        at: 0.25,
        text: "Each facet bends its ray by Snell's law — toward the local normal. A trough is a converging lens; a crest spreads its rays apart.",
      },
      {
        at: 0.5,
        text: "Follow the rays down: where neighbors converge, light piles up. The bright filaments on the bed are exactly the places the refraction map squeezed.",
      },
      {
        at: 0.78,
        text: "Depth is the lever arm: the same slopes displace rays further before they land — β = d·(1 − 1/n) — so the pattern sharpens, then folds over itself.",
      },
    ],
    draw(c, w, h, t) {
      const surfaceY = h * 0.22;
      const bedY = lerp(h * 0.5, h * 0.88, Math.min(1, t * 1.35));
      const amp = h * 0.018;
      const k = (Math.PI * 2) / (w * 0.16);
      const phase = t * 14;

      // water body
      c.fillStyle = "rgba(26, 58, 80, 0.3)";
      c.fillRect(0, surfaceY, w, bedY - surfaceY);

      // the surface curve
      c.strokeStyle = PAL.dot;
      c.lineWidth = 1.5;
      c.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const y = surfaceY + Math.sin(x * k + phase) * amp;
        if (x === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();

      // rays + landing histogram
      const rayCount = 60;
      const bins = new Float32Array(120);
      c.strokeStyle = "rgba(255, 233, 178, 0.34)";
      c.lineWidth = 1;
      for (let i = 0; i < rayCount; i++) {
        const x = ((i + 0.5) / rayCount) * w;
        const yS = surfaceY + Math.sin(x * k + phase) * amp;
        // sun from straight above; facet normal angle from the curve slope
        const slope = Math.cos(x * k + phase) * amp * k;
        const alpha = Math.atan(slope); // incidence angle
        const refr = Math.asin(Math.sin(alpha) / n);
        const dev = alpha - refr; // deviation from vertical, toward the normal
        const xLand = x + Math.tan(dev) * (bedY - yS);
        c.beginPath();
        c.moveTo(x, h * 0.04);
        c.lineTo(x, yS);
        c.lineTo(xLand, bedY);
        c.stroke();
        const b = Math.floor((xLand / w) * bins.length);
        if (b >= 0 && b < bins.length) bins[b] += 1;
      }

      // bed brightness from the histogram — the caustic, measured not painted
      const binW = w / bins.length;
      const mean = rayCount / bins.length;
      for (let b = 0; b < bins.length; b++) {
        const f = bins[b] / mean;
        const glow = Math.min(1, Math.max(0, (f - 0.6) / 2.4));
        c.fillStyle = `rgba(255, 236, 190, ${(glow * 0.9).toFixed(3)})`;
        c.fillRect(b * binW, bedY - 3, binW + 0.5, 6);
      }
      c.strokeStyle = PAL.grid;
      c.beginPath();
      c.moveTo(0, bedY);
      c.lineTo(w, bedY);
      c.stroke();

      const depthM = ((bedY - surfaceY) / (h * 0.66)) * 4;
      label(c, `depth ${depthM.toFixed(1)} m · β = ${(depthM * BETA_PER_METER).toFixed(2)} m`, w * 0.03, h * 0.95, {
        color: PAL.text,
        mono: true,
      });
      label(c, "bright where rays bunch — det J → 0", w * 0.97, bedY + 18, { color: PAL.warm, align: "right", size: 11 });
    },
  });
}

// ---- Step 1: the caustic sheet --------------------------------------------------------------

export async function mountCausticSheet(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await underCtx(el, { fov: 44 });
  ctx.scene.background = new THREE.Color(0x04060a);

  const sky = createDawnSky(7.8);
  const waves = createWaveUniforms({ windSpeed: 2.4 });
  const bed = makeSandBed({ env: sky, waves, depth: 1.8, size: 26, segments: 80 });
  bed.gain.value = 0.65;
  ctx.scene.add(bed.mesh);
  ctx.onDispose(() => {
    bed.dispose();
    sky.dispose();
  });

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(0, -1.8, 0),
    distance: 14,
    azimuth: -0.6,
    polar: 1.05,
    minPolar: 0.35,
    maxPolar: 1.35,
  });
  ctx.onDispose(() => orbit.dispose());

  let depth = 1.8;
  ctx.shell.slider({
    label: "depth (m)",
    min: 0.3,
    max: 6,
    step: 0.05,
    value: depth,
    onInput: (v) => {
      depth = v;
      bed.mesh.position.y = -v;
    },
  });
  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0.5,
    max: 6,
    step: 0.1,
    value: 2.4,
    onInput: (v) => (waves.windSpeed.value = v),
  });
  ctx.shell.slider({
    label: "choppiness",
    min: 0.6,
    max: 2.6,
    step: 0.05,
    value: 1,
    onInput: (v) => (waves.choppiness.value = v),
  });
  ctx.shell.slider({
    label: "filament sharpness",
    min: 0.8,
    max: 3,
    step: 0.05,
    value: bed.sharp.value,
    onInput: (v) => (bed.sharp.value = v),
  });
  ctx.shell.setInfo(() => `β = depth · (1 − 1/n) = ${(depth * BETA_PER_METER).toFixed(2)} m`);

  return ctx.finish((t, dt) => {
    waves.time.value = t;
    orbit.update(dt);
  });
}

// ---- Step 2: fog and god rays -----------------------------------------------------------------

export async function mountGodRays(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await underCtx(el, { fov: 58 });

  const sky = createDawnSky(6.6);
  const skyDome = sky.makeDome();
  const depthDome = makeDepthDome(200);
  const ceiling = new SurfaceCeiling({ env: sky, size: 220, segments: 140 });
  const bed = makeSandBed({ env: sky, waves: ceiling.waves, depth: 3.2, size: 80 });
  const rays = new GodRayScreen(ctx.camera, { waves: ceiling.waves, env: sky, steps: 18, maxDist: 13 });
  ctx.scene.add(skyDome, depthDome.mesh, ceiling.mesh, bed.mesh);
  ctx.onDispose(() => {
    rays.dispose();
    ceiling.dispose();
    bed.dispose();
    depthDome.dispose();
    sky.dispose();
  });

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(0, -1.7, 0),
    distance: 5,
    azimuth: -2.2,
    polar: 0.02,
    minPolar: -0.4,
    maxPolar: 0.14,
    drift: 0.008,
  });
  ctx.onDispose(() => orbit.dispose());

  wind.speed = 2.4;
  ctx.shell.slider({
    label: "hour (sun angle)",
    min: 5.4,
    max: 8.8,
    step: 0.05,
    value: 6.6,
    onInput: (v) => sky.setHour(v),
  });
  ctx.shell.slider({
    label: "shaft gain",
    min: 0.005,
    max: 0.14,
    step: 0.005,
    value: rays.gain.value,
    onInput: (v) => (rays.gain.value = v),
  });
  ctx.shell.slider({
    label: "turbidity (view fog)",
    min: 0.02,
    max: 0.3,
    step: 0.01,
    value: 0.09,
    onInput: (v) => {
      ceiling.turbidity.value = v;
      bed.turbidity.value = v;
      rays.extinction.value = 0.3 + v * 2.5;
    },
  });
  ceiling.turbidity.value = 0.09;
  bed.turbidity.value = 0.09;
  ctx.shell.setInfo(() => "shafts = caustics extruded along the sun direction");

  return ctx.finish((t, dt) => {
    ceiling.update(t);
    depthDome.mesh.position.copy(ctx.camera.position);
    depthDome.camDepth.value = Math.max(0, -ctx.camera.position.y);
    depthDome.sunDirection.value.copy(sky.sunDirection.value);
    orbit.update(dt);
  });
}

// ---- Step 3: bubble columns ---------------------------------------------------------------------

export async function mountBubbleColumns(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await underCtx(el, { fov: 56 });

  const sky = createDawnSky(7.6);
  const skyDome = sky.makeDome();
  const depthDome = makeDepthDome(200);
  const rings = new RippleRings();
  const ceiling = new SurfaceCeiling({ env: sky, size: 220, segments: 140, rings });
  const bed = makeSandBed({ env: sky, waves: ceiling.waves, depth: 2.8, size: 70 });
  const plume = new BubblePlume(240);
  plume.attachToBus();
  ctx.scene.add(skyDome, depthDome.mesh, ceiling.mesh, bed.mesh, plume.mesh);

  let simT = 0;
  const unsub = onDisturbance((d) => rings.add(d, simT));
  ctx.onDispose(() => {
    unsub();
    plume.dispose();
    ceiling.dispose();
    bed.dispose();
    depthDome.dispose();
    sky.dispose();
  });

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(0, -1.2, 0),
    distance: 4.4,
    azimuth: 1.2,
    polar: 0.0,
    minPolar: -0.5,
    maxPolar: 0.16,
  });
  ctx.onDispose(() => orbit.dispose());

  const rand = (s: number): number => (Math.random() - 0.5) * 2 * s;
  ctx.shell.button("raindrop", () => disturb({ kind: "rain", x: rand(2.2), z: rand(2.2), energy: 0.004, radius: 0.06 }));
  ctx.shell.button("fish rise", () => disturb({ kind: "rise", x: rand(2.4), z: rand(2.4), energy: 0.05, radius: 0.18 }));
  ctx.shell.button("talon strike", () => disturb({ kind: "splash", x: rand(1.6), z: rand(1.6), energy: 1.0, radius: 0.4 }));
  ctx.shell.setInfo(() => `${plume.count} bubbles · raindrops are too weak to make a column`);

  return ctx.finish((t, dt) => {
    simT = t;
    ceiling.update(t);
    plume.update(dt, t);
    depthDome.mesh.position.copy(ctx.camera.position);
    depthDome.camDepth.value = Math.max(0, -ctx.camera.position.y);
    depthDome.sunDirection.value.copy(sky.sunDirection.value);
    orbit.update(dt);
  });
}
