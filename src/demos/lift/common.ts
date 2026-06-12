// Shared scene scaffolding for the Lift demos: renderer boot, a dawn sky
// dome, a lake sheet whose ripples follow the spine wind, force arrows,
// wind-streak particles, a focus overlay for keyboard demos, and a trail.

import * as THREE from "three/webgpu";
import {
  color,
  cos,
  float,
  mix,
  normalize,
  positionWorld,
  sin,
  smoothstep,
  time,
  transformNormalToView,
  uniform,
  vec3,
} from "three/tsl";
import { wind } from "../../lib/spine";

// Everything that needs undoing, undone in reverse order.
export class Bin {
  private fns: (() => void)[] = [];
  add(fn: () => void): void {
    this.fns.push(fn);
  }
  dispose(): void {
    for (let i = this.fns.length - 1; i >= 0; i--) this.fns[i]();
    this.fns.length = 0;
  }
}

export async function createRenderer(canvas: HTMLCanvasElement): Promise<THREE.WebGPURenderer> {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  await renderer.init();
  return renderer;
}

export function makeCamera(canvas: HTMLCanvasElement, fov = 55): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(fov, canvas.width / canvas.height, 0.1, 2400);
}

// Dawn sky dome + sun + soft fill, and matching fog.
export function makeSky(scene: THREE.Scene, bin: Bin): void {
  const geo = new THREE.SphereGeometry(1100, 24, 14);
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.side = THREE.BackSide;
  mat.fog = false;
  const h = normalize(positionWorld).y;
  const low = mix(color(0x0c1626), color(0xd9b48c), smoothstep(float(-0.06), float(0.02), h));
  const midBand = mix(low, color(0x7d96b8), smoothstep(float(0.02), float(0.2), h));
  mat.colorNode = mix(midBand, color(0x27405e), smoothstep(float(0.18), float(0.6), h));
  const dome = new THREE.Mesh(geo, mat);
  scene.add(dome);

  scene.fog = new THREE.Fog(0x8fa3b8, 220, 1050);

  const sun = new THREE.DirectionalLight(0xffd9a0, 2.2);
  sun.position.set(-260, 110, 140);
  scene.add(sun);
  const fill = new THREE.HemisphereLight(0x9db8d6, 0x1c2230, 0.85);
  scene.add(fill);

  bin.add(() => {
    geo.dispose();
    mat.dispose();
  });
}

// The lake: a flat sheet at y = 0 whose shading normal is perturbed by two
// wave trains steered by the spine wind. Call update() each frame so the
// ripple direction and amplitude keep agreeing with the gusts the bird
// rides — one wind field, one weather.
// TODO(lift): swap in The Mirror's surface material once src/lib/water ships.
export interface WaterSheet {
  mesh: THREE.Mesh;
  update(): void;
}

export function makeWater(scene: THREE.Scene, bin: Bin, size = 2200): WaterSheet {
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = color(0x12304e);
  mat.roughnessNode = float(0.16);
  mat.metalnessNode = float(0.05);

  const uDir = uniform(wind.direction);
  const uAmp = uniform(0.04);
  const px = positionWorld.x;
  const pz = positionWorld.z;

  const d1x = cos(uDir);
  const d1z = sin(uDir);
  const d2x = cos(uDir.add(0.8));
  const d2z = sin(uDir.add(0.8));
  const k1 = float((Math.PI * 2) / 3.1);
  const k2 = float((Math.PI * 2) / 1.3);
  const ph1 = px.mul(d1x).add(pz.mul(d1z)).mul(k1).add(time.mul(2.1));
  const ph2 = px.mul(d2x).add(pz.mul(d2z)).mul(k2).add(time.mul(3.4));
  const sx = cos(ph1).mul(uAmp).mul(k1).mul(d1x).add(cos(ph2).mul(uAmp).mul(0.55).mul(k2).mul(d2x));
  const sz = cos(ph1).mul(uAmp).mul(k1).mul(d1z).add(cos(ph2).mul(uAmp).mul(0.55).mul(k2).mul(d2z));
  mat.normalNode = transformNormalToView(normalize(vec3(sx.negate(), 1, sz.negate())));

  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  bin.add(() => {
    geo.dispose();
    mat.dispose();
  });

  return {
    mesh,
    update() {
      uDir.value = wind.direction;
      uAmp.value = 0.012 + wind.speed * 0.007;
    },
  };
}

// A solid 3D arrow for force vectors (screen lines are too thin to read).
export class VectorArrow {
  readonly group = new THREE.Group();
  private readonly shaft: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly geos: THREE.BufferGeometry[];
  private readonly mat: THREE.MeshBasicNodeMaterial;
  private readonly q = new THREE.Quaternion();
  private static readonly Y = new THREE.Vector3(0, 1, 0);
  private readonly dir = new THREE.Vector3();

  constructor(hex: number, radius = 0.035) {
    this.mat = new THREE.MeshBasicNodeMaterial();
    this.mat.colorNode = color(hex);
    const shaftGeo = new THREE.CylinderGeometry(radius, radius, 1, 6);
    shaftGeo.translate(0, 0.5, 0);
    const headGeo = new THREE.ConeGeometry(radius * 2.6, radius * 8, 8);
    this.geos = [shaftGeo, headGeo];
    this.shaft = new THREE.Mesh(shaftGeo, this.mat);
    this.head = new THREE.Mesh(headGeo, this.mat);
    this.group.add(this.shaft, this.head);
  }

  set(origin: THREE.Vector3, vec: THREE.Vector3, scale: number): void {
    const len = vec.length() * scale;
    if (len < 0.08) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.group.position.copy(origin);
    this.dir.copy(vec).normalize();
    this.q.setFromUnitVectors(VectorArrow.Y, this.dir);
    this.group.quaternion.copy(this.q);
    const headLen = Math.min(0.3, len * 0.4);
    this.shaft.scale.set(1, len - headLen, 1);
    this.head.position.y = len - headLen * 0.5;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.mat.dispose();
  }
}

// A breadcrumb line behind the bird.
export class Trail {
  readonly line: THREE.Line;
  private readonly positions: Float32Array;
  private count = 0;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.LineBasicMaterial;

  constructor(private readonly capacity = 240, hex = 0x7aa2ff) {
    this.positions = new Float32Array(capacity * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.5 });
    this.line = new THREE.Line(this.geo, this.mat);
    this.line.frustumCulled = false;
  }

  push(p: THREE.Vector3): void {
    if (this.count === this.capacity) {
      this.positions.copyWithin(0, 3);
      this.count--;
    }
    this.positions.set([p.x, p.y, p.z], this.count * 3);
    this.count++;
    this.geo.setDrawRange(0, this.count);
    this.geo.attributes.position.needsUpdate = true;
  }

  reset(): void {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// Short line segments advected by the spine wind — the air, made visible.
// Each streak is colored by its vertical velocity: lift glows green, sink
// runs amber, level flow stays a quiet blue.
export class WindStreaks {
  readonly lines: THREE.LineSegments;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly particles: Float32Array; // x,y,z,life per particle
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.LineBasicMaterial;
  private readonly v = new THREE.Vector3();

  constructor(
    private readonly count: number,
    private readonly min: THREE.Vector3,
    private readonly max: THREE.Vector3,
    private readonly floor: ((x: number, z: number) => number) | null = null,
  ) {
    this.particles = new Float32Array(count * 4);
    this.pos = new Float32Array(count * 6);
    this.col = new Float32Array(count * 6);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6 });
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
    for (let i = 0; i < count; i++) this.respawn(i, true);
  }

  private respawn(i: number, anywhere: boolean): void {
    const p = this.particles;
    p[i * 4] = this.min.x + Math.random() * (this.max.x - this.min.x);
    p[i * 4 + 1] = this.min.y + Math.random() * (this.max.y - this.min.y);
    p[i * 4 + 2] = this.min.z + Math.random() * (this.max.z - this.min.z);
    p[i * 4 + 3] = (anywhere ? Math.random() : 1) * (2.5 + Math.random() * 2.5);
    if (this.floor) {
      const g = this.floor(p[i * 4], p[i * 4 + 2]);
      if (p[i * 4 + 1] < g + 0.5) p[i * 4 + 1] = g + 0.5 + Math.random() * 10;
    }
  }

  update(dt: number, t: number): void {
    const p = this.particles;
    for (let i = 0; i < this.count; i++) {
      wind.sample(p[i * 4], p[i * 4 + 1], p[i * 4 + 2], t, this.v);
      p[i * 4] += this.v.x * dt;
      p[i * 4 + 1] += this.v.y * dt;
      p[i * 4 + 2] += this.v.z * dt;
      p[i * 4 + 3] -= dt;
      const out =
        p[i * 4] < this.min.x ||
        p[i * 4] > this.max.x ||
        p[i * 4 + 2] < this.min.z ||
        p[i * 4 + 2] > this.max.z ||
        p[i * 4 + 1] < 0.2 ||
        p[i * 4 + 1] > this.max.y + 30 ||
        (this.floor !== null && p[i * 4 + 1] < this.floor(p[i * 4], p[i * 4 + 2]) + 0.3);
      if (p[i * 4 + 3] <= 0 || out) this.respawn(i, false);

      // streak from tail to head along the local wind
      const sx = this.v.x * 0.22;
      const sy = this.v.y * 0.22;
      const sz = this.v.z * 0.22;
      this.pos[i * 6] = p[i * 4] - sx;
      this.pos[i * 6 + 1] = p[i * 4 + 1] - sy;
      this.pos[i * 6 + 2] = p[i * 4 + 2] - sz;
      this.pos[i * 6 + 3] = p[i * 4];
      this.pos[i * 6 + 4] = p[i * 4 + 1];
      this.pos[i * 6 + 5] = p[i * 4 + 2];

      // color by vertical motion
      const up = Math.max(-1, Math.min(1, this.v.y / 2.5));
      const r = up > 0 ? 0.45 - 0.25 * up : 0.45 + 0.5 * -up;
      const g = up > 0 ? 0.62 + 0.35 * up : 0.62 - 0.15 * -up;
      const b = up > 0 ? 0.85 - 0.4 * up : 0.85 - 0.45 * -up;
      for (const o of [0, 3]) {
        this.col[i * 6 + o] = r;
        this.col[i * 6 + o + 1] = g;
        this.col[i * 6 + o + 2] = b;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// Keyboard-focus UX for interactive canvases: click to take the controls,
// with an on-screen hint while unfocused.
export class FocusOverlay {
  readonly wrapper: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly onFocus = (): void => this.sync(true);
  private readonly onBlur = (): void => this.sync(false);
  private readonly onPointer = (): void => this.canvas.focus();
  private _focused = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    hint: string,
    private readonly interactive = true,
  ) {
    this.wrapper = document.createElement("div");
    this.wrapper.style.position = "relative";
    canvas.parentElement?.insertBefore(this.wrapper, canvas);
    this.wrapper.appendChild(canvas);
    if (interactive) {
      canvas.tabIndex = 0;
      canvas.style.outline = "none";
      canvas.style.cursor = "pointer";
    }

    this.prompt = document.createElement("div");
    this.prompt.style.cssText =
      "position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;";
    const pill = document.createElement("span");
    pill.textContent = "Click to take the controls";
    pill.style.cssText =
      "padding:.5rem 1.1rem;border-radius:999px;border:1px solid rgba(122,162,255,.5);" +
      "background:rgba(10,11,16,.72);color:#d7dbe6;font:600 .82rem ui-sans-serif,system-ui,sans-serif;" +
      "letter-spacing:.06em;";
    this.prompt.appendChild(pill);
    this.wrapper.appendChild(this.prompt);

    if (!interactive) this.prompt.style.display = "none";

    this.bar = document.createElement("div");
    this.bar.textContent = hint;
    if (!hint) this.bar.style.display = "none";
    this.bar.style.cssText =
      "position:absolute;left:50%;bottom:.6rem;transform:translateX(-50%);max-width:94%;" +
      "padding:.28rem .8rem;border-radius:999px;background:rgba(10,11,16,.66);color:#aab4d4;" +
      "font:600 .68rem ui-monospace,Menlo,monospace;white-space:nowrap;overflow:hidden;" +
      "text-overflow:ellipsis;pointer-events:none;transition:opacity .3s;";
    this.wrapper.appendChild(this.bar);

    if (interactive) {
      canvas.addEventListener("focus", this.onFocus);
      canvas.addEventListener("blur", this.onBlur);
      canvas.addEventListener("pointerdown", this.onPointer);
    }
    this.sync(false);
  }

  private sync(focused: boolean): void {
    this._focused = focused;
    this.prompt.style.opacity = focused ? "0" : "1";
    this.bar.style.opacity = focused ? "0.85" : "0.45";
  }

  get focused(): boolean {
    return this._focused;
  }

  // A positioned HUD element living over the canvas.
  panel(css: string): HTMLDivElement {
    const div = document.createElement("div");
    div.style.cssText = `position:absolute;pointer-events:none;${css}`;
    this.wrapper.appendChild(div);
    return div;
  }

  dispose(): void {
    if (!this.interactive) return;
    this.canvas.removeEventListener("focus", this.onFocus);
    this.canvas.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("pointerdown", this.onPointer);
  }
}
