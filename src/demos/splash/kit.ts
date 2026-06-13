// Shared plumbing for The Splash's demos: renderer + camera bootstrap on the
// site Shell, a drag orbit, click→water picking, lights for lit meshes, and
// the "tank" materials that render a HeightWaveSim grid three ways (clay for
// shape study, heat for reading the state directly, water for the real look).

import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import type { Node } from "three/webgpu";
import {
  cameraPosition,
  clamp,
  float,
  int,
  max,
  mix,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  reflect,
  smoothstep,
  uniform,
  varying,
  vec3,
  vertexIndex,
} from "three/tsl";
import { Shell, type Demo } from "../../lib/demoShell";
import type { LakeEnvironment } from "../../lib/water";
import { f0FromIor, fresnelSchlick, sunGlint, WATER_IOR } from "../../lib/water";
import type { HeightWaveSim } from "../../lib/fluid";

type NodeF = Node<"float">;
type NodeI = Node<"int">;
type NodeV3 = Node<"vec3">;

// ---- renderer + camera --------------------------------------------------------

export interface SplashCtxOptions {
  aspect?: number;
  fov?: number;
  near?: number;
  far?: number;
}

export interface SplashCtx {
  shell: Shell;
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  onDispose(fn: () => void): void;
  finish(frame: (t: number, dt: number) => void): Demo;
}

export async function splashCtx(el: HTMLElement, options: SplashCtxOptions = {}): Promise<SplashCtx> {
  const { aspect = 0.62, fov = 50, near = 0.1, far = 3000 } = options;
  const shell = new Shell(el, aspect);
  const renderer = new WebGPURenderer({ canvas: shell.canvas, antialias: true });
  await renderer.init();
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.setSize(shell.canvas.width, shell.canvas.height, false);

  const scene = new Scene();
  const camera = new PerspectiveCamera(fov, shell.canvas.width / shell.canvas.height, near, far);

  const disposers: (() => void)[] = [];
  let last = performance.now();
  let t = 0;

  return {
    shell,
    renderer,
    scene,
    camera,
    onDispose(fn) {
      disposers.push(fn);
    },
    finish(frame) {
      return {
        frame() {
          const now = performance.now();
          const dt = Math.min((now - last) / 1000, 0.1);
          last = now;
          t += dt;
          frame(t, dt);
          renderer.render(scene, camera);
          shell.tick();
        },
        dispose() {
          for (const fn of disposers) fn();
          renderer.dispose();
        },
      };
    },
  };
}

// ---- drag orbit ----------------------------------------------------------------

export interface OrbitOptions {
  target?: Vector3;
  azimuth?: number;
  polar?: number;
  distance?: number;
  minPolar?: number;
  maxPolar?: number;
  drift?: number;
}

export interface Orbit {
  update(dt: number): void;
  dispose(): void;
}

export function addOrbit(canvas: HTMLCanvasElement, camera: PerspectiveCamera, options: OrbitOptions = {}): Orbit {
  const target = options.target ?? new Vector3(0, 0, 0);
  let azimuth = options.azimuth ?? 0.8;
  let polar = options.polar ?? 0.5;
  const distance = options.distance ?? 18;
  const minPolar = options.minPolar ?? 0.06;
  const maxPolar = options.maxPolar ?? 1.4;
  let drift = options.drift ?? 0;
  let azimuthGoal = azimuth;
  let polarGoal = polar;
  let dragging = false;
  let moved = 0;
  let lastX = 0;
  let lastY = 0;

  const down = (e: PointerEvent): void => {
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent): void => {
    if (!dragging) return;
    moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
    if (moved > 6) drift = 0;
    azimuthGoal -= (e.clientX - lastX) * 0.005;
    polarGoal = Math.min(maxPolar, Math.max(minPolar, polarGoal + (e.clientY - lastY) * 0.004));
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const up = (e: PointerEvent): void => {
    dragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);

  return {
    update(dt: number) {
      azimuthGoal += drift * dt;
      const k = Math.min(1, dt * 7);
      azimuth += (azimuthGoal - azimuth) * k;
      polar += (polarGoal - polar) * k;
      camera.position.set(
        target.x + distance * Math.cos(polar) * Math.cos(azimuth),
        target.y + distance * Math.sin(polar),
        target.z + distance * Math.cos(polar) * Math.sin(azimuth),
      );
      camera.lookAt(target);
    },
    dispose() {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    },
  };
}

// ---- click → water plane ---------------------------------------------------------

/** Map a click to the (x, z) where the eye ray crosses y = 0. */
export function pickWaterPoint(
  event: { clientX: number; clientY: number },
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
): { x: number; z: number } | null {
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  const origin = camera.position;
  const dir = new Vector3(ndcX, ndcY, 0.5).unproject(camera).sub(origin).normalize();
  if (dir.y > -1e-4) return null;
  const t = -origin.y / dir.y;
  if (t <= 0 || t > 5000) return null;
  return { x: origin.x + dir.x * t, z: origin.z + dir.z * t };
}

/** Wire a tap handler that distinguishes clicks from orbit drags. */
export function onTap(canvas: HTMLCanvasElement, fn: (e: PointerEvent) => void): () => void {
  let downX = 0;
  let downY = 0;
  const down = (e: PointerEvent): void => {
    downX = e.clientX;
    downY = e.clientY;
  };
  const up = (e: PointerEvent): void => {
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) < 7) fn(e);
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointerup", up);
  return () => {
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointerup", up);
  };
}

// ---- lights for lit meshes (the bird, floats) --------------------------------------

export function addLights(scene: Scene, sunDir = new Vector3(0.6, 0.7, 0.3)): () => void {
  const sun = new DirectionalLight(new Color(0xffeedd), 2.4);
  sun.position.copy(sunDir).multiplyScalar(100);
  const hemi = new HemisphereLight(new Color(0x9db8d9), new Color(0x1c2430), 0.8);
  scene.add(sun, hemi);
  return () => {
    scene.remove(sun, hemi);
    sun.dispose();
    hemi.dispose();
  };
}

// ---- the tank: a grid mesh whose vertex order IS the sim lattice -------------------

/**
 * A flat grid with vertex (i, j) at (−half + i·s, 0, −half + j·s) in row-major
 * order — so `vertexIndex` equals the sim's cell index, no resampling at all.
 */
export function makeTankGeometry(size: number, res: number): BufferGeometry {
  const n = res - 1;
  const s = size / n;
  const half = size / 2;
  const positions = new Float32Array(res * res * 3);
  const normals = new Float32Array(res * res * 3);
  let p = 0;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      positions[p] = -half + i * s;
      positions[p + 2] = -half + j * s;
      normals[p + 1] = 1;
      p += 3;
    }
  }
  const indices = new Uint32Array(n * n * 6);
  let q = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * res + i;
      indices[q++] = a;
      indices[q++] = a + res;
      indices[q++] = a + 1;
      indices[q++] = a + 1;
      indices[q++] = a + res;
      indices[q++] = a + res + 1;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("normal", new BufferAttribute(normals, 3));
  geo.setIndex(new BufferAttribute(indices, 1));
  return geo;
}

/** Per-vertex height + analytic-ish normal straight from the sim buffer. */
function tankVertexNodes(sim: HeightWaveSim, exaggerate: NodeF) {
  const res = sim.res;
  const idx = int(vertexIndex);
  const i = idx.mod(res);
  const j = idx.div(res);
  const at = (ii: NodeI, jj: NodeI): NodeI =>
    int(clamp(float(jj), 0, res - 1)).mul(res).add(int(clamp(float(ii), 0, res - 1)));
  const h = sim.cellNode(idx).x.mul(exaggerate);
  const hL = sim.cellNode(at(i.sub(1), j)).x.mul(exaggerate);
  const hR = sim.cellNode(at(i.add(1), j)).x.mul(exaggerate);
  const hD = sim.cellNode(at(i, j.sub(1))).x.mul(exaggerate);
  const hU = sim.cellNode(at(i, j.add(1))).x.mul(exaggerate);
  const normal = varying(normalize(vec3(hL.sub(hR), 2 * sim.spacing, hD.sub(hU))));
  return { h, normal };
}

export interface TankMesh {
  mesh: Mesh;
  /** Vertical exaggeration of the rendered height (teaching aid). */
  exaggerate: { value: number };
  dispose(): void;
}

/** Matte clay: shape without optics — for studying the wave equation. */
export function makeClayTank(sim: HeightWaveSim): TankMesh {
  const exaggerate = uniform(1);
  const material = new MeshBasicNodeMaterial();
  const { h, normal } = tankVertexNodes(sim, exaggerate);
  material.positionNode = positionLocal.add(vec3(0, h, 0));
  const n = normal.normalize();
  const view = normalize(cameraPosition.sub(positionWorld));
  const light = normalize(vec3(0.45, 0.6, 0.3));
  const diffuse = n.dot(light).clamp(0, 1);
  const deep = vec3(0.114, 0.165, 0.235);
  const lit = vec3(0.486, 0.592, 0.722);
  const rim = view.dot(n).clamp(0, 1).oneMinus().pow(3).mul(0.18);
  const spec = reflect(view.negate(), n).dot(light).clamp(0, 1).pow(90).mul(0.5);
  material.colorNode = mix(deep, lit, diffuse.mul(0.85).add(0.08)).add(rim).add(spec);

  const geometry = makeTankGeometry(sim.worldSize, sim.res);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    exaggerate,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Heat view: read the state like an engineer — blue trough, white crest. */
export function makeHeatTank(sim: HeightWaveSim): TankMesh {
  const exaggerate = uniform(1);
  const material = new MeshBasicNodeMaterial();
  const { h, normal } = tankVertexNodes(sim, exaggerate);
  material.positionNode = positionLocal.add(vec3(0, h, 0));
  const amp = varying(sim.cellNode(int(vertexIndex)).x);
  const t01 = amp.mul(6).clamp(-1, 1).mul(0.5).add(0.5);
  const trough = vec3(0.07, 0.19, 0.45);
  const zero = vec3(0.045, 0.06, 0.1);
  const crest = vec3(0.95, 0.97, 1.0);
  const color = mix(mix(trough, zero, smoothstep(0.0, 0.5, t01)), crest, smoothstep(0.5, 1.0, t01));
  const n = normal.normalize();
  const shade = n.dot(normalize(vec3(0.3, 0.8, 0.2))).clamp(0, 1).mul(0.25).add(0.75);
  material.colorNode = color.mul(shade);

  const geometry = makeTankGeometry(sim.worldSize, sim.res);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    exaggerate,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** The real look: Fresnel sky over a dark body plus the sun glint, on the
 *  sim's surface — The Mirror's optics on The Splash's shape. */
export function makeWaterTank(sim: HeightWaveSim, env: LakeEnvironment): TankMesh {
  const exaggerate = uniform(1);
  const ior = uniform(WATER_IOR);
  const roughness = uniform(0.09);
  const scatter = uniform(new Color(0x0a2531));
  const material = new MeshBasicNodeMaterial();
  const { h, normal } = tankVertexNodes(sim, exaggerate);
  material.positionNode = positionLocal.add(vec3(0, h, 0));

  const n = normal.normalize();
  const view = normalize(cameraPosition.sub(positionWorld));
  const cosTheta = n.dot(view).clamp(0, 1);
  const fresnel = fresnelSchlick(cosTheta, f0FromIor(ior));
  const r = reflect(view.negate(), n);
  const skyDir = normalize(vec3(r.x, max(r.y, 0.02), r.z));
  const reflected = env.skyColor(skyDir);
  const glint = sunGlint(n, view, env.sunDirection, roughness)
    .mul(fresnel.clamp(0.02, 1))
    .mul(env.sunColor);
  material.colorNode = mix(scatter.rgb as unknown as NodeV3, reflected, fresnel).add(glint);

  const geometry = makeTankGeometry(sim.worldSize, sim.res);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    exaggerate,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ---- tiny scenery ------------------------------------------------------------------

/** Fake-lit flat material: base color shaded by a fixed key direction. The
 *  uniform shares the caller's Vector3, so a moving sun keeps working. */
export function fakeLitMaterial(hex: number, sunDir: Vector3): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const base = uniform(new Color(hex));
  const sun = uniform(sunDir);
  const ndl = normalWorld.dot(normalize(vec3(sun.x, sun.y, sun.z))).clamp(0, 1);
  material.colorNode = base.rgb.mul(ndl.mul(0.7).add(0.3));
  return material;
}

/** A simple lit ball for floats and probes. */
export function makeBall(
  radius: number,
  hex: number,
  sunDir: Vector3,
): { mesh: Mesh; dispose(): void } {
  const geometry = new SphereGeometry(radius, 22, 16);
  const material = fakeLitMaterial(hex, sunDir);
  const mesh = new Mesh(geometry, material);
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function disposeGroup(group: Group): void {
  group.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicNodeMaterial).dispose();
    }
  });
}
