// Demos for air.html — the sky model and the sun on the world clock.
// Part 1 of Air & Light.

import { Color, Mesh, MeshBasicNodeMaterial, PlaneGeometry, SphereGeometry, Vector3 } from "three/webgpu";
import { color, vec3 } from "three/tsl";
import { BufferAttribute, BufferGeometry, Line, LineBasicNodeMaterial } from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { mountScrolly, PAL, label, phase, clamp01, lerp } from "../../lib/scrolly";
import { clock } from "../../lib/spine";
import { LakeSurface } from "../../lib/water";
import {
  createAtmosphere,
  createSkyPalette,
  skyColors,
  sunDirection,
  sunElevationDeg,
  LATITUDE_DEG,
  DECLINATION_DEG,
} from "../../lib/sky";
import { addOrbit, fmtHour, makeTerrainMesh, skyCtx } from "./kit";

// What the elevation means, in the photographer's words.
function lightName(e: number): string {
  if (e < -12) return "night";
  if (e < -4) return "deep twilight";
  if (e < 0.5) return "blue hour";
  if (e < 7) return "golden hour";
  if (e < 25) return "morning light";
  return "full day";
}

// ---- hero: the whole day over the lake -----------------------------------------------

export async function mountAirHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { aspect: 0.5, fov: 46, far: 9000 });

  const atm = createAtmosphere(clock.hour);
  ctx.scene.add(atm.makeDome());

  const pal = createSkyPalette();
  const ambient = new Color();
  const terrain = makeTerrainMesh({
    size: 3400,
    segments: 192,
    sunDirection: atm.sunDirection,
    sunColor: atm.sunColor,
    ambient: { value: ambient },
  });
  ctx.scene.add(terrain.mesh);

  const lake = new LakeSurface({ env: atm, size: 1000, segments: 192 });
  ctx.scene.add(lake.mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 3, 0),
    distance: 30,
    polar: 0.16,
    azimuth: -2.4,
    maxPolar: 0.9,
    drift: 0.004,
  });

  clock.setHour(8.2);
  let playing = true;
  clock.speed = 14; // ~43 s per in-game day at the site's 600 s day length

  ctx.shell.slider({
    label: "world clock (hour)",
    min: 0,
    max: 24,
    step: 0.05,
    value: 8.2,
    onInput: (v) => {
      clock.setHour(v);
      playing = false;
      clock.speed = 0;
    },
  });
  ctx.shell.button("play / pause the day", () => {
    playing = !playing;
    clock.speed = playing ? 14 : 0;
  });
  ctx.shell.setInfo(() => {
    const e = sunElevationDeg(clock.hour);
    return `${fmtHour(clock.hour)} · sun ${e.toFixed(1)}° · ${lightName(e)}`;
  });

  ctx.onDispose(() => {
    atm.dispose();
    lake.dispose();
    terrain.dispose();
    orbit.dispose();
    clock.speed = 1;
  });
  return ctx.finish((t, dt) => {
    clock.advance(dt);
    atm.setHour(clock.hour);
    skyColors(clock.hour, pal);
    ambient.copy(pal.ambient).multiplyScalar(0.45 + pal.ambientIntensity);
    lake.update(t);
    orbit.update(dt);
  });
}

// ---- Step 1 scrolly: where the sun is -------------------------------------------------

export function mountSunGeometryScrolly(el: HTMLElement): void {
  const lat = (LATITUDE_DEG * Math.PI) / 180;
  const sun = new Vector3();

  // Oblique projection: east on +x, up on -y(screen), north tipped back.
  const proj = (
    v: Vector3,
    cx: number,
    cy: number,
    r: number,
  ): { x: number; y: number; behind: number } => {
    const north = -v.z;
    return {
      x: cx + (v.x - north * 0.42) * r,
      y: cy - (v.y + north * 0.2) * r,
      behind: north,
    };
  };

  mountScrolly(el, {
    screens: 4,
    aspect: 0.56,
    steps: [
      { at: 0, text: "Stand on the lake. Your horizon is a circle; everything in the sky lives on a dome above it." },
      {
        at: 0.25,
        text: "The whole dome turns once a day around one fixed axis — the celestial pole. At our latitude (46.6°) it stands 46.6° above the northern horizon.",
      },
      {
        at: 0.5,
        text: "The sun rides one circle of that turning dome, offset from the equator by the season's declination (+5° in our fixed mid-April). The angle along the circle is the HOUR ANGLE: 15° per hour, zero at noon.",
      },
      {
        at: 0.78,
        text: "Project the sun's position onto the vertical and you get its elevation: sin e = sin φ sin δ + cos φ cos δ cos H. That one line of trig is the game's entire day–night cycle.",
      },
    ],
    draw(c, w, h, t) {
      const cx = w * 0.5;
      const cy = h * 0.62;
      const r = Math.min(w, h) * 0.52;

      // Horizon ellipse + ground.
      c.strokeStyle = PAL.dim;
      c.lineWidth = 1.5;
      c.beginPath();
      c.ellipse(cx, cy, r, r * 0.2, 0, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = PAL.dot;
      c.beginPath();
      c.arc(cx, cy, 3, 0, Math.PI * 2);
      c.fill();
      label(c, "you", cx + 8, cy + 10, { color: PAL.muted });
      label(c, "E", cx + r + 10, cy, { color: PAL.muted });
      label(c, "W", cx - r - 14, cy, { color: PAL.muted });
      const np = proj(new Vector3(0, 0, -1), cx, cy, r);
      label(c, "N", np.x, np.y - 8, { color: PAL.muted });

      // Sky dome outline.
      const domeA = phase(t, 0.0, 0.18);
      if (domeA > 0) {
        c.globalAlpha = domeA * 0.7;
        c.strokeStyle = PAL.grid;
        c.beginPath();
        c.arc(cx, cy, r, Math.PI, 0);
        c.stroke();
        c.globalAlpha = 1;
      }

      // Celestial pole axis.
      const poleA = phase(t, 0.22, 0.38);
      if (poleA > 0) {
        const pole = new Vector3(0, Math.sin(lat), -Math.cos(lat));
        const pp = proj(pole, cx, cy, r * 0.96);
        c.globalAlpha = poleA;
        c.strokeStyle = PAL.accent;
        c.setLineDash([5, 5]);
        c.beginPath();
        c.moveTo(cx, cy);
        c.lineTo(pp.x, pp.y);
        c.stroke();
        c.setLineDash([]);
        label(c, `celestial pole · ${LATITUDE_DEG}° up`, pp.x + 6, pp.y - 6, { color: PAL.accent });
        c.globalAlpha = 1;
      }

      // The sun's daily circle.
      const circleA = phase(t, 0.42, 0.58);
      if (circleA > 0) {
        c.globalAlpha = circleA;
        c.strokeStyle = PAL.warm;
        c.lineWidth = 1.5;
        let started = false;
        c.beginPath();
        for (let i = 0; i <= 96; i++) {
          const hour = (i / 96) * 24;
          sunDirection(hour, sun);
          const p = proj(sun, cx, cy, r);
          if (!started) {
            c.moveTo(p.x, p.y);
            started = true;
          } else c.lineTo(p.x, p.y);
        }
        c.stroke();
        label(c, `declination δ = +${DECLINATION_DEG}°`, cx - r * 0.96, cy - r * 0.74, { color: PAL.warm });
        c.globalAlpha = 1;
      }

      // The sun itself, sweeping with progress through the last half.
      const sweep = phase(t, 0.5, 0.95);
      if (sweep > 0) {
        const hour = lerp(5.2, 20.2, sweep);
        sunDirection(hour, sun);
        const p = proj(sun, cx, cy, r);
        const e = sunElevationDeg(hour);
        c.globalAlpha = clamp01(sweep * 3);
        c.fillStyle = e > 0 ? PAL.warm : PAL.dim;
        c.beginPath();
        c.arc(p.x, p.y, 7, 0, Math.PI * 2);
        c.fill();
        // Elevation angle marker: drop to the horizon point below the sun.
        const flat = new Vector3(sun.x, 0, sun.z).normalize();
        const pf = proj(flat, cx, cy, r);
        c.strokeStyle = PAL.good;
        c.setLineDash([3, 4]);
        c.beginPath();
        c.moveTo(p.x, p.y);
        c.lineTo(pf.x, pf.y);
        c.lineTo(cx, cy);
        c.moveTo(cx, cy);
        c.lineTo(p.x, p.y);
        c.stroke();
        c.setLineDash([]);
        label(c, `${Math.floor(hour)}:${String(Math.floor((hour % 1) * 60)).padStart(2, "0")} · e = ${e.toFixed(0)}°`, p.x + 12, p.y - 10, {
          color: PAL.text,
          mono: true,
        });
        c.globalAlpha = 1;
      }

      // The formula.
      const fA = phase(t, 0.8, 0.95);
      if (fA > 0) {
        label(c, "sin e = sin φ · sin δ + cos φ · cos δ · cos H", cx, h * 0.08, {
          color: PAL.text,
          size: 14,
          align: "center",
          alpha: fA,
          mono: true,
        });
      }
    },
  });
}

// ---- Step 1 demo: the sun's arc in 3D ----------------------------------------------------

export async function mountSunArc(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { fov: 52, far: 2000 });

  const atm = createAtmosphere(9, { stars: { intensity: 0.7 } });
  ctx.scene.add(atm.makeDome(600));

  // A dark ground disc so the horizon is a real line.
  const groundGeo = new PlaneGeometry(1400, 1400);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new MeshBasicNodeMaterial();
  groundMat.colorNode = color(0x0a0e12);
  const ground = new Mesh(groundGeo, groundMat);
  ctx.scene.add(ground);

  // The sun's full 24-hour track, drawn as a polyline at dome radius.
  const N = 192;
  const arcPos = new Float32Array((N + 1) * 3);
  const v = new Vector3();
  for (let i = 0; i <= N; i++) {
    sunDirection((i / N) * 24, v).multiplyScalar(540);
    arcPos.set([v.x, v.y, v.z], i * 3);
  }
  const arcGeo = new BufferGeometry();
  arcGeo.setAttribute("position", new BufferAttribute(arcPos, 3));
  const arcMat = new LineBasicNodeMaterial({ color: 0xffb86b, transparent: true, opacity: 0.85 });
  const arc = new Line(arcGeo, arcMat);
  ctx.scene.add(arc);

  // The sun marker riding the track.
  const markGeo = new SphereGeometry(10, 16, 12);
  const markMat = new MeshBasicNodeMaterial();
  markMat.colorNode = vec3(8, 6.4, 4.4);
  const marker = new Mesh(markGeo, markMat);
  ctx.scene.add(marker);

  let hour = 9;
  const apply = (): void => {
    atm.setHour(hour);
    sunDirection(hour, v).multiplyScalar(540);
    marker.position.copy(v);
  };
  apply();

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 30, 0),
    distance: 90,
    polar: 0.12,
    azimuth: 1.35,
    maxPolar: 0.6,
  });

  ctx.shell.slider({
    label: "hour",
    min: 0,
    max: 24,
    step: 0.05,
    value: hour,
    onInput: (val) => {
      hour = val;
      apply();
    },
  });
  ctx.shell.setInfo(() => {
    const e = sunElevationDeg(hour);
    const az = (Math.atan2(sunDirection(hour, v).x, -v.z) * 180) / Math.PI;
    return `${fmtHour(hour)} · elevation ${e.toFixed(1)}° · azimuth ${((az + 360) % 360).toFixed(0)}°`;
  });

  ctx.onDispose(() => {
    atm.dispose();
    groundGeo.dispose();
    groundMat.dispose();
    arcGeo.dispose();
    arcMat.dispose();
    markGeo.dispose();
    markMat.dispose();
    orbit.dispose();
  });
  return ctx.finish((_t, dt) => {
    orbit.update(dt);
  });
}

// ---- Step 2/3 demo: the scattering knobs ----------------------------------------------------

export async function mountScattering(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { fov: 55, far: 2000 });

  const atm = createAtmosphere(18.0, { stars: false });
  ctx.scene.add(atm.makeDome(600));

  const groundGeo = new PlaneGeometry(1400, 1400);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new MeshBasicNodeMaterial();
  groundMat.colorNode = color(0x0a0e12);
  ctx.scene.add(new Mesh(groundGeo, groundMat));

  let hour = 18.0;
  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 26, 0),
    distance: 60,
    polar: 0.1,
    azimuth: 2.6, // facing the evening sun
    maxPolar: 0.9,
  });

  ctx.shell.slider({
    label: "hour",
    min: 4,
    max: 22,
    step: 0.05,
    value: hour,
    onInput: (val) => {
      hour = val;
      atm.setHour(hour);
    },
  });
  ctx.shell.slider({
    label: "molecules (Rayleigh ×)",
    min: 0.1,
    max: 3,
    step: 0.05,
    value: 1,
    onInput: (val) => {
      atm.rayleigh.value = val;
      atm.setHour(hour); // re-derive the sun's transmittance
    },
  });
  ctx.shell.slider({
    label: "aerosols (Mie ×)",
    min: 0.1,
    max: 8,
    step: 0.1,
    value: 1,
    onInput: (val) => {
      atm.mie.value = val;
      atm.setHour(hour);
    },
  });
  ctx.shell.slider({
    label: "haze forwardness g",
    min: 0.3,
    max: 0.92,
    step: 0.01,
    value: 0.76,
    onInput: (val) => (atm.mieG.value = val),
  });
  ctx.shell.setInfo(() => `sun ${sunElevationDeg(hour).toFixed(1)}° · drag to look around`);

  ctx.onDispose(() => {
    atm.dispose();
    groundGeo.dispose();
    groundMat.dispose();
    orbit.dispose();
  });
  return ctx.finish((_t, dt) => {
    orbit.update(dt);
  });
}

// ---- Step 4 demo: golden hour, blue hour, over the water ----------------------------------------

export async function mountGoldenHours(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await skyCtx(el, { fov: 48, far: 9000 });

  const atm = createAtmosphere(6.4);
  ctx.scene.add(atm.makeDome());

  const pal = createSkyPalette();
  const ambient = new Color();
  const terrain = makeTerrainMesh({
    size: 3400,
    segments: 160,
    sunDirection: atm.sunDirection,
    sunColor: atm.sunColor,
    ambient: { value: ambient },
  });
  ctx.scene.add(terrain.mesh);

  const lake = new LakeSurface({ env: atm, size: 1000, segments: 160 });
  ctx.scene.add(lake.mesh);

  let hour = 6.4;
  const apply = (): void => {
    atm.setHour(hour);
    skyColors(hour, pal);
    ambient.copy(pal.ambient).multiplyScalar(0.45 + pal.ambientIntensity);
  };
  apply();

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 2.5, 0),
    distance: 26,
    polar: 0.14,
    azimuth: -2.5,
    maxPolar: 0.8,
  });

  ctx.shell.slider({
    label: "hour",
    min: 4,
    max: 22,
    step: 0.02,
    value: hour,
    onInput: (val) => {
      hour = val;
      apply();
    },
  });
  ctx.shell.setInfo(() => {
    const e = sunElevationDeg(hour);
    return `${fmtHour(hour)} · sun ${e.toFixed(1)}° · ${lightName(e)}`;
  });

  ctx.onDispose(() => {
    atm.dispose();
    lake.dispose();
    terrain.dispose();
    orbit.dispose();
  });
  return ctx.finish((t, dt) => {
    lake.update(t);
    orbit.update(dt);
  });
}
