// Demos for wake.html — wakes and foam. Part 6 of The Splash, the finale:
// an advected foam field, the wake wedge derived honestly, and the
// slow-motion strike with the bird.

import { Vector3 } from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { mountScrolly, PAL, label, phase } from "../../lib/scrolly";
import { createDawnSky } from "../../lib/water";
import { disturb } from "../../lib/spine";
import { buildOsprey } from "../../lib/bird/build";
import { OspreyAnimator } from "../../lib/bird/animator";
import { FluidSim, SimSurface, SimWaterProvider, SpraySystem, installSimProvider } from "../../lib/fluid";
import { addLights, addOrbit, makeBall, onTap, pickWaterPoint, splashCtx } from "./kit";

// ---- hero: the slow-motion strike ----------------------------------------------------------

type StrikePhase = "circle" | "dive" | "under" | "breach";

export async function mountWakeHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { aspect: 0.48, fov: 47, far: 4000 });
  const sky = createDawnSky(6.6);
  const dome = sky.makeDome();
  const removeLights = addLights(ctx.scene, sky.sunDirection.value as Vector3);

  const sim = new FluidSim(ctx.renderer, {
    resolution: 192,
    worldSize: 24,
    depth: 9,
    mirror: true,
  });
  const restore = installSimProvider(sim);
  const detach = sim.attachToBus();
  const surface = new SimSurface(sim, { env: sky, extent: 1400, waves: { windSpeed: 1.8 } });
  const spray = new SpraySystem(ctx.renderer, { count: 4096, sim });
  ctx.scene.add(dome, surface.mesh, spray.sprite);

  const osprey = buildOsprey();
  const anim = new OspreyAnimator(osprey);
  osprey.group.rotation.order = "YXZ"; // yaw, then pitch, then roll
  ctx.scene.add(osprey.group);

  // ---- the dive loop, a small state machine over sim time -------------------
  let timeScale = 0.45;
  let phaseName: StrikePhase = "circle";
  let phaseT = 0;
  let angle = 0;
  const pos = new Vector3(10, 6.5, 0);
  const vel = new Vector3();
  const R = 10;
  const circleY = 6.5;
  let wakeTimer = 0;

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.8, 0),
    distance: 13,
    polar: 0.2,
    azimuth: 2.4,
    drift: 0.008,
    minPolar: 0.05,
  });

  const startDive = (): void => {
    phaseName = "dive";
    phaseT = 0;
    // aim at the water ahead of the current position
    vel.set(-pos.x, 0, -pos.z).normalize().multiplyScalar(4);
    vel.y = -2;
  };

  ctx.shell.slider({
    label: "time scale",
    min: 0.05,
    max: 1,
    step: 0.01,
    value: timeScale,
    onInput: (v) => (timeScale = v),
  });
  ctx.shell.button("dive now", () => {
    if (phaseName === "circle") startDive();
  });
  ctx.shell.setInfo(() => `phase: ${phaseName} · everything below 1× is the same sim, slower`);

  ctx.onDispose(() => {
    restore();
    detach();
    surface.dispose();
    spray.dispose();
    osprey.dispose();
    removeLights();
    sky.dispose();
    orbit.dispose();
    sim.dispose();
  });

  return ctx.finish((t, dt) => {
    sim.timeScale = timeScale;
    spray.timeScale = timeScale;
    const h = dt * timeScale; // bird time runs on sim time
    phaseT += h;

    switch (phaseName) {
      case "circle": {
        angle += (5.2 / R) * h;
        pos.set(Math.cos(angle) * R, circleY, Math.sin(angle) * R);
        osprey.group.rotation.set(0, -angle, 0.3);
        anim.requestPose(null);
        anim.gait01 += (0.85 - anim.gait01) * Math.min(1, h * 2);
        anim.bank = 0.35;
        if (phaseT > 6.5) startDive();
        break;
      }
      case "dive": {
        anim.requestPose("tuck");
        anim.gait01 = 1;
        vel.y -= 9.81 * h * 0.9; // a controlled fall, wings cheating drag
        pos.addScaledVector(vel, h);
        osprey.group.rotation.set(Math.atan2(-vel.y, Math.hypot(vel.x, vel.z)) * 0.7, Math.atan2(vel.x, vel.z), 0);
        if (pos.y < 0.55) anim.requestPose("strike");
        if (pos.y <= 0.05) {
          const speed = vel.length();
          const energy = Math.min(0.5 * speed * speed * 0.06, 4);
          disturb({ kind: "splash", x: pos.x, z: pos.z, energy, radius: 0.55, vx: vel.x, vz: vel.z });
          spray.emit({ x: pos.x, z: pos.z, energy });
          phaseName = "under";
          phaseT = 0;
        }
        break;
      }
      case "under": {
        // a beat below the surface — the camera reads the crown, not the bird
        pos.y = -0.45 + phaseT * 0.3;
        vel.multiplyScalar(Math.exp(-3 * h));
        pos.addScaledVector(vel, h * 0.4);
        anim.requestPose("float");
        if (phaseT > 1.1) {
          phaseName = "breach";
          phaseT = 0;
          vel.set(-pos.z, 0, pos.x).normalize().multiplyScalar(2.2);
        }
        break;
      }
      case "breach": {
        anim.requestPose(null);
        anim.gait01 += (0.1 - anim.gait01) * Math.min(1, h * 3); // deep flaps
        anim.flapRateHz = 3.6;
        vel.y += (3.4 - vel.y) * Math.min(1, h * 1.6);
        const sp = Math.hypot(vel.x, vel.z);
        if (sp < 5) vel.multiplyScalar(1 + 0.5 * h);
        pos.addScaledVector(vel, h);
        osprey.group.rotation.set(-0.25, Math.atan2(vel.x, vel.z), 0);
        // streaming off the back: wake + skim events while still low
        wakeTimer -= h;
        if (pos.y < 0.9 && pos.y > -0.1 && wakeTimer <= 0) {
          wakeTimer = 0.08;
          disturb({ kind: "wake", x: pos.x, z: pos.z, energy: 0.12, radius: 0.4, vx: vel.x, vz: vel.z });
        }
        if (pos.y > circleY) {
          pos.y = circleY;
          angle = Math.atan2(pos.z, pos.x);
          phaseName = "circle";
          phaseT = 0;
        }
        break;
      }
    }

    osprey.group.position.copy(pos);
    osprey.group.visible = pos.y > -0.3;
    anim.update(h);

    sim.moveTo(pos.x, pos.z);
    sim.step(dt);
    spray.update(dt);
    surface.update(t);
    orbit.update(dt);
  });
}

// ---- Step 1: foam, painted and stirred -------------------------------------------------------

export async function mountFoamPaint(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const sky = createDawnSky(7.2);
  const dome = sky.makeDome();
  const sim = new FluidSim(ctx.renderer, { resolution: 176, worldSize: 18, depth: 6 });
  const surface = new SimSurface(sim, { env: sky, extent: 240, waves: { windSpeed: 1.2 } });
  ctx.scene.add(dome, surface.mesh);

  // the stirrer: a slow circling disturbance that keeps the field moving
  let stirAngle = 0;
  let stirring = true;

  const canvas = ctx.shell.canvas;
  let painting = false;
  const paint = (e: PointerEvent): void => {
    const p = pickWaterPoint(e, canvas, ctx.camera);
    if (p && Math.abs(p.x) < 8.6 && Math.abs(p.z) < 8.6) {
      sim.impulse({ x: p.x, z: p.z, radius: 0.7, foam: 0.5 });
    }
  };
  const down = (e: PointerEvent): void => {
    painting = true;
    paint(e);
  };
  const move = (e: PointerEvent): void => {
    if (painting) paint(e);
  };
  const up = (): void => {
    painting = false;
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  ctx.onDispose(() => {
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
  });

  // fixed camera: painting and orbiting fight over the pointer
  ctx.camera.position.set(0, 14, 11);
  ctx.camera.lookAt(0, 0, 0);

  ctx.shell.slider({
    label: "foam decay (1/s)",
    min: 0.02,
    max: 1.2,
    step: 0.02,
    value: sim.foamDecay,
    onInput: (v) => (sim.foamDecay = v),
  });
  ctx.shell.button("stirring on/off", () => {
    stirring = !stirring;
  });
  ctx.shell.setInfo(() => "drag to paint foam — it rides the velocity field, not the waves");

  ctx.onDispose(() => {
    surface.dispose();
    sky.dispose();
    sim.dispose();
  });
  return ctx.finish((t, dt) => {
    if (stirring) {
      stirAngle += dt * 0.9;
      const x = Math.cos(stirAngle) * 3.6;
      const z = Math.sin(stirAngle) * 3.6;
      disturbWakeInto(sim, x, z, -Math.sin(stirAngle) * 3.2, Math.cos(stirAngle) * 3.2);
    }
    sim.step(dt);
    surface.update(t);
  });
}

function disturbWakeInto(sim: FluidSim, x: number, z: number, vx: number, vz: number): void {
  sim.disturb({ kind: "wake", x, z, energy: 0.06, radius: 0.5, vx, vz });
}

// ---- scrolly: the wedge, constructed --------------------------------------------------------

export function mountKelvinScrolly(el: HTMLElement): void {
  mountScrolly(el, {
    screens: 3.6,
    aspect: 0.5,
    steps: [
      {
        at: 0,
        text: "A parked source rings the water: every wavefront is a circle centered where it was born, radius c·(age). Concentric, boring, correct.",
      },
      {
        at: 0.26,
        text: "Move the source slower than the waves and the circles bunch ahead, stretch behind — but every front still escapes. No wedge.",
      },
      {
        at: 0.52,
        text: "Move faster than c and the source outruns its own rings. The circles can only pile up along their common tangent: a wedge with sin θ = c / v. Faster boat, narrower V.",
      },
      {
        at: 0.8,
        text: "Deep water complicates this beautifully: dispersion makes every speed present at once, and the envelope locks at 19.47° regardless of boat speed — Kelvin's result. Our shallow-water lake follows the simpler Mach law, and the demo below measures it.",
      },
    ],
    draw(c, w, h, t) {
      const cy = h * 0.52;
      const cWave = h * 0.085; // wave speed, px per fake second
      const stage = t < 0.26 ? 0 : t < 0.52 ? 1 : 2;
      const v = stage === 0 ? 0 : stage === 1 ? cWave * 0.55 : cWave * 1.9;
      // fake time runs 0→tt within each stage so every stage replays itself
      const tt = 4.2;
      const stageT =
        stage === 0 ? phase(t, 0.0, 0.26) : stage === 1 ? phase(t, 0.26, 0.52) : phase(t, 0.52, 0.95);
      const tau = 0.35 + stageT * (tt - 0.35);
      const startX = stage === 0 ? w * 0.5 : w * 0.14;
      const sx = startX + v * tau;
      // wavefronts: circles born at the source's past positions
      c.strokeStyle = PAL.accent;
      c.lineWidth = 1.4;
      const n = 14;
      for (let k = 0; k < n; k++) {
        const birth = (k / n) * tau;
        const age = tau - birth;
        if (age <= 0.05) continue;
        const bx = startX + v * birth;
        const r = cWave * age * (stage === 0 ? 2.2 : 1.6);
        c.globalAlpha = 0.8 * Math.max(0.12, 1 - age / tt);
        c.beginPath();
        c.arc(bx, cy, r, 0, Math.PI * 2);
        c.stroke();
      }
      c.globalAlpha = 1;
      // the source
      c.fillStyle = PAL.warm;
      c.beginPath();
      c.arc(sx, cy, 5, 0, Math.PI * 2);
      c.fill();
      // wedge envelope once the source outruns its waves
      if (stage === 2) {
        const theta = Math.asin(Math.min(1, (cWave * 1.6) / v));
        c.strokeStyle = PAL.warm;
        c.lineWidth = 2;
        const L = w;
        for (const s of [-1, 1]) {
          c.beginPath();
          c.moveTo(sx, cy);
          c.lineTo(sx - Math.cos(theta) * L, cy + s * Math.sin(theta) * L);
          c.stroke();
        }
        label(c, `sin θ = c/v → θ ≈ ${((theta * 180) / Math.PI).toFixed(0)}°`, w * 0.5, h * 0.09, {
          color: PAL.warm,
          align: "center",
          mono: true,
          size: 12,
        });
      } else if (stage === 1) {
        label(c, "v < c: fronts bunch ahead, never trapped", w * 0.5, h * 0.09, {
          color: PAL.muted,
          align: "center",
          size: 12,
        });
      } else {
        label(c, "v = 0: concentric rings", w * 0.5, h * 0.09, { color: PAL.muted, align: "center", size: 12 });
      }
    },
  });
}

// ---- Step 2: measuring the wedge ---------------------------------------------------------------

export async function mountWakeAngle(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const sky = createDawnSky(7.0);
  const dome = sky.makeDome();
  const sim = new FluidSim(ctx.renderer, { resolution: 208, worldSize: 24, depth: 6, mirror: true });
  const provider = new SimWaterProvider(sim);
  const detach = sim.attachToBus();
  const surface = new SimSurface(sim, { env: sky, extent: 300, waves: { windSpeed: 0.8 } });
  ctx.scene.add(dome, surface.mesh);

  const runner = makeBall(0.2, 0xc25b2a, sky.sunDirection.value as Vector3);
  ctx.scene.add(runner.mesh);

  let speed = 5;
  let x = -9;
  let dir = 1;
  let wakeTimer = 0;

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0, 0),
    distance: 20,
    polar: 0.85,
    azimuth: 1.57,
  });

  ctx.shell.slider({
    label: "runner speed (m/s)",
    min: 1,
    max: 9,
    step: 0.1,
    value: speed,
    onInput: (v) => (speed = v),
  });
  ctx.shell.setInfo(() => {
    const c = sim.waveSpeedCap;
    if (speed <= c) return `v ≤ c (${c.toFixed(1)} m/s): bow waves outrun the runner — no wedge`;
    const deg = (Math.asin(c / speed) * 180) / Math.PI;
    return `predicted half-angle: asin(c/v) = asin(${c.toFixed(1)}/${speed.toFixed(1)}) = ${deg.toFixed(0)}°`;
  });

  ctx.onDispose(() => {
    detach();
    surface.dispose();
    runner.dispose();
    sky.dispose();
    orbit.dispose();
    sim.dispose();
  });
  return ctx.finish((t, dt) => {
    x += dir * speed * dt;
    if (x > 9) {
      dir = -1;
      x = 9;
    }
    if (x < -9) {
      dir = 1;
      x = -9;
    }
    runner.mesh.position.set(x, provider.heightAt(x, 0, t) - 0.03, 0);
    wakeTimer -= dt;
    if (wakeTimer <= 0) {
      wakeTimer = 0.05;
      disturb({ kind: "wake", x, z: 0, energy: 0.06 * speed, radius: 0.35, vx: dir * speed, vz: 0 });
    }
    sim.step(dt);
    surface.update(t);
    orbit.update(dt);
  });
}

// ---- Step 3: the layers, one by one ----------------------------------------------------------------

export async function mountStrikeMix(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const sky = createDawnSky(6.8);
  const dome = sky.makeDome();
  const sim = new FluidSim(ctx.renderer, { resolution: 176, worldSize: 18, depth: 7 });
  const surface = new SimSurface(sim, { env: sky, extent: 400, waves: { windSpeed: 1.4 } });
  const spray = new SpraySystem(ctx.renderer, { count: 4096, sim });
  ctx.scene.add(dome, surface.mesh, spray.sprite);

  const layers = { rings: true, spray: true, foam: true };
  const strike = (): void => {
    const e = 2.6;
    const se = Math.sqrt(e);
    sim.impulse({
      x: 0,
      z: 0,
      radius: 0.55,
      down: layers.rings ? 0.4 * se : 0,
      radial: layers.rings ? 1.5 * se : 0,
      foam: layers.foam ? 0.85 : 0,
    });
    if (layers.spray) spray.emit({ x: 0, z: 0, energy: e });
  };

  let autoTimer = 1;
  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.5, 0),
    distance: 9,
    polar: 0.22,
    azimuth: 2.2,
  });

  const offTap = onTap(ctx.shell.canvas, () => strike());
  ctx.shell.button("rings", () => {
    layers.rings = !layers.rings;
  });
  ctx.shell.button("spray", () => {
    layers.spray = !layers.spray;
  });
  ctx.shell.button("foam", () => {
    layers.foam = !layers.foam;
  });
  ctx.shell.setInfo(
    () =>
      `layers: ${(["rings", "spray", "foam"] as const).filter((k) => layers[k]).join(" + ") || "none — just ambient water"}`,
  );

  ctx.onDispose(() => {
    surface.dispose();
    spray.dispose();
    sky.dispose();
    orbit.dispose();
    offTap();
    sim.dispose();
  });
  return ctx.finish((t, dt) => {
    sim.timeScale = 0.6;
    spray.timeScale = 0.6;
    autoTimer -= dt;
    if (autoTimer <= 0) {
      autoTimer = 5;
      strike();
    }
    sim.step(dt);
    spray.update(dt);
    surface.update(t);
    orbit.update(dt);
  });
}
