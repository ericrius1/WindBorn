// Demos for skin.html — Fresnel reflectance, roughness, and the assembled
// water skin. Part 1 of The Mirror.

import { Mesh, MeshBasicNodeMaterial, NoToneMapping, PlaneGeometry, SphereGeometry, Vector3 } from "three/webgpu";
import {
  cameraPosition,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  select,
  uniform,
  vec3,
} from "three/tsl";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { mountScrolly, PAL, label, arrow, lerp } from "../../lib/scrolly";
import { wind } from "../../lib/spine";
import {
  LakeSurface,
  createDawnSky,
  createWaveUniforms,
  f0FromIor,
  fresnelExact,
  fresnelSchlick,
  sunGlint,
  waveHeightNode,
  waveSlopeNode,
} from "../../lib/water";
import { addOrbit, claySurfaceMaterial, mirrorCtx } from "./kit";

// ---- hero: the finished skin, teased --------------------------------------------

export async function mountSkinHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { aspect: 0.48, fov: 48 });
  const sky = createDawnSky(6.7);
  const dome = sky.makeDome();
  const lake = new LakeSurface({ env: sky, size: 700, segments: 288, waves: { choppiness: 1.1 } });
  ctx.scene.add(dome, lake.mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.4, 0),
    distance: 15,
    polar: 0.16,
    azimuth: 2.4,
    maxPolar: 1.1,
    drift: 0.012,
  });

  wind.speed = 2.2;
  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 7,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.setInfo(() => `F₀ ≈ 2% · the rest is geometry`);

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

// ---- Step 1: reflectance painted as brightness -----------------------------------

export async function mountFresnelPaint(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { fov: 45 });
  ctx.renderer.toneMapping = NoToneMapping; // diagnostic image: raw values

  const ior = uniform(1.333);
  const useExact = uniform(0);

  const material = new MeshBasicNodeMaterial();
  const view = normalize(cameraPosition.sub(positionWorld));
  const cosTheta = normalWorld.dot(view).clamp(0, 1);
  const f = select(
    useExact.greaterThan(0.5),
    fresnelExact(cosTheta, ior),
    fresnelSchlick(cosTheta, f0FromIor(ior)),
  );
  material.colorNode = vec3(f);

  const planeGeometry = new PlaneGeometry(80, 80);
  planeGeometry.rotateX(-Math.PI / 2);
  const plane = new Mesh(planeGeometry, material);
  const sphereGeometry = new SphereGeometry(1.6, 48, 32);
  const sphere = new Mesh(sphereGeometry, material);
  sphere.position.set(0, 1.9, 0);
  ctx.scene.add(plane, sphere);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 1.1, 0),
    distance: 9,
    polar: 0.22,
    azimuth: 0.7,
    maxPolar: 1.3,
  });

  ctx.shell.slider({
    label: "index of refraction n",
    min: 1.02,
    max: 2.5,
    step: 0.01,
    value: 1.333,
    onInput: (v) => (ior.value = v),
  });
  ctx.shell.button("toggle exact ↔ Schlick", () => {
    useExact.value = useExact.value > 0.5 ? 0 : 1;
  });
  ctx.shell.setInfo(() => {
    const n = ior.value;
    const f0 = ((n - 1) / (n + 1)) ** 2;
    return `${useExact.value > 0.5 ? "exact Fresnel" : "Schlick"} · F₀ = ${(f0 * 100).toFixed(2)}%`;
  });

  ctx.onDispose(() => {
    planeGeometry.dispose();
    sphereGeometry.dispose();
    material.dispose();
    orbit.dispose();
  });
  return ctx.finish((_t, dt) => orbit.update(dt));
}

// ---- the scrolly: one ray meets the surface ---------------------------------------

function fresnelExactCpu(cosTheta: number, n: number): number {
  const c1 = Math.max(0, Math.min(1, cosTheta));
  const sin2t = (1 - c1 * c1) / (n * n);
  const c2 = Math.sqrt(Math.max(1 - sin2t, 0));
  const rs = (c1 - n * c2) / (c1 + n * c2);
  const rp = (c2 - n * c1) / (c2 + n * c1);
  return (rs * rs + rp * rp) / 2;
}

export function mountFresnelScrolly(el: HTMLElement): void {
  const N = 1.333;
  mountScrolly(el, {
    screens: 3.4,
    aspect: 0.52,
    steps: [
      { at: 0, text: "A ray of light meets the lake. Two ways out: bounce off, or bend in. The Fresnel ratio F decides the split." },
      {
        at: 0.3,
        text: "Looking steeply down, F is tiny — about 2% reflects and 98% enters the water. That is why you can see the bottom at your feet.",
      },
      {
        at: 0.62,
        text: "As the angle flattens, F climbs slowly… then takes off. Past 70° the surface is most of the way to a mirror.",
      },
      {
        at: 0.86,
        text: "At a grazing glance, nearly all light bounces. The far side of any lake is sky, not lakebed — geometry alone decides.",
      },
    ],
    draw(c, w, h, t) {
      const surfaceY = h * 0.52;
      const hitX = w * 0.34;
      // incidence angle from vertical: 6° → 87°
      const theta = lerp(6, 87, t) * (Math.PI / 180);
      const f = fresnelExactCpu(Math.cos(theta), N);

      // water body
      c.fillStyle = "rgba(38, 70, 96, 0.35)";
      c.fillRect(0, surfaceY, w * 0.68, h - surfaceY);
      c.strokeStyle = PAL.accent;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(0, surfaceY);
      c.lineTo(w * 0.68, surfaceY);
      c.stroke();
      label(c, "air", 10, surfaceY - 12, { color: PAL.muted });
      label(c, "water  (n = 1.333)", 10, surfaceY + 14, { color: PAL.muted });

      const rayLen = h * 0.42;
      // incident ray (downward toward hit point)
      const ix = hitX - Math.sin(theta) * rayLen;
      const iy = surfaceY - Math.cos(theta) * rayLen;
      arrow(c, ix, iy, hitX, surfaceY, PAL.text, 2.5);
      // normal
      c.setLineDash([4, 4]);
      c.strokeStyle = PAL.dim;
      c.beginPath();
      c.moveTo(hitX, surfaceY - rayLen * 0.85);
      c.lineTo(hitX, surfaceY + rayLen * 0.6);
      c.stroke();
      c.setLineDash([]);
      // reflected ray, weight ∝ F
      const rx = hitX + Math.sin(theta) * rayLen;
      const ry = surfaceY - Math.cos(theta) * rayLen;
      arrow(c, hitX, surfaceY, rx, ry, PAL.warm, 1 + 5 * f);
      label(c, `reflected  ${(f * 100).toFixed(0)}%`, rx - 60, ry - 12, { color: PAL.warm });
      // refracted ray (Snell), weight ∝ 1−F
      const thetaT = Math.asin(Math.min(1, Math.sin(theta) / N));
      const tx = hitX + Math.sin(thetaT) * rayLen * 0.8;
      const ty = surfaceY + Math.cos(thetaT) * rayLen * 0.8;
      arrow(c, hitX, surfaceY, tx, ty, PAL.good, 1 + 5 * (1 - f));
      label(c, `refracted  ${((1 - f) * 100).toFixed(0)}%`, tx + 8, ty, { color: PAL.good });

      // F(θ) curve, right panel
      const gx = w * 0.72;
      const gw = w * 0.25;
      const gy = h * 0.16;
      const gh = h * 0.62;
      c.strokeStyle = PAL.grid;
      c.strokeRect(gx, gy, gw, gh);
      label(c, "F", gx - 14, gy + 6, { color: PAL.muted, mono: true });
      label(c, "0°", gx, gy + gh + 14, { color: PAL.muted, mono: true });
      label(c, "90°", gx + gw - 18, gy + gh + 14, { color: PAL.muted, mono: true });
      c.strokeStyle = PAL.accent;
      c.lineWidth = 2;
      c.beginPath();
      for (let i = 0; i <= 60; i++) {
        const a = (i / 60) * (Math.PI / 2);
        const fv = fresnelExactCpu(Math.cos(a), N);
        const px = gx + (i / 60) * gw;
        const py = gy + gh - fv * gh;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.stroke();
      const mx = gx + (theta / (Math.PI / 2)) * gw;
      const my = gy + gh - f * gh;
      c.fillStyle = PAL.warm;
      c.beginPath();
      c.arc(mx, my, 4.5, 0, Math.PI * 2);
      c.fill();
      label(c, `θ = ${((theta * 180) / Math.PI).toFixed(0)}°  F = ${(f * 100).toFixed(1)}%`, gx, gy - 10, {
        color: PAL.text,
        mono: true,
      });
    },
  });
}

// ---- Step 2: roughness and the glitter path ---------------------------------------

export async function mountGlitterPath(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { fov: 46 });

  const waves = createWaveUniforms({ windSpeed: 2.6, choppiness: 1.5, windDirection: 0.9 });
  const roughness = uniform(0.12);
  const sunDir = uniform(new Vector3(1, 0.08, 0).normalize());
  const sunColor = uniform(new Vector3(3.4, 2.3, 1.4));
  let elevationDeg = 5;

  const material = new MeshBasicNodeMaterial();
  material.positionNode = positionLocal.add(vec3(0, waveHeightNode(positionLocal.xz, waves, 3), 0));
  const s = waveSlopeNode(positionWorld.xz, waves);
  const n = normalize(vec3(s.x.negate(), 1, s.y.negate()));
  const view = normalize(cameraPosition.sub(positionWorld));
  const glint = sunGlint(n, view, sunDir, roughness);
  const base = vec3(0.012, 0.03, 0.046);
  material.colorNode = base.add(vec3(sunColor).mul(glint));

  const geometry = new PlaneGeometry(260, 260, 256, 256);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  ctx.scene.add(mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(20, 0, 0),
    distance: 26,
    polar: 0.1,
    azimuth: Math.PI,
    minPolar: 0.05,
    maxPolar: 0.9,
  });

  ctx.shell.slider({
    label: "roughness r",
    min: 0.02,
    max: 0.5,
    step: 0.005,
    value: roughness.value,
    onInput: (v) => (roughness.value = v),
  });
  ctx.shell.slider({
    label: "sun elevation (°)",
    min: 1,
    max: 30,
    step: 0.5,
    value: elevationDeg,
    onInput: (v) => {
      elevationDeg = v;
      const e = (v * Math.PI) / 180;
      sunDir.value.set(Math.cos(e), Math.sin(e), 0);
    },
  });
  ctx.shell.setInfo(() => `lobe exponent s = 2/r² − 2 ≈ ${Math.round(2 / roughness.value ** 2 - 2)}`);

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

// ---- Step 3: the assembled skin vs. flat paint --------------------------------------

export async function mountWaterSkin(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { fov: 48 });
  const sky = createDawnSky(6.7);
  const dome = sky.makeDome();
  const lake = new LakeSurface({ env: sky, size: 500, segments: 256 });
  ctx.scene.add(dome, lake.mesh);

  const skinMaterial = lake.mesh.material as MeshBasicNodeMaterial;
  const clayMaterial = claySurfaceMaterial({
    height: (xz) => waveHeightNode(xz, lake.waves, 3),
    slope: (xz) => waveSlopeNode(xz, lake.waves),
  });
  let skinned = true;

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.3, 0),
    distance: 14,
    polar: 0.2,
    azimuth: 2.2,
    maxPolar: 1.2,
  });

  wind.speed = 2.4;
  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 6,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.button("toggle matte paint ↔ water skin", () => {
    skinned = !skinned;
    lake.mesh.material = skinned ? skinMaterial : clayMaterial;
  });
  ctx.shell.setInfo(() => (skinned ? "Fresnel + glint: water" : "same waves, no Fresnel: wobbling plastic"));

  ctx.onDispose(() => {
    lake.dispose();
    clayMaterial.dispose();
    sky.dispose();
    orbit.dispose();
  });
  return ctx.finish((t, dt) => {
    lake.update(t);
    orbit.update(dt);
  });
}
