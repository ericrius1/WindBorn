// Demos for crown.html — spray. Part 5 of The Splash: the impact energy
// budget, ballistic droplets with drag, inheriting the surface velocity,
// and the rejoin.

import { ConeGeometry, Group, Mesh, SphereGeometry, Vector3 } from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { mountScrolly, PAL, label, phase, lerp, clamp01 } from "../../lib/scrolly";
import { createDawnSky } from "../../lib/water";
import { disturb } from "../../lib/spine";
import { FluidSim, SimSurface, SpraySystem } from "../../lib/fluid";
import { addOrbit, fakeLitMaterial, splashCtx, type SplashCtx } from "./kit";

// ---- the falling weight (the bird's stand-in until the finale) --------------------------

class DropWeight {
  readonly group = new Group();
  private y = 6;
  private vy = 0;
  private falling = false;
  private resetTimer = 0;
  private readonly parts: { dispose(): void }[] = [];

  constructor(sunDir: Vector3, readonly onImpact: (energy: number, x: number, z: number) => void) {
    const material = fakeLitMaterial(0x2c2f36, sunDir);
    const body = new Mesh(new SphereGeometry(0.16, 18, 14), material);
    body.scale.set(1, 1.7, 1);
    const nose = new Mesh(new ConeGeometry(0.13, 0.34, 14), material);
    nose.rotation.x = Math.PI;
    nose.position.y = -0.3;
    this.group.add(body, nose);
    this.group.position.y = this.y;
    this.parts.push(body.geometry, nose.geometry, material);
  }

  energyScale = 1.6;

  drop(): void {
    if (!this.falling && this.resetTimer <= 0) {
      this.falling = true;
      this.vy = 0;
    }
  }

  update(simDt: number): void {
    if (this.falling) {
      this.vy -= 9.81 * simDt;
      this.y += this.vy * simDt;
      if (this.y <= 0.05) {
        // ½mv² in bus units: scaled so a 6 m drop lands near "talon strike"
        const energy = this.energyScale * 0.5 * (this.vy * this.vy) * 0.025;
        this.onImpact(energy, this.group.position.x, this.group.position.z);
        this.falling = false;
        this.resetTimer = 2.2;
        this.y = -1; // underwater, hidden
      }
    } else if (this.resetTimer > 0) {
      this.resetTimer -= simDt;
      if (this.resetTimer <= 0) this.y = 6;
    }
    this.group.position.y = this.y;
    this.group.visible = this.y > -0.5;
  }

  dispose(): void {
    for (const p of this.parts) p.dispose();
  }
}

// ---- shared strike scene ------------------------------------------------------------------

async function makeStrikeScene(ctx: SplashCtx, opts: { res?: number; size?: number } = {}) {
  const sky = createDawnSky(6.8);
  const dome = sky.makeDome();
  const sim = new FluidSim(ctx.renderer, {
    resolution: opts.res ?? 192,
    worldSize: opts.size ?? 18,
    depth: 7,
  });
  const detach = sim.attachToBus();
  const surface = new SimSurface(sim, { env: sky, extent: 500, waves: { windSpeed: 1.3 } });
  const spray = new SpraySystem(ctx.renderer, { count: 4096, sim });
  ctx.scene.add(dome, surface.mesh, spray.sprite);

  ctx.onDispose(() => {
    detach();
    surface.dispose();
    spray.dispose();
    sky.dispose();
    sim.dispose();
  });
  return { sky, sim, surface, spray };
}

// ---- hero: the strike, on a loop -------------------------------------------------------------

export async function mountCrownHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { aspect: 0.48, fov: 46 });
  const { sky, sim, surface, spray } = await makeStrikeScene(ctx);

  const weight = new DropWeight(sky.sunDirection.value as Vector3, (energy, x, z) => {
    disturb({ kind: "splash", x, z, energy, radius: 0.5 });
    spray.emit({ x, z, energy });
  });
  ctx.scene.add(weight.group);

  let timeScale = 1;
  let autoTimer = 1.2;

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.6, 0),
    distance: 9,
    polar: 0.16,
    azimuth: 2.0,
    drift: 0.01,
    minPolar: 0.05,
  });

  ctx.shell.slider({
    label: "time scale",
    min: 0.08,
    max: 1,
    step: 0.01,
    value: timeScale,
    onInput: (v) => (timeScale = v),
  });
  ctx.shell.button("strike", () => weight.drop());
  ctx.shell.setInfo(() => `droplets emitted so far: ${spray.emittedTotal}`);

  ctx.onDispose(() => {
    weight.dispose();
    orbit.dispose();
  });
  return ctx.finish((t, dt) => {
    sim.timeScale = timeScale;
    spray.timeScale = timeScale;
    autoTimer -= dt;
    if (autoTimer <= 0) {
      autoTimer = 6.5;
      weight.drop();
    }
    weight.update(dt * timeScale);
    sim.step(dt);
    spray.update(dt);
    surface.update(t);
    orbit.update(dt);
  });
}

// ---- scrolly: anatomy of a splash --------------------------------------------------------------

export function mountSplashAnatomyScrolly(el: HTMLElement): void {
  mountScrolly(el, {
    screens: 3.4,
    aspect: 0.52,
    steps: [
      { at: 0, text: "Impact. The body punches a cavity; its kinetic energy is the whole splash's budget." },
      {
        at: 0.28,
        text: "The crown: displaced water erupts in a ring around the cavity, riding the outward surface velocity. This is the part a height field cannot hold — water above water.",
      },
      {
        at: 0.56,
        text: "The cavity collapses; converging water meets at the middle and fires the Worthington jet straight up.",
      },
      {
        at: 0.82,
        text: "Droplets rain back down — each landing is a tiny new impact — while rings carry the rest of the energy away. Then the lake forgets.",
      },
    ],
    draw(c, w, h, t) {
      const waterY = h * 0.62;
      const cx = w * 0.5;
      // phases
      const impact = phase(t, 0.02, 0.2);
      const crown = phase(t, 0.28, 0.5);
      const jet = phase(t, 0.56, 0.74);
      const rain = phase(t, 0.82, 1);
      // water
      c.fillStyle = "#143247";
      c.fillRect(w * 0.04, waterY, w * 0.92, h * 0.34);
      // surface with cavity / jet profile
      c.strokeStyle = PAL.accent;
      c.lineWidth = 2.2;
      c.beginPath();
      for (let px = 0; px <= w * 0.92; px += 2) {
        const x = px + w * 0.04;
        const u = (x - cx) / (w * 0.09);
        const cav = -impact * (1 - crown) * Math.exp(-u * u) * h * 0.12;
        const jetH = jet * (1 - rain * 0.85) * Math.exp(-u * u * 8) * h * 0.2;
        const ringR = 2.4 + rain * 4;
        const rings =
          rain *
          Math.exp(-((Math.abs(u) - ringR) * (Math.abs(u) - ringR)) / 0.6) *
          h *
          0.025 *
          Math.cos((Math.abs(u) - ringR) * 5);
        const y = waterY + cav - jetH - rings;
        if (px === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
      // the falling body
      if (t < 0.3) {
        const by = lerp(h * 0.12, waterY - 6, clamp01(t / 0.18));
        c.fillStyle = "#2c2f36";
        c.beginPath();
        c.ellipse(cx, by, 7, 12, 0, 0, Math.PI * 2);
        c.fill();
      }
      // crown droplets
      if (crown > 0.02) {
        c.fillStyle = "#dfeef4";
        const nDrops = 18;
        for (let i = 0; i < nDrops; i++) {
          const a = (i / nDrops) * 2 - 1;
          const tt = crown * (0.4 + 0.6 * ((i * 37) % 10) / 10);
          const dx = a * (28 + tt * 50);
          const dy = -tt * h * 0.22 * (1 - tt) * 4 * (0.6 + 0.4 * ((i * 17) % 7) / 7);
          c.globalAlpha = 1 - rain;
          c.beginPath();
          c.arc(cx + dx, waterY + dy - 6, 2.2, 0, Math.PI * 2);
          c.fill();
          c.globalAlpha = 1;
        }
        label(c, "the crown", cx + w * 0.16, waterY - h * 0.16, { color: PAL.text, size: 12 });
      }
      if (jet > 0.05 && rain < 0.6) {
        label(c, "Worthington jet", cx + 14, waterY - h * 0.21, { color: PAL.warm, size: 12 });
      }
      if (rain > 0.1) {
        label(c, "rejoin rings", cx + w * 0.25, waterY + 18, { color: PAL.muted, size: 12 });
      }
    },
  });
}

// ---- Step 1: the energy budget ------------------------------------------------------------------

export async function mountEnergyCount(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const { sim, surface, spray } = await makeStrikeScene(ctx, { res: 160 });

  let energy = 1;
  let autoTimer = 0.6;
  const strike = (): void => {
    disturb({ kind: "splash", x: 0, z: 0, energy, radius: 0.5 });
    spray.emit({ x: 0, z: 0, energy });
  };

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.5, 0),
    distance: 8.5,
    polar: 0.18,
    azimuth: 1.4,
  });

  ctx.shell.slider({
    label: "impact energy",
    min: 0.1,
    max: 6,
    step: 0.1,
    value: energy,
    onInput: (v) => (energy = v),
  });
  ctx.shell.button("strike", strike);
  ctx.shell.setInfo(() => {
    const n = Math.max(8, Math.round(90 * Math.sqrt(energy)));
    const v = (2.6 * Math.sqrt(energy)).toFixed(1);
    return `budget: ≈${n} droplets · launch speed ≈ ${v} m/s (both ∝ √energy)`;
  });

  ctx.onDispose(() => orbit.dispose());
  return ctx.finish((t, dt) => {
    autoTimer -= dt;
    if (autoTimer <= 0) {
      autoTimer = 4.5;
      strike();
    }
    sim.step(dt);
    spray.update(dt);
    surface.update(t);
    orbit.update(dt);
  });
}

// ---- Step 2: ballistics, slowed down ---------------------------------------------------------------

export async function mountDropletArcs(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const { sim, surface, spray } = await makeStrikeScene(ctx, { res: 160 });

  let timeScale = 0.25;
  let autoTimer = 0.5;

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.7, 0),
    distance: 7.5,
    polar: 0.12,
    azimuth: 2.4,
    minPolar: 0.04,
  });

  ctx.shell.slider({
    label: "time scale",
    min: 0.05,
    max: 1,
    step: 0.01,
    value: timeScale,
    onInput: (v) => (timeScale = v),
  });
  ctx.shell.slider({
    label: "air drag (1/s)",
    min: 0,
    max: 3,
    step: 0.05,
    value: spray.dragU.value as number,
    onInput: (v) => (spray.dragU.value = v),
  });
  ctx.shell.button("burst", () => spray.emit({ x: 0, z: 0, energy: 2.4 }));
  ctx.shell.setInfo(() => "parabolas, bent by drag — gravity pays for every arc");

  ctx.onDispose(() => orbit.dispose());
  return ctx.finish((t, dt) => {
    sim.timeScale = timeScale;
    spray.timeScale = timeScale;
    autoTimer -= dt;
    if (autoTimer <= 0) {
      autoTimer = 5;
      disturb({ kind: "splash", x: 0, z: 0, energy: 2.4, radius: 0.5 });
      spray.emit({ x: 0, z: 0, energy: 2.4 });
    }
    sim.step(dt);
    spray.update(dt);
    surface.update(t);
    orbit.update(dt);
  });
}

// ---- Step 3: inheriting the surface ------------------------------------------------------------------

export async function mountCrownRing(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const { sim, surface, spray } = await makeStrikeScene(ctx, { res: 160 });

  let autoTimer = 0.6;
  const strike = (): void => {
    // impulse first, so the velocity field is rushing outward when the
    // droplets sample it a frame later
    disturb({ kind: "splash", x: 0, z: 0, energy: 3, radius: 0.55 });
    spray.emit({ x: 0, z: 0, energy: 3, radius: 0.55 });
  };

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.6, 0),
    distance: 8,
    polar: 0.15,
    azimuth: 1.0,
    minPolar: 0.04,
  });

  ctx.shell.button("inherit surface velocity: on/off", () => {
    spray.inherit.value = spray.inherit.value > 0.5 ? 0 : 1;
  });
  ctx.shell.button("strike", strike);
  ctx.shell.setInfo(() =>
    (spray.inherit.value as number) > 0.5
      ? "droplets add the water's outward rush — a flared crown"
      : "droplets ignore the water — a straight-up fountain",
  );

  ctx.onDispose(() => orbit.dispose());
  return ctx.finish((t, dt) => {
    sim.timeScale = 0.45;
    spray.timeScale = 0.45;
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

// ---- Step 4: the rejoin -----------------------------------------------------------------------------

export async function mountRejoinRings(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const { sky, sim, surface, spray } = await makeStrikeScene(ctx, { res: 176 });

  const weight = new DropWeight(sky.sunDirection.value as Vector3, (energy, x, z) => {
    disturb({ kind: "splash", x, z, energy, radius: 0.5 });
    spray.emit({ x, z, energy });
  });
  ctx.scene.add(weight.group);

  let autoTimer = 1;
  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.4, 0),
    distance: 10,
    polar: 0.3,
    azimuth: 2.6,
  });

  ctx.shell.button("rejoin disturbances: on/off", () => {
    spray.rejoinEnabled = !spray.rejoinEnabled;
  });
  ctx.shell.button("strike", () => weight.drop());
  ctx.shell.setInfo(() =>
    spray.rejoinEnabled
      ? "every landing droplet is a tiny 'rain' event — secondary rings, live foam"
      : "droplets vanish on touchdown — the splash ends too cleanly",
  );

  ctx.onDispose(() => {
    weight.dispose();
    orbit.dispose();
  });
  return ctx.finish((t, dt) => {
    autoTimer -= dt;
    if (autoTimer <= 0) {
      autoTimer = 6;
      weight.drop();
    }
    weight.update(dt);
    sim.step(dt);
    spray.update(dt);
    surface.update(t);
    orbit.update(dt);
  });
}
