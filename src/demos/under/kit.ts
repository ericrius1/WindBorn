// Shared plumbing for Under's demos: renderer + camera on the site Shell,
// a drag orbit that's allowed to look UP (underwater cameras spend their
// lives staring at the ceiling), a caustic-lit sand bed, a silhouette
// ridgeline for the above-water half of crossing scenes, and click→plane
// picking for "strike here" interactions.

import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import {
  cameraPosition,
  color,
  length,
  mix,
  mx_noise_float,
  positionLocal,
  positionWorld,
  smoothstep,
  uniform,
  vec3,
} from "three/tsl";
import { Shell, type Demo } from "../../lib/demoShell";
import { disturb, onDisturbance, waterHeightAt } from "../../lib/spine";
import {
  LakeSurface,
  RippleRings,
  createDawnSky,
  type DawnSky,
  type LakeBed,
  type LakeEnvironment,
} from "../../lib/water";
import type { WaveUniforms } from "../../lib/water/waveNodes";
import {
  BETA_PER_METER,
  LensOverlay,
  SurfaceCeiling,
  SurfaceCrossing,
  causticFocusNode,
  makeDepthDome,
  mediumColorNode,
  sunTintAtDepth,
  underwaterFog,
  type DepthDome,
  type LensOverlayOptions,
} from "../../lib/underwater";

// ---- renderer + camera --------------------------------------------------------

export interface UnderCtxOptions {
  aspect?: number;
  fov?: number;
  near?: number;
  far?: number;
}

export interface UnderCtx {
  shell: Shell;
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  width: number;
  height: number;
  onDispose(fn: () => void): void;
  finish(frame: (t: number, dt: number) => void): Demo;
}

export async function underCtx(el: HTMLElement, options: UnderCtxOptions = {}): Promise<UnderCtx> {
  const { aspect = 0.62, fov = 50, near = 0.06, far = 1600 } = options;
  const shell = new Shell(el, aspect);
  const renderer = new WebGPURenderer({ canvas: shell.canvas, antialias: true });
  await renderer.init();
  renderer.toneMapping = ACESFilmicToneMapping;
  const width = shell.canvas.width;
  const height = shell.canvas.height;
  renderer.setSize(width, height, false);

  const scene = new Scene();
  const camera = new PerspectiveCamera(fov, width / height, near, far);
  scene.add(camera); // overlay quads and god-ray screens ride the camera

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

// ---- drag orbit (negative polar = looking up from below) ------------------------

export interface OrbitOptions {
  target?: Vector3;
  azimuth?: number;
  polar?: number; // radians from horizontal; negative looks up at the target
  distance?: number;
  minPolar?: number;
  maxPolar?: number;
  drift?: number; // idle azimuth drift, rad/s, until grabbed
}

export interface Orbit {
  target: Vector3;
  update(dt: number): void;
  setPolar(p: number): void;
  setDistance(d: number): void;
  dispose(): void;
}

export function addOrbit(canvas: HTMLCanvasElement, camera: PerspectiveCamera, options: OrbitOptions = {}): Orbit {
  const target = options.target ?? new Vector3(0, 0, 0);
  let azimuth = options.azimuth ?? 0;
  let polar = options.polar ?? 0.3;
  let distance = options.distance ?? 10;
  const minPolar = options.minPolar ?? -1.35;
  const maxPolar = options.maxPolar ?? 1.35;
  let drift = options.drift ?? 0;
  let azimuthGoal = azimuth;
  let polarGoal = polar;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.style.touchAction = "pan-y";
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
    target,
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
    setPolar(p: number) {
      polarGoal = Math.min(maxPolar, Math.max(minPolar, p));
    },
    setDistance(d: number) {
      distance = d;
    },
    dispose() {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    },
  };
}

// ---- the caustic-lit sand bed ----------------------------------------------------

export interface SandBedOptions {
  env: LakeEnvironment;
  /** Shared wave uniforms — the same table the surface above is using. */
  waves: WaveUniforms;
  /** Depth of the bed below the surface, meters. */
  depth?: number;
  size?: number;
  segments?: number;
  /** Waves used for the caustic Hessian (fewer = cheaper). */
  causticCount?: number;
}

export interface SandBed {
  mesh: Mesh;
  /** Caustic brightness. */
  gain: { value: number };
  /** Caustic filament sharpening exponent. */
  sharp: { value: number };
  /** Underwater extinction toward the bed, 1/m. */
  turbidity: { value: number };
  dispose(): void;
}

/**
 * A sandy lakebed lit by the analytic caustic node: albedo from noise,
 * ambient from the medium, filaments from the Jacobian of the refraction
 * map, all faded by underwater fog. The hero scenes and the breach share it.
 */
export function makeSandBed(options: SandBedOptions): SandBed {
  const { env, waves: u, depth = 2.2, size = 60, segments = 96, causticCount = 4 } = options;

  const gain = uniform(0.5);
  const sharp = uniform(1.7);
  const turbidity = uniform(0.07);

  const geometry = new BufferGeometry();
  // a grid built by hand; the dunes ride on top in the vertex shader
  const verts: number[] = [];
  const indices: number[] = [];
  const n = segments;
  for (let iz = 0; iz <= n; iz++) {
    for (let ix = 0; ix <= n; ix++) {
      const x = (ix / n - 0.5) * size;
      const z = (iz / n - 0.5) * size;
      verts.push(x, 0, z);
      if (ix < n && iz < n) {
        const a = iz * (n + 1) + ix;
        indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      }
    }
  }
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
  geometry.setIndex(indices);

  const material = new MeshBasicNodeMaterial();

  // gentle dunes, vertex-displaced
  const dunes = mx_noise_float(positionLocal.xz.mul(0.22)).mul(0.35);
  material.positionNode = positionLocal.add(vec3(0, dunes, 0));

  const xz = positionWorld.xz;
  // sandy albedo: mottle + fine speckle
  const mottle = mx_noise_float(xz.mul(0.5)).mul(0.5).add(0.5);
  const fine = mx_noise_float(xz.mul(4.1)).mul(0.5).add(0.5);
  const albedo = mix(color(0x57492e), color(0x84714a), mottle).mul(fine.mul(0.3).add(0.78));

  // caustic light: evaluate the focus factor where the sun ray through this
  // point entered the surface, β grown by the true local depth
  const fragDepth = positionWorld.y.negate().max(0.05);
  const sunY = env.sunDirection.y.max(0.18);
  const entry = xz.add(env.sunDirection.xz.mul(fragDepth.div(sunY)));
  const beta = fragDepth.mul(BETA_PER_METER);
  const caustic = causticFocusNode(entry, u, beta, causticCount).pow(sharp).mul(gain);

  // sun color after the dive to this depth — Beer–Lambert per channel
  const sunTint = sunTintAtDepth(fragDepth, sunY, vec3(0.42, 0.09, 0.035));

  const ambient = mediumColorNode(fragDepth).mul(0.85);
  const lit = albedo.mul(ambient.add(sunTint.mul(env.sunColor).mul(caustic.add(0.22)).mul(0.3)));

  const dist = length(positionWorld.sub(cameraPosition));
  const fogColor = mediumColorNode(cameraPosition.y.negate().max(0).mul(0.6).add(fragDepth.mul(0.3)));
  material.colorNode = underwaterFog(lit, fogColor, dist, turbidity);

  const mesh = new Mesh(geometry, material);
  mesh.position.y = -depth;
  mesh.frustumCulled = false;

  return {
    mesh,
    gain,
    sharp,
    turbidity,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ---- silhouette ridgeline for the above-water half --------------------------------

function hash01(i: number): number {
  const s = Math.sin(i * 91.7 + 47.3) * 33941.715;
  return s - Math.floor(s);
}

/** A ring of dark serrated ridges around the lake — scenery for the air side
 *  of a crossing scene. TODO(under): swap for The Basin's real terrain when a
 *  scene can afford it. */
export function makeRidgeline(radius = 420, height = 100, seed = 3): Mesh {
  const segments = 200;
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const cell = Math.floor(i * 0.31) + seed * 17;
    const f = (i * 0.31) % 1;
    const jag = hash01(cell) * (1 - f) + hash01(cell + 1) * f;
    const ridge =
      height *
      (0.46 +
        0.3 * Math.sin(theta * 1.9 + seed) +
        0.14 * Math.sin(theta * 6.3 + seed * 2.2) +
        0.18 * (jag - 0.5));
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    positions.set([x, -4, z], i * 6);
    positions.set([x, Math.max(ridge, height * 0.1), z], i * 6 + 3);
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const material = new MeshBasicNodeMaterial({ side: 2 });
  material.colorNode = mix(color(0x0a0f17), color(0x2c3450), smoothstep(0, height, positionWorld.y));
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

export function disposeMesh(mesh: Mesh): void {
  mesh.geometry.dispose();
  (mesh.material as MeshBasicNodeMaterial).dispose();
}

// ---- the standard crossing scene -----------------------------------------------------
// One grammar for every scene a camera can pass through: the same lake
// rendered twice (topside LakeSurface, underside SurfaceCeiling, shared
// disturbance rings), a sky dome that is always there, a depth dome that
// exists only while the camera is below, a caustic-lit bed, and the
// LensOverlay deciding what the housing itself shows.

// The analytic bed the topside surface refracts into — same dunes and the
// same sandy palette as the makeSandBed mesh, so the bottom seen through
// the surface and the bottom seen from underwater agree.
export function sandLakeBed(depth: number): LakeBed {
  return {
    heightNode: (xz) => mx_noise_float(xz.mul(0.22)).mul(0.35).sub(depth),
    colorNode: (p) => {
      const mottle = mx_noise_float(p.xz.mul(0.5)).mul(0.5).add(0.5);
      const fine = mx_noise_float(p.xz.mul(4.1)).mul(0.5).add(0.5);
      return mix(color(0x57492e), color(0x84714a), mottle).mul(fine.mul(0.3).add(0.78));
    },
  };
}

export interface CrossingSceneOptions {
  hour?: number;
  bedDepth?: number;
  ridge?: boolean;
  overlay?: LensOverlayOptions;
  size?: number;
}

export interface CrossingScene {
  sky: DawnSky;
  lake: LakeSurface;
  ceiling: SurfaceCeiling;
  rings: RippleRings;
  depthDome: DepthDome;
  bed: SandBed;
  crossing: SurfaceCrossing;
  overlay: LensOverlay;
  /** Call once per frame BEFORE rendering. Cleanup is wired into the ctx. */
  sync(t: number, dt: number): void;
}

export function buildCrossingScene(ctx: UnderCtx, opts: CrossingSceneOptions = {}): CrossingScene {
  const { hour = 7.2, bedDepth = 2.6, ridge = true, overlay: overlayOpts, size = 260 } = opts;

  const sky = createDawnSky(hour);
  const skyDome = sky.makeDome();
  const rings = new RippleRings();

  const lake = new LakeSurface({
    env: sky,
    size,
    segments: 192,
    rings,
    bed: sandLakeBed(bedDepth),
  });
  const ceiling = new SurfaceCeiling({ env: sky, size, segments: 160, rings });
  const bed = makeSandBed({ env: sky, waves: ceiling.waves, depth: bedDepth, size: Math.min(size, 90) });
  const depthDome = makeDepthDome(220);
  depthDome.mesh.visible = false;

  ctx.scene.add(skyDome, lake.mesh, ceiling.mesh, bed.mesh, depthDome.mesh);

  let ridgeMesh: Mesh | null = null;
  if (ridge) {
    ridgeMesh = makeRidgeline(Math.max(360, size * 1.4), 95);
    ctx.scene.add(ridgeMesh);
  }

  const crossing = new SurfaceCrossing();
  const overlay = new LensOverlay(ctx.camera, overlayOpts);

  let simT = 0;
  const unsub = onDisturbance((d) => rings.add(d, simT));

  const sync = (t: number, dt: number): void => {
    simT = t;
    lake.update(t);
    ceiling.update(t);
    const cam = ctx.camera.position;
    const water = waterHeightAt(cam.x, cam.z, t);
    const event = crossing.update(cam.y, water, dt);
    if (event) {
      overlay.notify(event, t);
      // the housing itself touches the water
      disturb({ kind: "splash", x: cam.x, z: cam.z, energy: 0.12, radius: 0.18 });
    }
    overlay.update(ctx.camera, water, crossing, t);
    depthDome.mesh.visible = crossing.state === "below";
    depthDome.mesh.position.copy(cam);
    depthDome.camDepth.value = Math.max(0, crossing.depth);
    depthDome.sunDirection.value.copy(sky.sunDirection.value);
  };

  ctx.onDispose(() => {
    unsub();
    overlay.dispose();
    lake.dispose();
    ceiling.dispose();
    bed.dispose();
    depthDome.dispose();
    sky.dispose();
    if (ridgeMesh) disposeMesh(ridgeMesh);
  });

  return { sky, lake, ceiling, rings, depthDome, bed, crossing, overlay, sync };
}

// ---- click → horizontal-plane picking ----------------------------------------------

export function pickPlanePoint(
  event: { clientX: number; clientY: number },
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
  planeY = 0,
): { x: number; z: number } | null {
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  const origin = camera.position;
  const dir = new Vector3(ndcX, ndcY, 0.5).unproject(camera).sub(origin).normalize();
  const dy = planeY - origin.y;
  if (Math.abs(dir.y) < 1e-5) return null;
  const t = dy / dir.y;
  if (t <= 0 || t > 4000) return null;
  return { x: origin.x + dir.x * t, z: origin.z + dir.z * t };
}
