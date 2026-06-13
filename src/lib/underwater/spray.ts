// Water streaming off the bird — the breach's signature.
//
// A wet osprey climbing out of the lake sheds water for a second or two:
// sheets break into drops, drops fly ballistic, drops hit the lake. Each
// droplet here is a tiny instanced sphere with gravity and an expiry; the
// emitter samples points around a moving body and launches them with the
// body's velocity plus a shake term. Drops that reach the water report a
// tiny "rain" disturbance now and then, so the bus hears the patter too.
//
// TODO(under): couple to src/lib/fluid once stable — the crown splash's
// spray (The Splash series) and this shedding spray should share one system.

import {
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  SphereGeometry,
  Vector3,
} from "three/webgpu";
import { cameraPosition, color, mix, normalWorld, normalize, positionWorld } from "three/tsl";
import { disturb, waterHeightAt } from "../spine";

interface Drop {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  age: number;
  life: number;
}

export class Spray {
  readonly mesh: InstancedMesh;

  /** Probability that a drop landing on the lake pings the bus. */
  reportChance = 0.06;

  private geometry: SphereGeometry;
  private material: MeshBasicNodeMaterial;
  private live: Drop[] = [];
  private mat = new Matrix4();
  private carry = 0;

  constructor(readonly capacity = 320) {
    this.geometry = new SphereGeometry(1, 6, 5);
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    this.material = material;
    const view = normalize(cameraPosition.sub(positionWorld));
    const rim = normalWorld.dot(view).abs().oneMinus().clamp(0, 1);
    material.colorNode = mix(color(0xbcd8e2), color(0xf4fbff), rim);
    material.opacityNode = rim.mul(0.5).add(0.42);

    this.mesh = new InstancedMesh(this.geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  /**
   * Shed drops from a body this frame. `center`/`velocity` describe the
   * body; `rate` is drops per second; `spread` the body's rough radius;
   * `kick` extra random speed (a wing-shake cranks this up).
   */
  emit(center: Vector3, velocity: Vector3, rate: number, dt: number, spread = 0.28, kick = 0.7): void {
    this.carry += rate * dt;
    while (this.carry >= 1) {
      this.carry -= 1;
      if (this.live.length >= this.capacity) return;
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const s = Math.sqrt(1 - u * u);
      this.live.push({
        x: center.x + s * Math.cos(a) * spread,
        y: center.y + u * spread * 0.7,
        z: center.z + s * Math.sin(a) * spread,
        vx: velocity.x * 0.75 + (Math.random() - 0.5) * 2 * kick,
        vy: velocity.y * 0.6 + Math.random() * 0.5 * kick,
        vz: velocity.z * 0.75 + (Math.random() - 0.5) * 2 * kick,
        r: 0.006 + Math.random() * 0.012,
        age: 0,
        life: 0.6 + Math.random() * 0.8,
      });
    }
  }

  update(dt: number, t: number): void {
    // physics pass (reverse, so splicing dead drops is safe) …
    for (let i = this.live.length - 1; i >= 0; i--) {
      const d = this.live[i];
      d.age += dt;
      d.vy -= 9.81 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      const water = waterHeightAt(d.x, d.z, t);
      if (d.age > d.life || d.y <= water) {
        if (d.y <= water && Math.random() < this.reportChance) {
          disturb({ kind: "rain", x: d.x, z: d.z, energy: 0.0015, radius: 0.05 });
        }
        this.live.splice(i, 1);
      }
    }
    // … then a clean matrix write for the survivors (indices are now final)
    for (let i = 0; i < this.live.length; i++) {
      const d = this.live[i];
      // Fast drops stretch along their velocity — cheap motion smear: scale
      // the sphere anisotropically in y by the fall speed.
      const stretch = 1 + Math.min(2.2, Math.abs(d.vy) * 0.22);
      this.mat.makeScale(d.r, d.r * stretch, d.r);
      this.mat.setPosition(d.x, d.y, d.z);
      this.mesh.setMatrixAt(i, this.mat);
    }
    this.mesh.count = this.live.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  get count(): number {
    return this.live.length;
  }

  clear(): void {
    this.live.length = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
