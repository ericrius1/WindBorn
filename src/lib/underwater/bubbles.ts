// Bubble columns — the lake's exhale after an impact.
//
// A strike drives air below the surface; buoyancy hands it back as a column
// of bubbles over the next couple of seconds. Each bubble is honest physics
// at cartoon scale: a millimeter-class sphere rising at its terminal speed
// (drag balances buoyancy almost instantly at this size), wobbling from the
// vortices it sheds, growing slightly as the pressure above it shrinks
// (Boyle: r ∝ P^(-1/3)), and popping when it reaches the surface.
//
// The plume listens on the disturbance bus, so any splash anywhere — the
// osprey, a fish, a button in a demo — grows a column without knowing we
// exist. TODO(under): couple to src/lib/fluid once stable, so columns spawn
// from the sim's real entrained-air estimate instead of the event energy.

import {
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  SphereGeometry,
} from "three/webgpu";
import { cameraPosition, color, mix, normalWorld, normalize, positionWorld } from "three/tsl";
import { onDisturbance, waterHeightAt } from "../spine";

interface Bubble {
  x: number;
  y: number;
  z: number;
  r0: number; // radius at birth, meters
  d0: number; // depth at birth, meters
  phase: number;
  age: number;
}

interface Source {
  x: number;
  z: number;
  depth: number;
  remaining: number;
  rate: number; // bubbles per second
  carry: number;
}

const ATM = 10.3; // one atmosphere expressed as meters of water

export class BubblePlume {
  readonly mesh: InstancedMesh;

  private geometry: SphereGeometry;
  private material: MeshBasicNodeMaterial;
  private live: Bubble[] = [];
  private sources: Source[] = [];
  private mat = new Matrix4();
  private unsub: (() => void) | null = null;

  constructor(readonly capacity = 220) {
    this.geometry = new SphereGeometry(1, 8, 6);
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    this.material = material;
    // A bubble is a tiny mirror ball of its surroundings: bright rim where
    // the view grazes it, water-colored through the middle.
    const view = normalize(cameraPosition.sub(positionWorld));
    const rim = normalWorld.dot(view).abs().oneMinus().clamp(0, 1);
    material.colorNode = mix(color(0x16323e), color(0xcfeaf2), rim.pow(1.6));
    material.opacityNode = rim.pow(1.4).mul(0.62).add(0.16);

    this.mesh = new InstancedMesh(this.geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  /** Subscribe to the disturbance bus: splashes and rises grow columns. */
  attachToBus(minEnergy = 0.02): void {
    this.unsub ??= onDisturbance((d) => {
      if ((d.kind === "splash" || d.kind === "rise") && d.energy >= minEnergy) {
        this.burst(d.x, d.z, d.energy);
      }
    });
  }

  /** Start a column: `energy` is the bus's joule-ish scalar (strike ≈ 1). */
  burst(x: number, z: number, energy: number): void {
    const e = Math.max(0.01, Math.min(energy, 1.5));
    this.sources.push({
      x,
      z,
      depth: 0.5 + e * 1.6,
      remaining: Math.round(10 + e * 90),
      rate: (10 + e * 90) / 1.7,
      carry: 0,
    });
  }

  private spawn(s: Source): void {
    if (this.live.length >= this.capacity) return;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.16 * Math.sqrt(s.depth);
    const depth = s.depth * (0.35 + 0.65 * Math.random());
    this.live.push({
      x: s.x + Math.cos(a) * r,
      z: s.z + Math.sin(a) * r,
      y: -depth,
      r0: 0.004 + Math.random() * 0.011,
      d0: depth,
      phase: Math.random() * Math.PI * 2,
      age: 0,
    });
  }

  update(dt: number, t: number): void {
    // sources trickle bubbles out over ~2 s — that's what makes a column
    for (let i = this.sources.length - 1; i >= 0; i--) {
      const s = this.sources[i];
      s.carry += s.rate * dt;
      while (s.carry >= 1 && s.remaining > 0) {
        s.carry -= 1;
        s.remaining -= 1;
        this.spawn(s);
      }
      if (s.remaining <= 0) this.sources.splice(i, 1);
    }

    // physics pass (reverse, so splicing the popped ones is safe) …
    for (let i = this.live.length - 1; i >= 0; i--) {
      const b = this.live[i];
      b.age += dt;
      const depth = Math.max(0, -b.y);
      // Terminal rise speed: drag balances buoyancy within milliseconds at
      // this size, so we never integrate the transient.
      const vt = 0.18 + b.r0 * Math.cbrt((b.d0 + ATM) / (depth + ATM)) * 14;
      b.y += vt * dt;
      // wobble: the path a shed vortex street writes
      b.x += Math.sin(t * 5.1 + b.phase) * 0.05 * dt;
      b.z += Math.cos(t * 4.3 + b.phase * 1.7) * 0.05 * dt;
      if (b.y > waterHeightAt(b.x, b.z, t) - b.r0) this.live.splice(i, 1); // pop
    }
    // … then a clean matrix write for the survivors (indices are now final)
    for (let i = 0; i < this.live.length; i++) {
      const b = this.live[i];
      // Boyle's law: the air expands as the water above it thins.
      const radius = b.r0 * Math.cbrt((b.d0 + ATM) / (Math.max(0, -b.y) + ATM));
      this.mat.makeScale(radius, radius, radius);
      this.mat.setPosition(b.x, b.y, b.z);
      this.mesh.setMatrixAt(i, this.mat);
    }
    this.mesh.count = this.live.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Live bubble count, for readouts. */
  get count(): number {
    return this.live.length;
  }

  clear(): void {
    this.live.length = 0;
    this.sources.length = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.unsub?.();
    this.unsub = null;
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
