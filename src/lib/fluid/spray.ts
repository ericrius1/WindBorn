// Spray — the crown of the splash. A pool of GPU droplets that the impact
// energy budget pays for: each emit() converts a slice of the impact's
// kinetic energy into ballistic droplets that inherit the surface velocity
// under them, fly under gravity and drag, and rejoin the lake as small
// "rain" disturbances on the bus (so the sim — and the audio, eventually —
// hears them land).
//
// Built in crown.html; the slow-motion strike in wake.html runs it at
// timeScale 0.1.
//
// The droplets live entirely on the GPU (positions never read back); the
// rejoin events are scheduled on the CPU from the same ballistic equations
// the GPU integrates — two transcriptions of one formula, the same trick
// the wave table uses (see /ripples.html).

import { Sprite, Vector4 } from "three/webgpu";
import type { SpriteMaterial, WebGPURenderer } from "three/webgpu";
import { SpriteNodeMaterial } from "three/webgpu";
import {
  Fn,
  If,
  Loop,
  float,
  hash,
  instanceIndex,
  instancedArray,
  select,
  smoothstep,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { disturb } from "../spine";
import type { FluidSim } from "./sim";

export const MAX_SPRAY_REQUESTS = 8;

export interface SpraySystemOptions {
  /** Droplet pool size. Default 4096. */
  count?: number;
  /** Sample the sim's surface velocity at spawn (crown shape). */
  sim?: FluidSim | null;
  /** Droplet sprite size, meters. Default 0.045. */
  size?: number;
  /** Linear air drag, 1/s. Default 0.55. */
  drag?: number;
  gravity?: number;
  /** Emit rejoin "rain" disturbances when droplets land. Default true. */
  rejoin?: boolean;
}

export interface EmitSpec {
  x: number;
  z: number;
  /** Impact energy in the bus's Joule-ish units. */
  energy: number;
  /** Spawn ring radius, meters. Default 0.45·√energy + 0.15. */
  radius?: number;
  /** Droplet count override. Default ≈ 90·√energy. */
  count?: number;
}

interface Rejoin {
  time: number;
  x: number;
  z: number;
  energy: number;
  radius: number;
}

// Velocity budget per √energy — the CPU twin of the spawn kernel constants.
const UP_SPEED = 2.6;
const OUT_SPEED = 1.7;

export class SpraySystem {
  readonly count: number;
  readonly sprite: Sprite;
  timeScale = 1;
  rejoinEnabled: boolean;

  /** 0..1 — how much of the local surface velocity droplets inherit. */
  readonly inherit = uniform(1);
  readonly gravityU;
  readonly dragU;

  /** CPU-side estimate of live droplets, for readouts. */
  emittedTotal = 0;

  private readonly pos;
  private readonly vel;
  private readonly dtU = uniform(0);
  private readonly reqA = Array.from({ length: MAX_SPRAY_REQUESTS }, () => new Vector4(0, 0, 0, 0.3));
  private readonly reqB = Array.from({ length: MAX_SPRAY_REQUESTS }, () => new Vector4(0, 0, 0, 0));
  private readonly reqANode = uniformArray<"vec4">(this.reqA as unknown[], "vec4");
  private readonly reqBNode = uniformArray<"vec4">(this.reqB as unknown[], "vec4");
  private reqCursor = 0;
  private reqPending = false;
  private poolCursor = 0;
  private seedBase = uniform(0);

  private readonly spawnKernel;
  private readonly updateKernel;
  private readonly clearKernel;
  private readonly material: SpriteNodeMaterial;
  private readonly rejoins: Rejoin[] = [];

  constructor(
    private readonly renderer: WebGPURenderer,
    options: SpraySystemOptions = {},
  ) {
    this.count = options.count ?? 4096;
    const sim = options.sim ?? null;
    const size = options.size ?? 0.045;
    this.gravityU = uniform(options.gravity ?? 9.81);
    this.dragU = uniform(options.drag ?? 0.55);
    this.rejoinEnabled = options.rejoin ?? true;

    this.pos = instancedArray(this.count, "vec4"); // (x, y, z, life)
    this.vel = instancedArray(this.count, "vec4"); // (vx, vy, vz, sizeSeed)

    const N = this.count;

    // ---- spawn: each request claims a contiguous (wrapping) index range ------
    this.spawnKernel = Fn(() => {
      const fi = float(instanceIndex);
      Loop(MAX_SPRAY_REQUESTS, ({ i: k }) => {
        const a = this.reqANode.element(k); // (x, z, energy, ringRadius)
        const b = this.reqBNode.element(k); // (start, count, 0, 0)
        const raw = fi.sub(b.x);
        const rel = raw.add(select(raw.lessThan(0), float(N), float(0)));
        If(rel.lessThan(b.y), () => {
          const seed = fi.add(this.seedBase).add(float(k).mul(91.7));
          const h1 = hash(seed);
          const h2 = hash(seed.add(17.1));
          const h3 = hash(seed.add(31.7));
          const h4 = hash(seed.add(47.3));
          const h5 = hash(seed.add(63.9));
          const ang = h1.mul(Math.PI * 2);
          const dir = vec2(ang.cos(), ang.sin());
          const ring = a.w.mul(h2.mul(0.75).add(0.25));
          const px = a.x.add(dir.x.mul(ring));
          const pz = a.y.add(dir.y.mul(ring));
          const e = a.z.sqrt();
          const vUp = e.mul(UP_SPEED).mul(h3.mul(0.9).add(0.55));
          const vOut = e.mul(OUT_SPEED).mul(h4.mul(0.85).add(0.35));
          let vx = dir.x.mul(vOut);
          let vz = dir.y.mul(vOut);
          if (sim) {
            const sv = sim.fieldNode(vec2(px, pz));
            vx = vx.add(sv.y.mul(this.inherit));
            vz = vz.add(sv.z.mul(this.inherit));
          }
          this.pos
            .element(instanceIndex)
            .assign(vec4(px, h5.mul(0.08).add(0.04), pz, h2.mul(0.9).add(0.5)));
          this.vel.element(instanceIndex).assign(vec4(vx, vUp, vz, h3));
        });
      });
    })().compute(this.count);

    // ---- update: ballistic flight, kill on touchdown -------------------------
    this.updateKernel = Fn(() => {
      const p = this.pos.element(instanceIndex);
      const v = this.vel.element(instanceIndex);
      If(p.w.greaterThan(0), () => {
        v.y.subAssign(this.gravityU.mul(this.dtU));
        const dragMul = float(1).div(this.dragU.mul(this.dtU).add(1));
        v.x.mulAssign(dragMul);
        v.y.mulAssign(dragMul);
        v.z.mulAssign(dragMul);
        p.x.addAssign(v.x.mul(this.dtU));
        p.y.addAssign(v.y.mul(this.dtU));
        p.z.addAssign(v.z.mul(this.dtU));
        p.w.subAssign(this.dtU);
        If(p.y.lessThan(0.01).and(v.y.lessThan(0)), () => {
          p.w.assign(0);
        });
      });
    })().compute(this.count);

    this.clearKernel = Fn(() => {
      this.pos.element(instanceIndex).assign(vec4(0, -10, 0, 0));
      this.vel.element(instanceIndex).assign(vec4(0, 0, 0, 0.5));
    })().compute(this.count);

    // ---- render: one instanced sprite pool ------------------------------------
    const material = new SpriteNodeMaterial();
    this.material = material;
    material.transparent = true;
    material.depthWrite = false;
    const pp = this.pos.element(instanceIndex);
    const vv = this.vel.element(instanceIndex);
    const alive = pp.w.greaterThan(0);
    material.positionNode = pp.xyz;
    const sizeSeed = vv.w.mul(0.8).add(0.6);
    material.scaleNode = select(alive, float(size).mul(sizeSeed), float(0));
    material.colorNode = vec3(0.86, 0.92, 0.97);
    material.opacityNode = select(alive, smoothstep(0, 0.12, pp.w).mul(0.85), float(0));

    this.sprite = new Sprite(material as unknown as SpriteMaterial);
    this.sprite.count = this.count;
    this.sprite.frustumCulled = false;

    this.renderer.compute(this.clearKernel);
  }

  // The pool's own clock: advances by dt·timeScale, so rejoin scheduling
  // stays correct in slow motion (the showcase runs at 0.1×).
  private simTime = 0;

  /** Burst a crown of droplets. */
  emit(spec: EmitSpec): void {
    const e = Math.max(spec.energy, 0);
    const sqrtE = Math.sqrt(e);
    const n = Math.min(
      this.count,
      Math.max(8, Math.round(spec.count ?? 90 * sqrtE)),
    );
    const radius = spec.radius ?? 0.45 * sqrtE + 0.15;
    this.reqA[this.reqCursor].set(spec.x, spec.z, e, radius);
    this.reqB[this.reqCursor].set(this.poolCursor, n, 0, 0);
    this.reqCursor = (this.reqCursor + 1) % MAX_SPRAY_REQUESTS;
    this.poolCursor = (this.poolCursor + n) % this.count;
    this.reqPending = true;
    this.emittedTotal += n;

    if (this.rejoinEnabled) {
      // The CPU twin of the flight: a droplet leaving at vUp lands after
      // t ≈ 2·vUp/g (drag shortens it a touch), at ring + vOut·t outward.
      const bursts = Math.min(10, Math.max(3, Math.round(n / 50)));
      for (let k = 0; k < bursts; k++) {
        const r1 = Math.random();
        const r2 = Math.random();
        const vUp = sqrtE * UP_SPEED * (0.55 + 0.9 * r1);
        const vOut = sqrtE * OUT_SPEED * (0.35 + 0.85 * r2);
        const flight = (2 * vUp) / 9.81 * 0.85;
        const ang = Math.random() * Math.PI * 2;
        const dist = radius + vOut * flight;
        this.rejoins.push({
          time: this.simTime + flight,
          x: spec.x + Math.cos(ang) * dist,
          z: spec.z + Math.sin(ang) * dist,
          energy: Math.min(0.004 * e + 0.0005, 0.02),
          radius: 0.12,
        });
      }
    }
  }

  /** Advance the pool and fire any due rejoin disturbances. */
  update(dt: number): void {
    const simDt = Math.min(dt, 0.1) * this.timeScale;
    this.simTime += simDt;
    if (this.reqPending) {
      this.seedBase.value = (this.simTime * 977 + this.emittedTotal) % 4096;
      this.renderer.compute(this.spawnKernel);
      for (const v of this.reqA) v.set(0, 0, 0, 0.3);
      for (const v of this.reqB) v.set(0, 0, 0, 0);
      this.reqPending = false;
    }
    if (simDt > 0) {
      this.dtU.value = simDt;
      this.renderer.compute(this.updateKernel);
    }
    for (let i = this.rejoins.length - 1; i >= 0; i--) {
      if (this.rejoins[i].time <= this.simTime) {
        const r = this.rejoins[i];
        disturb({ kind: "rain", x: r.x, z: r.z, energy: r.energy, radius: r.radius });
        this.rejoins.splice(i, 1);
      }
    }
  }

  clear(): void {
    this.renderer.compute(this.clearKernel);
    this.rejoins.length = 0;
  }

  dispose(): void {
    this.material.dispose();
    this.rejoins.length = 0;
  }
}
