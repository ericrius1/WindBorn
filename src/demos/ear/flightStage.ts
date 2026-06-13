// A compact flyable 3D stage for The Ear's hero demos: dawn sky, the spine-
// steered lake sheet, the flight model + stand-in glyph from the Lift
// library, a chase camera, and (optionally) the basin terrain so the cirque
// walls exist for echoes. The point of this stage is to be HEARD — every
// frame it publishes FlightState, and the caller hangs synths off that.

import * as THREE from "three/webgpu";
import {
  color,
  cos,
  float,
  mix,
  normalize,
  positionWorld,
  sin,
  smoothstep,
  time,
  transformNormalToView,
  uniform,
  vec3,
} from "three/tsl";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { wind } from "../../lib/spine";
import {
  FlightBody,
  StickControls,
  ChaseCamera,
  BirdGlyph,
  publishFlightState,
} from "../../lib/flight";
import { Bag, FlyFocus } from "./earCommon";

export type StagePilot = (body: FlightBody, t: number, dt: number) => void;

export interface StageOptions {
  aspect?: number;
  /** Build the basin terrain (cirque walls, for echo demos). */
  terrain?: boolean;
  /** Flies the bird while the canvas isn't focused. */
  autopilot?: StagePilot;
  start?: { x: number; y: number; z: number; heading?: number; speed?: number };
  hint?: string;
  prompt?: string;
  /** Chase-camera overrides. */
  cam?: Partial<Pick<ChaseCamera, "distance" | "height" | "fovBase" | "fovSpeedGain" | "fovKickGain" | "breathe" | "flapBob">>;
  /** Called every frame after physics + publish, before render. */
  onFrame?: (api: StageApi, dt: number, t: number) => void;
  /** Extra teardown/controls hook after the stage is assembled. */
  setup?: (api: StageApi) => void;
  info?: (body: FlightBody) => string;
}

export interface StageApi {
  shell: Shell;
  body: FlightBody;
  controls: StickControls;
  focus: FlyFocus;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  bag: Bag;
}

function makeSky(scene: THREE.Scene, bag: Bag): void {
  const geo = new THREE.SphereGeometry(1500, 24, 14);
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.side = THREE.BackSide;
  mat.fog = false;
  const h = normalize(positionWorld).y;
  const low = mix(color(0x0c1626), color(0xd9b48c), smoothstep(float(-0.06), float(0.02), h));
  const mid = mix(low, color(0x7d96b8), smoothstep(float(0.02), float(0.2), h));
  mat.colorNode = mix(mid, color(0x27405e), smoothstep(float(0.18), float(0.6), h));
  scene.add(new THREE.Mesh(geo, mat));
  scene.fog = new THREE.Fog(0x8fa3b8, 260, 1400);
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.2);
  sun.position.set(-260, 110, 140);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x9db8d6, 0x1c2230, 0.85));
  bag.add(() => {
    geo.dispose();
    mat.dispose();
  });
}

interface WaterSheet {
  update(): void;
}

function makeWater(scene: THREE.Scene, bag: Bag, size = 2600): WaterSheet {
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = color(0x12304e);
  mat.roughnessNode = float(0.16);
  mat.metalnessNode = float(0.05);

  // Two wave trains steered by the spine wind direction perturb the shading
  // normal — the same trick the Lift stage uses, kept in lockstep with the
  // wind the synths hear.
  const uDir = uniform(wind.direction);
  const uAmp = uniform(0.04);
  const px = positionWorld.x;
  const pz = positionWorld.z;
  const d1x = cos(uDir);
  const d1z = sin(uDir);
  const d2x = cos(uDir.add(0.8));
  const d2z = sin(uDir.add(0.8));
  const k1 = float((Math.PI * 2) / 3.1);
  const k2 = float((Math.PI * 2) / 1.3);
  const ph1 = px.mul(d1x).add(pz.mul(d1z)).mul(k1).add(time.mul(2.1));
  const ph2 = px.mul(d2x).add(pz.mul(d2z)).mul(k2).add(time.mul(3.4));
  const sx = cos(ph1).mul(uAmp).mul(k1).mul(d1x).add(cos(ph2).mul(uAmp).mul(0.55).mul(k2).mul(d2x));
  const sz = cos(ph1).mul(uAmp).mul(k1).mul(d1z).add(cos(ph2).mul(uAmp).mul(0.55).mul(k2).mul(d2z));
  mat.normalNode = transformNormalToView(normalize(vec3(sx.negate(), 1, sz.negate())));

  scene.add(new THREE.Mesh(geo, mat));
  bag.add(() => {
    geo.dispose();
    mat.dispose();
  });
  return {
    update() {
      uDir.value = wind.direction;
      uAmp.value = 0.012 + wind.speed * 0.007;
    },
  };
}

// The cirque, as a displaced grid over the canonical basin height function.
async function makeTerrain(scene: THREE.Scene, bag: Bag): Promise<(x: number, z: number) => number> {
  const { terrainGrid } = await import("../../lib/terrain");
  const grid = terrainGrid();
  const heightAt = (x: number, z: number): number => grid.heightAt(x, z);

  const size = 2600;
  const segs = 150;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const meadow = new THREE.Color(0x44523a);
  const scree = new THREE.Color(0x6e6a62);
  const snow = new THREE.Color(0xcfd4d6);
  const shore = new THREE.Color(0x4d4a3c);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = heightAt(pos.getX(i), pos.getZ(i));
    pos.setY(i, h);
    if (h < 2) c.copy(shore);
    else if (h < 120) c.copy(meadow).lerp(scree, (h - 2) / 118);
    else c.copy(scree).lerp(snow, Math.min(1, (h - 120) / 260));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.vertexColors = true;
  mat.flatShading = true;
  mat.roughness = 0.95;
  scene.add(new THREE.Mesh(geo, mat));
  bag.add(() => {
    geo.dispose();
    mat.dispose();
  });
  return heightAt;
}

export async function mountFlightStage(
  el: HTMLElement,
  opts: StageOptions = {},
): Promise<Demo & { api: StageApi | null }> {
  if (!navigator.gpu) return Object.assign(gpuMissing(el), { api: null });
  const shell = new Shell(el, opts.aspect ?? 0.56);
  const bag = new Bag();

  const renderer = new THREE.WebGPURenderer({ canvas: shell.canvas, antialias: true });
  renderer.setSize(shell.canvas.width, shell.canvas.height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  await renderer.init();
  bag.add(() => renderer.dispose());

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    opts.cam?.fovBase ?? 55,
    shell.canvas.width / shell.canvas.height,
    0.1,
    3200,
  );
  makeSky(scene, bag);
  const water = makeWater(scene, bag);
  const heightAt = opts.terrain ? await makeTerrain(scene, bag) : null;

  const body = new FlightBody();
  const s = opts.start ?? { x: 0, y: 30, z: 0, heading: 0.3, speed: 10 };
  body.reset(s.x, s.y, s.z, s.heading ?? 0, s.speed ?? 10);

  const glyph = new BirdGlyph(1);
  scene.add(glyph.group);
  bag.add(() => glyph.dispose());

  const chase = new ChaseCamera();
  chase.fovSpeedGain = 1.1;
  chase.fovKickGain = 0.4;
  chase.breathe = 0.6;
  chase.flapBob = 0.6;
  Object.assign(chase, opts.cam ?? {});

  const controls = new StickControls();
  controls.expo = 0.45;
  controls.attach(shell.canvas);
  bag.add(() => controls.detach());

  const focus = new FlyFocus(
    shell.canvas,
    opts.hint ?? "A/D bank · W/S pitch · Space flap · Shift tuck",
    opts.prompt ?? "Click to fly — and to listen",
  );
  bag.add(() => focus.dispose());

  const api: StageApi = { shell, body, controls, focus, scene, camera, bag };
  opts.setup?.(api);

  shell.setInfo(
    () =>
      opts.info?.(body) ??
      `V ${body.airspeed.toFixed(1)} m/s · alt ${body.pos.y.toFixed(0)} m`,
  );

  let last = performance.now();
  let simT = 0;
  const tmp = new THREE.Vector3();

  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    simT += dt;

    if (focus.focused) {
      controls.update(dt);
      body.commands.bank = controls.bank;
      body.commands.pitch = controls.pitch;
      body.commands.effort = controls.effort;
      body.commands.tuck = controls.tuck;
    } else if (opts.autopilot) {
      opts.autopilot(body, simT, dt);
    } else {
      body.commands.bank = 0;
      body.commands.pitch = 0;
      body.commands.effort = body.pos.y < 18 ? 0.7 : 0.35;
      body.commands.tuck = 0;
    }

    body.step(dt, simT);

    // Soft valley bounds; the terrain (when present) is solid.
    const d = Math.hypot(body.pos.x, body.pos.z);
    const bound = heightAt ? 900 : 260;
    if (d > bound) {
      tmp.set(-body.pos.x / d, 0, -body.pos.z / d);
      body.vel.addScaledVector(tmp, (d - bound) * 0.6 * dt);
    }
    if (heightAt) {
      const g = heightAt(body.pos.x, body.pos.z);
      if (body.pos.y < g + 0.6) {
        body.pos.y = g + 0.6;
        if (body.vel.y < 0) body.vel.y = 0;
      }
    }

    publishFlightState(body);
    glyph.applyBody(body);
    chase.update(camera, body, dt, simT);
    water.update();

    opts.onFrame?.(api, dt, simT);

    renderer.render(scene, camera);
    shell.tick();
  };

  return { frame, dispose: () => bag.dispose(), api };
}

/** A watchable pilot that climbs flapping, then tucks into a dive — the
 *  full speed range on a loop, which is exactly what wind audio wants. */
export function divePilot(cx = 0, cz = 0): StagePilot {
  let mode: "climb" | "dive" | "pull" = "climb";
  return (body, _t, _dt) => {
    const c = body.commands;
    const heading = Math.atan2(body.vel.z, body.vel.x);
    const desired = Math.atan2(cz - body.pos.z, cx - body.pos.x) + 0.9;
    const err = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading));
    c.bank = Math.max(-1, Math.min(1, err * 1.3));

    if (mode === "climb" && body.pos.y > 75) mode = "dive";
    else if (mode === "dive" && (body.pos.y < 14 || body.airspeed > 30)) mode = "pull";
    else if (mode === "pull" && body.vel.y > -1 && body.airspeed < 16) mode = "climb";

    if (mode === "climb") {
      c.effort = 0.85;
      c.tuck = 0;
      c.pitch = Math.max(-0.5, Math.min(0.5, (75 - body.pos.y) * 0.02 - body.vel.y * 0.08));
    } else if (mode === "dive") {
      c.effort = 0;
      c.tuck = 1;
      c.pitch = -0.65;
      c.bank *= 0.3;
    } else {
      c.effort = 0.25;
      c.tuck = 0;
      c.pitch = 0.85;
    }
  };
}
