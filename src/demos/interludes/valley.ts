// Shared stage pieces for the Season 2 and Season 3 interludes — the parts
// of a *playable basin* that no single library ships assembled:
//
//   makeValleyTerrain  the canonical basin as one graded mesh: fine cells
//                      where the player lives, geometric growth to the rim
//                      (geometry borrowed from The Splash's graded sheet)
//   syncSunToSky       a real DirectionalLight + hemisphere fill keyed to
//                      whatever sky environment the scene runs
//   addBirdLights      the underwater variant: the key light loses red with
//                      depth (Beer–Lambert on a light's color)
//   RingPulse          bus events → expanding geometry rings, readable from
//                      cruise altitude (the surface shaders answer locally;
//                      this is the far-field telegraph)
//   addOrbit           a drag orbit for the non-piloted figures
//   fmtHour            "6:03" from a clock hour

import {
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  Vector3,
} from "three/webgpu";
import { dot, normalize, positionLocal, positionWorld, uniform, varying, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { onDisturbance, type DisturbanceKind } from "../../lib/spine";
import { makeGradedSheetGeometry } from "../../lib/fluid";
import { terrainHeightNode, terrainNormalNode, terrainSurfaceColor } from "../../lib/terrain";

type NodeV3 = Node<"vec3">;

// ---- the valley, meshed ---------------------------------------------------------

/** The sky seam every series' environment exports: sun uniforms + skyColor. */
export interface SkyEnv {
  sunDirection: { value: Vector3 };
  sunColor: { value: Color };
  skyColor(dir: NodeV3): NodeV3;
}

export interface ValleyTerrainOptions {
  /** Uniform-resolution core (where the player flies low), meters. */
  coreSize?: number;
  /** Cells across the core: coreSize/coreCells = finest cell. */
  coreCells?: number;
  /** Far edge of the mesh, meters (the crest ring sits at ~1150). */
  extent?: number;
  /** Geometric cell growth outside the core. */
  growth?: number;
  /** Sun uniforms (the sky's own — HDR colors are scaled down inside). */
  env: SkyEnv;
  /** Hemisphere fill color; mutate the instance per frame to re-key. */
  ambient?: Color;
  /** Last word on the fragment (height fog goes here). */
  tint?: (lit: NodeV3, world: NodeV3) => NodeV3;
}

export interface ValleyTerrain {
  mesh: Mesh;
  /** The shared ambient color instance (drive it from your palette). */
  ambient: Color;
  dispose(): void;
}

/**
 * The basin as one mesh: a graded sheet displaced by the canonical
 * `terrainHeightNode` in the vertex stage, painted by the Basin's surface
 * material, fake-lit by the scene's sun uniforms so day scenes can re-key
 * it every frame without a real light rig.
 */
export function makeValleyTerrain(options: ValleyTerrainOptions): ValleyTerrain {
  const {
    coreSize = 900,
    coreCells = 180,
    extent = 2800,
    growth = 1.35,
    env,
    ambient = new Color(0x8c9cb4),
    tint,
  } = options;

  const geometry = makeGradedSheetGeometry(coreSize, coreCells, extent, growth);
  const material = new MeshBasicNodeMaterial();

  // The sheet lies in xz at y = 0; lift every vertex onto the basin.
  const xz = positionLocal.xz;
  const h = terrainHeightNode(xz);
  material.positionNode = vec3(xz.x, h, xz.y);

  // Analytic FD normal per vertex (varying pins it to the vertex stage);
  // the FD step matches the core cell so shading detail matches geometry.
  const vNormal = varying(terrainNormalNode(xz, coreSize / coreCells));
  const nrm = normalize(vNormal);

  const ambientU = uniform(ambient); // shares the Color instance
  const albedo = terrainSurfaceColor(positionWorld, nrm);
  const diffuse = dot(nrm, env.sunDirection as unknown as NodeV3).clamp(0, 1);
  // HDR sun (≈3.6 at full day) scaled to a sane key; ambient fills shadows.
  const lit = albedo.mul(
    (env.sunColor as unknown as NodeV3).mul(diffuse).mul(0.3).add(ambientU.mul(0.85)),
  );
  material.colorNode = tint ? tint(lit, positionWorld) : lit;

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false; // displaced verts vs. a flat bounding box

  return {
    mesh,
    ambient,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ---- lights keyed to a sky env ------------------------------------------------------

export interface SkyLights {
  sun: DirectionalLight;
  hemi: HemisphereLight;
  /** Re-key both lights from the env's current uniforms. Call per frame. */
  sync(): void;
  dispose(): void;
}

/**
 * A real sun + hemisphere pair for standard-material bodies (the osprey,
 * the fish), normalized from the sky's HDR sun color so the bird neither
 * blows out at noon nor vanishes at dusk.
 */
export function syncSunToSky(scene: Scene, env: SkyEnv): SkyLights {
  const sun = new DirectionalLight(0xffffff, 2.2);
  const hemi = new HemisphereLight(0x90a8c8, 0x232a22, 0.6);
  scene.add(sun, hemi);

  const sync = (): void => {
    const c = sun.color.copy(env.sunColor.value);
    const m = Math.max(c.r, c.g, c.b);
    if (m > 1e-4) c.multiplyScalar(1 / m);
    sun.intensity = 0.2 + Math.min(3.0, m);
    sun.position.copy(env.sunDirection.value).multiplyScalar(600);
    if (sun.position.y < 40) sun.position.y = 40; // pre-sunrise: glow-band light
    hemi.intensity = 0.3 + Math.min(0.55, m * 0.16);
  };
  sync();

  return {
    sun,
    hemi,
    sync,
    dispose() {
      scene.remove(sun, hemi);
      sun.dispose();
      hemi.dispose();
    },
  };
}

export interface BirdLights {
  /** Pass the body's depth below the surface (≥ 0 above water). */
  update(depth: number): void;
  dispose(): void;
}

/** Key + rim + fill for an underwater figure: the key light's color runs
 *  the same Beer–Lambert the water shaders use, so a sunlit bird two meters
 *  down goes green-white exactly when the medium says it should. */
export function addBirdLights(scene: Scene): BirdLights {
  const hemi = new HemisphereLight(0x9db8d8, 0x1c2a28, 0.9);
  const sun = new DirectionalLight(0xffd9b3, 2.3);
  sun.position.set(-5, 6, 4);
  const rim = new DirectionalLight(0x6f87b8, 0.7);
  rim.position.set(4, 2, -6);
  scene.add(hemi, sun, rim);
  return {
    update(depth: number) {
      const d = Math.max(0, depth);
      sun.color.setRGB(Math.exp(-0.42 * d), 0.85 * Math.exp(-0.09 * d), 0.7 * Math.exp(-0.035 * d));
      hemi.intensity = 0.9 - Math.min(0.45, d * 0.12);
    },
    dispose() {
      scene.remove(hemi, sun, rim);
      sun.dispose();
      rim.dispose();
      hemi.dispose();
    },
  };
}

// ---- bus events as geometry rings -----------------------------------------------------
// The surface shaders only answer disturbances locally (the ring pool is
// small, the sim window is 28 m wide). The hunt needs rises readable from
// eighty meters up — so the bus also feeds this: flat expanding rings, one
// mesh per live event, faded by age. Stage dressing with a gameplay job.

interface LiveRing {
  mesh: Mesh;
  material: MeshBasicMaterial;
  age: number;
  life: number;
}

export class RingPulse {
  readonly group = new Group();

  private readonly geometry = new RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
  private readonly live: LiveRing[] = [];
  private readonly unsub: () => void;

  constructor(kinds: DisturbanceKind[] = ["rise", "splash"], capacity = 24, minEnergy = 0.015) {
    this.unsub = onDisturbance((d) => {
      if (!kinds.includes(d.kind) || d.energy < minEnergy) return;
      if (this.live.length >= capacity) return;
      const material = new MeshBasicMaterial({
        color: 0xd6e8f2,
        transparent: true,
        opacity: Math.min(0.55, 0.18 + d.energy * 0.4),
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(this.geometry, material);
      mesh.position.set(d.x, 0.03, d.z);
      mesh.scale.setScalar(Math.max(0.15, d.radius));
      this.group.add(mesh);
      this.live.push({ mesh, material, age: 0, life: 1.6 + Math.min(1.4, d.energy) });
    });
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const r = this.live[i];
      r.age += dt;
      if (r.age >= r.life) {
        this.group.remove(r.mesh);
        r.material.dispose();
        this.live.splice(i, 1);
        continue;
      }
      r.mesh.scale.addScalar(dt * 1.2);
      r.material.opacity = (1 - r.age / r.life) ** 2 * 0.5;
    }
  }

  dispose(): void {
    this.unsub();
    for (const r of this.live) r.material.dispose();
    this.live.length = 0;
    this.geometry.dispose();
  }
}

// ---- drag orbit -------------------------------------------------------------------------

export interface OrbitOptions {
  target?: Vector3;
  azimuth?: number;
  polar?: number; // radians above the horizon (negative looks up from below)
  distance?: number;
  minPolar?: number;
  maxPolar?: number;
  /** Idle drift, radians/s; stops the first time the user grabs the canvas. */
  drift?: number;
}

export interface Orbit {
  target: Vector3;
  update(dt: number): void;
  dispose(): void;
}

export function addOrbit(canvas: HTMLCanvasElement, camera: PerspectiveCamera, options: OrbitOptions = {}): Orbit {
  const target = options.target ?? new Vector3(0, 0, 0);
  let azimuth = options.azimuth ?? 0.8;
  let polar = options.polar ?? 0.5;
  const distance = options.distance ?? 20;
  const minPolar = options.minPolar ?? 0.05;
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
    dispose() {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    },
  };
}

// ---- small helpers --------------------------------------------------------------------

/** "6:03" from a clock hour. */
export function fmtHour(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  return `${Math.floor(hh)}:${String(Math.floor((hh % 1) * 60)).padStart(2, "0")}`;
}
