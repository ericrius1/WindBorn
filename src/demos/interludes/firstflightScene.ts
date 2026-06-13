// Scenery and shared plumbing for the First Flight interlude. The water —
// surface material, planar reflection, ripple rings, dawn-sky palette — comes
// straight from The Mirror's library (src/lib/water). Everything the
// libraries don't ship for a *lit* scene (silhouette ridges around the
// horizon, a snag landmark, a sun + fill keyed to the dawn palette so the
// standard-material bird reads) is rebuilt minimally here.
//
// TODO(interlude): adopt src/lib/sky once stable — the sun light, hemisphere
// fill, and ridge silhouettes below are placeholders keyed to clock.hour
// through the water library's dawn palette.

import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGPURenderer,
} from "three/webgpu";
import { mix, positionWorld, smoothstep, uniform } from "three/tsl";
import { Shell, type Demo } from "../../lib/demoShell";
import { clock, disturb, onDisturbance, wind } from "../../lib/spine";
import { LakeSurface, PlanarReflection, RippleRings, createDawnSky, type DawnSky } from "../../lib/water";

// ---- renderer + camera + frame loop ------------------------------------------

export interface InterludeCtxOptions {
  aspect?: number;
  fov?: number;
  near?: number;
  far?: number;
  /** Internal render resolution as a fraction of the canvas; raymarch-heavy
   *  heroes run at ~0.7 and let CSS stretch the difference. */
  renderScale?: number;
}

export interface InterludeCtx {
  shell: Shell;
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  width: number;
  height: number;
  onDispose(fn: () => void): void;
  /** Build the Demo: tick a clamped timer, run frame(t, dt), then render. */
  finish(frame: (t: number, dt: number) => void, render?: () => void): Demo;
}

export async function interludeCtx(el: HTMLElement, options: InterludeCtxOptions = {}): Promise<InterludeCtx> {
  const { aspect = 0.56, fov = 52, near = 0.1, far = 2600, renderScale = 1 } = options;
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
          const dt = Math.min((now - last) / 1000, 0.05);
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

// ---- silhouette ridges --------------------------------------------------------
// A ring of dark serrated ridgelines so the horizon isn't a bare seam between
// lake and sky. Pure stage dressing: a vertical triangle strip whose top edge
// is layered sines plus smoothed lattice jitter.
// TODO(interlude): replace with The Basin's real terrain once it ships.

function hash01(n: number): number {
  const s = Math.sin(n * 91.7 + 47.3) * 24634.6345;
  return s - Math.floor(s);
}

interface RidgeOptions {
  radius: number;
  height: number;
  seed: number;
  baseColor: number;
  crestColor: number;
}

function makeRidgeRing(opts: RidgeOptions): Mesh {
  const { radius, height, seed, baseColor, crestColor } = opts;
  const segments = 200;
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const u = i * 0.31 + seed * 3.7;
    const cell = Math.floor(u);
    const f = u - cell;
    const fs = f * f * (3 - 2 * f);
    const jag = (hash01(cell) * (1 - fs) + hash01(cell + 1) * fs) * 2 - 1;
    const ridge =
      height *
      (0.45 +
        0.27 * Math.sin(theta * 2.7 + seed) +
        0.15 * Math.sin(theta * 6.3 + seed * 1.9) +
        0.09 * Math.sin(theta * 11.4 + seed * 0.7) +
        0.16 * jag);
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    positions.set([x, -5, z], i * 6);
    positions.set([x, Math.max(ridge, height * 0.14), z], i * 6 + 3);
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
  material.side = 2; // DoubleSide: visible from anywhere on the lake

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

// ---- the snag -------------------------------------------------------------------
// The dead standing tree at the waterline — the future nest site, and the one
// fixed landmark to navigate by. Lit by the scene's real lights.

function makeSnag(x: number, z: number): Group {
  const group = new Group();
  const material = new MeshStandardMaterial({ color: 0x2a1d12, roughness: 1, metalness: 0, flatShading: true });
  const parts: [number, number, number, [number, number, number], [number, number, number]][] = [
    // [topRadius, bottomRadius, length, position, rotation]
    [0.09, 0.24, 8.0, [0, 3.6, 0], [0, 0, 0.05]],
    [0.035, 0.085, 3.4, [0.9, 5.5, 0.3], [0, 0, -0.85]],
    [0.03, 0.07, 2.6, [-0.8, 4.6, -0.2], [0.25, 0, 0.9]],
    [0.02, 0.045, 1.7, [0.4, 6.9, -0.4], [-0.45, 0, -0.55]],
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

function disposeGroup(group: Group): void {
  group.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
    }
  });
}

// ---- the dawn world -----------------------------------------------------------

export interface DawnWorldOptions {
  /** World-clock hour the scene wakes at (the dawn window is 4.4–9). */
  hour?: number;
  /** Mean wind m/s — also sets the swell the bird floats on. */
  windSpeed?: number;
  /** Mirror pass for the lake; costs a second scene render. */
  reflection?: boolean;
  reflectionScale?: number;
  size?: number;
  segments?: number;
  mountains?: boolean;
  /** Snag position, or null for open water. */
  snag?: [number, number] | null;
  /** Occasional fish rises on the disturbance bus. */
  autoRises?: boolean;
  /** Where the rises should cluster (e.g. near the bird). */
  riseCenter?: () => { x: number; z: number };
  /** Re-key the sky from the advancing world clock every frame. */
  followClock?: boolean;
}

export interface DawnWorld {
  sky: DawnSky;
  lake: LakeSurface;
  rings: RippleRings;
  update(t: number): void;
  renderReflection(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera): void;
  dispose(): void;
}

export function buildDawnWorld(scene: Scene, width: number, height: number, options: DawnWorldOptions = {}): DawnWorld {
  const {
    hour = 6.1,
    windSpeed = 1.4,
    reflection = false,
    reflectionScale = 0.5,
    size = 900,
    segments = 180,
    mountains = true,
    snag = null,
    autoRises = false,
    riseCenter,
    followClock = false,
  } = options;

  clock.setHour(hour);
  wind.speed = windSpeed;

  const sky = createDawnSky(hour);
  const dome = sky.makeDome(1150);
  scene.add(dome);

  const ridges: Mesh[] = [];
  if (mountains) {
    ridges.push(
      makeRidgeRing({ radius: 740, height: 215, seed: 5, baseColor: 0x121a2c, crestColor: 0x3a4a6e }),
      makeRidgeRing({ radius: 470, height: 118, seed: 11, baseColor: 0x0a0e17, crestColor: 0x1f2940 }),
    );
    for (const r of ridges) scene.add(r);
  }

  let snagGroup: Group | null = null;
  if (snag) {
    snagGroup = makeSnag(snag[0], snag[1]);
    scene.add(snagGroup);
  }

  const rings = new RippleRings();
  const mirror = reflection
    ? new PlanarReflection(Math.max(64, Math.round(width * reflectionScale)), Math.max(64, Math.round(height * reflectionScale)))
    : null;
  const lake = new LakeSurface({ env: sky, reflection: mirror, rings, size, segments });
  lake.roughness.value = 0.06;
  scene.add(lake.mesh);

  // Real lights for the standard-material bird and snag, keyed to the same
  // palette the dome and water read.
  const sun = new DirectionalLight(0xffffff, 2.2);
  const hemi = new HemisphereLight(0x90a8c8, 0x1a2027, 0.65);
  scene.add(sun, hemi);

  const syncSun = (): void => {
    const c = sun.color.copy(sky.sunColor.value);
    const m = Math.max(c.r, c.g, c.b);
    if (m > 1e-4) c.multiplyScalar(1 / m);
    sun.intensity = 0.25 + Math.min(3.2, m);
    sun.position.copy(sky.sunDirection.value).multiplyScalar(420);
    if (sun.position.y < 30) sun.position.y = 30; // pre-sunrise: light from the glow band
  };
  syncSun();

  // The bus: every disturbance anywhere becomes a ring packet on the lake.
  let now = 0;
  const offBus = onDisturbance((d) => rings.add(d, now));
  let nextRise = 3;

  return {
    sky,
    lake,
    rings,
    update(t) {
      now = t;
      lake.update(t);
      if (followClock) sky.setHour(clock.hour);
      syncSun();
      if (autoRises && t > nextRise) {
        nextRise = t + 3 + Math.random() * 6;
        const c = riseCenter ? riseCenter() : { x: 0, z: 0 };
        const a = Math.random() * Math.PI * 2;
        const r = 6 + Math.random() * 22;
        disturb({
          kind: "rise",
          x: c.x + Math.cos(a) * r,
          z: c.z + Math.sin(a) * r,
          energy: 0.02 + Math.random() * 0.06,
          radius: 0.4,
        });
      }
    },
    renderReflection(renderer, sceneRef, camera) {
      if (mirror) mirror.render(renderer, sceneRef, camera, [lake.mesh]);
    },
    dispose() {
      offBus();
      lake.dispose();
      mirror?.dispose();
      sky.dispose();
      for (const r of ridges) {
        r.geometry.dispose();
        (r.material as MeshBasicNodeMaterial).dispose();
      }
      if (snagGroup) disposeGroup(snagGroup);
    },
  };
}

// ---- click-to-focus overlay ------------------------------------------------------
// Keyboard demos must not steal keys from the page; the canvas only listens
// while focused, and this overlay makes that visible: a prompt pill while
// idle, a control-hint bar while flying.

export class PilotOverlay {
  private readonly wrapper: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private _focused = false;
  private readonly onFocus = (): void => this.sync(true);
  private readonly onBlur = (): void => this.sync(false);
  private readonly onPointer = (): void => this.canvas.focus();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    hint: string,
  ) {
    this.wrapper = document.createElement("div");
    this.wrapper.style.position = "relative";
    canvas.parentElement?.insertBefore(this.wrapper, canvas);
    this.wrapper.appendChild(canvas);
    canvas.tabIndex = 0;
    canvas.style.outline = "none";
    canvas.style.cursor = "pointer";

    this.prompt = document.createElement("div");
    this.prompt.style.cssText = "position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;";
    const pill = document.createElement("span");
    pill.textContent = "Click to take the stick";
    pill.style.cssText =
      "padding:.5rem 1.1rem;border-radius:999px;border:1px solid rgba(122,162,255,.5);" +
      "background:rgba(10,11,16,.72);color:#d7dbe6;font:600 .82rem ui-sans-serif,system-ui,sans-serif;" +
      "letter-spacing:.06em;";
    this.prompt.appendChild(pill);
    this.wrapper.appendChild(this.prompt);

    this.bar = document.createElement("div");
    this.bar.textContent = hint;
    this.bar.style.cssText =
      "position:absolute;left:50%;bottom:.6rem;transform:translateX(-50%);max-width:94%;" +
      "padding:.28rem .8rem;border-radius:999px;background:rgba(10,11,16,.66);color:#aab4d4;" +
      "font:600 .68rem ui-monospace,Menlo,monospace;white-space:nowrap;overflow:hidden;" +
      "text-overflow:ellipsis;pointer-events:none;transition:opacity .3s;";
    this.wrapper.appendChild(this.bar);

    canvas.addEventListener("focus", this.onFocus);
    canvas.addEventListener("blur", this.onBlur);
    canvas.addEventListener("pointerdown", this.onPointer);
    this.sync(false);
  }

  private sync(focused: boolean): void {
    this._focused = focused;
    this.prompt.style.opacity = focused ? "0" : "1";
    this.bar.style.opacity = focused ? "0.9" : "0.45";
  }

  get focused(): boolean {
    return this._focused;
  }

  dispose(): void {
    this.canvas.removeEventListener("focus", this.onFocus);
    this.canvas.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("pointerdown", this.onPointer);
  }
}
