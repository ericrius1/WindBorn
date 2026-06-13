// The Splash's flagship: a local shallow-water simulation on a fixed-size
// GPU grid whose world-space window can move. This is the object the dive,
// the wakes, the foam, and the game's centerpiece splash all run on.
//
// Built across the series:
//   waves.html     ping-pong integration, Laplacian, CFL, sponge boundaries
//                  (see ./heightWave.ts for the minimal version)
//   shallows.html  the shallow-water equations; the depth field d(x, z)
//   simbubble.html the moving window: snap-to-lattice shifts + edge fade
//   coupling.html  disturbance-bus ingestion (momentum in), CPU mirror
//                  readback (heights out, for buoyancy)
//   crown.html     spray spawning reads the velocity field (./spray.ts)
//   wake.html      the foam channel: advected by the flow, fed by impacts
//
// State per cell: vec4(η, vx, vz, foam) — surface deviation from the
// ambient lake (NOT absolute height; the ambient analytic waves live
// underneath, see ./provider.ts), depth-averaged horizontal velocity, and
// entrained foam. Two buffers ping-pong; step() always leaves the freshest
// state in A. A separate float buffer holds the still-water depth d per
// cell, refilled from the depth function whenever the window moves.

import type { WebGPURenderer, Node } from "three/webgpu";
import { Vector2, Vector4 } from "three/webgpu";
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
  max,
  min,
  mix,
  select,
  smoothstep,
  uniform,
  uniformArray,
  vec2,
  vec4,
} from "three/tsl";
import type { Disturbance, DisturbanceKind } from "../spine";
import { onDisturbance } from "../spine";

type NodeF = Node<"float">;
type NodeI = Node<"int">;
type NodeV2 = Node<"vec2">;
type NodeV4 = Node<"vec4">;

export const MAX_IMPULSES = 16;

/** A depth field for the sim: a TSL builder for the GPU fill pass, and an
 *  optional CPU twin for diagnostics. Both return DEPTH in meters (≥ 0
 *  underwater, ≤ 0 on land — the sim clamps at zero). */
export interface DepthSpec {
  node: (xz: NodeV2) => NodeF;
  cpu?: (x: number, z: number) => number;
}

export interface FluidSimOptions {
  /** Lattice samples per side. Default 192. */
  resolution?: number;
  /** Side length of the window, meters. Default 24. */
  worldSize?: number;
  /** Initial window center in world meters. Default (0, 0). */
  center?: { x: number; z: number };
  /** Still-water depth: a constant or a DepthSpec. Default 6. */
  depth?: number | DepthSpec;
  /**
   * The declared cheat: the depth used by the wave-speed term is
   * min(d, depthCap). True shallow-water treats every wave as a long wave
   * (c = √(g·d)), which at 20 m of depth sends centimeter ripples racing at
   * 14 m/s. Capping the *effective* depth keeps splash rings at a believable
   * pace while leaving the real shallows (d < cap) honest. Default 1.5 m.
   */
  depthCap?: number;
  /** m/s². You will not need to change this on Stillwater. */
  gravity?: number;
  /** Exponential η decay, 1/s. Default 0.10. */
  damping?: number;
  /** Bottom friction on velocity, 1/s. Default 0.55. */
  friction?: number;
  /** Checkerboard-killing blend toward the 4-neighbor mean, per substep
   *  fraction. Default 0.04. */
  smoothing?: number;
  /** Foam decay, 1/s. Default 0.35. */
  foamDecay?: number;
  /** Sponge + blend band width as a fraction of the half-size. Default 0.30
   *  (the rim where the sim fades into the ambient lake also absorbs
   *  outgoing waves — one band, two jobs). */
  blendWidth?: number;
  /** Fraction of the stability limit to run at. Default 0.55. */
  cflSafety?: number;
  maxSubsteps?: number;
  /** Allocate and refresh the CPU mirror for height/velocity queries. */
  mirror?: boolean;
}

// Disturbance kind → impulse shape. Scales are per √(energy J-ish):
//   down   meters of cavity pushed into η
//   radial m/s of outward velocity
//   dir    fraction of the disturber's own velocity injected
//   foam   foam units added (scaled by energy^0.6)
const IMPULSE_TUNING: Record<DisturbanceKind, { down: number; radial: number; dir: number; foam: number }> = {
  splash: { down: 0.4, radial: 1.5, dir: 0.3, foam: 0.6 },
  rise: { down: 0.12, radial: 0.5, dir: 0, foam: 0.08 },
  rain: { down: 0.18, radial: 0.25, dir: 0, foam: 0 },
  wake: { down: 0.05, radial: 0.4, dir: 0.85, foam: 0.16 },
  skim: { down: 0.09, radial: 0.5, dir: 0.55, foam: 0.1 },
};

export class FluidSim {
  readonly res: number;
  readonly cells: number;
  readonly worldSize: number;
  /** Lattice spacing, meters. Sample (i, j) sits at center + (i·s − half). */
  readonly spacing: number;
  readonly depthCap: number;
  readonly gravity: number;

  timeScale = 1;
  cflSafety: number;
  maxSubsteps: number;

  /** Window center, world meters. Snapped to lattice increments. */
  readonly center = new Vector2(0, 0);
  /** Same value as a uniform — shared by kernels and surface materials. */
  readonly centerUniform;

  /** Where the blend-to-ambient (and the sponge) begins, as a fraction of
   *  the half-size (0 = fade everywhere, 1 = no fade). */
  readonly blendStart;
  /** Debug/teaching switch: 1 = cut the sim off hard at the window edge. */
  readonly hardEdge = uniform(0);

  /** Diagnostics. */
  lastSubsteps = 0;
  /** Frames since the CPU mirror last refreshed (staleness readout). */
  mirrorAge = 0;
  /** Effective gravity-wave speed bound, m/s: √(g·depthCap). */
  readonly waveSpeedCap: number;

  // ---- GPU state ---------------------------------------------------------------
  private readonly a;
  private readonly b;
  private readonly depthBuf;
  private readonly dtU = uniform(0);
  private readonly dampMul = uniform(1);
  private readonly fricMul = uniform(1);
  private readonly foamMul = uniform(1);
  private readonly smoothK = uniform(0);
  private readonly spongeK = uniform(0);
  private readonly shiftU = uniform(new Vector2(0, 0));
  private readonly impA = Array.from({ length: MAX_IMPULSES }, () => new Vector4(0, 0, 0, 1));
  private readonly impB = Array.from({ length: MAX_IMPULSES }, () => new Vector4(0, 0, 0, 0));
  private readonly impANode = uniformArray<"vec4">(this.impA as unknown[], "vec4");
  private readonly impBNode = uniformArray<"vec4">(this.impB as unknown[], "vec4");
  private impCursor = 0;
  private impPending = false;

  private readonly stepAB;
  private readonly stepBA;
  private readonly copyBA;
  private readonly clearAll;
  private readonly impulseKernel;
  private readonly shiftKernel;
  private readonly depthKernel;
  private current: "a" | "b" = "a";

  // ---- CPU mirror ----------------------------------------------------------------
  private mirrorEnabled: boolean;
  private mirrorData: Float32Array | null = null;
  private readonly mirrorCenter = new Vector2(0, 0);
  private mirrorInFlight = false;
  private mirrorFresh = false;
  private blendStartValue: number;

  constructor(
    private readonly renderer: WebGPURenderer,
    options: FluidSimOptions = {},
  ) {
    this.res = options.resolution ?? 192;
    this.cells = this.res * this.res;
    this.worldSize = options.worldSize ?? 24;
    this.spacing = this.worldSize / (this.res - 1);
    this.depthCap = options.depthCap ?? 1.5;
    this.gravity = options.gravity ?? 9.81;
    this.cflSafety = options.cflSafety ?? 0.55;
    this.maxSubsteps = options.maxSubsteps ?? 8;
    this.waveSpeedCap = Math.sqrt(this.gravity * this.depthCap);
    this.mirrorEnabled = options.mirror ?? false;

    if (options.center) this.center.set(options.center.x, options.center.z);
    this.centerUniform = uniform(this.center.clone());
    this.blendStartValue = 1 - (options.blendWidth ?? 0.3);
    this.blendStart = uniform(this.blendStartValue);

    const damping = options.damping ?? 0.1;
    const friction = options.friction ?? 0.55;
    const foamDecay = options.foamDecay ?? 0.35;
    const smoothing = options.smoothing ?? 0.04;
    this.tuning = { damping, friction, foamDecay, smoothing };

    this.a = instancedArray(this.cells, "vec4");
    this.b = instancedArray(this.cells, "vec4");
    this.depthBuf = instancedArray(this.cells, "float");

    const res = this.res;
    const s = this.spacing;
    const half = this.worldSize / 2;
    const g = this.gravity;
    const dCap = this.depthCap;
    const vMax = 4 * this.waveSpeedCap;

    const spongeCells = Math.max(2, (1 - this.blendStartValue) * 0.5 * res);

    const at = (ii: NodeI, jj: NodeI): NodeI =>
      int(clamp(float(jj), 0, res - 1)).mul(res).add(int(clamp(float(ii), 0, res - 1)));

    // ---- the integrator: one substep of the shallow-water equations -----------
    const buildStep = (src: typeof this.a, dst: typeof this.b) => {
      return Fn(() => {
        const idx = int(instanceIndex);
        const i = idx.mod(res);
        const j = idx.div(res);

        const iL = at(i.sub(1), j);
        const iR = at(i.add(1), j);
        const iD = at(i, j.sub(1));
        const iU = at(i, j.add(1));

        const C = src.element(idx).toVar(); // (η, vx, vz, foam)
        const L = src.element(iL).toVar();
        const R = src.element(iR).toVar();
        const D = src.element(iD).toVar();
        const U = src.element(iU).toVar();

        const d = this.depthBuf.element(idx).toVar();
        const dL = this.depthBuf.element(iL).min(dCap);
        const dR = this.depthBuf.element(iR).min(dCap);
        const dD = this.depthBuf.element(iD).min(dCap);
        const dU = this.depthBuf.element(iU).min(dCap);

        // -- mass: ∂η/∂t = −∇·(d·v). Dry neighbors carry zero flux, which is
        // exactly a wall — waves reflect off the shoreline for free.
        const div = dR.mul(R.y).sub(dL.mul(L.y)).add(dU.mul(U.z)).sub(dD.mul(D.z)).div(2 * s);
        const avg = L.x.add(R.x).add(D.x).add(U.x).mul(0.25);
        const eta = C.x.sub(div.mul(this.dtU)).mul(this.dampMul);
        const etaS = mix(eta, avg, this.smoothK); // checkerboard damper

        // -- momentum: ∂v/∂t = −g·∇η, with one-sided differences at the
        // shore so dry cells (η pinned at 0) don't fake a slope.
        const etaL = select(dL.greaterThan(0.001), L.x, C.x);
        const etaR = select(dR.greaterThan(0.001), R.x, C.x);
        const etaD = select(dD.greaterThan(0.001), D.x, C.x);
        const etaU = select(dU.greaterThan(0.001), U.x, C.x);
        const vx = C.y.sub(etaR.sub(etaL).mul(g / (2 * s)).mul(this.dtU)).mul(this.fricMul);
        const vz = C.z.sub(etaU.sub(etaD).mul(g / (2 * s)).mul(this.dtU)).mul(this.fricMul);

        // -- sponge: the blend rim eats outgoing waves so nothing reflects
        // off the window edge back into the action.
        const fi = float(i);
        const fj = float(j);
        const edgeCells = min(min(fi, float(res - 1).sub(fi)), min(fj, float(res - 1).sub(fj)));
        const rim = float(1).sub(edgeCells.div(spongeCells).clamp(0, 1));
        const sponge = float(1).sub(rim.mul(rim).mul(this.spongeK)).clamp(0, 1);

        // -- foam: ride the flow (semi-Lagrangian walk back along v), decay.
        const srcG = vec2(float(i), float(j)).sub(vec2(C.y, C.z).mul(this.dtU.div(s)));
        const gc = clamp(srcG, vec2(0), vec2(res - 1.001));
        const g0 = floor(gc);
        const f = gc.sub(g0);
        const fIdx = int(g0.y).mul(res).add(int(g0.x));
        const f00 = src.element(fIdx).w;
        const f10 = src.element(fIdx.add(1)).w;
        const f01 = src.element(fIdx.add(res)).w;
        const f11 = src.element(fIdx.add(res + 1)).w;
        const foam = mix(mix(f00, f10, f.x), mix(f01, f11, f.x), f.y).mul(this.foamMul);

        const wet = d.greaterThan(0.001);
        const out = vec4(
          select(wet, etaS.mul(sponge).clamp(-3, 3), 0),
          select(wet, vx.mul(sponge).clamp(-vMax, vMax), 0),
          select(wet, vz.mul(sponge).clamp(-vMax, vMax), 0),
          select(wet, foam.clamp(0, 2), foam.mul(0.8)),
        );
        dst.element(idx).assign(out);
      })().compute(this.cells);
    };
    this.stepAB = buildStep(this.a, this.b);
    this.stepBA = buildStep(this.b, this.a);

    this.copyBA = Fn(() => {
      this.a.element(instanceIndex).assign(this.b.element(instanceIndex));
    })().compute(this.cells);

    this.clearAll = Fn(() => {
      this.a.element(instanceIndex).assign(vec4(0));
      this.b.element(instanceIndex).assign(vec4(0));
    })().compute(this.cells);

    // ---- impulse ingestion: own-cell writes, runs in place on A ----------------
    this.impulseKernel = Fn(() => {
      const idx = int(instanceIndex);
      const i = idx.mod(res);
      const j = idx.div(res);
      const world = vec2(float(i), float(j)).mul(s).sub(half).add(this.centerUniform);
      const cell = this.a.element(idx);
      const wet = this.depthBuf.element(idx).greaterThan(0.001);
      Loop(MAX_IMPULSES, ({ i: k }) => {
        const pa = this.impANode.element(k); // (x, z, down, radius)
        const pb = this.impBNode.element(k); // (pushX, pushZ, foam, radial)
        const rel = world.sub(pa.xy);
        const r = rel.length().max(1e-4);
        const q = exp(r.mul(r).negate().div(pa.w.mul(pa.w).max(1e-4)));
        const dir = rel.div(r);
        const wetQ = select(wet, q, float(0));
        cell.x.subAssign(pa.z.mul(wetQ));
        cell.y.addAssign(dir.x.mul(pb.w).add(pb.x).mul(wetQ));
        cell.z.addAssign(dir.y.mul(pb.w).add(pb.y).mul(wetQ));
        cell.w.addAssign(pb.z.mul(wetQ));
      });
      cell.x.assign(cell.x.clamp(-3, 3));
      cell.w.assign(cell.w.clamp(0, 2));
    })().compute(this.cells);

    // ---- window shift: B[i,j] = A[i+di, j+dj], zero where the past ran out -----
    this.shiftKernel = Fn(() => {
      const idx = int(instanceIndex);
      const i = idx.mod(res);
      const j = idx.div(res);
      const ii = i.add(int(this.shiftU.x));
      const jj = j.add(int(this.shiftU.y));
      const inside = ii
        .greaterThanEqual(0)
        .and(ii.lessThan(res))
        .and(jj.greaterThanEqual(0))
        .and(jj.lessThan(res));
      const v = this.a.element(at(ii, jj));
      this.b.element(idx).assign(select(inside, v, vec4(0)));
    })().compute(this.cells);

    // ---- depth fill: evaluate the depth function on the new window -------------
    const depthOpt = options.depth ?? 6;
    const depthExpr: (xz: NodeV2) => NodeF =
      typeof depthOpt === "number" ? () => float(depthOpt) : depthOpt.node;
    this.depthCpu = typeof depthOpt === "number" ? () => depthOpt : (depthOpt.cpu ?? null);
    this.depthKernel = Fn(() => {
      const idx = int(instanceIndex);
      const i = idx.mod(res);
      const j = idx.div(res);
      const world = vec2(float(i), float(j)).mul(s).sub(half).add(this.centerUniform);
      this.depthBuf.element(idx).assign(max(depthExpr(world), 0));
    })().compute(this.cells);

    this.renderer.compute(this.depthKernel);
    if (this.mirrorEnabled) this.mirrorData = new Float32Array(this.cells * 4);
  }

  private readonly tuning: { damping: number; friction: number; foamDecay: number; smoothing: number };
  private readonly depthCpu: ((x: number, z: number) => number) | null;

  /** Move the blend rim. 0.9 = thin rim, 0.4 = wide soft apron. */
  setBlendStart(v: number): void {
    this.blendStartValue = v;
    this.blendStart.value = v;
  }

  /** Foam decay rate, 1/s (wake.html puts a slider on it). */
  get foamDecay(): number {
    return this.tuning.foamDecay;
  }
  set foamDecay(v: number) {
    this.tuning.foamDecay = v;
  }

  /** Largest stable substep at the capped wave speed. */
  stableDt(): number {
    return (this.cflSafety * this.spacing) / (Math.SQRT2 * this.waveSpeedCap);
  }

  /** Turn on the CPU mirror (heights/velocities readable next frame). */
  enableMirror(): void {
    this.mirrorEnabled = true;
    this.mirrorData ??= new Float32Array(this.cells * 4);
  }

  // ---- disturbances ------------------------------------------------------------

  /**
   * Low-level impulse, bypassing the disturbance-kind table: a Gaussian
   * footprint that pushes the surface down by `down` meters, kicks water
   * radially outward at `radial` m/s, adds a directed push (pushX, pushZ)
   * m/s, and deposits `foam`.
   */
  impulse(spec: {
    x: number;
    z: number;
    radius: number;
    down?: number;
    radial?: number;
    pushX?: number;
    pushZ?: number;
    foam?: number;
  }): void {
    const half = this.worldSize / 2;
    const margin = half + 2 * spec.radius;
    if (Math.abs(spec.x - this.center.x) > margin || Math.abs(spec.z - this.center.y) > margin) return;
    const radius = Math.max(spec.radius, this.spacing * 1.5);
    this.impA[this.impCursor].set(spec.x, spec.z, spec.down ?? 0, radius);
    this.impB[this.impCursor].set(spec.pushX ?? 0, spec.pushZ ?? 0, spec.foam ?? 0, spec.radial ?? 0);
    this.impCursor = (this.impCursor + 1) % MAX_IMPULSES;
    this.impPending = true;
  }

  /** Feed a disturbance-bus event into the sim (ignored outside the window). */
  disturb(d: Disturbance): void {
    const t = IMPULSE_TUNING[d.kind];
    const e = Math.sqrt(Math.max(d.energy, 0));
    this.impulse({
      x: d.x,
      z: d.z,
      radius: d.radius,
      down: Math.min(t.down * e, 0.5),
      radial: Math.min(t.radial * e, 3),
      pushX: (d.vx ?? 0) * t.dir,
      pushZ: (d.vz ?? 0) * t.dir,
      foam: Math.min(t.foam * Math.pow(Math.max(d.energy, 0), 0.6), 1),
    });
  }

  /** Subscribe this sim to the spine's disturbance bus. Returns unsubscribe. */
  attachToBus(): () => void {
    return onDisturbance((d) => this.disturb(d));
  }

  // ---- the per-frame pair: moveTo (optional), then step ---------------------------

  /**
   * Re-center the window on (x, z), snapped to whole lattice cells so the
   * shift pass is an exact integer copy — no resampling blur, ever. Call at
   * most once per frame, before step().
   */
  moveTo(x: number, z: number): void {
    const s = this.spacing;
    const di = Math.round((x - this.center.x) / s);
    const dj = Math.round((z - this.center.y) / s);
    if (di === 0 && dj === 0) return;
    this.center.x += di * s;
    this.center.y += dj * s;
    (this.centerUniform.value as Vector2).copy(this.center);
    if (Math.abs(di) >= this.res || Math.abs(dj) >= this.res) {
      this.renderer.compute(this.clearAll);
    } else {
      (this.shiftU.value as Vector2).set(di, dj);
      this.renderer.compute(this.shiftKernel);
      this.renderer.compute(this.copyBA);
    }
    this.current = "a";
    this.renderer.compute(this.depthKernel);
  }

  /** Advance by dt real seconds (× timeScale). */
  step(dt: number): void {
    const simDt = Math.min(dt, 0.1) * this.timeScale;
    if (simDt <= 0) return;

    if (this.impPending) {
      this.renderer.compute(this.impulseKernel);
      for (const v of this.impA) v.set(0, 0, 0, 1);
      for (const v of this.impB) v.set(0, 0, 0, 0);
      this.impPending = false;
    }

    const n = Math.min(this.maxSubsteps, Math.max(1, Math.ceil(simDt / this.stableDt())));
    const sub = simDt / n;
    this.dtU.value = sub;
    this.dampMul.value = Math.exp(-this.tuning.damping * sub);
    this.fricMul.value = Math.exp(-this.tuning.friction * sub);
    this.foamMul.value = Math.exp(-this.tuning.foamDecay * sub);
    this.smoothK.value = Math.min(0.25, this.tuning.smoothing);
    this.spongeK.value = Math.min(1, 5 * sub);
    this.lastSubsteps = n;

    for (let k = 0; k < n; k++) {
      this.renderer.compute(this.current === "a" ? this.stepAB : this.stepBA);
      this.current = this.current === "a" ? "b" : "a";
    }
    if (this.current === "b") {
      this.renderer.compute(this.copyBA);
      this.current = "a";
    }

    if (this.mirrorEnabled) {
      this.mirrorAge++;
      if (!this.mirrorInFlight) {
        this.mirrorInFlight = true;
        const snapCx = this.center.x;
        const snapCz = this.center.y;
        this.renderer
          .getArrayBufferAsync(this.a.value)
          .then((ab) => {
            this.mirrorData!.set(new Float32Array(ab));
            this.mirrorCenter.set(snapCx, snapCz);
            this.mirrorFresh = true;
            this.mirrorAge = 0;
            this.mirrorInFlight = false;
          })
          .catch(() => {
            this.mirrorInFlight = false;
          });
      }
    }
  }

  /** Flatten the window (η, v, foam all to zero). */
  clear(): void {
    this.renderer.compute(this.clearAll);
    this.current = "a";
  }

  /** Re-run the depth fill pass — call after changing uniforms your
   *  DepthSpec.node closes over (e.g. a depth slider). */
  refillDepth(): void {
    this.renderer.compute(this.depthKernel);
  }

  // ---- CPU queries (mirror-backed; one or two frames stale by design) -----------

  get hasMirror(): boolean {
    return this.mirrorFresh;
  }

  private sampleMirror(x: number, z: number, channel: 0 | 1 | 2 | 3): number {
    if (!this.mirrorFresh || !this.mirrorData) return 0;
    const half = this.worldSize / 2;
    const gx = (x - this.mirrorCenter.x + half) / this.spacing;
    const gz = (z - this.mirrorCenter.y + half) / this.spacing;
    if (gx < 0 || gz < 0 || gx > this.res - 1 || gz > this.res - 1) return 0;
    const cgx = Math.min(gx, this.res - 1.001);
    const cgz = Math.min(gz, this.res - 1.001);
    const i0 = Math.floor(cgx);
    const j0 = Math.floor(cgz);
    const fx = cgx - i0;
    const fz = cgz - j0;
    const d = this.mirrorData;
    const r = j0 * this.res + i0;
    const v00 = d[r * 4 + channel];
    const v10 = d[(r + 1) * 4 + channel];
    const v01 = d[(r + this.res) * 4 + channel];
    const v11 = d[(r + this.res + 1) * 4 + channel];
    return (v00 * (1 - fx) + v10 * fx) * (1 - fz) + (v01 * (1 - fx) + v11 * fx) * fz;
  }

  /** Raw sim η at world (x, z) — deviation from ambient, fade NOT applied. */
  heightAt(x: number, z: number): number {
    return this.sampleMirror(x, z, 0);
  }

  /** fade · η — what the provider adds on top of the ambient lake. */
  offsetAt(x: number, z: number): number {
    if (!this.mirrorFresh) return 0;
    const f = this.fadeValue(x, z, this.mirrorCenter.x, this.mirrorCenter.y);
    return f <= 0 ? 0 : f * this.sampleMirror(x, z, 0);
  }

  velocityAt(x: number, z: number, target = new Vector2()): Vector2 {
    return target.set(this.sampleMirror(x, z, 1), this.sampleMirror(x, z, 2));
  }

  foamAt(x: number, z: number): number {
    return this.sampleMirror(x, z, 3);
  }

  private fadeValue(x: number, z: number, cx: number, cz: number): number {
    const half = this.worldSize / 2;
    const m = Math.max(Math.abs(x - cx), Math.abs(z - cz)) / half;
    if (m >= 1) return 0;
    const b = this.blendStartValue;
    if (m <= b) return 1;
    const t = (m - b) / Math.max(1 - b, 1e-4);
    const sm = t * t * (3 - 2 * t);
    const smooth = 1 - sm;
    const hard = this.hardEdge.value as number;
    return smooth * (1 - hard) + hard; // hard edge: 1 everywhere inside
  }

  /** Blend weight toward the ambient lake at world (x, z), current window. */
  fadeAt(x: number, z: number): number {
    return this.fadeValue(x, z, this.center.x, this.center.y);
  }

  // ---- TSL accessors (always read buffer A) ---------------------------------------

  /** Bilinear state (η, vx, vz, foam) at WORLD (x, z). Clamped at the rim. */
  fieldNode(xz: NodeV2): NodeV4 {
    const res = this.res;
    return Fn(() => {
      const half = this.worldSize / 2;
      const g = xz.sub(this.centerUniform).add(half).div(this.spacing);
      const gc = clamp(g, vec2(0), vec2(res - 1.001));
      const g0 = floor(gc);
      const f = gc.sub(g0);
      const idx = int(g0.y).mul(res).add(int(g0.x));
      const v00 = this.a.element(idx);
      const v10 = this.a.element(idx.add(1));
      const v01 = this.a.element(idx.add(res));
      const v11 = this.a.element(idx.add(res + 1));
      return mix(mix(v00, v10, f.x), mix(v01, v11, f.x), f.y);
    })() as unknown as NodeV4;
  }

  heightNode(xz: NodeV2): NodeF {
    return this.fieldNode(xz).x;
  }

  /** (∂η/∂x, ∂η/∂z) by central differences one lattice step wide. */
  slopeNode(xz: NodeV2): NodeV2 {
    const e = this.spacing;
    const hL = this.heightNode(xz.sub(vec2(e, 0)));
    const hR = this.heightNode(xz.add(vec2(e, 0)));
    const hD = this.heightNode(xz.sub(vec2(0, e)));
    const hU = this.heightNode(xz.add(vec2(0, e)));
    return vec2(hR.sub(hL), hU.sub(hD)).div(2 * e);
  }

  foamNode(xz: NodeV2): NodeF {
    return this.fieldNode(xz).w;
  }

  /** Bilinear still-water depth at world (x, z). */
  depthNode(xz: NodeV2): NodeF {
    const res = this.res;
    return Fn(() => {
      const half = this.worldSize / 2;
      const g = xz.sub(this.centerUniform).add(half).div(this.spacing);
      const gc = clamp(g, vec2(0), vec2(res - 1.001));
      const g0 = floor(gc);
      const f = gc.sub(g0);
      const idx = int(g0.y).mul(res).add(int(g0.x));
      const v00 = this.depthBuf.element(idx);
      const v10 = this.depthBuf.element(idx.add(1));
      const v01 = this.depthBuf.element(idx.add(res));
      const v11 = this.depthBuf.element(idx.add(res + 1));
      return mix(mix(v00, v10, f.x), mix(v01, v11, f.x), f.y);
    })() as unknown as NodeF;
  }

  /** The CPU fade, transcribed: 1 in the core, 0 past the window edge. */
  fadeNode(xz: NodeV2): NodeF {
    const half = this.worldSize / 2;
    const rel = xz.sub(this.centerUniform).abs().div(half);
    const m = rel.x.max(rel.y);
    const smooth = float(1).sub(smoothstep(this.blendStart, float(1), m));
    const hard = float(1).sub(smoothstep(0.995, 1.0, m));
    return mix(smooth, hard, this.hardEdge);
  }

  /** CPU depth function twin, when one was provided. */
  depthAtCpu(x: number, z: number): number | null {
    return this.depthCpu ? Math.max(0, this.depthCpu(x, z)) : null;
  }

  dispose(): void {
    this.mirrorData = null;
    this.mirrorFresh = false;
  }
}
