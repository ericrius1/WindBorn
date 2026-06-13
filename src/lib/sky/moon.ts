// The moon: a real sphere, hung along the moon direction and lit by the
// actual sun direction — which is the entire theory of lunar phases in one
// dot product (night.html walks through it). When the site's default lag of
// 12 hours puts the moon opposite the sun, the lit hemisphere faces us:
// full moon. Shrink the lag and a terminator walks across the disc, not
// because we drew a crescent, but because geometry says so.
//
// The disc is drawn ~3× its true angular size (0.26°) — the cinematic moon
// every game ships, declared rather than smuggled.

import { Color, Group, Mesh, MeshBasicNodeMaterial, SphereGeometry, Vector3 } from "three/webgpu";
import { dot, int, mix, normalWorld, normalize, positionLocal, uniform } from "three/tsl";
import { moonDirectionLagged, sunDirection } from "./palette";
import { vnoise3 } from "./noise3";

export const MOON_ANGULAR_RADIUS_DEG = 0.26;

export interface MoonOptions {
  /** Distance from the origin to hang the disc, meters (inside the dome). */
  distance?: number;
  /** Visual size multiplier over the true angular radius. */
  sizeScale?: number;
  /** Hours the moon trails the sun. 12 = full (the site default). */
  lagHours?: number;
}

export class Moon {
  readonly group = new Group();
  /** Hours behind the sun; 12 = opposite = full. Demos put a slider on it. */
  lagHours: number;

  /** Where the disc currently hangs (unit vector), for glints and readouts. */
  readonly direction = new Vector3(0, 1, 0);

  private readonly sunDir = uniform(new Vector3(0, 1, 0));
  private readonly tint = uniform(new Color(0.92, 0.93, 0.95));
  private readonly mesh: Mesh;
  private readonly geometry: SphereGeometry;
  private readonly material: MeshBasicNodeMaterial;
  private readonly distance: number;

  constructor(options: MoonOptions = {}) {
    this.distance = options.distance ?? 3300;
    const sizeScale = options.sizeScale ?? 3;
    this.lagHours = options.lagHours ?? 12;

    const radius = this.distance * Math.tan((MOON_ANGULAR_RADIUS_DEG * Math.PI) / 180) * sizeScale;
    this.geometry = new SphereGeometry(radius, 32, 20);
    this.material = new MeshBasicNodeMaterial();
    this.material.fog = false;

    // Phase = Lambert shading by the true sun direction. Earthshine keeps
    // the dark limb a breath above black, exactly as the real one floats.
    const n = normalize(normalWorld);
    const lit = dot(n, this.sunDir).clamp(0, 1);
    const day = lit.pow(0.8); // soften the terminator a touch
    // Maria: big dark basins from one octave of value noise on the sphere.
    const maria = vnoise3(positionLocal.normalize().mul(3.4), int(5)).mul(0.35).oneMinus();
    const surface = this.tint.rgb.mul(maria);
    this.material.colorNode = mix(surface.mul(0.045), surface.mul(2.4), day);

    this.mesh = new Mesh(this.geometry, this.material);
    this.group.add(this.mesh);
  }

  /** Place the disc for a clock hour and aim its lighting at the real sun. */
  update(hour: number): void {
    moonDirectionLagged(hour, this.lagHours, this.direction);
    this.group.position.copy(this.direction).multiplyScalar(this.distance);
    // A set moon is below the horizon — don't leave a disc hanging under it.
    this.group.visible = this.direction.y > -0.04;
    sunDirection(hour, this.sunDir.value);
  }

  /** Illuminated fraction of the disc, 0..1 — the textbook phase formula:
   *  k = (1 − cos α)/2 with α the sun–moon elongation. */
  litFraction(hour: number): number {
    const sun = sunDirection(hour, _sunScratch);
    moonDirectionLagged(hour, this.lagHours, _moonScratch);
    const cosA = sun.dot(_moonScratch);
    return (1 - cosA) / 2;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

const _sunScratch = new Vector3();
const _moonScratch = new Vector3();
