// A minimal dawn sky for The Mirror's scenes: a two-color gradient dome, a
// sun with a halo, and a palette keyed to the world clock's hour. The water
// needs *something* believable to reflect; this is that something.
//
// TODO(sky): Air & Light replaces this with the real atmosphere model. Keep
// the exported shape (uniforms + skyColor(dir)) so the lake doesn't notice.

import { BackSide, Color, Mesh, MeshBasicNodeMaterial, SphereGeometry, Vector3 } from "three/webgpu";
import { acos, dot, mix, normalize, positionWorld, pow, smoothstep, uniform } from "three/tsl";
import type { Node } from "three/webgpu";

type NodeV3 = Node<"vec3">;

interface DawnKey {
  hour: number;
  zenith: number; // hex colors
  horizon: number;
  glow: number;
  sun: number;
  elevation: number; // sun elevation, degrees
  intensity: number; // HDR sun intensity multiplier
}

// Hand-keyed palette across the dawn window. Linear interpolation between
// neighbors; clamped outside.
const KEYS: DawnKey[] = [
  { hour: 4.4, zenith: 0x060a18, horizon: 0x0e1428, glow: 0x182240, sun: 0xffd9b0, elevation: -9, intensity: 0.0 },
  { hour: 5.3, zenith: 0x0b1330, horizon: 0x383052, glow: 0x8a4a44, sun: 0xffc890, elevation: -3.5, intensity: 0.3 },
  { hour: 6.1, zenith: 0x1b2c55, horizon: 0xe08a5a, glow: 0xff9650, sun: 0xffd2a0, elevation: 1.5, intensity: 2.6 },
  { hour: 7.0, zenith: 0x2b4d88, horizon: 0xd8b48a, glow: 0xffc98a, sun: 0xfff0d0, elevation: 11, intensity: 3.2 },
  { hour: 9.0, zenith: 0x3b6fc0, horizon: 0xaac4e0, glow: 0xffe9c0, sun: 0xfff8ea, elevation: 33, intensity: 3.6 },
];

const _a = new Color();
const _b = new Color();

function lerpHex(out: Color, ha: number, hb: number, t: number): void {
  _a.setHex(ha);
  _b.setHex(hb);
  out.copy(_a).lerp(_b, t);
}

/**
 * Build the dawn sky: uniforms (sun direction/color, gradient colors), the
 * `skyColor(dir)` radiance node, `setHour(h)` to re-key everything to the
 * world clock (4.4–9 is the dawn window), and `makeDome()` for a BackSide
 * dome mesh shaded by skyColor.
 */
export function createDawnSky(initialHour = 6.1) {
  const sunDirection = uniform(new Vector3(0, 0.1, 0));
  const sunColor = uniform(new Color(0));
  const zenithColor = uniform(new Color(0));
  const horizonColor = uniform(new Color(0));
  const glowColor = uniform(new Color(0));

  // Sun azimuth: fixed over the eastern ridge, drifting slightly south as
  // the morning goes on.
  function setHour(hour: number): void {
    const h = Math.min(Math.max(hour, KEYS[0].hour), KEYS[KEYS.length - 1].hour);
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].hour < h) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = (h - a.hour) / (b.hour - a.hour);

    lerpHex(zenithColor.value, a.zenith, b.zenith, t);
    lerpHex(horizonColor.value, a.horizon, b.horizon, t);
    lerpHex(glowColor.value, a.glow, b.glow, t);

    const intensity = a.intensity + (b.intensity - a.intensity) * t;
    lerpHex(sunColor.value, a.sun, b.sun, t);
    sunColor.value.multiplyScalar(intensity);

    const elevation = ((a.elevation + (b.elevation - a.elevation) * t) * Math.PI) / 180;
    const azimuth = 0.55 + (h - 6) * 0.05;
    sunDirection.value.set(
      Math.cos(elevation) * Math.cos(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.sin(azimuth),
    );
  }

  setHour(initialHour);

  function skyColor(dir: NodeV3): NodeV3 {
    const up = dir.y.clamp(0, 1);
    // Horizon-to-zenith gradient; the 0.45 power holds the warm band low.
    const base = mix(horizonColor, zenithColor, pow(up, 0.45));
    const sunAmt = dot(dir, sunDirection).clamp(0, 1);
    // Wide warm glow around the sun + a tighter halo.
    const glow = glowColor.mul(pow(sunAmt, 4).mul(0.35).add(pow(sunAmt, 48).mul(0.85)));
    // The disc itself, by angle (acos is fine at this precision for a ~0.7° disc).
    const ang = acos(sunAmt.clamp(0, 0.99999));
    const disc = smoothstep(0.016, 0.009, ang);
    return base.add(glow).add(sunColor.mul(disc));
  }

  const domes: Mesh[] = [];

  function makeDome(radius = 900): Mesh {
    const geometry = new SphereGeometry(radius, 48, 24);
    const material = new MeshBasicNodeMaterial({ side: BackSide });
    material.colorNode = skyColor(normalize(positionWorld));
    const mesh = new Mesh(geometry, material);
    domes.push(mesh);
    return mesh;
  }

  function dispose(): void {
    for (const d of domes) {
      d.geometry.dispose();
      (d.material as MeshBasicNodeMaterial).dispose();
    }
    domes.length = 0;
  }

  return {
    sunDirection,
    sunColor,
    zenithColor,
    horizonColor,
    glowColor,
    skyColor,
    setHour,
    makeDome,
    dispose,
  };
}

export type DawnSky = ReturnType<typeof createDawnSky>;
