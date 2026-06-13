// Demos for shallows.html — the shallow-water equations with a real depth
// term. Part 2 of The Splash: c = √(g·d), shoaling on a ramp, and the sim
// reading The Basin's bathymetry.

import { Mesh, MeshBasicNodeMaterial, Vector2, Vector3 } from "three/webgpu";
import { color, float, mix, normalize, positionLocal, smoothstep, uniform, varying, vec2, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { mountScrolly, PAL, label, arrow, phase, lerp } from "../../lib/scrolly";
import { createDawnSky } from "../../lib/water";
import { terrainHeightAt, terrainHeightNode, terrainNormalNode } from "../../lib/terrain";
import { FluidSim, SimSurface } from "../../lib/fluid";
import { addOrbit, makeTankGeometry, onTap, pickWaterPoint, splashCtx, type SplashCtx } from "./kit";

type NodeV2 = Node<"vec2">;

// ---- where the lake meets the land ----------------------------------------------------
// Walk a ray out from the lake center and bisect the terrain's zero crossing.
// One shoreline point, computed from the same function every series reads.

export function findShorePoint(angle: number): Vector2 {
  const dir = new Vector2(Math.cos(angle), Math.sin(angle));
  let lo = 120; // certainly water
  let hi = 480; // certainly land
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (terrainHeightAt(dir.x * mid, dir.y * mid) < 0) lo = mid;
    else hi = mid;
  }
  return dir.multiplyScalar((lo + hi) / 2);
}

// ---- a terrain backdrop around the window ---------------------------------------------

function makeTerrainPatch(cx: number, cz: number, size: number, segments: number) {
  const geometry = makeTankGeometry(size, segments + 1);
  const material = new MeshBasicNodeMaterial();
  const worldXZ = positionLocal.xz.add(vec2(cx, cz)) as NodeV2;
  const h = terrainHeightNode(worldXZ);
  material.positionNode = vec3(positionLocal.x, h, positionLocal.z);
  // Height and normal go to the fragment stage as varyings — the basin noise
  // is ~14 gradient evaluations and has no business running per pixel.
  const vH = varying(h);
  const vN = varying(terrainNormalNode(worldXZ, size / segments));
  const sun = normalize(vec3(0.5, 0.65, 0.3));
  const lit = vN.normalize().dot(sun).clamp(0, 1).mul(0.65).add(0.35);
  // wet sand at the waterline → dry gravel → meadow green higher up
  let c = mix(color("#5d5444"), color("#8c8674"), smoothstep(0.0, 1.6, vH));
  c = mix(c, color("#5d6b4a"), smoothstep(1.6, 7, vH));
  c = mix(color("#3e3a30"), c, smoothstep(-0.6, 0.25, vH)); // darker when submerged
  material.colorNode = c.mul(lit);
  const mesh = new Mesh(geometry, material);
  mesh.position.set(cx, 0, cz);
  mesh.frustumCulled = false;
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ---- a swell paddle: timed wake impulses along a line ----------------------------------

class SwellPaddle {
  period = 2.6;
  energy = 0.35;
  private timer = 0.4;

  constructor(
    private readonly sim: FluidSim,
    /** Paddle line center. */
    readonly origin: Vector2,
    /** Unit direction the swell travels (toward shore). */
    readonly dir: Vector2,
    private readonly width: number,
  ) {}

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.period;
    const px = -this.dir.y;
    const pz = this.dir.x;
    const n = 7;
    for (let k = 0; k < n; k++) {
      const o = ((k / (n - 1)) * 2 - 1) * this.width * 0.5;
      this.sim.disturb({
        kind: "wake",
        x: this.origin.x + px * o,
        z: this.origin.y + pz * o,
        energy: this.energy,
        radius: this.width / n,
        vx: this.dir.x * 1.6,
        vz: this.dir.y * 1.6,
      });
    }
  }
}

// ---- shared scene assembly for the real-shore demos -------------------------------------

async function makeShoreScene(ctx: SplashCtx, windowSize: number, res: number) {
  const sky = createDawnSky(7.3);
  const dome = sky.makeDome();

  const shore = findShorePoint(2.2);
  const inward = shore.clone().normalize().multiplyScalar(-1); // toward open water
  const center = shore.clone().addScaledVector(inward, windowSize * 0.25); // a bit lakeward

  const sim = new FluidSim(ctx.renderer, {
    resolution: res,
    worldSize: windowSize,
    center: { x: center.x, z: center.y },
    depth: {
      node: (xz) => terrainHeightNode(xz).negate(),
      cpu: (x, z) => -terrainHeightAt(x, z),
    },
    depthCap: 1.5,
  });
  const surface = new SimSurface(sim, {
    env: sky,
    extent: 420,
    depthTint: true,
    waves: { windSpeed: 1.2 },
  });
  const terrain = makeTerrainPatch(shore.x, shore.y, windowSize * 4.5, 150);
  ctx.scene.add(dome, surface.mesh, terrain.mesh);

  ctx.onDispose(() => {
    surface.dispose();
    terrain.dispose();
    sky.dispose();
    sim.dispose();
  });
  return { sky, sim, surface, shore, inward, center };
}

// ---- hero: swell feeling the beach -------------------------------------------------------

export async function mountShallowsHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { aspect: 0.48, fov: 46, far: 4000 });
  const { sim, surface, shore, inward } = await makeShoreScene(ctx, 56, 224);

  // Paddle out in open water, pushing swell trains at the beach.
  const paddleOrigin = shore.clone().addScaledVector(inward, 56 * 0.62);
  const paddle = new SwellPaddle(sim, paddleOrigin, inward.clone().multiplyScalar(-1), 56 * 0.7);
  paddle.period = 2.2;
  paddle.energy = 0.5;

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(shore.x, 0.5, shore.y),
    distance: 34,
    polar: 0.3,
    azimuth: Math.atan2(-inward.y, -inward.x) + 0.5,
    drift: 0.008,
  });

  ctx.shell.slider({
    label: "swell energy",
    min: 0.05,
    max: 1.2,
    step: 0.05,
    value: paddle.energy,
    onInput: (v) => (paddle.energy = v),
  });
  ctx.shell.slider({
    label: "swell period (s)",
    min: 1.2,
    max: 5,
    step: 0.1,
    value: paddle.period,
    onInput: (v) => (paddle.period = v),
  });
  ctx.shell.setInfo(
    () => `depth term: −terrainHeightAt · window ${sim.res}² over ${sim.worldSize} m`,
  );

  ctx.onDispose(() => orbit.dispose());
  return ctx.finish((t, dt) => {
    paddle.update(dt);
    sim.step(dt);
    surface.update(t);
    orbit.update(dt);
  });
}

// ---- scrolly: one column's budget ---------------------------------------------------------

export function mountColumnScrolly(el: HTMLElement): void {
  mountScrolly(el, {
    screens: 3.6,
    aspect: 0.52,
    steps: [
      {
        at: 0,
        text: "Shallow water as columns: still depth d up to the calm line, surface offset η on top. The state per column is η plus a horizontal velocity v.",
      },
      {
        at: 0.25,
        text: "Mass: water slides between columns. The flux through a wall is q = d·v — a deep column moves far more water at the same speed.",
      },
      {
        at: 0.52,
        text: "Where more arrives than leaves, the surface must rise: ∂η/∂t = −∇·(d·v). Nothing is created; it only piles up.",
      },
      {
        at: 0.78,
        text: "Momentum: a tilted surface means higher pressure under the high side, so the water accelerates downhill: ∂v/∂t = −g·∇η. Two equations, closed loop — waves.",
      },
    ],
    draw(c, w, h, t) {
      const n = 9;
      const x0 = w * 0.09;
      const x1 = w * 0.91;
      const colW = (x1 - x0) / n;
      const bedY = h * 0.86;
      const calmY = h * 0.38;
      const anim = t * 10;
      // depth profile: deeper on the left
      const depths = Array.from({ length: n }, (_, i) => lerp(0.95, 0.45, i / (n - 1)));
      // a gentle traveling hump for η
      const etas = Array.from({ length: n }, (_, i) => 0.5 * Math.sin(i * 0.9 - anim * 0.7));
      const showFlux = phase(t, 0.25, 0.4);
      const showRise = phase(t, 0.52, 0.66);
      const showMomentum = phase(t, 0.78, 0.9);

      for (let i = 0; i < n; i++) {
        const px = x0 + i * colW;
        const topY = calmY - etas[i] * h * 0.07;
        const colBedY = lerp(bedY, calmY + h * 0.1, 1 - depths[i]); // shallower right
        // η cap above/below the calm line
        c.fillStyle = "#143247";
        c.fillRect(px + 1, topY, colW - 2, calmY - topY || 1);
        // the still-depth column d
        c.fillStyle = "#1b405c";
        c.fillRect(px + 1, calmY, colW - 2, colBedY - calmY);
        // surface cap
        c.fillStyle = PAL.accent;
        c.fillRect(px + 1, topY - 1.5, colW - 2, 3);
        // bed
        c.fillStyle = "#383226";
        c.fillRect(px + 1, colBedY, colW - 2, bedY - colBedY + h * 0.04);
      }
      // calm line
      c.strokeStyle = PAL.muted;
      c.setLineDash([5, 5]);
      c.beginPath();
      c.moveTo(x0, calmY);
      c.lineTo(x1, calmY);
      c.stroke();
      c.setLineDash([]);
      label(c, "calm level (y = 0)", x1 + 4, calmY, { color: PAL.muted, size: 10 });
      label(c, "lakebed", w * 0.5, bedY + h * 0.05, { color: PAL.muted, align: "center", size: 10 });
      label(c, "η", x0 + colW * 1.5, calmY - h * 0.12, { color: PAL.accent, size: 13 });
      label(c, "d", x0 + colW * 0.5, (calmY + bedY) / 2, { color: PAL.text, size: 13 });

      if (showFlux > 0.02) {
        c.globalAlpha = showFlux;
        for (let i = 1; i < n; i++) {
          const px = x0 + i * colW;
          const v = Math.cos(i * 0.9 - anim * 0.7);
          const ay = (calmY + bedY) / 2;
          const len = v * colW * 0.42 * depths[i];
          arrow(c, px - len / 2, ay, px + len / 2, ay, PAL.warm, 2, 6);
        }
        label(c, "flux q = d·v", w * 0.5, h * 0.1, { color: PAL.warm, align: "center", size: 13 });
        c.globalAlpha = 1;
      }
      if (showRise > 0.02) {
        c.globalAlpha = showRise;
        const i = 4;
        const px = x0 + (i + 0.5) * colW;
        const topY = calmY - etas[i] * h * 0.07;
        arrow(c, px, topY + 26, px, topY + 4, PAL.good, 2.5, 7);
        label(c, "more in than out → η rises", px, topY + 40, {
          color: PAL.good,
          align: "center",
          size: 12,
        });
        c.globalAlpha = 1;
      }
      if (showMomentum > 0.02) {
        c.globalAlpha = showMomentum;
        const i = 5;
        const px = x0 + (i + 0.5) * colW;
        const slope = etas[i + 1] - etas[i - 1];
        const ay = calmY + h * 0.07;
        arrow(c, px, ay, px - Math.sign(slope) * colW * 0.9, ay, PAL.red, 2.5, 7);
        label(c, "v accelerates downhill: −g·∇η", px, ay + h * 0.07, {
          color: PAL.red,
          align: "center",
          size: 12,
        });
        c.globalAlpha = 1;
      }
    },
  });
}

// ---- Step 2: c = √(g·d) ---------------------------------------------------------------------

export async function mountSpeedOfDepth(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const sky = createDawnSky(7.6);
  const dome = sky.makeDome();

  const depthU = uniform(2);
  const sim = new FluidSim(ctx.renderer, {
    resolution: 192,
    worldSize: 26,
    depth: { node: () => depthU, cpu: () => depthU.value as number },
    depthCap: 9, // no cap here: this demo IS about the true speed
    damping: 0.05,
    friction: 0.12,
  });
  const surface = new SimSurface(sim, { env: sky, extent: 0, waves: { ampScale: 0 } });
  ctx.scene.add(dome, surface.mesh);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0, 0),
    distance: 19,
    polar: 0.62,
    azimuth: 1.3,
  });

  let dripTimer = 0.5;
  ctx.shell.slider({
    label: "still depth d (m)",
    min: 0.2,
    max: 8,
    step: 0.1,
    value: depthU.value as number,
    onInput: (v) => {
      depthU.value = v;
      sim.refillDepth();
    },
  });
  ctx.shell.button("drop a ring now", () => sim.disturb({ kind: "splash", x: 0, z: 0, energy: 0.35, radius: 0.7 }));
  ctx.shell.setInfo(() => {
    const d = depthU.value as number;
    return `predicted front speed c = √(g·d) = ${Math.sqrt(9.81 * d).toFixed(2)} m/s`;
  });

  ctx.onDispose(() => {
    surface.dispose();
    sky.dispose();
    orbit.dispose();
    sim.dispose();
  });
  return ctx.finish((t, dt) => {
    dripTimer -= dt;
    if (dripTimer <= 0) {
      dripTimer = 3.2;
      sim.disturb({ kind: "splash", x: 0, z: 0, energy: 0.35, radius: 0.7 });
    }
    sim.step(dt);
    surface.update(t);
    orbit.update(dt);
  });
}

// ---- Step 3: shoaling on an analytic ramp ----------------------------------------------------

export async function mountShoalingRamp(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46 });
  const sky = createDawnSky(7.0);
  const dome = sky.makeDome();

  const size = 36;
  // Beach on +x: depth falls linearly from dMax to zero at x = beachX.
  const slopeU = uniform(0.28);
  const beachX = size * 0.32;
  const sim = new FluidSim(ctx.renderer, {
    resolution: 224,
    worldSize: size,
    depth: {
      node: (xz) => float(beachX).sub(xz.x).mul(slopeU).clamp(0, 6),
      cpu: (x) => Math.min(Math.max((beachX - x) * (slopeU.value as number), 0), 6),
    },
    depthCap: 6, // honest speeds: shoaling is the lesson
    damping: 0.06,
    friction: 0.3,
  });
  const surface = new SimSurface(sim, {
    env: sky,
    extent: 0,
    depthTint: true,
    waves: { ampScale: 0 },
  });
  ctx.scene.add(dome, surface.mesh);

  const paddle = new SwellPaddle(sim, new Vector2(-size * 0.42, 0), new Vector2(1, 0), size * 0.8);
  paddle.period = 2.4;
  paddle.energy = 0.45;

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(2, 0, 0),
    distance: 26,
    polar: 0.42,
    azimuth: 3.6,
  });

  ctx.shell.slider({
    label: "beach slope",
    min: 0.08,
    max: 0.6,
    step: 0.02,
    value: slopeU.value as number,
    onInput: (v) => {
      slopeU.value = v;
      sim.refillDepth();
    },
  });
  ctx.shell.slider({
    label: "swell period (s)",
    min: 1.2,
    max: 4.5,
    step: 0.1,
    value: paddle.period,
    onInput: (v) => (paddle.period = v),
  });
  ctx.shell.setInfo(() => "watch crests slow, bunch, and steepen as the bottom comes up");

  ctx.onDispose(() => {
    surface.dispose();
    sky.dispose();
    orbit.dispose();
    sim.dispose();
  });
  return ctx.finish((t, dt) => {
    paddle.update(dt);
    sim.step(dt);
    surface.update(t);
    orbit.update(dt);
  });
}

// ---- Step 4: the real lakebed -----------------------------------------------------------------

export async function mountLakebedWindow(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await splashCtx(el, { fov: 46, far: 4000 });
  const { sim, surface, shore } = await makeShoreScene(ctx, 44, 192);

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(shore.x, 0.4, shore.y),
    distance: 26,
    polar: 0.5,
    azimuth: 2.6,
  });

  const offTap = onTap(ctx.shell.canvas, (e) => {
    const p = pickWaterPoint(e, ctx.shell.canvas, ctx.camera);
    if (p) sim.disturb({ kind: "splash", x: p.x, z: p.z, energy: 0.6, radius: 0.6 });
  });

  ctx.shell.button("splash mid-window", () =>
    sim.disturb({ kind: "splash", x: sim.center.x, z: sim.center.y, energy: 0.8, radius: 0.7 }),
  );
  ctx.shell.setInfo(() => {
    const d = sim.depthAtCpu(sim.center.x, sim.center.y);
    return `depth under window center: ${d === null ? "?" : d.toFixed(2)} m (terrainHeightAt, negated)`;
  });

  ctx.onDispose(() => {
    orbit.dispose();
    offTap();
  });
  return ctx.finish((t, dt) => {
    sim.step(dt);
    surface.update(t);
    orbit.update(dt);
  });
}
