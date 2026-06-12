// Demos for mirrorworld.html — the mirrored camera, the perfect mirror, the
// rippled mirror, and the Fresnel-weighted blend. Part 3 of The Mirror.

import { Group, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Vector3 } from "three/webgpu";
import { cameraPosition, mix, normalize, positionLocal, positionWorld, uniform, vec3 } from "three/tsl";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { mountScrolly, PAL, arrow, label, lerp, phase } from "../../lib/scrolly";
import { wind } from "../../lib/spine";
import {
  LakeSurface,
  PlanarReflection,
  createDawnSky,
  f0FromIor,
  fresnelSchlick,
  sunGlint,
  waveHeightNode,
  waveSlopeNode,
  createWaveUniforms,
} from "../../lib/water";
import { addOrbit, makeBuoys, makeMountainRing, makeSnag, mirrorCtx, type MirrorCtx, disposeGroup } from "./kit";

// ---- the shared shoreline scene ----------------------------------------------------

interface ReflectionScene {
  sky: ReturnType<typeof createDawnSky>;
  reflection: PlanarReflection;
  snag: Group;
  buoys: ReturnType<typeof makeBuoys>;
  dispose(): void;
}

function buildReflectionScene(ctx: MirrorCtx, hour: number): ReflectionScene {
  const sky = createDawnSky(hour);
  const dome = sky.makeDome();
  const mountains = makeMountainRing({ radius: 460, height: 120 });
  const snag = makeSnag(-5, -7, sky.sunDirection);
  const buoys = makeBuoys(3, 8, sky.sunDirection);
  const reflection = new PlanarReflection(Math.round(ctx.width * 0.5), Math.round(ctx.height * 0.5));
  ctx.scene.add(dome, mountains, snag, buoys.group);
  return {
    sky,
    reflection,
    snag,
    buoys,
    dispose() {
      sky.dispose();
      reflection.dispose();
      mountains.geometry.dispose();
      (mountains.material as MeshBasicNodeMaterial).dispose();
      disposeGroup(snag);
      buoys.dispose();
    },
  };
}

// ---- hero: the mirror world, complete ------------------------------------------------

export async function mountMirrorworldHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { aspect: 0.48, fov: 48 });
  const parts = buildReflectionScene(ctx, 6.25);
  const lake = new LakeSurface({ env: parts.sky, reflection: parts.reflection, size: 700, segments: 288 });
  ctx.scene.add(lake.mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(-2, 1.4, -2),
    distance: 16,
    polar: 0.14,
    azimuth: 0.9,
    maxPolar: 1.0,
    drift: 0.008,
  });

  wind.speed = 1.6;
  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 7,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.setInfo(() => "two renders per frame: the world, then its double");

  ctx.onDispose(() => {
    lake.dispose();
    parts.dispose();
    orbit.dispose();
  });
  return ctx.finish(
    (t, dt) => {
      lake.update(t);
      parts.buoys.update(t);
      orbit.update(dt);
    },
    () => {
      parts.reflection.render(ctx.renderer, ctx.scene, ctx.camera, [lake.mesh]);
      ctx.renderer.render(ctx.scene, ctx.camera);
    },
  );
}

// ---- the scrolly: reflecting the eye ---------------------------------------------------

export function mountMirrorScrolly(el: HTMLElement): void {
  mountScrolly(el, {
    screens: 3.2,
    aspect: 0.52,
    steps: [
      { at: 0, text: "Side view: your eye, a snag at the shoreline, and the water plane at y = 0." },
      {
        at: 0.3,
        text: "Reflect the eye across the plane: same x and z, y negated. Everything a flat mirror shows you is exactly what this underwater twin sees.",
      },
      {
        at: 0.58,
        text: "A reflected ray bouncing off the surface up to the snag is the same length as a straight ray from the twin — so render the scene once from the twin's position into a texture.",
      },
      {
        at: 0.84,
        text: "One catch: the twin can see things under the water that should never appear in a reflection. We clip its view at the plane itself — an oblique near plane.",
      },
    ],
    draw(c, w, h, t) {
      const surfY = h * 0.55;
      // water
      c.fillStyle = "rgba(38, 70, 96, 0.3)";
      c.fillRect(0, surfY, w, h - surfY);
      c.strokeStyle = PAL.accent;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(0, surfY);
      c.lineTo(w, surfY);
      c.stroke();
      label(c, "y = 0", w - 52, surfY - 10, { color: PAL.muted, mono: true });

      // snag: a vertical trunk with two branches
      const sx = w * 0.68;
      const top = surfY - h * 0.3;
      c.strokeStyle = PAL.text;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(sx, surfY);
      c.lineTo(sx, top);
      c.moveTo(sx, top + h * 0.08);
      c.lineTo(sx + w * 0.04, top + h * 0.035);
      c.moveTo(sx, top + h * 0.14);
      c.lineTo(sx - w * 0.04, top + h * 0.1);
      c.stroke();
      label(c, "snag", sx + 10, top, { color: PAL.text });

      // eye
      const ex = w * 0.18;
      const ey = surfY - h * 0.22;
      c.fillStyle = PAL.warm;
      c.beginPath();
      c.arc(ex, ey, 6, 0, Math.PI * 2);
      c.fill();
      label(c, "eye  (x, y, z)", ex - 8, ey - 16, { color: PAL.warm });

      // mirrored eye
      const ghost = phase(t, 0.28, 0.45);
      if (ghost > 0) {
        const my = surfY + (surfY - ey);
        c.globalAlpha = ghost;
        c.fillStyle = PAL.good;
        c.beginPath();
        c.arc(ex, my, 6, 0, Math.PI * 2);
        c.fill();
        label(c, "twin  (x, −y, z)", ex - 8, my + 20, { color: PAL.good });
        c.setLineDash([3, 4]);
        c.strokeStyle = PAL.dim;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(ex, ey);
        c.lineTo(ex, my);
        c.stroke();
        c.setLineDash([]);
        c.globalAlpha = 1;
      }

      // bounced ray vs twin ray
      const rays = phase(t, 0.56, 0.75);
      if (rays > 0) {
        c.globalAlpha = rays;
        const hitX = lerp(ex, sx, 0.42);
        // eye → surface → snag top
        c.strokeStyle = PAL.warm;
        c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(ex, ey);
        c.lineTo(hitX, surfY);
        c.lineTo(sx, top);
        c.stroke();
        // twin → snag top (straight)
        const my = surfY + (surfY - ey);
        c.strokeStyle = PAL.good;
        c.setLineDash([5, 4]);
        c.beginPath();
        c.moveTo(ex, my);
        c.lineTo(hitX, surfY);
        c.stroke();
        c.setLineDash([]);
        c.globalAlpha = 1;
      }

      // clip-plane note
      const clip = phase(t, 0.82, 0.95);
      if (clip > 0) {
        c.globalAlpha = clip;
        // a rock below the surface, crossed out from the twin's view
        const rx = w * 0.45;
        const ry = surfY + h * 0.16;
        c.fillStyle = PAL.dim;
        c.beginPath();
        c.ellipse(rx, ry, 16, 9, 0, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = PAL.red;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(rx - 20, ry - 12);
        c.lineTo(rx + 20, ry + 12);
        c.moveTo(rx + 20, ry - 12);
        c.lineTo(rx - 20, ry + 12);
        c.stroke();
        label(c, "clipped: below the plane", rx + 26, ry, { color: PAL.red });
        arrow(c, w * 0.1, surfY + 4, w * 0.36, surfY + 4, PAL.red, 1.5);
        label(c, "oblique near plane = the water plane", w * 0.1, surfY + 22, { color: PAL.red, size: 11 });
        c.globalAlpha = 1;
      }
    },
  });
}

// ---- Step 1: the second camera ----------------------------------------------------------

export async function mountSecondCamera(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { fov: 48 });
  const parts = buildReflectionScene(ctx, 6.4);
  const lake = new LakeSurface({
    env: parts.sky,
    reflection: parts.reflection,
    size: 600,
    segments: 224,
    waves: { ampScale: 0.25 },
  });
  ctx.scene.add(lake.mesh);

  let viewMirror = false;
  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(-2, 1.5, -2),
    distance: 15,
    polar: 0.22,
    azimuth: 0.9,
    maxPolar: 1.0,
  });

  ctx.shell.button("switch eye: yours ↔ the underwater twin", () => {
    viewMirror = !viewMirror;
  });
  ctx.shell.setInfo(() => {
    const y = ctx.camera.position.y;
    return viewMirror
      ? `twin camera at y = ${(-y).toFixed(1)} m, looking up`
      : `your camera at y = ${y.toFixed(1)} m`;
  });

  ctx.onDispose(() => {
    lake.dispose();
    parts.dispose();
    orbit.dispose();
  });
  return ctx.finish(
    (t, dt) => {
      lake.update(t);
      parts.buoys.update(t);
      orbit.update(dt);
    },
    () => {
      parts.reflection.render(ctx.renderer, ctx.scene, ctx.camera, [lake.mesh]);
      if (viewMirror) {
        lake.mesh.visible = false;
        ctx.renderer.render(ctx.scene, parts.reflection.camera);
        lake.mesh.visible = true;
      } else {
        ctx.renderer.render(ctx.scene, ctx.camera);
      }
    },
  );
}

// ---- Step 2: the perfect mirror -----------------------------------------------------------

export async function mountPerfectMirror(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { fov: 48 });
  const parts = buildReflectionScene(ctx, 6.3);
  // Dead-flat water, zero distortion: the texture is sampled raw.
  const lake = new LakeSurface({
    env: parts.sky,
    reflection: parts.reflection,
    size: 600,
    segments: 8,
    waves: { ampScale: 0 },
  });
  lake.distortion.value = 0;
  ctx.scene.add(lake.mesh);

  let scale = 0.5;
  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(-2, 1.6, -2),
    distance: 14,
    polar: 0.18,
    azimuth: 0.9,
    maxPolar: 0.9,
  });

  ctx.shell.slider({
    label: "reflection resolution ×",
    min: 0.1,
    max: 1,
    step: 0.05,
    value: scale,
    onInput: (v) => {
      scale = v;
      parts.reflection.setSize(ctx.width * v, ctx.height * v);
    },
  });
  ctx.shell.setInfo(
    () => `render target: ${Math.round(ctx.width * scale)} × ${Math.round(ctx.height * scale)} px`,
  );

  ctx.onDispose(() => {
    lake.dispose();
    parts.dispose();
    orbit.dispose();
  });
  return ctx.finish(
    (t, dt) => {
      lake.update(t);
      parts.buoys.update(t);
      orbit.update(dt);
    },
    () => {
      parts.reflection.render(ctx.renderer, ctx.scene, ctx.camera, [lake.mesh]);
      ctx.renderer.render(ctx.scene, ctx.camera);
    },
  );
}

// ---- Step 3: the rippled mirror --------------------------------------------------------------

export async function mountRippledMirror(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { fov: 48 });
  const parts = buildReflectionScene(ctx, 6.3);
  const lake = new LakeSurface({ env: parts.sky, reflection: parts.reflection, size: 600, segments: 256 });
  ctx.scene.add(lake.mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(-2, 1.5, -2),
    distance: 15,
    polar: 0.17,
    azimuth: 0.9,
    maxPolar: 1.0,
  });

  wind.speed = 2;
  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 7,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.slider({
    label: "distortion strength",
    min: 0,
    max: 0.3,
    step: 0.005,
    value: lake.distortion.value,
    onInput: (v) => (lake.distortion.value = v),
  });
  ctx.shell.setInfo(() => "offset = normal.xz × strength, in texture UV units");

  ctx.onDispose(() => {
    lake.dispose();
    parts.dispose();
    orbit.dispose();
  });
  return ctx.finish(
    (t, dt) => {
      lake.update(t);
      parts.buoys.update(t);
      orbit.update(dt);
    },
    () => {
      parts.reflection.render(ctx.renderer, ctx.scene, ctx.camera, [lake.mesh]);
      ctx.renderer.render(ctx.scene, ctx.camera);
    },
  );
}

// ---- Step 4: weighted back by Fresnel ----------------------------------------------------------

export async function mountMirrorSkin(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await mirrorCtx(el, { fov: 48 });
  const parts = buildReflectionScene(ctx, 6.3);

  // A hand-assembled surface so the Fresnel weight can be switched off — the
  // library's LakeSurface always keeps it on.
  const waves = createWaveUniforms();
  const fresnelOn = uniform(1);
  const distortion = uniform(0.09);
  const roughness = uniform(0.08);

  const material = new MeshBasicNodeMaterial();
  material.positionNode = positionLocal.add(vec3(0, waveHeightNode(positionLocal.xz, waves, 3), 0));
  const s = waveSlopeNode(positionWorld.xz, waves);
  const n = normalize(vec3(s.x.negate(), 1, s.y.negate()));
  const view = normalize(cameraPosition.sub(positionWorld));
  const cosTheta = n.dot(view).clamp(0, 1);
  const fresnel = fresnelSchlick(cosTheta, f0FromIor(uniform(1.333)));
  const weight = mix(uniform(1), fresnel, fresnelOn); // 1 = chrome, F = water
  const reflected = parts.reflection.colorNode(n.xz.mul(distortion));
  const body = vec3(0.016, 0.078, 0.1);
  const glint = sunGlint(n, view, parts.sky.sunDirection, roughness)
    .mul(parts.sky.sunColor.rgb)
    .mul(weight);
  material.colorNode = mix(body, reflected, weight).add(glint);

  const geometry = new PlaneGeometry(600, 600, 256, 256);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  ctx.scene.add(mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(-2, 1.5, -2),
    distance: 15,
    polar: 0.2,
    azimuth: 0.9,
    maxPolar: 1.1,
  });

  wind.speed = 1.8;
  ctx.shell.button("toggle chrome ↔ Fresnel", () => {
    fresnelOn.value = fresnelOn.value > 0.5 ? 0 : 1;
  });
  ctx.shell.setInfo(() =>
    fresnelOn.value > 0.5
      ? "mix(body, mirror, F): water"
      : "100% mirror everywhere: liquid chrome",
  );

  ctx.onDispose(() => {
    geometry.dispose();
    material.dispose();
    parts.dispose();
    orbit.dispose();
  });
  return ctx.finish(
    (t, dt) => {
      waves.time.value = t;
      waves.windSpeed.value = wind.speed;
      waves.windDirection.value = wind.direction;
      parts.buoys.update(t);
      orbit.update(dt);
    },
    () => {
      parts.reflection.render(ctx.renderer, ctx.scene, ctx.camera, [mesh]);
      ctx.renderer.render(ctx.scene, ctx.camera);
    },
  );
}
