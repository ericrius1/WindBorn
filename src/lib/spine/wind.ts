// One wind field for the whole world. Flight lift, water ripples, drifting
// clouds, swaying grass, and the whoosh in your ears all sample this one
// function — which is why they all agree about the weather.
//
// The base field is a steady vector plus smooth gusts from value noise.
// Systems with spatial knowledge (ridge lift over slopes, thermals over warm
// scree) register influences on top.

import { Vector3 } from "three";

export type WindInfluence = (x: number, y: number, z: number, t: number, out: Vector3) => void;

// Cheap smooth value noise, hashed on integer lattice points.
function hash(ix: number, iy: number, iz: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 1440662683) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = (h * 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function vnoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
  let v = 0;
  for (let dz = 0; dz <= 1; dz++)
    for (let dy = 0; dy <= 1; dy++)
      for (let dx = 0; dx <= 1; dx++) {
        const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
        v += w * hash(ix + dx, iy + dy, iz + dz);
      }
  return v * 2 - 1; // -1..1
}

export class WindField {
  // Direction the wind blows TOWARD, in radians around +y (0 = +x).
  direction = 0.6;
  // Mean speed in m/s at reference height.
  speed = 3;
  // 0 = laminar, 1 = very gusty.
  gustiness = 0.45;
  // Spatial scale of gusts in meters.
  gustScale = 60;

  private influences: WindInfluence[] = [];
  private tmp = new Vector3();

  // Register extra wind (ridge lift, thermals). Returns an unsubscribe.
  addInfluence(fn: WindInfluence): () => void {
    this.influences.push(fn);
    return () => {
      const i = this.influences.indexOf(fn);
      if (i >= 0) this.influences.splice(i, 1);
    };
  }

  sample(x: number, y: number, z: number, t: number, target = new Vector3()): Vector3 {
    const s = 1 / this.gustScale;
    const gust = 1 + this.gustiness * vnoise(x * s + t * 0.11, y * s * 2, z * s - t * 0.07);
    const swirl = this.gustiness * 0.5 * vnoise(z * s + t * 0.13, 7.3, x * s + t * 0.05);
    const dir = this.direction + swirl;
    const v = this.speed * Math.max(0, gust);
    target.set(Math.cos(dir) * v, 0, Math.sin(dir) * v);
    for (const fn of this.influences) {
      this.tmp.set(0, 0, 0);
      fn(x, y, z, t, this.tmp);
      target.add(this.tmp);
    }
    return target;
  }
}

export const wind = new WindField();
