// Shared plumbing for The Mirror's demos: renderer + camera setup on top of
// the site Shell, a drag orbit, a frame timer, and the bits of scenery the
// water needs around it (silhouette mountains, a snag perch, floating buoys).

import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import {
  cameraPosition,
  mix,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  reflect,
  smoothstep,
  uniform,
  vec3,
} from "three/tsl";
import { Color } from "three/webgpu";
import type { Node } from "three/webgpu";
import { Shell, type Demo } from "../../lib/demoShell";
import { waterHeightAt, waterNormalAt } from "../../lib/spine";

type NodeF = Node<"float">;
type NodeV2 = Node<"vec2">;

// ---- renderer + camera --------------------------------------------------------

export interface MirrorCtxOptions {
  aspect?: number;
  fov?: number;
  near?: number;
  far?: number;
}

export interface MirrorCtx {
  shell: Shell;
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  width: number;
  height: number;
  /** Register cleanup that runs on dispose. */
  onDispose(fn: () => void): void;
  /**
   * Build the Demo: ticks the timer, runs `frame(t, dt)`, renders (or runs
   * `render` instead when given), updates the fps readout.
   */
  finish(frame: (t: number, dt: number) => void, render?: () => void): Demo;
}

export async function mirrorCtx(el: HTMLElement, options: MirrorCtxOptions = {}): Promise<MirrorCtx> {
  const { aspect = 0.62, fov = 50, near = 0.1, far = 2500 } = options;
  const shell = new Shell(el, aspect);
  const renderer = new WebGPURenderer({ canvas: shell.canvas, antialias: true });
  await renderer.init();
  renderer.toneMapping = ACESFilmicToneMapping;
  const width = shell.canvas.width;
  const height = shell.canvas.height;
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

// ---- drag orbit ----------------------------------------------------------------

export interface OrbitOptions {
  target?: Vector3;
  azimuth?: number;
  polar?: number; // radians from horizontal: 0 = water level, π/2 = overhead
  distance?: number;
  minPolar?: number;
  maxPolar?: number;
  /** Slow idle drift, radians/s; stops the first time the user grabs it. */
  drift?: number;
}

export interface Orbit {
  update(dt: number): void;
  dispose(): void;
  setPolar(p: number): void;
}

export function addOrbit(canvas: HTMLCanvasElement, camera: PerspectiveCamera, options: OrbitOptions = {}): Orbit {
  const target = options.target ?? new Vector3(0, 0, 0);
  let azimuth = options.azimuth ?? 0;
  let polar = options.polar ?? 0.35;
  const distance = options.distance ?? 20;
  const minPolar = options.minPolar ?? 0.04;
  const maxPolar = options.maxPolar ?? 1.35;
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
    polarGoal += (e.clientY - lastY) * 0.004;
    polarGoal = Math.min(maxPolar, Math.max(minPolar, polarGoal));
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
    setPolar(p: number) {
      polarGoal = Math.min(maxPolar, Math.max(minPolar, p));
    },
    dispose() {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    },
  };
}

// ---- clay surface: shape without optics -------------------------------------------

export interface ClaySurfaceNodes {
  height(xz: NodeV2): NodeF;
  slope(xz: NodeV2): NodeV2;
}

/**
 * A matte "clay" material for studying wave *shape* before the optics posts:
 * vertex displacement from `height`, per-fragment analytic normal from
 * `slope`, simple key light plus a restrained specular streak so crests read.
 * The mesh must sit at the world origin (local xz == world xz).
 */
export function claySurfaceMaterial(nodes: ClaySurfaceNodes): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.positionNode = positionLocal.add(vec3(0, nodes.height(positionLocal.xz), 0));

  const s = nodes.slope(positionWorld.xz);
  const n = normalize(vec3(s.x.negate(), 1, s.y.negate()));
  const view = normalize(cameraPosition.sub(positionWorld));
  const light = normalize(vec3(0.45, 0.6, 0.3));
  const diffuse = n.dot(light).clamp(0, 1);
  const deep = uniform(new Color(0x1d2a3c));
  const lit = uniform(new Color(0x7c97b8));
  const rim = view.dot(n).clamp(0, 1).oneMinus().pow(3).mul(0.18);
  const spec = reflect(view.negate(), n).dot(light).clamp(0, 1).pow(90).mul(0.5);
  material.colorNode = mix(deep, lit, diffuse.mul(0.85).add(0.08)).add(rim).add(spec);
  return material;
}

// ---- click → water-plane picking ------------------------------------------------

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
  if (dir.y > -1e-4) return null; // looking up: no water hit
  const t = -origin.y / dir.y;
  if (t <= 0 || t > 4000) return null;
  return { x: origin.x + dir.x * t, z: origin.z + dir.z * t };
}

// ---- scenery: silhouette mountains ----------------------------------------------

function hash01(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export interface MountainRingOptions {
  radius?: number;
  height?: number;
  seed?: number;
  baseColor?: number;
  crestColor?: number;
}

/**
 * A ring of jagged silhouette ridges around the lake — a vertical triangle
 * strip whose top edge is a layered-sine + jitter ridge line. Scenery only.
 * TODO(basin): replace with The Basin's real terrain once it exists.
 */
export function makeMountainRing(options: MountainRingOptions = {}): Mesh {
  const { radius = 470, height = 130, seed = 7, baseColor = 0x0b1018, crestColor = 0x232c40 } = options;
  const segments = 240;
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    // Layered sines give the big massifs; lattice jitter gives the serration.
    const cell = (i * 0.22 + seed) | 0;
    const f = (i * 0.22 + seed) % 1;
    const jag = (hash01(cell) * (1 - f) + hash01(cell + 1) * f) * 2 - 1;
    const ridge =
      height *
      (0.5 +
        0.26 * Math.sin(theta * 2.3 + seed * 1.7) +
        0.16 * Math.sin(theta * 5.1 + seed * 0.4) +
        0.1 * Math.sin(theta * 9.7 + seed * 2.9) +
        0.14 * jag);
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    positions.set([x, -6, z], i * 6);
    positions.set([x, Math.max(ridge, height * 0.12), z], i * 6 + 3);
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(indices);

  const material = new MeshBasicNodeMaterial();
  const base = uniform(new Color(baseColor));
  const crest = uniform(new Color(crestColor));
  material.colorNode = mix(base, crest, smoothstep(0, height, positionWorld.y));
  // Render the inside of the ring.
  material.side = 2; // DoubleSide keeps the strip visible from both shores

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

// ---- scenery: snag perch ---------------------------------------------------------

/** Fake-lit flat material: base color shaded by an overhead-ish key light. */
export function fakeLitMaterial(hex: number, sunDirection: { value: Vector3 }): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const base = uniform(new Color(hex));
  const sun = uniform(sunDirection.value); // shares the Vector3 instance
  const ndl = normalWorld.dot(sun).clamp(0, 1);
  material.colorNode = base.rgb.mul(ndl.mul(0.7).add(0.3));
  return material;
}

/** A dead standing tree at the waterline — the future nest site. */
export function makeSnag(x: number, z: number, sunDirection: { value: Vector3 }): Group {
  const group = new Group();
  const material = fakeLitMaterial(0x241a12, sunDirection);
  const parts: [number, number, number, [number, number, number], [number, number, number]][] = [
    // [r1, r2, length, position, rotation]
    [0.1, 0.22, 7.5, [0, 3.4, 0], [0, 0, 0.06]],
    [0.04, 0.09, 3.2, [0.8, 5.2, 0.2], [0, 0, -0.9]],
    [0.03, 0.07, 2.4, [-0.7, 4.3, -0.2], [0.2, 0, 0.95]],
    [0.02, 0.05, 1.6, [0.5, 6.4, -0.3], [-0.4, 0, -0.6]],
  ];
  for (const [r1, r2, len, pos, rot] of parts) {
    const geometry = new CylinderGeometry(r1, r2, len, 7);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    group.add(mesh);
  }
  group.position.set(x, 0, z);
  return group;
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

// ---- scenery: floating buoys ------------------------------------------------------

export interface Buoys {
  group: Group;
  /** Ride the spine's water: heights and normals from `waterHeightAt`. */
  update(t: number): void;
  scatter(): void;
  dispose(): void;
}

const _n = new Vector3();
const _up = new Vector3(0, 1, 0);

export function makeBuoys(count: number, spread: number, sunDirection: { value: Vector3 }): Buoys {
  const group = new Group();
  const spots: { x: number; z: number }[] = [];
  const geometry = new SphereGeometry(0.32, 20, 14);
  const mastGeometry = new CylinderGeometry(0.025, 0.035, 1.1, 6);
  const colors = [0xc25b2a, 0xb8902f, 0x90332a];
  const materials = colors.map((c) => fakeLitMaterial(c, sunDirection));

  const place = (i: number, body: Group): void => {
    const a = hash01(i * 3 + 11) * Math.PI * 2;
    const r = spread * (0.25 + 0.75 * hash01(i * 7 + 5));
    spots[i] = { x: Math.cos(a) * r, z: Math.sin(a) * r };
    body.position.set(spots[i].x, 0, spots[i].z);
  };

  let scatterSeed = 0;
  for (let i = 0; i < count; i++) {
    const body = new Group();
    const ball = new Mesh(geometry, materials[i % materials.length]);
    const mast = new Mesh(mastGeometry, materials[(i + 1) % materials.length]);
    mast.position.y = 0.6;
    body.add(ball, mast);
    place(i, body);
    group.add(body);
  }

  return {
    group,
    update(t: number) {
      for (let i = 0; i < count; i++) {
        const body = group.children[i];
        const { x, z } = spots[i];
        body.position.y = waterHeightAt(x, z, t) - 0.06;
        waterNormalAt(x, z, t, _n);
        body.quaternion.setFromUnitVectors(_up, _n);
      }
    },
    scatter() {
      scatterSeed += 101;
      for (let i = 0; i < count; i++) place(i + scatterSeed, group.children[i] as Group);
    },
    dispose() {
      geometry.dispose();
      mastGeometry.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
