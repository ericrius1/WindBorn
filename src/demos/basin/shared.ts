// Shared plumbing for every Basin demo: renderer + scene setup, a gradient
// sky, alpine lighting, a calm water plane at y = 0, flat grid geometry for
// GPU-displaced terrain, an orbit rig, and dispose bookkeeping. Demos stay
// focused on the one idea they teach.

import {
  ACESFilmicToneMapping,
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardNodeMaterial,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  WebGPURenderer,
  BufferGeometry,
  BufferAttribute,
} from "three/webgpu";
import type { Node } from "three/webgpu";
import {
  color,
  float,
  mix,
  normalize,
  normalWorld,
  positionLocal,
  positionWorld,
  smoothstep,
  transformNormalToView,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import { Shell, type Demo } from "../../lib/demoShell";

type NodeF = Node<"float">;
type NodeV2 = Node<"vec2">;
type NodeV3 = Node<"vec3">;

// ---- kit ------------------------------------------------------------------------

export interface KitOptions {
  aspect?: number;
  /** Fog distances; pass null for no fog. Default [900, 4200]. */
  fog?: [number, number] | null;
  /** Camera far plane. Default 12000. */
  far?: number;
  fov?: number;
  sky?: boolean;
}

export class Kit {
  readonly shell: Shell;
  readonly renderer: WebGPURenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly sun: DirectionalLight;

  private disposables: Array<{ dispose(): void }> = [];
  private last = performance.now();

  constructor(renderer: WebGPURenderer, shell: Shell, opts: KitOptions) {
    this.shell = shell;
    this.renderer = renderer;

    const canvas = shell.canvas;
    this.camera = new PerspectiveCamera(
      opts.fov ?? 50,
      canvas.width / Math.max(1, canvas.height),
      0.5,
      opts.far ?? 12000,
    );

    if (opts.fog !== null) {
      const [near, far] = opts.fog ?? [900, 4200];
      this.scene.fog = new Fog(new Color("#b7c6d8"), near, far);
    }

    // Alpine light: one warm sun, one cool sky fill.
    this.sun = new DirectionalLight(new Color("#fff2dd"), 2.6);
    this.sun.position.set(1100, 950, 500);
    this.scene.add(this.sun);
    const hemi = new HemisphereLight(new Color("#9db8d9"), new Color("#3c4136"), 0.85);
    this.scene.add(hemi);

    if (opts.sky !== false) this.scene.add(this.makeSky());
  }

  /** Register anything with a dispose() for teardown. Returns it back. */
  track<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing);
    return thing;
  }

  /** Wrap a per-frame callback into the site's Demo contract. */
  start(frame: (dt: number, t: number) => void): Demo {
    const t0 = performance.now();
    return {
      frame: () => {
        const now = performance.now();
        const dt = Math.min(0.1, (now - this.last) / 1000);
        this.last = now;
        frame(dt, (now - t0) / 1000);
        this.renderer.render(this.scene, this.camera);
        this.shell.tick();
      },
      dispose: () => {
        for (const d of this.disposables) d.dispose();
        this.disposables = [];
        this.renderer.dispose();
      },
    };
  }

  private makeSky(): Mesh {
    const geo = this.trackGeo(new SphereGeometry(7500, 24, 12));
    const mat = this.track(new MeshBasicNodeMaterial());
    mat.side = BackSide;
    mat.fog = false;
    const h = positionLocal.y.div(7500);
    const low = mix(color("#cfdde9"), color("#7fa3cc"), smoothstep(-0.02, 0.22, h));
    mat.colorNode = mix(low, color("#39618f"), smoothstep(0.22, 0.75, h));
    return new Mesh(geo, mat);
  }

  trackGeo<T extends BufferGeometry>(geo: T): T {
    this.disposables.push(geo);
    return geo;
  }
}

/**
 * Standard demo bootstrap. Returns null when WebGPU is missing — callers
 * fall back to gpuMissing(el).
 */
export async function makeKit(el: HTMLElement, opts: KitOptions = {}): Promise<Kit | null> {
  if (!navigator.gpu) return null;
  const shell = new Shell(el, opts.aspect ?? 0.62);
  const renderer = new WebGPURenderer({ canvas: shell.canvas, antialias: true });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(shell.canvas.width, shell.canvas.height, false);
  renderer.toneMapping = ACESFilmicToneMapping;
  return new Kit(renderer, shell, opts);
}

// ---- flat grid for GPU displacement ----------------------------------------------

/**
 * A flat XZ grid centered on (cx, cz): plain position attribute in world
 * meters, unit normals up. Heights come from the material's positionNode.
 */
export function makeGridGeometry(size: number, segments: number, cx = 0, cz = 0): BufferGeometry {
  const n = segments;
  const verts = (n + 1) * (n + 1);
  const positions = new Float32Array(verts * 3);
  const normals = new Float32Array(verts * 3);
  let p = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      positions[p] = cx + (i / n - 0.5) * size;
      positions[p + 1] = 0;
      positions[p + 2] = cz + (j / n - 0.5) * size;
      normals[p + 1] = 1;
      p += 3;
    }
  }
  const tris = new Uint32Array(n * n * 6);
  let q = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + n + 2;
      const d = a + n + 1;
      tris[q++] = a;
      tris[q++] = c;
      tris[q++] = b;
      tris[q++] = a;
      tris[q++] = d;
      tris[q++] = c;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("normal", new BufferAttribute(normals, 3));
  geo.setIndex(new BufferAttribute(tris, 1));
  return geo;
}

export interface DisplaceOptions {
  /** Height of the surface at world (x, z) — a TSL builder. */
  height: (xz: NodeV2) => NodeF;
  /** FD step for the analytic normal, meters. Default 2. */
  eps?: number;
  /** Fragment-stage color from displaced world position + normal. */
  makeColor?: (args: { world: NodeV3; normal: NodeV3 }) => NodeV3;
  roughness?: number;
}

/**
 * A standard-lit material whose vertices ride `height`. The normal is
 * derived from the same height function (four taps, vertex stage).
 */
export function makeDisplacedMaterial(opts: DisplaceOptions): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  const xz = positionLocal.xz;
  const h = opts.height(xz);
  material.positionNode = vec3(xz.x, h, xz.y);

  const e = float(opts.eps ?? 2);
  const hL = opts.height(xz.sub(vec2(e, 0)));
  const hR = opts.height(xz.add(vec2(e, 0)));
  const hD = opts.height(xz.sub(vec2(0, e)));
  const hU = opts.height(xz.add(vec2(0, e)));
  const vNormal = varying(normalize(vec3(hL.sub(hR), e.mul(2), hD.sub(hU))));
  material.normalNode = transformNormalToView(vNormal.normalize());

  if (opts.makeColor) {
    // positionWorld/normalWorld are pipeline varyings of the displaced mesh
    material.colorNode = opts.makeColor({ world: positionWorld, normal: normalWorld });
  } else {
    material.colorNode = vec3(0.55, 0.56, 0.58);
  }
  material.roughnessNode = float(opts.roughness ?? 0.95);
  material.metalnessNode = float(0);
  return material;
}

/**
 * The Basin's pre-paint look: a quiet elevation tint used by the Cirque and
 * Far Shore posts, before the Treeline post earns the real materials.
 */
export function elevationTint(world: NodeV3, normal: NodeV3): NodeV3 {
  const y = world.y;
  const up = normal.y;
  // underwater slate → shore gravel → rock that pales with altitude → snow
  let c: NodeV3 = mix(color("#2b3438"), color("#8c8674"), smoothstep(-3, 1.5, y));
  c = mix(c, color("#6f6d68"), smoothstep(2, 120, y));
  c = mix(c, color("#8f8e8c"), smoothstep(120, 380, y));
  c = mix(c, color("#e9edf3"), smoothstep(360, 470, y).mul(smoothstep(0.5, 0.72, up)));
  // cliffs stay dark
  return mix(c, color("#4d4b47"), smoothstep(0.45, 0.7, float(1).sub(up)).mul(0.5));
}

// ---- water -----------------------------------------------------------------------

/** A calm, slightly transparent lake sheet at y = 0. */
export function makeWater(kit: Kit, size = 6000, opacity = 0.86): Mesh {
  const geo = kit.trackGeo(new PlaneGeometry(size, size));
  geo.rotateX(-Math.PI / 2);
  const mat = kit.track(new MeshStandardNodeMaterial());
  mat.transparent = true;
  mat.opacity = opacity;
  mat.colorNode = color("#15303d");
  mat.roughnessNode = float(0.08);
  mat.metalnessNode = float(0);
  const water = new Mesh(geo, mat);
  water.position.y = 0;
  return water;
}

// ---- camera rigs ------------------------------------------------------------------

export interface OrbitOptions {
  target?: Vector3;
  radius?: number;
  azimuth?: number;
  /** Elevation above the horizon, radians. */
  polar?: number;
  /** Radians/second of idle spin (stops while dragging). */
  autoSpin?: number;
  minPolar?: number;
  maxPolar?: number;
}

export class OrbitRig {
  target: Vector3;
  radius: number;
  azimuth: number;
  polar: number;
  autoSpin: number;
  private minPolar: number;
  private maxPolar: number;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private idle = 0;
  private readonly canvas: HTMLCanvasElement;
  private readonly onDown: (e: PointerEvent) => void;
  private readonly onMove: (e: PointerEvent) => void;
  private readonly onUp: (e: PointerEvent) => void;

  constructor(canvas: HTMLCanvasElement, opts: OrbitOptions = {}) {
    this.canvas = canvas;
    this.target = opts.target ?? new Vector3();
    this.radius = opts.radius ?? 900;
    this.azimuth = opts.azimuth ?? 0.8;
    this.polar = opts.polar ?? 0.5;
    this.autoSpin = opts.autoSpin ?? 0;
    this.minPolar = opts.minPolar ?? 0.06;
    this.maxPolar = opts.maxPolar ?? 1.35;

    this.onDown = (e) => {
      this.dragging = true;
      this.idle = 0;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    this.onMove = (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.azimuth -= dx * 0.005;
      this.polar = Math.min(this.maxPolar, Math.max(this.minPolar, this.polar + dy * 0.004));
    };
    this.onUp = (e) => {
      this.dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
  }

  update(camera: PerspectiveCamera, dt: number): void {
    if (!this.dragging) {
      this.idle += dt;
      if (this.idle > 2.5) this.azimuth += this.autoSpin * dt;
    }
    const ce = Math.cos(this.polar);
    camera.position.set(
      this.target.x + this.radius * ce * Math.cos(this.azimuth),
      this.target.y + this.radius * Math.sin(this.polar),
      this.target.z + this.radius * ce * Math.sin(this.azimuth),
    );
    camera.lookAt(this.target);
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onUp);
  }
}
