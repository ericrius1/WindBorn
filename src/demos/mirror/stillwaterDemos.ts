// Demos for stillwater.html — the glass-dawn finale. Part 5 of The Mirror.

import { Mesh, MeshBasicNodeMaterial, PlaneGeometry, Vector3 } from "three/webgpu";
import {
  cameraPosition,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  reflect,
  step,
  uniform,
  vec3,
} from "three/tsl";
import { Color } from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { clock, disturb, onDisturbance, wind } from "../../lib/spine";
import {
  PlanarReflection,
  RippleRings,
  createDawnSky,
  createWaveUniforms,
  f0FromIor,
  fresnelSchlick,
  sunGlint,
  waveHeightNode,
  waveSlopeNode,
} from "../../lib/water";
import { addOrbit, makeMountainRing, makeSnag, mirrorCtx, pickWaterPoint, disposeGroup } from "./kit";
import { DAWN_CAMERA, buildGlassDawn } from "./glassDawnScene";

function fmtClock(): string {
  const h = clock.hour;
  return `${Math.floor(h)}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
}

// ---- hero: the glass dawn -----------------------------------------------------------

export async function mountStillwaterHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { aspect: 0.5, fov: 46 });
  const dawn = buildGlassDawn(ctx.scene, ctx.width, ctx.height);
  dawn.attachPointer(ctx.shell.canvas, ctx.camera);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, { ...DAWN_CAMERA, maxPolar: 1.0, drift: 0.006 });

  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 4,
    step: 0.05,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.setInfo(() => "first light · 6:03 · tap the water");

  ctx.onDispose(() => {
    dawn.dispose();
    orbit.dispose();
  });
  return ctx.finish(
    (t, dt) => {
      dawn.update(t, dt);
      orbit.update(dt);
    },
    () => {
      dawn.renderReflection(ctx.renderer, ctx.scene, ctx.camera);
      ctx.renderer.render(ctx.scene, ctx.camera);
    },
  );
}

// ---- Step 1: the material, layer by layer ----------------------------------------------

const STAGES = [
  "0 · flat paint",
  "1 · + Fresnel sky",
  "2 · + wind ripples",
  "3 · + mirror world",
  "4 · + glints and rings",
];

export async function mountAssembly(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { fov: 48 });
  const sky = createDawnSky(6.2);
  const dome = sky.makeDome();
  const mountains = makeMountainRing({ radius: 460, height: 120 });
  const snag = makeSnag(-5, -7, sky.sunDirection);
  ctx.scene.add(dome, mountains, snag);

  const reflection = new PlanarReflection(Math.round(ctx.width * 0.5), Math.round(ctx.height * 0.5));
  const rings = new RippleRings();
  const waves = createWaveUniforms({ windSpeed: 1.6 });
  const stage = uniform(0);

  // Stage gates: each layer switches on at its step.
  const sFresnel = step(0.5, stage);
  const sWaves = step(1.5, stage);
  const sMirror = step(2.5, stage);
  const sAlive = step(3.5, stage);

  const material = new MeshBasicNodeMaterial();
  const ringsV = rings.contributionNode(positionLocal.xz, waves.time);
  material.positionNode = positionLocal.add(
    vec3(0, waveHeightNode(positionLocal.xz, waves, 3).mul(sWaves).add(ringsV.x.mul(sAlive)), 0),
  );

  const ringsF = rings.contributionNode(positionWorld.xz, waves.time);
  const slope = waveSlopeNode(positionWorld.xz, waves).mul(sWaves).add(ringsF.yz.mul(sAlive));
  const n = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));
  const view = normalize(cameraPosition.sub(positionWorld));
  const fresnel = fresnelSchlick(n.dot(view).clamp(0, 1), f0FromIor(uniform(1.333)));
  const r = reflect(view.negate(), n);
  const skyReflected = sky.skyColor(normalize(vec3(r.x, r.y.max(0.02), r.z)));
  const mirrorReflected = reflection.colorNode(n.xz.mul(0.09));
  const reflected = mix(skyReflected, mirrorReflected, sMirror);
  const body = uniform(new Color(0x0a2531)).rgb;
  const glint = sunGlint(n, view, sky.sunDirection, uniform(0.06)).mul(sky.sunColor.rgb).mul(sAlive);
  material.colorNode = mix(body, reflected, fresnel.mul(sFresnel)).add(glint);

  const geometry = new PlaneGeometry(600, 600, 256, 256);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  ctx.scene.add(mesh);

  let now = 0;
  const offBus = onDisturbance((d) => rings.add(d, now));
  const click = (e: PointerEvent): void => {
    const hit = pickWaterPoint(e, ctx.shell.canvas, ctx.camera);
    if (hit) disturb({ kind: "rise", x: hit.x, z: hit.z, energy: 0.06, radius: 0.4 });
  };
  ctx.shell.canvas.addEventListener("pointerdown", click);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(-2, 1.4, -2),
    distance: 15,
    polar: 0.16,
    azimuth: 0.9,
    maxPolar: 1.0,
  });

  ctx.shell.button("add the next layer", () => {
    stage.value = (stage.value + 1) % 5;
  });
  ctx.shell.setInfo(() => `${STAGES[stage.value]}${stage.value === 4 ? " — tap the water" : ""}`);

  ctx.onDispose(() => {
    offBus();
    ctx.shell.canvas.removeEventListener("pointerdown", click);
    geometry.dispose();
    material.dispose();
    reflection.dispose();
    sky.dispose();
    mountains.geometry.dispose();
    (mountains.material as MeshBasicNodeMaterial).dispose();
    disposeGroup(snag);
    orbit.dispose();
  });
  return ctx.finish(
    (t, dt) => {
      now = t;
      waves.time.value = t;
      waves.windSpeed.value = wind.speed;
      waves.windDirection.value = wind.direction;
      orbit.update(dt);
    },
    () => {
      if (stage.value >= 3) reflection.render(ctx.renderer, ctx.scene, ctx.camera, [mesh]);
      ctx.renderer.render(ctx.scene, ctx.camera);
    },
  );
}

// ---- Step 2: the dawn keyed to the clock ---------------------------------------------------

export async function mountDawnHour(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { fov: 47 });
  const dawn = buildGlassDawn(ctx.scene, ctx.width, ctx.height, { autoRises: true, size: 1000 });
  dawn.attachPointer(ctx.shell.canvas, ctx.camera);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, { ...DAWN_CAMERA, distance: 15, maxPolar: 1.0 });

  ctx.shell.slider({
    label: "world clock (hour)",
    min: 4.6,
    max: 9,
    step: 0.05,
    value: 6.05,
    onInput: (v) => dawn.setHour(v),
  });
  ctx.shell.setInfo(() => {
    const e = Math.asin(dawn.sky.sunDirection.value.y) * (180 / Math.PI);
    return `${fmtClock()} · sun at ${e.toFixed(1)}°`;
  });

  ctx.onDispose(() => {
    dawn.dispose();
    orbit.dispose();
  });
  return ctx.finish(
    (t, dt) => {
      dawn.update(t, dt);
      orbit.update(dt);
    },
    () => {
      dawn.renderReflection(ctx.renderer, ctx.scene, ctx.camera);
      ctx.renderer.render(ctx.scene, ctx.camera);
    },
  );
}

// ---- Step 3: wind dies, mirror wakes ----------------------------------------------------------

export async function mountGlassWind(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { fov: 47 });
  const dawn = buildGlassDawn(ctx.scene, ctx.width, ctx.height, {
    autoRises: false,
    windSpeed: 0.5,
    size: 1000,
  });

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, { ...DAWN_CAMERA, distance: 16, maxPolar: 1.0 });

  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 6,
    step: 0.05,
    value: 0.5,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.setInfo(() => {
    const swell = 3.5 * wind.speed * 0.4; // cm: base amp/wind × swell fraction
    return wind.speed < 0.3 ? "glass" : `swell ≈ ${swell.toFixed(1)} cm`;
  });

  ctx.onDispose(() => {
    dawn.dispose();
    orbit.dispose();
  });
  return ctx.finish(
    (t, dt) => {
      dawn.update(t, dt);
      orbit.update(dt);
    },
    () => {
      dawn.renderReflection(ctx.renderer, ctx.scene, ctx.camera);
      ctx.renderer.render(ctx.scene, ctx.camera);
    },
  );
}

// ---- Step 4: the disturbance bus -----------------------------------------------------------------

export async function mountRiseRings(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { fov: 47 });
  const dawn = buildGlassDawn(ctx.scene, ctx.width, ctx.height, {
    autoRises: false,
    windSpeed: 0.35,
    size: 1000,
  });
  dawn.attachPointer(ctx.shell.canvas, ctx.camera);

  // A second, independent listener on the same bus — proof the channel is
  // shared. (Later it'll be the splash synthesizer in your headphones.)
  let events = 0;
  let lastKind = "—";
  const offCounter = onDisturbance((d) => {
    events++;
    lastKind = d.kind;
  });

  let raining = false;
  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    ...DAWN_CAMERA,
    distance: 13,
    polar: 0.32,
    maxPolar: 1.1,
  });

  ctx.shell.button("toggle a rain shower", () => {
    raining = !raining;
  });
  ctx.shell.setInfo(() => `bus events: ${events} · last: ${lastKind} · tap for a rise`);

  ctx.onDispose(() => {
    offCounter();
    dawn.dispose();
    orbit.dispose();
  });
  return ctx.finish(
    (t, dt) => {
      if (raining && Math.random() < dt * 7) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 14;
        disturb({
          kind: "rain",
          x: Math.cos(a) * r + DAWN_CAMERA.target.x,
          z: Math.sin(a) * r + DAWN_CAMERA.target.z,
          energy: 0.001 + Math.random() * 0.002,
          radius: 0.05,
        });
      }
      dawn.update(t, dt);
      orbit.update(dt);
    },
    () => {
      dawn.renderReflection(ctx.renderer, ctx.scene, ctx.camera);
      ctx.renderer.render(ctx.scene, ctx.camera);
    },
  );
}
