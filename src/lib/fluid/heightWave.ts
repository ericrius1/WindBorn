// The smallest GPU water simulation that behaves like water: the linear
// wave equation on a square grid, taught in waves.html and kept here as the
// minimal reference implementation. The real lake sim (./sim.ts) upgrades
// this to the shallow-water equations; everything structural — ping-pong
// storage buffers, the five-point Laplacian, the CFL substep loop, splash
// injection, sponge boundaries — is introduced here first.
//
// State per cell: (h, w) = surface height and its time derivative, stored
// as a vec2 in two storage buffers A and B. Every substep reads A whole and
// writes B whole (the ping), then the roles swap (the pong). A step() call
// always leaves the freshest state in A, so materials can bind A once and
// never care about the swap.

import type { WebGPURenderer, Node } from "three/webgpu";
import { Vector4 } from "three/webgpu";
import {
  Fn,
  Loop,
  clamp,
  exp,
  float,
  floor,
  instanceIndex,
  instancedArray,
  int,
  min,
  mix,
  uniform,
  uniformArray,
  vec2,
} from "three/tsl";

type NodeF = Node<"float">;
type NodeI = Node<"int">;
type NodeV2 = Node<"vec2">;

/** Pending splash pool size. Splashes beyond this in one frame are dropped. */
export const MAX_SPLASHES = 12;

export interface HeightWaveSimOptions {
  /** Cells per side. The grid is square. Default 192. */
  resolution?: number;
  /** Side length of the simulated patch, meters. Default 16. */
  worldSize?: number;
  /** Wave phase speed c, m/s. Default 2. */
  waveSpeed?: number;
  /** Energy decay, 1/s (exponential). Default 0.12. */
  damping?: number;
  /** "reflect" bounces waves off the walls; "absorb" eats them. */
  boundary?: "reflect" | "absorb";
  /** Sponge band width as a fraction of the half-size. Default 0.16. */
  spongeWidth?: number;
  /**
   * When true (default) step() subdivides the frame dt so the CFL number
   * stays under `cflSafety`. When false it integrates the whole frame in one
   * substep — which goes unstable when c·dt/dx gets too big. waves.html
   * turns this off on purpose to show the cliff.
   */
  clampStability?: boolean;
  /** Fraction of the stability limit to run at. Default 0.9. */
  cflSafety?: number;
  /** Upper bound on substeps per frame. Default 8. */
  maxSubsteps?: number;
}

export class HeightWaveSim {
  readonly res: number;
  readonly cells: number;
  readonly worldSize: number;
  /** Lattice spacing dx, meters. Samples sit at -half + i·dx. */
  readonly spacing: number;

  /** Wave phase speed c in m/s. Drives the CFL limit. */
  waveSpeed: number;
  /** Exponential energy decay, 1/s. */
  damping: number;
  /** 0 = reflect, 1 = absorb. Mirrors the boundary option, slider-friendly. */
  boundaryMode: number;
  clampStability: boolean;
  cflSafety: number;
  maxSubsteps: number;
  timeScale = 1;

  /** Diagnostics from the latest step() — for demo readouts. */
  lastSubsteps = 0;
  lastCfl = 0;

  // ---- GPU state ------------------------------------------------------------
  private readonly a;
  private readonly b;
  private readonly dtU = uniform(0);
  private readonly c2dt = uniform(0); // c²·dt
  private readonly dampMul = uniform(1); // exp(-damping·dt)
  private readonly spongeK = uniform(0); // sponge strength · dt · boundaryMode
  private readonly splashData = Array.from({ length: MAX_SPLASHES }, () => new Vector4(0, 0, 0, 1));
  private readonly splashes = uniformArray<"vec4">(this.splashData as unknown[], "vec4");
  private splashCursor = 0;
  private splashesPending = false;

  private readonly stepAB;
  private readonly stepBA;
  private readonly copyBA;
  private readonly clearAll;
  private readonly splashKernel;
  private current: "a" | "b" = "a";

  constructor(
    private readonly renderer: WebGPURenderer,
    options: HeightWaveSimOptions = {},
  ) {
    this.res = options.resolution ?? 192;
    this.cells = this.res * this.res;
    this.worldSize = options.worldSize ?? 16;
    this.spacing = this.worldSize / (this.res - 1);
    this.waveSpeed = options.waveSpeed ?? 2;
    this.damping = options.damping ?? 0.12;
    this.boundaryMode = options.boundary === "absorb" ? 1 : 0;
    this.clampStability = options.clampStability ?? true;
    this.cflSafety = options.cflSafety ?? 0.9;
    this.maxSubsteps = options.maxSubsteps ?? 8;

    this.a = instancedArray(this.cells, "vec2");
    this.b = instancedArray(this.cells, "vec2");

    const spongeCells = Math.max(2, Math.floor(this.res * 0.5 * (options.spongeWidth ?? 0.16)));

    // ---- the integrator: read src whole, write dst whole ---------------------
    const buildStep = (src: typeof this.a, dst: typeof this.b) => {
      const res = this.res;
      const invDx2 = 1 / (this.spacing * this.spacing);
      return Fn(() => {
        const idx = int(instanceIndex);
        const i = idx.mod(res);
        const j = idx.div(res);
        const at = (ii: NodeI, jj: NodeI): NodeI =>
          int(clamp(float(jj), 0, res - 1)).mul(res).add(int(clamp(float(ii), 0, res - 1)));

        const c = src.element(idx).toVar(); // (h, w)
        const hL = src.element(at(i.sub(1), j)).x;
        const hR = src.element(at(i.add(1), j)).x;
        const hD = src.element(at(i, j.sub(1))).x;
        const hU = src.element(at(i, j.add(1))).x;

        // Discrete Laplacian: "the average of my neighbors, minus me",
        // scaled by 1/dx². Curvature of the surface, in 1/m.
        const lap = hL.add(hR).add(hD).add(hU).sub(c.x.mul(4)).mul(invDx2);

        // Sponge: cells within the boundary band lose extra energy each
        // substep, quadratically stronger toward the wall. boundaryMode
        // gates it (folded into spongeK on the CPU).
        const fi = float(i);
        const fj = float(j);
        const edge = min(min(fi, float(res - 1).sub(fi)), min(fj, float(res - 1).sub(fj))).div(
          spongeCells,
        );
        const edgeT = float(1).sub(edge.clamp(0, 1));
        const sponge = float(1).sub(edgeT.mul(edgeT).mul(this.spongeK)).clamp(0, 1);

        // Symplectic Euler: kick the velocity, then drift the height with
        // the *new* velocity.
        const w = c.y.add(lap.mul(this.c2dt)).mul(this.dampMul).mul(sponge);
        const h = c.x.add(w.mul(this.dtU)).mul(sponge);
        dst.element(idx).assign(vec2(h, w));
      })().compute(this.cells);
    };
    this.stepAB = buildStep(this.a, this.b);
    this.stepBA = buildStep(this.b, this.a);

    this.copyBA = Fn(() => {
      this.a.element(instanceIndex).assign(this.b.element(instanceIndex));
    })().compute(this.cells);

    this.clearAll = Fn(() => {
      this.a.element(instanceIndex).assign(vec2(0));
      this.b.element(instanceIndex).assign(vec2(0));
    })().compute(this.cells);

    // ---- splash injection: own-cell writes only, so it runs in place ---------
    this.splashKernel = Fn(() => {
      const idx = int(instanceIndex);
      const i = idx.mod(this.res);
      const j = idx.div(this.res);
      const half = this.worldSize / 2;
      const x = float(i).mul(this.spacing).sub(half);
      const z = float(j).mul(this.spacing).sub(half);
      const cell = this.a.element(idx);
      Loop(MAX_SPLASHES, ({ i: k }) => {
        const s = this.splashes.element(k); // (x, z, amp, radius)
        const dx = x.sub(s.x);
        const dz = z.sub(s.y);
        const r2 = dx.mul(dx).add(dz.mul(dz));
        const g = exp(r2.negate().div(s.w.mul(s.w).max(1e-4)));
        cell.x.addAssign(s.z.mul(g));
      });
    })().compute(this.cells);
  }

  /** Largest stable substep for the current wave speed (2-D von Neumann). */
  stableDt(): number {
    return (this.cflSafety * this.spacing) / (Math.SQRT2 * Math.max(this.waveSpeed, 1e-3));
  }

  /**
   * Queue a height splash: a Gaussian bump of `amp` meters with footprint
   * `radius` meters at patch-local (x, z) (the patch is centered on 0).
   * Applied at the start of the next step().
   */
  splash(x: number, z: number, amp: number, radius: number): void {
    this.splashData[this.splashCursor].set(x, z, amp, Math.max(radius, this.spacing));
    this.splashCursor = (this.splashCursor + 1) % MAX_SPLASHES;
    this.splashesPending = true;
  }

  /** Advance the simulation by `dt` real seconds (scaled by timeScale). */
  step(dt: number): void {
    const simDt = Math.min(dt, 0.1) * this.timeScale;
    if (simDt <= 0) return;

    if (this.splashesPending) {
      this.renderer.compute(this.splashKernel);
      for (const v of this.splashData) v.set(0, 0, 0, 1);
      this.splashesPending = false;
    }

    let n = 1;
    let sub = simDt;
    if (this.clampStability) {
      n = Math.min(this.maxSubsteps, Math.max(1, Math.ceil(simDt / this.stableDt())));
      sub = simDt / n;
    }
    this.dtU.value = sub;
    this.c2dt.value = this.waveSpeed * this.waveSpeed * sub;
    this.dampMul.value = Math.exp(-this.damping * sub);
    this.spongeK.value = Math.min(1, 6 * sub) * this.boundaryMode;
    this.lastSubsteps = n;
    this.lastCfl = (this.waveSpeed * sub * Math.SQRT2) / this.spacing;

    for (let k = 0; k < n; k++) {
      this.renderer.compute(this.current === "a" ? this.stepAB : this.stepBA);
      this.current = this.current === "a" ? "b" : "a";
    }
    if (this.current === "b") {
      this.renderer.compute(this.copyBA);
      this.current = "a";
    }
  }

  /** Flatten the pond. */
  clear(): void {
    this.renderer.compute(this.clearAll);
    this.current = "a";
  }

  // ---- TSL accessors (materials read buffer A; it is always freshest) --------

  /** State (h, w) of the cell under lattice index `idx` — for grid meshes
   *  whose vertex order matches the sim lattice (vertexIndex == cell). */
  cellNode(idx: NodeI | Node<"uint">): NodeV2 {
    return this.a.element(idx) as unknown as NodeV2;
  }

  /** Bilinear state (h, w) at patch-local meters (center = 0). */
  fieldNode(xz: NodeV2): NodeV2 {
    const res = this.res;
    return Fn(() => {
      const half = this.worldSize / 2;
      const g = xz.add(half).div(this.spacing);
      const gc = clamp(g, vec2(0), vec2(res - 1.001));
      const g0 = floor(gc);
      const f = gc.sub(g0);
      const i0 = int(g0.x);
      const j0 = int(g0.y);
      const idx = j0.mul(res).add(i0);
      const v00 = this.a.element(idx);
      const v10 = this.a.element(idx.add(1));
      const v01 = this.a.element(idx.add(res));
      const v11 = this.a.element(idx.add(res + 1));
      return mix(mix(v00, v10, f.x), mix(v01, v11, f.x), f.y);
    })() as unknown as NodeV2;
  }

  /** Bilinear height at patch-local meters. */
  heightNode(xz: NodeV2): NodeF {
    return this.fieldNode(xz).x;
  }

  dispose(): void {
    // Buffers die with the demo's renderer; nothing renderer-independent held.
  }
}
