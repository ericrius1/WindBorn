// Shared plumbing for Air & Light's demos: renderer + camera bootstrap on
// the site Shell, a drag orbit, a displaced-terrain builder for ridge
// silhouettes (the real basin, not stage flats), and small formatting
// helpers. Demos stay focused on the one idea they teach.

import {
  ACESFilmicToneMapping,
  Mesh,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGPURenderer,
  BufferAttribute,
  BufferGeometry,
  Color,
} from "three/webgpu";
import {
  cameraPosition,
  dot,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  reflect,
  uniform,
  varying,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { Shell, type Demo } from "../../lib/demoShell";
import { terrainHeightNode, terrainNormalNode, terrainSurfaceColor } from "../../lib/terrain";
import { createWaveUniforms, waveHeightNode, waveSlopeNode, f0FromIor, fresnelSchlick, sunGlint } from "../../lib/water";
import { clock, wind } from "../../lib/spine";

type NodeV3 = Node<"vec3">;

// ---- renderer + camera ------------------------------------------------------------

export interface SkyCtxOptions {
  aspect?: number;
  fov?: number;
  near?: number;
  far?: number;
  /**
   * Internal render resolution as a fraction of the canvas. Raymarch-heavy
   * heroes run at ~0.6 and let CSS stretch — the budget trick the clouds
   * essay explains.
   */
  renderScale?: number;
}

export interface SkyCtx {
  shell: Shell;
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  width: number;
  height: number;
  onDispose(fn: () => void): void;
  finish(frame: (t: number, dt: number) => void, render?: () => void): Demo;
}

export async function skyCtx(el: HTMLElement, options: SkyCtxOptions = {}): Promise<SkyCtx> {
  const { aspect = 0.62, fov = 50, near = 0.3, far = 9000, renderScale = 1 } = options;
  const shell = new Shell(el, aspect);
  const renderer = new WebGPURenderer({ canvas: shell.canvas, antialias: true });
  await renderer.init();
  renderer.toneMapping = ACESFilmicToneMapping;
  const width = Math.round(shell.canvas.width * renderScale);
  const height = Math.round(shell.canvas.height * renderScale);
  renderer.setSize(width, height, false);

  const scene = new Scene();
  const camera = new PerspectiveCamera(fov, width / height, near, far);

  const disposers: (() => void)[] = [];
  let last = performance.now();
  let t = 0;

  return {
    shell,
    renderer,
    scene,
    camera,
    width,
    height,
    onDispose(fn) {
      disposers.push(fn);
    },
    finish(frame, render) {
      return {
        frame() {
          const now = performance.now();
          const dt = Math.min((now - last) / 1000, 0.1);
          last = now;
          t += dt;
          frame(t, dt);
          if (render) render();
          else renderer.render(scene, camera);
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

// ---- drag orbit ----------------------------------------------------------------------

export interface OrbitOptions {
  target?: Vector3;
  azimuth?: number;
  polar?: number; // radians above the horizon
  distance?: number;
  minPolar?: number;
  maxPolar?: number;
  /** Idle drift, radians/s; stops the first time the user grabs the canvas. */
  drift?: number;
}

export interface Orbit {
  update(dt: number): void;
  dispose(): void;
}

export function addOrbit(canvas: HTMLCanvasElement, camera: PerspectiveCamera, options: OrbitOptions = {}): Orbit {
  const target = options.target ?? new Vector3(0, 2, 0);
  let azimuth = options.azimuth ?? 0.8;
  let polar = options.polar ?? 0.22;
  const distance = options.distance ?? 24;
  const minPolar = options.minPolar ?? 0.03;
  const maxPolar = options.maxPolar ?? 1.25;
  let drift = options.drift ?? 0;
  let azimuthGoal = azimuth;
  let polarGoal = polar;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const down = (e: PointerEvent): void => {
    dragging = true;
    drift = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent): void => {
    if (!dragging) return;
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

// ---- the basin as a backdrop --------------------------------------------------------
// A flat grid displaced by the canonical terrain height in the vertex stage
// (The Basin's GPU function — the same mountains every series shares),
// fake-lit by sun + ambient uniforms, with an optional tint hook so fog can
// have the last word on the fragment.

export interface TerrainMeshOptions {
  /** Side length in meters. */
  size?: number;
  /** Grid segments per side. */
  segments?: number;
  /** World center of the grid. */
  cx?: number;
  cz?: number;
  /** Light uniforms (HDR sun color works; it is scaled down inside). */
  sunDirection: { value: Vector3 };
  sunColor: { value: Color };
  ambient: { value: Color };
  /** Final say on the fragment color (fog goes here). */
  tint?: (lit: NodeV3, world: NodeV3) => NodeV3;
}

export interface TerrainMesh {
  mesh: Mesh;
  dispose(): void;
}

export function makeTerrainMesh(options: TerrainMeshOptions): TerrainMesh {
  const { size = 3200, segments = 192, cx = 0, cz = 0 } = options;

  // Flat grid with world-space xz baked into positions.
  const n = segments;
  const verts = (n + 1) * (n + 1);
  const positions = new Float32Array(verts * 3);
  let p = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      positions[p] = cx + (i / n - 0.5) * size;
      positions[p + 2] = cz + (j / n - 0.5) * size;
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
      tris[q++] = a + n + 2;
      tris[q++] = a;
      tris[q++] = a + n + 2;
      tris[q++] = a + 1;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(tris, 1));

  const material = new MeshBasicNodeMaterial();
  const xz = positionLocal.xz;
  const h = terrainHeightNode(xz);
  material.positionNode = vec3(xz.x, h, xz.y);

  // Vertex-stage analytic normal; FD step matched to the cell size.
  const vN = varying(terrainNormalNode(xz, size / segments));
  const nrm = normalize(vN);

  const sunDir = uniform(options.sunDirection.value); // shares the Vector3
  const sunC = uniform(options.sunColor.value); // shares the Color
  const ambC = uniform(options.ambient.value);

  const albedo = terrainSurfaceColor(positionWorld, nrm);
  const diffuse = dot(nrm, sunDir).clamp(0, 1);
  // HDR sun (≈3.6 at noon) scaled to a sane key; ambient fills the shadows.
  const lit = albedo.mul(sunC.rgb.mul(diffuse).mul(0.32).add(ambC.rgb.mul(0.85)));
  material.colorNode = options.tint ? options.tint(lit, positionWorld) : lit;

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ---- tintable calm water --------------------------------------------------------------
// The Mirror's LakeSurface owns its full color chain, which is right for the
// finished lake but leaves fog nowhere to stand. This is the same recipe —
// wave-table displacement, Fresnel mix, sun glint — with a tint hook at the
// end so aerial perspective and mist get the last word on the fragment.
// TODO(mirror): if LakeSurface ever grows a post-shading tint/fog hook, this
// builder collapses into a thin wrapper around it.

export interface CalmWaterOptions {
  env: {
    sunDirection: { value: Vector3 };
    sunColor: { value: Color };
    skyColor(dir: NodeV3): NodeV3;
  };
  size?: number;
  segments?: number;
  windSpeed?: number;
  tint?: (color: NodeV3, world: NodeV3) => NodeV3;
}

export interface CalmWater {
  mesh: Mesh;
  waves: ReturnType<typeof createWaveUniforms>;
  update(t: number, syncWind?: boolean): void;
  dispose(): void;
}

export function makeCalmWater(options: CalmWaterOptions): CalmWater {
  const { env, size = 1000, segments = 160 } = options;
  const geometry = new PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const waves = createWaveUniforms({ windSpeed: options.windSpeed ?? wind.speed });
  const material = new MeshBasicNodeMaterial();

  material.positionNode = positionLocal.add(vec3(0, waveHeightNode(positionLocal.xz, waves, 3), 0));

  const slope = waveSlopeNode(positionWorld.xz, waves);
  const nrm = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));
  const view = normalize(cameraPosition.sub(positionWorld));
  const fresnel = fresnelSchlick(nrm.dot(view).clamp(0, 1), f0FromIor(uniform(1.333)));

  const sunDir = uniform(env.sunDirection.value);
  const sunC = uniform(env.sunColor.value);
  const r = reflect(view.negate(), nrm);
  const reflected = env.skyColor(normalize(vec3(r.x, r.y.max(0.02), r.z)));
  const body = uniform(new Color(0x0a2531));
  const glint = sunGlint(nrm, view, sunDir, uniform(0.08)).mul(fresnel.clamp(0.02, 1)).mul(sunC.rgb);
  const shaded = mix(body.rgb, reflected, fresnel).add(glint);
  material.colorNode = options.tint ? options.tint(shaded, positionWorld) : shaded;

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    waves,
    update(t, syncWind = true) {
      waves.time.value = t;
      if (syncWind) {
        waves.windDirection.value = wind.direction;
        waves.windSpeed.value = wind.speed;
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ---- small helpers -------------------------------------------------------------------

/** "6:03" from a clock hour. */
export function fmtHour(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  return `${Math.floor(hh)}:${String(Math.floor((hh % 1) * 60)).padStart(2, "0")}`;
}

/** The page-wide clock, formatted. */
export function fmtClock(): string {
  return fmtHour(clock.hour);
}

/** Map a click on the canvas to the (x, z) where the eye ray meets y = 0. */
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
  if (t <= 0 || t > 4000) return null;
  return { x: origin.x + dir.x * t, z: origin.z + dir.z * t };
}
