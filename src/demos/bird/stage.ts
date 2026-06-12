// Shared scenery for every New Feathers demo: a WebGPU renderer on the
// shell's canvas, dawn-ish lighting, an optional live lake surface (the same
// ambient wave table the whole site shares), an orbiting camera, and a
// ripple-ring layer that listens to the disturbance bus.

import * as THREE from "three/webgpu";
import { color, positionLocal, transformNormalToView, vec3 } from "three/tsl";
import type { Shell } from "../../lib/demoShell";
import { wind, onDisturbance, type Disturbance } from "../../lib/spine";
import { createWaveUniforms, waveHeightNode, waveNormalNode, type WaveUniforms } from "../../lib/water/waveNodes";

export interface OrbitOptions {
  target?: [number, number, number];
  radius?: number;
  azimuth?: number; // radians; 0 looks from +z
  polar?: number; // radians from the horizon; + looks down
  autoSpin?: number; // radians/second until the reader grabs it
  drag?: boolean; // pointer orbiting (default true)
}

export interface StageOptions {
  fov?: number;
  background?: number;
  water?: boolean | { size?: number; detail?: number };
  ground?: boolean; // matte disc at y = 0 for perched scenes
  rings?: boolean; // ripple rings listening to the disturbance bus
  fog?: [number, number] | false;
  orbit?: OrbitOptions;
}

export interface Stage {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  time: number;
  waveUniforms: WaveUniforms | null;
  orbit: Orbit;
  update(dt: number): void; // advance time, water, rings, camera
  render(): void;
  dispose(): void;
}

class Orbit {
  target = new THREE.Vector3();
  radius = 2;
  azimuth = 0.5;
  polar = 0.32;
  autoSpin = 0;
  private dragging = false;
  private grabbed = false;
  private detach: (() => void) | null = null;

  constructor(private camera: THREE.PerspectiveCamera, opts: OrbitOptions = {}, canvas?: HTMLCanvasElement) {
    if (opts.target) this.target.set(...opts.target);
    this.radius = opts.radius ?? 2;
    this.azimuth = opts.azimuth ?? 0.5;
    this.polar = opts.polar ?? 0.32;
    this.autoSpin = opts.autoSpin ?? 0;

    // Drag to orbit. Deliberately no wheel zoom: the mouse wheel belongs to
    // the page (heroes are full-width — readers must be able to scroll past).
    if (canvas && (opts.drag ?? true)) {
      canvas.style.touchAction = "pan-y";
      const down = (e: PointerEvent): void => {
        this.dragging = true;
        this.grabbed = true;
        canvas.setPointerCapture(e.pointerId);
      };
      const move = (e: PointerEvent): void => {
        if (!this.dragging) return;
        this.azimuth -= e.movementX * 0.008;
        this.polar = Math.min(1.35, Math.max(-0.1, this.polar + e.movementY * 0.006));
      };
      const up = (): void => {
        this.dragging = false;
      };
      canvas.addEventListener("pointerdown", down);
      canvas.addEventListener("pointermove", move);
      canvas.addEventListener("pointerup", up);
      canvas.addEventListener("pointercancel", up);
      this.detach = () => {
        canvas.removeEventListener("pointerdown", down);
        canvas.removeEventListener("pointermove", move);
        canvas.removeEventListener("pointerup", up);
        canvas.removeEventListener("pointercancel", up);
      };
    }
    this.apply();
  }

  update(dt: number): void {
    if (!this.grabbed && this.autoSpin !== 0) this.azimuth += this.autoSpin * dt;
    this.apply();
  }

  apply(): void {
    const cp = Math.cos(this.polar);
    this.camera.position.set(
      this.target.x + Math.sin(this.azimuth) * cp * this.radius,
      this.target.y + Math.sin(this.polar) * this.radius,
      this.target.z + Math.cos(this.azimuth) * cp * this.radius,
    );
    this.camera.lookAt(this.target);
  }

  dispose(): void {
    this.detach?.();
  }
}

// Ripple rings: a listener on the disturbance bus. Every disturb() anywhere
// on the page spawns an expanding, fading ring here — the bus made visible.
class RippleRings {
  readonly group = new THREE.Group();
  private live: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; age: number; life: number; r0: number; speed: number }[] = [];
  private geo = new THREE.RingGeometry(0.88, 1, 48).rotateX(-Math.PI / 2);
  private unsub: () => void;

  constructor() {
    this.unsub = onDisturbance((d) => this.spawn(d));
  }

  spawn(d: Disturbance): void {
    if (this.live.length > 40) return;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xcfe3ee,
      transparent: true,
      opacity: Math.min(0.6, 0.18 + d.energy * 0.45),
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.position.set(d.x, 0.015, d.z);
    mesh.scale.setScalar(Math.max(0.05, d.radius * 0.5));
    this.group.add(mesh);
    this.live.push({
      mesh,
      mat,
      age: 0,
      life: 1.2 + Math.min(1.4, d.energy),
      r0: Math.max(0.05, d.radius * 0.5),
      speed: 0.7 + Math.min(1.6, d.energy * 1.2),
    });
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const r = this.live[i];
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        this.group.remove(r.mesh);
        r.mat.dispose();
        this.live.splice(i, 1);
        continue;
      }
      r.mesh.scale.setScalar(r.r0 + r.age * r.speed);
      r.mat.opacity = (1 - t) * (1 - t) * 0.55;
    }
  }

  dispose(): void {
    this.unsub();
    for (const r of this.live) r.mat.dispose();
    this.geo.dispose();
  }
}

export async function createStage(shell: Shell, opts: StageOptions = {}): Promise<Stage> {
  const canvas = shell.canvas;
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const bg = opts.background ?? 0x0b0f16;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bg);
  if (opts.fog !== false) {
    const [near, far] = opts.fog ?? [16, 60];
    scene.fog = new THREE.Fog(bg, near, far);
  }

  const camera = new THREE.PerspectiveCamera(opts.fov ?? 38, canvas.width / canvas.height, 0.05, 200);
  const orbit = new Orbit(camera, opts.orbit, canvas);

  const hemi = new THREE.HemisphereLight(0x8fa8c8, 0x232120, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9b3, 2.4);
  sun.position.set(-6, 4.5, 5);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x6f87b8, 0.9);
  rim.position.set(4, 3, -6);
  scene.add(rim);

  const disposables: { dispose(): void }[] = [];

  let waveUniforms: WaveUniforms | null = null;
  if (opts.water) {
    const wopts = typeof opts.water === "object" ? opts.water : {};
    const size = wopts.size ?? 36;
    const detail = wopts.detail ?? 110;
    waveUniforms = createWaveUniforms();
    const geo = new THREE.PlaneGeometry(size, size, detail, detail);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.16, metalness: 0 });
    const xz = positionLocal.xz;
    mat.positionNode = positionLocal.add(vec3(0, waveHeightNode(xz, waveUniforms), 0));
    mat.normalNode = transformNormalToView(waveNormalNode(xz, waveUniforms));
    mat.colorNode = color(0x14222c);
    const water = new THREE.Mesh(geo, mat);
    scene.add(water);
    disposables.push(geo, mat);
  }

  if (opts.ground) {
    const geo = new THREE.CircleGeometry(4, 48).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x161a21, roughness: 1, metalness: 0 });
    const disc = new THREE.Mesh(geo, mat);
    scene.add(disc);
    disposables.push(geo, mat);
  }

  let rings: RippleRings | null = null;
  if (opts.rings) {
    rings = new RippleRings();
    scene.add(rings.group);
  }

  const stage: Stage = {
    renderer,
    scene,
    camera,
    sun,
    time: 0,
    waveUniforms,
    orbit,
    update(dt: number) {
      stage.time += dt;
      orbit.update(dt);
      if (waveUniforms) {
        waveUniforms.time.value = stage.time;
        waveUniforms.windDirection.value = wind.direction;
        waveUniforms.windSpeed.value = wind.speed;
      }
      rings?.update(dt);
    },
    render() {
      renderer.render(scene, camera);
    },
    dispose() {
      orbit.dispose();
      rings?.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
    },
  };
  return stage;
}

// Frame-time helper: demos call dt() once per frame and get clamped seconds.
export function makeTimer(): () => number {
  let last = performance.now();
  return () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    return dt;
  };
}
