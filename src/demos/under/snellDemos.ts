// Demos for snell.html — Snell's window and total internal reflection.
// Part 2 of Under.

import * as THREE from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { mountScrolly, PAL, arrow, label, lerp, clamp01 } from "../../lib/scrolly";
import { wind } from "../../lib/spine";
import { createDawnSky } from "../../lib/water";
import { WATER_IOR } from "../../lib/water/opticsNodes";
import { SurfaceCeiling, criticalAngle, makeDepthDome, windowRadius } from "../../lib/underwater";
import { addOrbit, makeSandBed, underCtx, type UnderCtx } from "./kit";

const DEG = 180 / Math.PI;

// CPU Fresnel for a ray INSIDE the water hitting the underside at internal
// angle θw (cos given). Reciprocity: equals the air-side Fresnel at the
// conjugate exit angle. Returns reflectance 0..1; 1 beyond the critical angle.
function fresnelInternalCpu(cosW: number, n = WATER_IOR): number {
  const sinW = Math.sqrt(Math.max(0, 1 - cosW * cosW));
  const sinA = n * sinW;
  if (sinA >= 1) return 1; // total internal reflection
  const cosA = Math.sqrt(1 - sinA * sinA);
  const sin2t = (1 - cosA * cosA) / (n * n);
  const cosT = Math.sqrt(Math.max(0, 1 - sin2t));
  const rs = (cosA - n * cosT) / (cosA + n * cosT);
  const rp = (cosT - n * cosA) / (cosT + n * cosA);
  return (rs * rs + rp * rp) / 2;
}

// ---- a first-person look-around (drag to aim, fixed position) ----------------------

interface LookAround {
  yaw: number;
  pitch: number;
  apply(camera: THREE.PerspectiveCamera): void;
  dispose(): void;
}

function addLookAround(canvas: HTMLCanvasElement, yaw0 = 0, pitch0 = 1.1): LookAround {
  const look: LookAround = {
    yaw: yaw0,
    pitch: pitch0,
    apply(camera) {
      const cp = Math.cos(look.pitch);
      camera.lookAt(
        camera.position.x + Math.sin(look.yaw) * cp,
        camera.position.y + Math.sin(look.pitch),
        camera.position.z + Math.cos(look.yaw) * cp,
      );
    },
    dispose() {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    },
  };
  let dragging = false;
  const down = (e: PointerEvent): void => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent): void => {
    if (!dragging) return;
    look.yaw -= e.movementX * 0.004;
    look.pitch = Math.min(1.5, Math.max(-0.4, look.pitch + e.movementY * 0.004));
  };
  const up = (): void => {
    dragging = false;
  };
  canvas.style.touchAction = "pan-y";
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  return look;
}

// ---- the standard underwater room ---------------------------------------------------

function underwaterRoom(ctx: UnderCtx, hour = 7.4, bedDepth = 3.4) {
  const sky = createDawnSky(hour);
  const skyDome = sky.makeDome();
  const depthDome = makeDepthDome(200);
  const ceiling = new SurfaceCeiling({ env: sky, size: 220, segments: 160 });
  const bed = makeSandBed({ env: sky, waves: ceiling.waves, depth: bedDepth, size: 80 });
  ctx.scene.add(skyDome, depthDome.mesh, ceiling.mesh, bed.mesh);
  ctx.onDispose(() => {
    ceiling.dispose();
    bed.dispose();
    depthDome.dispose();
    sky.dispose();
  });
  const sync = (t: number): void => {
    ceiling.update(t);
    depthDome.mesh.position.copy(ctx.camera.position);
    depthDome.camDepth.value = Math.max(0, -ctx.camera.position.y);
    depthDome.sunDirection.value.copy(sky.sunDirection.value);
  };
  return { sky, ceiling, bed, depthDome, sync };
}

// ---- hero: the window itself ---------------------------------------------------------

export async function mountSnellHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await underCtx(el, { aspect: 0.48, fov: 68 });
  const room = underwaterRoom(ctx, 7.0, 4.2);

  ctx.camera.position.set(0, -1.6, 0);
  const look = addLookAround(ctx.shell.canvas, 0.6, 1.05);
  ctx.onDispose(() => look.dispose());

  wind.speed = 1.4;
  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 6,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.slider({
    label: "hour",
    min: 5.2,
    max: 8.8,
    step: 0.05,
    value: 7.0,
    onInput: (v) => room.sky.setHour(v),
  });
  ctx.shell.setInfo(() => `θc = ${(criticalAngle() * DEG).toFixed(1)}° — drag to look around`);

  return ctx.finish((t) => {
    // a slow drift so the window breathes even before the reader grabs it
    ctx.camera.position.set(Math.sin(t * 0.1) * 0.4, -1.6, Math.cos(t * 0.13) * 0.4);
    look.apply(ctx.camera);
    room.sync(t);
  });
}

// ---- the scrolly: deriving the critical angle ----------------------------------------

export function mountCriticalScrolly(el: HTMLElement): void {
  const n = WATER_IOR;
  const thetaC = Math.asin(1 / n);
  mountScrolly(el, {
    screens: 3.4,
    aspect: 0.56,
    steps: [
      {
        at: 0,
        text: "A ray leaving water bends AWAY from the vertical: sin θ<sub>air</sub> = 1.333 · sin θ<sub>water</sub>. Shallow rays exit almost straight.",
      },
      {
        at: 0.28,
        text: "Steeper rays bend harder, and the surface keeps more of the light — the reflected share (Fresnel) grows as the exit ray flattens toward the surface.",
      },
      {
        at: 0.52,
        text: "At sin θ = 1/1.333 — θc ≈ 48.6° — the exit ray grazes the surface itself. Snell has run out of sines: there is no angle whose sine is greater than 1.",
      },
      {
        at: 0.72,
        text: "Beyond θc nothing exits. Total internal reflection: the underside becomes a perfect mirror — not 98%, all of it.",
      },
      {
        at: 0.9,
        text: "Run it backwards: an eye underwater sees the entire sky compressed inside a 2·48.6° ≈ 97° cone. That cone is Snell's window.",
      },
    ],
    draw(c, w, h, t) {
      const surfaceY = h * 0.34;
      const sx = w * 0.46;
      const sy = h * 0.86;
      // water body + surface line
      c.fillStyle = "rgba(26, 58, 80, 0.35)";
      c.fillRect(0, surfaceY, w, h - surfaceY);
      c.strokeStyle = PAL.dot;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(0, surfaceY);
      c.lineTo(w, surfaceY);
      c.stroke();
      label(c, "air", w * 0.03, surfaceY - 12, { color: PAL.muted });
      label(c, "water · n = 1.333", w * 0.03, surfaceY + 14, { color: PAL.muted });

      // the window cone, drawn faint once the story reaches it
      const coneAlpha = clamp01((t - 0.82) / 0.1);
      if (coneAlpha > 0) {
        c.save();
        c.globalAlpha = coneAlpha * 0.25;
        c.fillStyle = PAL.warm;
        c.beginPath();
        c.moveTo(sx, sy);
        const r = (sy - surfaceY) / Math.cos(thetaC);
        c.lineTo(sx - Math.sin(thetaC) * r, sy - Math.cos(thetaC) * r);
        c.lineTo(sx + Math.sin(thetaC) * r, sy - Math.cos(thetaC) * r);
        c.closePath();
        c.fill();
        c.restore();
        label(c, "Snell's window — the whole sky lives in here", sx, surfaceY - 28, {
          color: PAL.warm,
          align: "center",
          alpha: coneAlpha,
        });
      }

      // sweep the internal angle with progress
      const theta = lerp(0.1, 1.22, Math.min(1, t / 0.85)); // radians, ~6°→70°
      const hit = { x: sx + Math.tan(theta) * (sy - surfaceY) * 0.42, y: surfaceY };
      // normal (dashed)
      c.save();
      c.setLineDash([4, 5]);
      c.strokeStyle = PAL.dim;
      c.beginPath();
      c.moveTo(hit.x, surfaceY - h * 0.24);
      c.lineTo(hit.x, surfaceY + h * 0.3);
      c.stroke();
      c.restore();

      const R = fresnelInternalCpu(Math.cos(theta));
      const T = 1 - R;

      // incident ray (always full strength)
      arrow(c, sx, sy, hit.x, hit.y, PAL.accent, 2.5, 8);
      label(c, `θ = ${(theta * DEG).toFixed(0)}°`, sx - 10, sy - 16, { color: PAL.accent, mono: true, align: "right" });

      // refracted ray
      const sinA = n * Math.sin(theta);
      if (sinA < 1) {
        const a = Math.asin(sinA);
        const len = h * 0.3;
        c.save();
        c.globalAlpha = Math.max(0.12, T);
        arrow(c, hit.x, hit.y, hit.x + Math.sin(a) * len, hit.y - Math.cos(a) * len, PAL.warm, 2.5, 8);
        c.restore();
        label(c, `exit ${(a * DEG).toFixed(0)}° · carries ${(T * 100).toFixed(0)}%`, hit.x + 14, hit.y - h * 0.26, {
          color: PAL.warm,
          mono: true,
          size: 11,
        });
      } else {
        label(c, "no exit — TIR", hit.x + 12, hit.y - 14, { color: PAL.red, mono: true });
      }

      // reflected ray
      const rLen = h * 0.26;
      c.save();
      c.globalAlpha = Math.max(0.1, R);
      arrow(
        c,
        hit.x,
        hit.y,
        hit.x + Math.sin(theta) * rLen,
        hit.y + Math.cos(theta) * rLen,
        PAL.good,
        2.5,
        8,
      );
      c.restore();
      label(c, `reflected ${(R * 100).toFixed(0)}%`, hit.x + Math.sin(theta) * rLen + 8, hit.y + Math.cos(theta) * rLen, {
        color: PAL.good,
        mono: true,
        size: 11,
      });

      // critical angle marker
      label(c, `θc = ${(thetaC * DEG).toFixed(1)}°  (sin θc = 1/n)`, w * 0.03, h * 0.95, { color: PAL.text, mono: true });
    },
  });
}

// ---- Step 1: the ray toy --------------------------------------------------------------

export async function mountCriticalAngle(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await underCtx(el, { fov: 42 });
  ctx.scene.background = new THREE.Color(0x05070c);

  // a translucent sheet for the surface, edge-on readable
  const sheetGeo = new THREE.PlaneGeometry(7, 5).rotateX(-Math.PI / 2);
  const sheetMat = new THREE.MeshBasicMaterial({
    color: 0x2b6f8a,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const sheet = new THREE.Mesh(sheetGeo, sheetMat);
  ctx.scene.add(sheet);

  // the underwater source
  const srcGeo = new THREE.SphereGeometry(0.08, 16, 12);
  const srcMat = new THREE.MeshBasicMaterial({ color: 0xffe9b0 });
  const source = new THREE.Mesh(srcGeo, srcMat);
  ctx.scene.add(source);

  // three rays as 2-point lines
  const makeRay = (hex: number): { line: THREE.Line; mat: THREE.LineBasicMaterial; geo: THREE.BufferGeometry } => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: hex, transparent: true });
    const line = new THREE.Line(geo, mat);
    ctx.scene.add(line);
    return { line, mat, geo };
  };
  const incident = makeRay(0x7aa2ff);
  const refracted = makeRay(0xffb86b);
  const reflected = makeRay(0x7dd6a0);
  const normal = makeRay(0x3a4054);
  normal.mat.opacity = 0.6;

  const setRay = (r: ReturnType<typeof makeRay>, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void => {
    const a = r.geo.getAttribute("position") as THREE.BufferAttribute;
    a.setXYZ(0, x0, y0, z0);
    a.setXYZ(1, x1, y1, z1);
    a.needsUpdate = true;
  };
  setRay(normal, 0, -1.6, 0, 0, 1.6, 0);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(0.4, 0, 0),
    distance: 5.2,
    azimuth: 0.35,
    polar: 0.12,
    minPolar: -0.6,
    maxPolar: 0.9,
  });
  ctx.onDispose(() => {
    orbit.dispose();
    sheetGeo.dispose();
    sheetMat.dispose();
    srcGeo.dispose();
    srcMat.dispose();
    for (const r of [incident, refracted, reflected, normal]) {
      r.geo.dispose();
      r.mat.dispose();
    }
  });

  let theta = 0.45; // internal angle from vertical, radians
  let sweep = true;
  ctx.shell.slider({
    label: "internal angle (°)",
    min: 2,
    max: 78,
    step: 0.5,
    value: theta * DEG,
    onInput: (v) => {
      theta = v / DEG;
      sweep = false;
    },
  });
  ctx.shell.button("auto sweep", () => (sweep = true));
  ctx.shell.setInfo(() => {
    const R = fresnelInternalCpu(Math.cos(theta));
    const sinA = WATER_IOR * Math.sin(theta);
    const exit = sinA < 1 ? `exit at ${(Math.asin(sinA) * DEG).toFixed(1)}°` : "no exit (TIR)";
    return `θ = ${(theta * DEG).toFixed(1)}° · ${exit} · reflected ${(R * 100).toFixed(0)}% · transmitted ${((1 - R) * 100).toFixed(0)}%`;
  });

  return ctx.finish((t, dt) => {
    if (sweep) theta = 0.12 + (Math.sin(t * 0.35) * 0.5 + 0.5) * 1.18;
    const Rdist = 1.9;
    const sx = -Math.sin(theta) * Rdist;
    const sy = -Math.cos(theta) * Rdist;
    source.position.set(sx, sy, 0);
    setRay(incident, sx, sy, 0, 0, 0, 0);

    const Rfrac = fresnelInternalCpu(Math.cos(theta));
    incident.mat.opacity = 0.95;
    const sinA = WATER_IOR * Math.sin(theta);
    if (sinA < 1) {
      const a = Math.asin(sinA);
      setRay(refracted, 0, 0, 0, Math.sin(a) * 1.8, Math.cos(a) * 1.8, 0);
      refracted.mat.opacity = Math.max(0.06, 1 - Rfrac);
      refracted.line.visible = true;
    } else {
      refracted.line.visible = false;
    }
    setRay(reflected, 0, 0, 0, Math.sin(theta) * 1.8, -Math.cos(theta) * 1.8, 0);
    reflected.mat.opacity = Math.max(0.08, Rfrac);

    orbit.update(dt);
  });
}

// ---- Step 2: the circle overhead --------------------------------------------------------

export async function mountWindowCircle(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await underCtx(el, { fov: 72 });
  const room = underwaterRoom(ctx, 7.4, 5.0);
  room.ceiling.waves.ampScale.value = 0.07; // near-glass, so the rim reads

  // the rim marker: a thin ring lying on the surface at r = depth·tan θc
  const ringGeo = new THREE.TorusGeometry(1, 0.014, 8, 90);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffb86b, transparent: true, opacity: 0.85 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ctx.scene.add(ring);
  ctx.onDispose(() => {
    ringGeo.dispose();
    ringMat.dispose();
  });

  let depth = 1.6;
  let ior = WATER_IOR;
  let showRing = true;
  ctx.shell.slider({
    label: "camera depth (m)",
    min: 0.5,
    max: 4.5,
    step: 0.05,
    value: depth,
    onInput: (v) => (depth = v),
  });
  ctx.shell.slider({
    label: "index of refraction n",
    min: 1.05,
    max: 1.8,
    step: 0.005,
    value: ior,
    onInput: (v) => {
      ior = v;
      room.ceiling.ior.value = v;
    },
  });
  ctx.shell.button("toggle rim marker", () => (showRing = !showRing));
  ctx.shell.setInfo(() => {
    const tc = criticalAngle(ior) * DEG;
    return `θc = asin(1/${ior.toFixed(3)}) = ${tc.toFixed(1)}° · rim radius ${windowRadius(depth, ior).toFixed(2)} m`;
  });

  const look = addLookAround(ctx.shell.canvas, 0.2, 1.35);
  ctx.onDispose(() => look.dispose());

  return ctx.finish((t) => {
    ctx.camera.position.set(0, -depth, 0);
    look.apply(ctx.camera);
    ring.visible = showRing;
    ring.position.set(0, -0.01, 0);
    const r = windowRadius(depth, ior);
    ring.scale.setScalar(r);
    room.sync(t);
  });
}

// ---- Step 3: the mirror outside ----------------------------------------------------------

export async function mountTirMirror(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await underCtx(el, { fov: 64 });

  const sky = createDawnSky(7.2);
  const skyDome = sky.makeDome();
  const depthDome = makeDepthDome(200);
  // five glowing beacons under the surface, mirrored by the TIR region
  const markers = [
    new THREE.Vector4(2.2, -0.7, 1.0, 1.6),
    new THREE.Vector4(-2.6, -1.1, 0.6, 1.6),
    new THREE.Vector4(0.8, -1.7, -2.4, 1.6),
    new THREE.Vector4(-1.2, -0.5, -2.0, 1.6),
    new THREE.Vector4(3.0, -1.4, -1.2, 1.6),
  ];
  const ceiling = new SurfaceCeiling({ env: sky, size: 220, segments: 160, markers });
  const bed = makeSandBed({ env: sky, waves: ceiling.waves, depth: 4.0, size: 80 });
  ctx.scene.add(skyDome, depthDome.mesh, ceiling.mesh, bed.mesh);

  const orbGeo = new THREE.SphereGeometry(0.05, 12, 10);
  const orbMat = new THREE.MeshBasicMaterial({ color: 0xbfeaff });
  const orbs = markers.map(() => {
    const m = new THREE.Mesh(orbGeo, orbMat);
    ctx.scene.add(m);
    return m;
  });

  ctx.onDispose(() => {
    ceiling.dispose();
    bed.dispose();
    depthDome.dispose();
    sky.dispose();
    orbGeo.dispose();
    orbMat.dispose();
  });

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(0, 0.4, 0),
    distance: 3.6,
    azimuth: 0.7,
    polar: -0.85,
    minPolar: -1.3,
    maxPolar: -0.35,
    drift: 0.01,
  });
  ctx.onDispose(() => orbit.dispose());

  wind.speed = 0.6;
  ctx.shell.slider({
    label: "wind speed (m/s)",
    min: 0,
    max: 6,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.button("glass calm", () => (wind.speed = 0.15));
  ctx.shell.button("breeze", () => (wind.speed = 3.5));
  ctx.shell.setInfo(() => "inside the circle: sky · outside: the lake, mirrored");

  // setMarker mutates the shared Vector4s, so keep clean home positions
  const home = markers.map((m) => m.clone());

  return ctx.finish((t, dt) => {
    // beacons drift in slow ellipses; mirror images follow by construction
    for (let i = 0; i < home.length; i++) {
      const m = home[i];
      const a = t * (0.1 + i * 0.025) + i * 2.1;
      const x = m.x + Math.cos(a) * 0.3;
      const z = m.z + Math.sin(a) * 0.3;
      orbs[i].position.set(x, m.y, z);
      ceiling.setMarker(i, x, m.y, z, m.w);
    }
    ceiling.update(t);
    depthDome.mesh.position.copy(ctx.camera.position);
    depthDome.camDepth.value = Math.max(0, -ctx.camera.position.y);
    depthDome.sunDirection.value.copy(sky.sunDirection.value);
    orbit.update(dt);
  });
}
