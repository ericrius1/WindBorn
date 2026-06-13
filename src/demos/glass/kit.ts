// Shared plumbing for Glass & Grain's demos: renderer + camera on the site
// Shell (with the post chain doing the final draw), a drag orbit, a lake
// stage (atmosphere + Mirror surface + basin backdrop + palette-keyed
// lights) that every grading demo points its camera at, a crossing stage
// for the wet-lens page, and a scripted dive flier that publishes honest
// FlightState numbers without needing the player's stick.

import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import type { Node } from "three/webgpu";
import {
  cameraPosition,
  color,
  dot,
  exp,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  positionWorld,
  uniform,
  varying,
  vec3,
} from "three/tsl";
import { Shell, type Demo } from "../../lib/demoShell";
import { clock, disturb, onDisturbance, waterHeightAt, waterNormalAt, wind } from "../../lib/spine";
import { createAtmosphere, skyColors, createSkyPalette, type Atmosphere } from "../../lib/sky";
import { LakeSurface, RippleRings, type LakeBed } from "../../lib/water";
import { terrainHeightNode, terrainNormalNode, terrainSurfaceColor } from "../../lib/terrain";
import {
  SurfaceCeiling,
  SurfaceCrossing,
  makeDepthDome,
  mediumColorNode,
  underwaterFog,
  type CrossingEvent,
  type DepthDome,
} from "../../lib/underwater";
import { buildOsprey, type Osprey } from "../../lib/bird/build";
import { OspreyAnimator } from "../../lib/bird/animator";
import { flightState } from "../../lib/flight";

type NodeV3 = Node<"vec3">;

// ---- renderer + camera --------------------------------------------------------

export interface GlassCtxOptions {
  aspect?: number;
  fov?: number;
  near?: number;
  far?: number;
  /** Internal render resolution as a fraction of the canvas (post chains on
   *  big hero canvases run at ~0.75 and let CSS stretch). */
  renderScale?: number;
}

export interface GlassCtx {
  shell: Shell;
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  width: number;
  height: number;
  onDispose(fn: () => void): void;
  /** `render` defaults to a plain renderer.render; post demos pass their
   *  stack's render so the chain owns the final draw. */
  finish(frame: (t: number, dt: number) => void, render?: () => void): Demo;
}

export async function glassCtx(el: HTMLElement, options: GlassCtxOptions = {}): Promise<GlassCtx> {
  const { aspect = 0.62, fov = 50, near = 0.1, far = 8000, renderScale = 1 } = options;
  const shell = new Shell(el, aspect);
  const renderer = new WebGPURenderer({ canvas: shell.canvas, antialias: true });
  await renderer.init();
  renderer.toneMapping = ACESFilmicToneMapping; // the curve renderOutput applies
  const width = Math.round(shell.canvas.width * renderScale);
  const height = Math.round(shell.canvas.height * renderScale);
  renderer.setSize(width, height, false);

  const scene = new Scene();
  const camera = new PerspectiveCamera(fov, width / height, near, far);
  scene.add(camera);

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
  polar?: number; // radians above the horizon; negative looks up from below
  distance?: number;
  minPolar?: number;
  maxPolar?: number;
  /** Idle drift, rad/s; stops the first time the user grabs the canvas. */
  drift?: number;
}

export interface Orbit {
  target: Vector3;
  update(dt: number): void;
  setPolar(p: number): void;
  setDistance(d: number): void;
  dispose(): void;
}

export function addOrbit(canvas: HTMLCanvasElement, camera: PerspectiveCamera, options: OrbitOptions = {}): Orbit {
  const target = options.target ?? new Vector3(0, 1, 0);
  let azimuth = options.azimuth ?? 0.8;
  let polar = options.polar ?? 0.2;
  let distance = options.distance ?? 18;
  const minPolar = options.minPolar ?? 0.02;
  const maxPolar = options.maxPolar ?? 1.3;
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

// ---- the basin backdrop ---------------------------------------------------------
// The canonical terrain height (The Basin's GPU twin) on a flat grid,
// fake-lit by shared sun/ambient uniforms, faded toward a fog color with
// distance so the far ridges sit in the air instead of on it.

interface BackdropOptions {
  size?: number;
  segments?: number;
  sunDirection: { value: Vector3 };
  sunColor: { value: Color };
  ambient: { value: Color };
  fog: { value: Color };
}

interface Backdrop {
  mesh: Mesh;
  dispose(): void;
}

function makeBasinBackdrop(options: BackdropOptions): Backdrop {
  const { size = 3200, segments = 160 } = options;

  const n = segments;
  const positions = new Float32Array((n + 1) * (n + 1) * 3);
  let p = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      positions[p] = (i / n - 0.5) * size;
      positions[p + 2] = (j / n - 0.5) * size;
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
  material.positionNode = vec3(xz.x, terrainHeightNode(xz), xz.y);

  const vN = varying(terrainNormalNode(xz, size / segments));
  const nrm = normalize(vN);

  const sunDir = uniform(options.sunDirection.value); // shares the Vector3
  const sunC = uniform(options.sunColor.value); // shares the Color
  const ambC = uniform(options.ambient.value);
  const fogC = uniform(options.fog.value);

  const albedo = terrainSurfaceColor(positionWorld, nrm);
  const diffuse = dot(nrm, sunDir).clamp(0, 1);
  // HDR sun scaled to a sane key; ambient fills the shadows.
  const lit = albedo.mul(sunC.rgb.mul(diffuse).mul(0.3).add(ambC.rgb.mul(0.85)));
  // a one-term aerial perspective so distance reads (mist.html owns the real one)
  const dist = positionWorld.sub(cameraPosition).length();
  const fade = exp(dist.mul(-0.00085).mul(positionWorld.y.mul(0.004).add(1).reciprocal())).oneMinus();
  material.colorNode = mix(lit, fogC.rgb, fade.clamp(0, 0.96));

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

// ---- the lake stage -------------------------------------------------------------
// Atmosphere dome + the Mirror's LakeSurface + the basin backdrop + a
// palette-keyed key light for mesh props (the bird). setHour() keys all of
// it; the post chain keys the grade to the same hour, which is the point.

export interface LakeStageOptions {
  hour?: number;
  /** Lake mesh side length, meters. */
  size?: number;
  /** Mountains around the lake. */
  terrain?: boolean;
  /** Analytic shallows bed under the surface near shore. */
  bed?: boolean;
}

export interface LakeStage {
  atmosphere: Atmosphere;
  lake: LakeSurface;
  rings: RippleRings;
  sun: DirectionalLight;
  hemi: HemisphereLight;
  /** Current stage hour (drives sky, palette lights — not the spine clock). */
  readonly hour: number;
  setHour(h: number): void;
  /** Advance waves/rings; call once per frame with scene seconds. */
  update(t: number, dt: number): void;
}

const SHALLOWS_BED: LakeBed = {
  heightNode: (xz) => mx_noise_float(xz.mul(0.13)).mul(0.5).sub(2.3),
  colorNode: (p) => {
    const mottle = mx_noise_float(p.xz.mul(0.5)).mul(0.5).add(0.5);
    return mix(color(0x4f422a), color(0x7d6b46), mottle);
  },
};

export function makeLakeStage(ctx: GlassCtx, options: LakeStageOptions = {}): LakeStage {
  const { hour = 7.4, size = 600, terrain = true, bed = true } = options;

  const atmosphere = createAtmosphere(hour);
  const dome = atmosphere.makeDome();
  const rings = new RippleRings();
  const lake = new LakeSurface({
    env: atmosphere,
    size,
    segments: 192,
    rings,
    bed: bed ? SHALLOWS_BED : null,
  });

  // palette-keyed lights for standard-material props (the bird)
  const palette = createSkyPalette();
  const hemi = new HemisphereLight(0x9db8d8, 0x1c2a28, 0.7);
  const sun = new DirectionalLight(0xffffff, 1.5);
  const ambient = uniform(new Color(0x404a5a));
  const fog = uniform(new Color(0x90a4b8));
  ctx.scene.add(dome, lake.mesh, hemi, sun);

  let backdrop: Backdrop | null = null;
  if (terrain) {
    backdrop = makeBasinBackdrop({
      sunDirection: atmosphere.sunDirection,
      sunColor: atmosphere.sunColor,
      ambient,
      fog,
    });
    ctx.scene.add(backdrop.mesh);
  }

  let hourNow = hour;
  const setHour = (h: number): void => {
    hourNow = h;
    atmosphere.setHour(h);
    skyColors(h, palette);
    sun.color.copy(palette.sun);
    sun.intensity = palette.sunIntensity * 2.2 + 0.02;
    sun.position.copy(atmosphere.sunDirection.value).multiplyScalar(60);
    hemi.color.copy(palette.horizon);
    hemi.intensity = palette.ambientIntensity * 1.4 + 0.05;
    ambient.value.copy(palette.ambient);
    fog.value.copy(palette.fog);
  };
  setHour(hour);

  let simT = 0;
  const unsub = onDisturbance((d) => rings.add(d, simT));

  ctx.onDispose(() => {
    unsub();
    lake.dispose();
    atmosphere.dispose();
    backdrop?.dispose();
  });

  return {
    atmosphere,
    lake,
    rings,
    sun,
    hemi,
    get hour() {
      return hourNow;
    },
    setHour,
    update(t: number) {
      simT = t;
      lake.update(t);
    },
  };
}

// ---- the floating osprey ---------------------------------------------------------

export interface Floater {
  osprey: Osprey;
  anim: OspreyAnimator;
  update(dt: number, t: number): void;
  dispose(): void;
}

export function makeFloater(scene: Scene, x: number, z: number): Floater {
  const osprey = buildOsprey();
  osprey.group.position.set(x, 0, z);
  scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);
  anim.requestPose("float");
  anim.gait01 = 1;

  const n = new Vector3();
  const up = new Vector3(0, 1, 0);
  const lean = { q: osprey.group.quaternion.clone() };
  let wakeTimer = 0.6;
  return {
    osprey,
    anim,
    update(dt: number, t: number) {
      const g = osprey.group;
      g.position.y = waterHeightAt(g.position.x, g.position.z, t) - 0.16;
      waterNormalAt(g.position.x, g.position.z, t, n);
      lean.q.setFromUnitVectors(up, n);
      g.quaternion.slerp(lean.q, Math.min(1, dt * 2));
      anim.update(dt);
      wakeTimer -= dt;
      if (wakeTimer <= 0) {
        wakeTimer = 1.7;
        disturb({ kind: "wake", x: g.position.x, z: g.position.z, energy: 0.02, radius: 0.3 });
      }
    },
    dispose() {
      osprey.dispose();
    },
  };
}

// ---- the crossing stage (wetlens) --------------------------------------------------
// The lake rendered twice — topside LakeSurface, underside SurfaceCeiling,
// shared bus rings — plus a mottled bed and a depth dome below. No overlay
// quads anywhere: the post chain's WetLensFx owns everything the housing
// shows, which is the whole argument of wetlens.html.

export interface CrossingStageOptions {
  hour?: number;
  bedDepth?: number;
  size?: number;
  /** Called when the camera passes through the surface. */
  onCrossing?: (event: CrossingEvent, t: number) => void;
}

export interface CrossingStage {
  atmosphere: Atmosphere;
  lake: LakeSurface;
  ceiling: SurfaceCeiling;
  crossing: SurfaceCrossing;
  depthDome: DepthDome;
  rings: RippleRings;
  /** Water height under the camera, from the last sync. */
  readonly waterY: number;
  /** Per frame, BEFORE stack.update()/render(). */
  sync(t: number, dt: number): void;
}

function makeUnderBed(depth: number, size: number): Backdrop {
  const geometry = new BufferGeometry();
  const n = 64;
  const positions = new Float32Array((n + 1) * (n + 1) * 3);
  let p = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      positions[p] = (i / n - 0.5) * size;
      positions[p + 2] = (j / n - 0.5) * size;
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
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(tris, 1));

  const material = new MeshBasicNodeMaterial();
  const dunes = mx_noise_float(positionLocal.xz.mul(0.13)).mul(0.5);
  material.positionNode = positionLocal.add(vec3(0, dunes, 0));

  const xz = positionWorld.xz;
  const mottle = mx_noise_float(xz.mul(0.5)).mul(0.5).add(0.5);
  const albedo = mix(color(0x4f422a), color(0x7d6b46), mottle) as NodeV3;
  const fragDepth = positionWorld.y.negate().max(0.05);
  const lit = albedo.mul(mediumColorNode(fragDepth).mul(0.9).add(0.05));
  const dist = positionWorld.sub(cameraPosition).length();
  material.colorNode = underwaterFog(lit, mediumColorNode(fragDepth.mul(0.6)), dist, uniform(0.08));

  const mesh = new Mesh(geometry, material);
  mesh.position.y = -depth;
  mesh.frustumCulled = false;
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function makeCrossingStage(ctx: GlassCtx, options: CrossingStageOptions = {}): CrossingStage {
  const { hour = 7.2, bedDepth = 2.6, size = 240, onCrossing } = options;

  const atmosphere = createAtmosphere(hour);
  const dome = atmosphere.makeDome(3000);
  const rings = new RippleRings();
  const lake = new LakeSurface({
    env: atmosphere,
    size,
    segments: 176,
    rings,
    bed: {
      heightNode: (xz) => mx_noise_float(xz.mul(0.13)).mul(0.5).sub(bedDepth),
      colorNode: (p) => {
        const mottle = mx_noise_float(p.xz.mul(0.5)).mul(0.5).add(0.5);
        return mix(color(0x4f422a), color(0x7d6b46), mottle);
      },
    },
  });
  const ceiling = new SurfaceCeiling({ env: atmosphere, size, segments: 144, rings });
  const bed = makeUnderBed(bedDepth, Math.min(size, 90));
  const depthDome = makeDepthDome(200);
  depthDome.mesh.visible = false;

  // a key light so mesh props read on the air side
  const hemi = new HemisphereLight(0x9db8d8, 0x1c2a28, 0.8);
  const sun = new DirectionalLight(0xffd9b3, 2.0);
  sun.position.copy(atmosphere.sunDirection.value).multiplyScalar(50);

  ctx.scene.add(dome, lake.mesh, ceiling.mesh, bed.mesh, depthDome.mesh, hemi, sun);

  const crossing = new SurfaceCrossing();
  let simT = 0;
  let waterY = 0;
  const unsub = onDisturbance((d) => rings.add(d, simT));

  ctx.onDispose(() => {
    unsub();
    lake.dispose();
    ceiling.dispose();
    bed.dispose();
    depthDome.dispose();
    atmosphere.dispose();
  });

  return {
    atmosphere,
    lake,
    ceiling,
    crossing,
    depthDome,
    rings,
    get waterY() {
      return waterY;
    },
    sync(t: number, dt: number) {
      simT = t;
      lake.update(t);
      ceiling.update(t);
      const cam = ctx.camera.position;
      waterY = waterHeightAt(cam.x, cam.z, t);
      const event = crossing.update(cam.y, waterY, dt);
      if (event) {
        onCrossing?.(event, t);
        disturb({ kind: "splash", x: cam.x, z: cam.z, energy: 0.12, radius: 0.18 });
      }
      depthDome.mesh.visible = crossing.state === "below";
      depthDome.mesh.position.copy(cam);
      depthDome.camDepth.value = Math.max(0, crossing.depth);
      depthDome.sunDirection.value.copy(atmosphere.sunDirection.value);
    },
  };
}

// ---- the scripted dive flier --------------------------------------------------------
// speedsight.html needs honest FlightState numbers without the player's
// stick: a kinematic osprey on a repeating circuit — cruise circle, tuck,
// dive, pull-out skim, climb — that publishes airspeed/verticalSpeed/tuck
// to the shared telemetry the way any scene that owns the bird would.

export interface DiveFlier {
  osprey: Osprey;
  anim: OspreyAnimator;
  position: Vector3;
  velocity: Vector3;
  /** 0..1 — where the circuit is (for readouts). */
  readonly phase: number;
  update(dt: number, t: number): void;
  dispose(): void;
}

const CIRCUIT = 14; // seconds per lap

export function makeDiveFlier(scene: Scene): DiveFlier {
  const osprey = buildOsprey();
  scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);

  const position = new Vector3(0, 24, 0);
  const velocity = new Vector3();
  const prev = new Vector3();
  const fwd = new Vector3(1, 0, 0);
  let phase = 0;
  let tuck = 0;
  let splashed = false;

  // The path: a parametric circuit, continuous at every seam. s in [0,1).
  //   0.00–0.55 cruise arc at 24 m, radius 40 (~18 m/s)
  //   0.55–0.73 tuck + accelerating dive to the strike point (~30 m/s)
  //   0.73–0.79 pull-out skim brushing the water
  //   0.79–1.00 steady climb back to the start of the arc
  const A0 = -Math.PI / 4;
  const SWEEP = Math.PI * 1.1;
  const R = 40;
  const P1 = new Vector3(Math.cos(A0 + SWEEP) * R, 24, Math.sin(A0 + SWEEP) * R); // dive entry
  const P2 = new Vector3(-6, 1.2, -6); // strike point
  const DIRH = new Vector3(P2.x - P1.x, 0, P2.z - P1.z).normalize();
  const P3 = new Vector3(P2.x + DIRH.x * 17, 1.2, P2.z + DIRH.z * 17); // skim end
  const C0 = new Vector3(Math.cos(A0) * R, 24, Math.sin(A0) * R); // lap start

  const posAt = (s: number, out: Vector3): Vector3 => {
    if (s < 0.55) {
      const a = A0 + (s / 0.55) * SWEEP;
      return out.set(Math.cos(a) * R, 24, Math.sin(a) * R);
    }
    if (s < 0.73) {
      const k = (s - 0.55) / 0.18;
      const e = Math.pow(k, 1.7); // ease-in: the dive gathers speed
      return out.copy(P1).lerp(P2, e);
    }
    if (s < 0.79) {
      const k = (s - 0.73) / 0.06;
      out.copy(P2).addScaledVector(DIRH, 17 * k);
      out.y = 1.2 - 0.8 * Math.sin(Math.PI * k); // brush the surface
      return out;
    }
    const k = (s - 0.79) / 0.21;
    out.copy(P3).lerp(C0, k);
    out.y = P3.y + (C0.y - P3.y) * k * k * (3 - 2 * k); // eased climb arc
    return out;
  };

  return {
    osprey,
    anim,
    position,
    velocity,
    get phase() {
      return phase;
    },
    update(dt: number, t: number) {
      phase = (t % CIRCUIT) / CIRCUIT;
      prev.copy(position);
      posAt(phase, position);
      // wrap discontinuity guard: if the path jumped, keep last velocity
      const jumped = prev.distanceToSquared(position) > 100;
      if (!jumped && dt > 0) velocity.copy(position).sub(prev).divideScalar(dt);

      // pose + gait from the segment
      const diving = phase >= 0.55 && phase < 0.73;
      const skimming = phase >= 0.73 && phase < 0.79;
      tuck += ((diving ? 1 : 0) - tuck) * Math.min(1, dt * 5);
      anim.poseTarget.tuck = diving ? 1 : 0;
      anim.poseTarget.brake = skimming ? 0.7 : 0;
      anim.gait01 = diving ? 1 : phase > 0.78 ? 0.2 : 0.6;
      anim.update(dt);

      // orient along the velocity
      if (velocity.lengthSq() > 0.1) {
        fwd.copy(velocity).normalize();
        const yaw = Math.atan2(-fwd.z, fwd.x);
        const pitch = Math.asin(Math.max(-1, Math.min(1, fwd.y)));
        osprey.group.rotation.set(0, yaw, pitch, "YZX");
      }
      osprey.group.position.copy(position);

      // splash on the pull-out
      if (skimming && !splashed) {
        splashed = true;
        disturb({ kind: "splash", x: position.x, z: position.z, energy: 0.5, radius: 0.5 });
      }
      if (!skimming) splashed = false;

      // publish the telemetry every consumer reads (this scene owns the bird)
      const speed = velocity.length();
      flightState.airspeed = speed;
      flightState.groundSpeed = Math.hypot(velocity.x, velocity.z);
      flightState.verticalSpeed = velocity.y;
      flightState.altitude = position.y;
      flightState.tuck = tuck;
      flightState.flapping = anim.gait01 < 0.4 ? 0.8 : 0;
      flightState.onWater = false;
      flightState.x = position.x;
      flightState.y = position.y;
      flightState.z = position.z;
    },
    dispose() {
      osprey.dispose();
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

/** Keep the spine wind in a believable band for a demo. */
export function setWind(speed: number): void {
  wind.speed = speed;
}
