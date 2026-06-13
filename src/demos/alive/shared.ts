// Shared plumbing for the Alive demos: renderer + scene bootstrap, an orbit
// rig, a terrain patch displaced by the canonical height function, a
// bus-wired lake surface, and dusk lighting driven by the hour. Each demo
// file stays about its one creature.

import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGPURenderer,
  BufferGeometry,
  BufferAttribute,
} from "three/webgpu";
import {
  float,
  normalize,
  positionLocal,
  positionWorld,
  normalWorld,
  transformNormalToView,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import { Shell, type Demo } from "../../lib/demoShell";
import { onDisturbance } from "../../lib/spine";
import { terrainHeightNode, terrainSurfaceColor } from "../../lib/terrain";
import { LakeSurface, RippleRings } from "../../lib/water";
import {
  createDuskLight,
  makeEagleGeometry,
  makeFlapMaterial,
  makeGooseGeometry,
  EAGLE_HINGE,
  GOOSE_HINGE,
  type DuskLight,
} from "../../lib/life";

// ---- kit -----------------------------------------------------------------------

export interface KitOptions {
  aspect?: number;
  fov?: number;
  far?: number;
  /** Fog [near, far]; null for none. Default [500, 3000]. */
  fog?: [number, number] | null;
  fogColor?: string;
}

export class Kit {
  readonly shell: Shell;
  readonly renderer: WebGPURenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;

  private disposables: Array<{ dispose(): void }> = [];
  private last = performance.now();

  constructor(renderer: WebGPURenderer, shell: Shell, opts: KitOptions) {
    this.shell = shell;
    this.renderer = renderer;
    const canvas = shell.canvas;
    this.camera = new PerspectiveCamera(
      opts.fov ?? 50,
      canvas.width / Math.max(1, canvas.height),
      0.1,
      opts.far ?? 9000,
    );
    if (opts.fog !== null) {
      const [near, far] = opts.fog ?? [500, 3000];
      this.scene.fog = new Fog(new Color(opts.fogColor ?? "#bcc8d6"), near, far);
    }
    this.sun = new DirectionalLight(new Color("#fff0d8"), 2.6);
    this.sun.position.set(900, 700, 400);
    this.scene.add(this.sun);
    this.hemi = new HemisphereLight(new Color("#9db8d9"), new Color("#3c4136"), 0.8);
    this.scene.add(this.hemi);
  }

  track<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing);
    return thing;
  }

  trackGeo<T extends BufferGeometry>(geo: T): T {
    this.disposables.push(geo);
    return geo;
  }

  start(frame: (dt: number, t: number) => void): Demo {
    const t0 = performance.now();
    return {
      frame: () => {
        const now = performance.now();
        const dt = Math.min(0.05, (now - this.last) / 1000);
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
}

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

// ---- camera rig ------------------------------------------------------------------

export interface OrbitOptions {
  target?: Vector3;
  radius?: number;
  azimuth?: number;
  polar?: number;
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
    this.radius = opts.radius ?? 60;
    this.azimuth = opts.azimuth ?? 0.8;
    this.polar = opts.polar ?? 0.4;
    this.autoSpin = opts.autoSpin ?? 0;
    this.minPolar = opts.minPolar ?? 0.04;
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

// ---- terrain patch ------------------------------------------------------------------

/** Flat XZ grid in world meters; heights come from the material. */
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
      tris[q++] = a;
      tris[q++] = a + n + 1;
      tris[q++] = a + 1;
      tris[q++] = a + 1;
      tris[q++] = a + n + 1;
      tris[q++] = a + n + 2;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("normal", new BufferAttribute(normals, 3));
  geo.setIndex(new BufferAttribute(tris, 1));
  return geo;
}

/** The canonical terrain, displaced on the GPU and painted by the Basin's
 *  surface material. One mesh, zero CPU height work. */
export function addTerrain(kit: Kit, size: number, segments: number, cx = 0, cz = 0, eps = 3): Mesh {
  const geo = kit.trackGeo(makeGridGeometry(size, segments, cx, cz));
  const material = kit.track(new MeshStandardNodeMaterial());
  const xz = positionLocal.xz;
  const h = terrainHeightNode(xz);
  material.positionNode = vec3(xz.x, h, xz.y);
  const e = float(eps);
  const hL = terrainHeightNode(xz.sub(vec2(e, 0)));
  const hR = terrainHeightNode(xz.add(vec2(e, 0)));
  const hD = terrainHeightNode(xz.sub(vec2(0, e)));
  const hU = terrainHeightNode(xz.add(vec2(0, e)));
  const vNormal = varying(normalize(vec3(hL.sub(hR), e.mul(2), hD.sub(hU))));
  material.normalNode = transformNormalToView(vNormal.normalize());
  material.colorNode = terrainSurfaceColor(positionWorld, normalWorld, {});
  material.roughnessNode = float(0.95);
  material.metalnessNode = float(0);
  const mesh = new Mesh(geo, material);
  mesh.frustumCulled = false;
  kit.scene.add(mesh);
  return mesh;
}

// ---- the lake, wired to the bus ----------------------------------------------------------

export interface LakeKit {
  lake: LakeSurface;
  rings: RippleRings;
  /** Call each frame BEFORE rendering, with sim time in seconds. */
  update(t: number): void;
}

/**
 * A LakeSurface listening to the disturbance bus through a RippleRings pool
 * — every `rise`, `skim`, and egg-dip in these demos becomes a ring.
 */
export function addLake(kit: Kit, env: DuskLight, size = 400, segments = 200): LakeKit {
  const rings = new RippleRings();
  const lake = kit.track(
    new LakeSurface({
      env,
      size,
      segments,
      rings,
      vertexWaves: 3,
    }),
  );
  kit.scene.add(lake.mesh);
  let simT = 0;
  const off = onDisturbance((d) => rings.add(d, simT));
  kit.track({ dispose: off });
  return {
    lake,
    rings,
    update(t: number): void {
      simT = t;
      lake.update(t);
    },
  };
}

// ---- bird meshes -----------------------------------------------------------------------------

/** Instanced geese with the goose-tempo flap material. */
export function addGooseMesh(kit: Kit, count: number): InstancedMesh {
  const geo = kit.trackGeo(makeGooseGeometry());
  const flap = makeFlapMaterial(GOOSE_HINGE);
  kit.track(flap.material);
  flap.frequency.value = 3.4;
  flap.amplitude.value = 0.55;
  flap.glide.value = 0.1;
  const mesh = new InstancedMesh(geo, flap.material, count);
  mesh.frustumCulled = false;
  kit.scene.add(mesh);
  return mesh;
}

/** The one eagle: a single-instance mesh so the flap shader still applies. */
export function addEagleMesh(kit: Kit): InstancedMesh {
  const geo = kit.trackGeo(makeEagleGeometry());
  const flap = makeFlapMaterial(EAGLE_HINGE);
  kit.track(flap.material);
  flap.frequency.value = 1.2;
  flap.amplitude.value = 0.05; // a soarer rocks, it doesn't row
  const mesh = new InstancedMesh(geo, flap.material, 1);
  mesh.frustumCulled = false;
  kit.scene.add(mesh);
  return mesh;
}

// ---- dusk environment ----------------------------------------------------------------------

/** Dusk light + dome wired to the kit's plain lights. Returns the rig. */
export function addDusk(kit: Kit, hour: number, domeRadius = 2000): DuskLight {
  const dusk = kit.track(createDuskLight(hour));
  kit.scene.add(dusk.makeDome(domeRadius));
  dusk.apply(kit.sun, kit.hemi, kit.scene.fog as Fog | null);
  return dusk;
}

/** Re-key the dusk palette and push it into the kit's lights. */
export function setDuskHour(kit: Kit, dusk: DuskLight, hour: number): void {
  dusk.setHour(hour);
  dusk.apply(kit.sun, kit.hemi, kit.scene.fog as Fog | null);
}
