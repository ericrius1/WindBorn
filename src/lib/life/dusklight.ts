// A minimal golden-hour-to-dusk light rig for the Alive series. The Mirror's
// dawn sky covers 4.4–9.0; our whole season happens on the other shoulder of
// the day, so this module keys a palette across 16.0–22.0 instead. Exported
// shape matches the dawn sky (sun uniforms + skyColor(dir) + a dome) so the
// shared LakeSurface accepts either one as its environment.
//
// TODO(life): adopt src/lib/sky palette once stable — Air & Light owns the
// real atmosphere; this is a stand-in keyed to the same clock.

import {
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicNodeMaterial,
  SphereGeometry,
  Vector3,
} from "three/webgpu";
import { acos, dot, mix, normalize, positionWorld, pow, smoothstep, uniform } from "three/tsl";
import type { Node } from "three/webgpu";

type NodeV3 = Node<"vec3">;

interface DuskKey {
  hour: number;
  zenith: number;
  horizon: number;
  glow: number;
  sun: number;
  hemiGround: number;
  elevation: number; // sun elevation, degrees
  intensity: number; // HDR sun multiplier
}

// Hand-keyed palette across the evening window. Linear interpolation between
// neighbors; clamped outside.
const KEYS: DuskKey[] = [
  { hour: 16.0, zenith: 0x3f74b8, horizon: 0xc3d2e2, glow: 0xffeccc, sun: 0xfff4e0, hemiGround: 0x3c4136, elevation: 28, intensity: 3.4 },
  { hour: 18.0, zenith: 0x35619f, horizon: 0xeec488, glow: 0xffd9a0, sun: 0xffe9c2, hemiGround: 0x3e3a2e, elevation: 13, intensity: 3.0 },
  { hour: 19.2, zenith: 0x2a4a82, horizon: 0xf99e58, glow: 0xff8e4c, sun: 0xffd49c, hemiGround: 0x3a322a, elevation: 5, intensity: 2.5 },
  { hour: 19.9, zenith: 0x1f3260, horizon: 0xe66e3c, glow: 0xff7a40, sun: 0xffb070, hemiGround: 0x2e2823, elevation: 0.5, intensity: 1.5 },
  { hour: 20.6, zenith: 0x141d3d, horizon: 0x6e4a68, glow: 0xb05e54, sun: 0xff9a78, hemiGround: 0x201d1c, elevation: -4, intensity: 0.25 },
  { hour: 22.0, zenith: 0x070b18, horizon: 0x111a32, glow: 0x1a2440, sun: 0xc9d4ff, hemiGround: 0x131316, elevation: -11, intensity: 0.0 },
];

const _a = new Color();
const _b = new Color();

function lerpHex(out: Color, ha: number, hb: number, t: number): void {
  _a.setHex(ha);
  _b.setHex(hb);
  out.copy(_a).lerp(_b, t);
}

/** 0..1: how golden the light is — peaks in the last hour before sunset. */
export function goldenness(hour: number): number {
  const t = (hour - 19.3) / 1.1;
  return Math.exp(-t * t);
}

/**
 * Build the dusk light: node uniforms (sun direction/color + skyColor(dir))
 * compatible with the LakeSurface environment, `setHour(h)` to re-key
 * everything to the world clock, `makeDome()` for a BackSide sky dome, and
 * `apply(sun, hemi, fog)` to push the same palette into plain scene lights.
 */
export function createDuskLight(initialHour = 19.2) {
  const sunDirection = uniform(new Vector3(0, 0.2, 0));
  const sunColor = uniform(new Color(0));
  const zenithColor = uniform(new Color(0));
  const horizonColor = uniform(new Color(0));
  const glowColor = uniform(new Color(0));

  // CPU-side copies for plain lights, refreshed by setHour.
  const cpu = {
    sun: new Color(0),
    hemiSky: new Color(0),
    hemiGround: new Color(0),
    fog: new Color(0),
    intensity: 0,
    elevation: 0,
  };

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
    cpu.sun.copy(sunColor.value);
    sunColor.value.multiplyScalar(intensity);
    cpu.intensity = intensity;

    // Evening sun sinks over the western rim, drifting north as it sets.
    const elevation = ((a.elevation + (b.elevation - a.elevation) * t) * Math.PI) / 180;
    cpu.elevation = elevation;
    const azimuth = Math.PI - 0.4 - (h - 18) * 0.06;
    sunDirection.value.set(
      Math.cos(elevation) * Math.cos(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.sin(azimuth),
    );

    cpu.hemiSky.copy(zenithColor.value).lerp(horizonColor.value, 0.4);
    lerpHex(cpu.hemiGround, a.hemiGround, b.hemiGround, t);
    cpu.fog.copy(horizonColor.value).lerp(zenithColor.value, 0.35);
  }

  setHour(initialHour);

  function skyColor(dir: NodeV3): NodeV3 {
    const up = dir.y.clamp(0, 1);
    const base = mix(horizonColor, zenithColor, pow(up, 0.5));
    const sunAmt = dot(dir, sunDirection).clamp(0, 1);
    const glow = glowColor.mul(pow(sunAmt, 3).mul(0.4).add(pow(sunAmt, 40).mul(0.9)));
    const ang = acos(sunAmt.clamp(0, 0.99999));
    const disc = smoothstep(0.01, 0.018, ang).oneMinus();
    return base.add(glow).add(sunColor.mul(disc));
  }

  const domes: Mesh[] = [];

  function makeDome(radius = 1200): Mesh {
    const geometry = new SphereGeometry(radius, 48, 24);
    const material = new MeshBasicNodeMaterial({ side: BackSide });
    material.fog = false;
    material.colorNode = skyColor(normalize(positionWorld));
    const mesh = new Mesh(geometry, material);
    domes.push(mesh);
    return mesh;
  }

  /** Push the current palette into ordinary scene lights (and the fog). */
  function apply(sun: DirectionalLight, hemi?: HemisphereLight, fog?: Fog | null): void {
    sun.color.copy(cpu.sun);
    sun.intensity = Math.max(0.02, cpu.intensity);
    const d = sunDirection.value;
    sun.position.set(d.x * 1200, Math.max(d.y, 0.02) * 1200, d.z * 1200);
    if (hemi) {
      hemi.color.copy(cpu.hemiSky);
      hemi.groundColor.copy(cpu.hemiGround);
      hemi.intensity = 0.35 + 0.5 * Math.min(1, cpu.intensity / 3);
    }
    if (fog) fog.color.copy(cpu.fog);
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
    apply,
    dispose,
  };
}

export type DuskLight = ReturnType<typeof createDuskLight>;
