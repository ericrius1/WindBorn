// The shared 3D "flyable" scene: water, sky, the dart glyph, the flight
// model, chase camera, optional force arrows / terrain / influences / HUDs.
// Every Lift page configures this differently; the options read like the
// table of contents of the series.

import * as THREE from "three/webgpu";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { wind } from "../../lib/spine";
import {
  FlightBody,
  StickControls,
  ChaseCamera,
  BirdGlyph,
  publishFlightState,
  flightState,
  ridgeLiftInfluence,
  thermalInfluence,
  clamp,
  damp,
  ALPHA_STALL,
  OSPREY,
  AIR_DENSITY,
  G,
  type ThermalSpec,
} from "../../lib/flight";
import {
  Bin,
  createRenderer,
  makeCamera,
  makeSky,
  makeWater,
  FocusOverlay,
  Trail,
  VectorArrow,
  WindStreaks,
} from "./common";

export type Autopilot = (body: FlightBody, t: number, dt: number) => void;

// Generic steering used by every autopilot: heading error → bank, altitude
// error → pitch + effort, with a don't-stall guard.
export function steerToward(body: FlightBody, tx: number, ty: number, tz: number): void {
  const c = body.commands;
  const heading = Math.atan2(body.vel.z, body.vel.x);
  const desired = Math.atan2(tz - body.pos.z, tx - body.pos.x);
  const err = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading));
  c.bank = clamp(err * 1.4, -1, 1);
  const altErr = ty - body.pos.y;
  c.pitch = clamp(altErr * 0.1 - body.vel.y * 0.12, -0.7, 0.7);
  if (body.airspeed < 7.5) c.pitch = Math.min(c.pitch, 0.1); // never beg for a stall
  c.effort = clamp(0.3 + altErr * 0.12 + (9.5 - body.airspeed) * 0.12, 0, 1);
  c.tuck = 0;
}

export function circlePilot(cx: number, cz: number, radius: number, alt: number): Autopilot {
  return (body) => {
    const a = Math.atan2(body.pos.z - cz, body.pos.x - cx) + 0.55;
    steerToward(body, cx + Math.cos(a) * radius, alt, cz + Math.sin(a) * radius);
  };
}

export function waypointPilot(points: [number, number, number][], glide = false): Autopilot {
  let idx = 0;
  return (body) => {
    const [x, y, z] = points[idx];
    const dx = body.pos.x - x;
    const dz = body.pos.z - z;
    if (dx * dx + dz * dz < 18 * 18) idx = (idx + 1) % points.length;
    steerToward(body, x, y, z);
    if (glide) body.commands.effort = 0;
  };
}

// Circle the core of a thermal with folded effort — climb for free.
export function thermalPilot(s: ThermalSpec): Autopilot {
  const orbit = circlePilot(s.x, s.z, s.radius * 0.85, 60);
  return (body, t, dt) => {
    orbit(body, t, dt);
    body.commands.effort = body.pos.y < 18 ? 0.6 : 0; // flap only to join the lift band
    body.commands.pitch = clamp(body.commands.pitch, -0.4, 0.35);
  };
}

export interface TerrainSpec {
  heightAt(x: number, z: number): number;
  size: number;
  segments: number;
}

// Build a vertex-colored terrain mesh from a height function. The Basin
// series owns real terrain; this is the minimal stand-in the wind needs.
// TODO(lift): swap in src/lib/terrain's heightfield once The Basin ships.
function buildTerrain(spec: TerrainSpec, bin: Bin): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(spec.size, spec.size, spec.segments, spec.segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const meadow = new THREE.Color(0x44523a);
  const scree = new THREE.Color(0x6e6a62);
  const snow = new THREE.Color(0xcfd4d6);
  const shore = new THREE.Color(0x4d4a3c);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = spec.heightAt(pos.getX(i), pos.getZ(i));
    pos.setY(i, h);
    if (h < 1.5) c.copy(shore);
    else if (h < 26) c.copy(meadow).lerp(scree, (h - 1.5) / 24.5);
    else c.copy(scree).lerp(snow, Math.min(1, (h - 26) / 22));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.vertexColors = true;
  mat.flatShading = true;
  mat.roughness = 0.95;
  const mesh = new THREE.Mesh(geo, mat);
  bin.add(() => {
    geo.dispose();
    mat.dispose();
  });
  return mesh;
}

export interface FlyableOptions {
  aspect?: number;
  start?: { x: number; y: number; z: number; heading?: number; speed?: number };
  windScale?: number;
  arrows?: boolean;
  arrowScale?: number; // meters per newton
  trail?: boolean;
  lockBank?: boolean; // forces.html: bank arrives next post
  allowTuck?: boolean;
  autopilot?: Autopilot | null; // flies whenever the canvas isn't focused
  terrain?: TerrainSpec | null;
  thermals?: ThermalSpec[];
  ridgeLift?: boolean;
  streaks?: number;
  hud?: "none" | "envelope" | "vario" | "telemetry";
  publishState?: boolean;
  hint?: string;
  cam?: Partial<
    Pick<
      ChaseCamera,
      | "distance"
      | "height"
      | "aimAhead"
      | "posLag"
      | "aimLag"
      | "fovBase"
      | "fovSpeedGain"
      | "fovSpeedRef"
      | "fovKickGain"
      | "breathe"
      | "flapBob"
    >
  >;
  camSliders?: boolean;
  fovSliders?: boolean;
  feelSliders?: boolean;
  joyToggle?: boolean;
  windSliders?: "none" | "speed" | "speed+direction";
  info?: (body: FlightBody) => string;
  // Watch-only demos: no keyboard, no focus prompt — the autopilot owns it.
  noControls?: boolean;
  // Static camera instead of the chase rig (e.g. watching a turn circle).
  fixedCamera?: { pos: [number, number, number]; lookAt: [number, number, number] };
  // Hook for page-specific sliders and state.
  setup?: (api: {
    shell: Shell;
    body: FlightBody;
    chase: ChaseCamera;
    controls: StickControls;
  }) => void;
}

const DEG = 180 / Math.PI;

export async function mountFlyable(el: HTMLElement, opts: FlyableOptions = {}): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el, opts.aspect ?? 0.56);
  const bin = new Bin();
  const renderer = await createRenderer(shell.canvas);
  bin.add(() => renderer.dispose());

  const scene = new THREE.Scene();
  const camera = makeCamera(shell.canvas, opts.cam?.fovBase ?? 55);
  makeSky(scene, bin);
  const water = makeWater(scene, bin);

  // ---- world extras ------------------------------------------------------
  const heightAt = opts.terrain ? opts.terrain.heightAt : null;
  if (opts.terrain) scene.add(buildTerrain(opts.terrain, bin));
  if (opts.ridgeLift && heightAt) bin.add(wind.addInfluence(ridgeLiftInfluence(heightAt)));
  for (const t of opts.thermals ?? []) bin.add(wind.addInfluence(thermalInfluence(t)));

  let streaks: WindStreaks | null = null;
  if (opts.streaks) {
    streaks = new WindStreaks(
      opts.streaks,
      new THREE.Vector3(-200, 1, -200),
      new THREE.Vector3(200, 110, 200),
      heightAt,
    );
    scene.add(streaks.lines);
    bin.add(() => streaks?.dispose());
  }

  // ---- the bird -----------------------------------------------------------
  const body = new FlightBody();
  body.windScale = opts.windScale ?? 1;
  const s = opts.start ?? { x: 0, y: 28, z: 0, heading: 0, speed: 10 };
  body.reset(s.x, s.y, s.z, s.heading ?? 0, s.speed ?? 10);
  const glyph = new BirdGlyph(1);
  scene.add(glyph.group);
  bin.add(() => glyph.dispose());

  const chase = new ChaseCamera();
  Object.assign(chase, opts.cam ?? {});

  const controls = new StickControls();
  if (!opts.noControls) {
    controls.attach(shell.canvas);
    bin.add(() => controls.detach());
  }

  const overlay = new FocusOverlay(
    shell.canvas,
    opts.hint ??
      (opts.noControls
        ? ""
        : opts.lockBank
          ? "W/S or ↑/↓ pitch · Space flap"
          : "A/D bank · W/S pitch · Space flap" + (opts.allowTuck !== false ? " · Shift tuck" : "")),
    !opts.noControls,
  );
  bin.add(() => overlay.dispose());

  // ---- force arrows ---------------------------------------------------------
  const arrowScale = opts.arrowScale ?? 0.22; // m per N
  let arrows: { lift: VectorArrow; drag: VectorArrow; weight: VectorArrow; thrust: VectorArrow } | null =
    null;
  if (opts.arrows) {
    arrows = {
      lift: new VectorArrow(0x7dd6a0),
      drag: new VectorArrow(0xff8585),
      weight: new VectorArrow(0xaab4d4),
      thrust: new VectorArrow(0xffb86b),
    };
    for (const a of Object.values(arrows)) {
      scene.add(a.group);
      bin.add(() => a.dispose());
    }
  }

  let trail: Trail | null = null;
  if (opts.trail) {
    trail = new Trail(260);
    scene.add(trail.line);
    bin.add(() => trail?.dispose());
  }

  // ---- HUDs -------------------------------------------------------------------
  let hudCanvas: HTMLCanvasElement | null = null;
  let hudCtx: CanvasRenderingContext2D | null = null;
  let telemetryDiv: HTMLDivElement | null = null;
  const histV: number[] = [];
  const histAlt: number[] = [];
  const envTrail: [number, number][] = [];
  let varioSmoothed = 0;

  if (opts.hud === "envelope" || opts.hud === "vario" || opts.hud === "telemetry") {
    const panel = overlay.panel(
      opts.hud === "vario"
        ? "right:.7rem;top:50%;transform:translateY(-50%);"
        : "right:.7rem;top:.7rem;",
    );
    hudCanvas = document.createElement("canvas");
    const w = opts.hud === "vario" ? 64 : opts.hud === "telemetry" ? 230 : 200;
    const h = opts.hud === "vario" ? 190 : opts.hud === "telemetry" ? 120 : 150;
    hudCanvas.width = w * 2;
    hudCanvas.height = h * 2;
    hudCanvas.style.cssText = `width:${w}px;height:${h}px;display:block;border-radius:8px;`;
    panel.appendChild(hudCanvas);
    hudCtx = hudCanvas.getContext("2d");
    hudCtx?.scale(2, 2);
    if (opts.hud === "telemetry") {
      telemetryDiv = document.createElement("div");
      telemetryDiv.style.cssText =
        "margin-top:.3rem;padding:.4rem .55rem;border-radius:8px;background:rgba(6,7,11,.72);" +
        "color:#c8d3f5;font:10.5px/1.55 ui-monospace,Menlo,monospace;white-space:pre;";
      panel.appendChild(telemetryDiv);
    }
  }

  // ---- sliders & toggles --------------------------------------------------------
  if (opts.windSliders && opts.windSliders !== "none") {
    const savedSpeed = wind.speed;
    const savedDir = wind.direction;
    const savedGust = wind.gustiness;
    bin.add(() => {
      wind.speed = savedSpeed;
      wind.direction = savedDir;
      wind.gustiness = savedGust;
    });
    shell.slider({
      label: "wind speed (m/s)",
      min: 0,
      max: 9,
      step: 0.5,
      value: wind.speed,
      onInput: (v) => (wind.speed = v),
    });
    if (opts.windSliders === "speed+direction")
      shell.slider({
        label: "wind direction (°)",
        min: -180,
        max: 180,
        step: 5,
        value: wind.direction * DEG,
        onInput: (v) => (wind.direction = v / DEG),
      });
  }

  if (opts.camSliders) {
    shell.slider({
      label: "camera stiffness (1/s)",
      min: 0.8,
      max: 12,
      step: 0.1,
      value: chase.posLag,
      onInput: (v) => {
        chase.posLag = v;
        chase.aimLag = v * 1.4;
      },
    });
    shell.slider({
      label: "follow distance (m)",
      min: 4,
      max: 16,
      step: 0.5,
      value: chase.distance,
      onInput: (v) => (chase.distance = v),
    });
    shell.button("toggle rigid camera", () => {
      chase.rigid = !chase.rigid;
    });
  }

  if (opts.fovSliders) {
    shell.slider({
      label: "FOV speed gain (°/m/s)",
      min: 0,
      max: 2.5,
      step: 0.05,
      value: chase.fovSpeedGain,
      onInput: (v) => (chase.fovSpeedGain = v),
    });
    shell.slider({
      label: "FOV kick (°/m/s²)",
      min: 0,
      max: 1.2,
      step: 0.05,
      value: chase.fovKickGain,
      onInput: (v) => (chase.fovKickGain = v),
    });
  }

  if (opts.feelSliders) {
    shell.slider({
      label: "camera breathing",
      min: 0,
      max: 1,
      step: 0.05,
      value: chase.breathe,
      onInput: (v) => (chase.breathe = v),
    });
    shell.slider({
      label: "flap bob",
      min: 0,
      max: 1,
      step: 0.05,
      value: chase.flapBob,
      onInput: (v) => (chase.flapBob = v),
    });
  }

  let joyOn = true;
  const applyJoy = (): void => {
    if (joyOn) {
      controls.expo = 0.45;
      controls.riseRate = 5;
      controls.fallRate = 9;
      chase.rigid = false;
      chase.fovSpeedGain = 1.1;
      chase.fovKickGain = 0.4;
      chase.breathe = 0.7;
      chase.flapBob = 0.7;
    } else {
      controls.expo = 0;
      controls.riseRate = 1000; // digital: keys snap to full deflection
      controls.fallRate = 1000;
      chase.rigid = true;
      chase.fovSpeedGain = 0;
      chase.fovKickGain = 0;
      chase.breathe = 0;
      chase.flapBob = 0;
    }
  };
  if (opts.joyToggle) {
    applyJoy();
    shell.button("feel: joy on / raw", () => {
      joyOn = !joyOn;
      applyJoy();
    });
  }

  opts.setup?.({ shell, body, chase, controls });

  if (opts.fixedCamera) {
    camera.position.set(...opts.fixedCamera.pos);
    camera.lookAt(...opts.fixedCamera.lookAt);
  }

  // ---- per-frame -------------------------------------------------------------
  let last = performance.now();
  let simT = 0;
  const tmp = new THREE.Vector3();
  let shake = 0;

  shell.setInfo(
    () =>
      opts.info?.(body) ??
      `V ${body.airspeed.toFixed(1)} m/s · alt ${body.pos.y.toFixed(0)} m · vario ${body.vel.y >= 0 ? "+" : ""}${body.vel.y.toFixed(1)} m/s`,
  );

  const drawHud = (): void => {
    if (!hudCtx || !hudCanvas) return;
    const ctx = hudCtx;
    const w = hudCanvas.width / 2;
    const h = hudCanvas.height / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(6,7,11,.72)";
    ctx.fillRect(0, 0, w, h);

    if (opts.hud === "envelope") {
      // axes: x = airspeed 0..30 m/s, y = α -6°..28°
      const X = (v: number): number => 26 + (v / 30) * (w - 34);
      const Y = (aDeg: number): number => h - 18 - ((aDeg + 6) / 34) * (h - 30);
      ctx.fillStyle = "rgba(255,133,133,.13)";
      ctx.fillRect(X(0), Y(28), X(30) - X(0), Y(ALPHA_STALL * DEG) - Y(28));
      // level-flight trim curve: α(V) with L = W
      ctx.strokeStyle = "#7aa2ff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      let started = false;
      for (let v = 5; v <= 30; v += 0.5) {
        const clNeed = (2 * OSPREY.mass * G) / (AIR_DENSITY * v * v * OSPREY.wingArea);
        const aDeg = (clNeed / 5) * DEG; // attached-flow slope ≈ 5/rad
        if (aDeg > 28) continue;
        if (!started) {
          ctx.moveTo(X(v), Y(aDeg));
          started = true;
        } else ctx.lineTo(X(v), Y(aDeg));
      }
      ctx.stroke();
      ctx.strokeStyle = "#ff8585";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(X(0), Y(ALPHA_STALL * DEG));
      ctx.lineTo(X(30), Y(ALPHA_STALL * DEG));
      ctx.stroke();
      ctx.setLineDash([]);
      // trail + dot
      envTrail.push([body.airspeed, body.alpha * DEG]);
      if (envTrail.length > 120) envTrail.shift();
      for (let i = 0; i < envTrail.length; i++) {
        ctx.fillStyle = `rgba(255,184,107,${((i / envTrail.length) * 0.5).toFixed(3)})`;
        ctx.fillRect(X(envTrail[i][0]) - 1, Y(envTrail[i][1]) - 1, 2, 2);
      }
      ctx.fillStyle = "#ffb86b";
      ctx.beginPath();
      ctx.arc(X(clamp(body.airspeed, 0, 30)), Y(clamp(body.alpha * DEG, -6, 28)), 3.4, 0, 7);
      ctx.fill();
      ctx.fillStyle = "#8a91a5";
      ctx.font = "9px ui-monospace,monospace";
      ctx.fillText("α°", 6, 14);
      ctx.fillText("airspeed →", w - 70, h - 5);
      ctx.fillStyle = "#ff8585";
      ctx.fillText("stall", X(2), Y(ALPHA_STALL * DEG) - 4);
    } else if (opts.hud === "vario") {
      const mid = h / 2;
      const Y = (v: number): number => mid - (clamp(v, -5, 5) / 5) * (h / 2 - 16);
      ctx.strokeStyle = "#2a2f42";
      for (let v = -4; v <= 4; v += 2) {
        ctx.beginPath();
        ctx.moveTo(w / 2 - 12, Y(v));
        ctx.lineTo(w / 2 + 12, Y(v));
        ctx.stroke();
      }
      ctx.strokeStyle = "#8a91a5";
      ctx.beginPath();
      ctx.moveTo(8, mid);
      ctx.lineTo(w - 8, mid);
      ctx.stroke();
      const v = varioSmoothed;
      ctx.fillStyle = v >= 0 ? "#7dd6a0" : "#ffb86b";
      ctx.fillRect(w / 2 - 7, Math.min(mid, Y(v)), 14, Math.abs(Y(v) - mid));
      ctx.font = "600 11px ui-monospace,monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${v >= 0 ? "+" : ""}${v.toFixed(1)}`, w / 2, h - 4);
      ctx.textAlign = "left";
    } else if (opts.hud === "telemetry") {
      // sparklines: airspeed + altitude
      histV.push(body.airspeed);
      histAlt.push(body.pos.y);
      if (histV.length > 110) {
        histV.shift();
        histAlt.shift();
      }
      const plot = (vals: number[], max: number, y0: number, colorHex: string, name: string): void => {
        ctx.strokeStyle = colorHex;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i < vals.length; i++) {
          const x = 8 + (i / 109) * (w - 16);
          const y = y0 + 42 - (clamp(vals[i], 0, max) / max) * 38;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.fillStyle = "#8a91a5";
        ctx.font = "9px ui-monospace,monospace";
        ctx.fillText(name, 8, y0 + 8);
      };
      plot(histV, 32, 4, "#7aa2ff", "airspeed 0–32 m/s");
      plot(histAlt, 90, 62, "#7dd6a0", "altitude 0–90 m");
    }
  };

  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    simT += dt;

    // controls or autopilot
    if (overlay.focused) {
      controls.update(dt);
      body.commands.bank = opts.lockBank ? 0 : controls.bank;
      body.commands.pitch = controls.pitch;
      body.commands.effort = controls.effort;
      body.commands.tuck = opts.allowTuck === false ? 0 : controls.tuck;
    } else if (opts.autopilot) {
      opts.autopilot(body, simT, dt);
      if (opts.lockBank) body.commands.bank = 0;
    } else {
      body.commands.bank = 0;
      body.commands.pitch = 0;
      body.commands.effort = body.pos.y < 18 ? 0.7 : 0.35;
    }

    body.step(dt, simT);

    // soft world bounds: the valley walls are a polite suggestion
    const d = Math.hypot(body.pos.x, body.pos.z);
    if (d > 240) {
      tmp.set(-body.pos.x / d, 0, -body.pos.z / d);
      body.vel.addScaledVector(tmp, (d - 240) * 0.6 * dt);
    }
    // terrain is solid (the model only knows about water)
    if (heightAt) {
      const g = heightAt(body.pos.x, body.pos.z);
      if (body.pos.y < g + 0.6) {
        body.pos.y = g + 0.6;
        if (body.vel.y < 0) body.vel.y = 0;
      }
    }

    if (opts.publishState) publishFlightState(body);

    glyph.applyBody(body);
    if (!opts.fixedCamera) {
      chase.update(camera, body, dt, simT);
      // stall buffet: the airframe talks before it lets go
      shake = damp(shake, body.stall, 6, dt);
      if (shake > 0.02 && !chase.rigid) {
        camera.position.x += (Math.random() - 0.5) * 0.07 * shake;
        camera.position.y += (Math.random() - 0.5) * 0.07 * shake;
      }
    }

    if (arrows) {
      arrows.lift.set(body.pos, body.liftForce, arrowScale);
      arrows.drag.set(body.pos, body.dragForce, arrowScale);
      arrows.weight.set(body.pos, body.weightForce, arrowScale);
      arrows.thrust.set(body.pos, body.thrustForce, arrowScale);
    }
    if (trail && simT % 0.08 < dt) trail.push(body.pos);
    streaks?.update(dt, simT);
    water.update();
    varioSmoothed = damp(varioSmoothed, body.vel.y, 2.5, dt);
    drawHud();
    if (telemetryDiv) {
      const f = flightState;
      telemetryDiv.textContent =
        `airspeed   ${f.airspeed.toFixed(1).padStart(5)} m/s\n` +
        `vertical   ${(f.verticalSpeed >= 0 ? "+" : "") + f.verticalSpeed.toFixed(1)} m/s\n` +
        `altitude   ${f.altitude.toFixed(1).padStart(5)} m\n` +
        `bank       ${(f.bank * DEG).toFixed(0).padStart(5)}°\n` +
        `alpha      ${(f.alpha * DEG).toFixed(1).padStart(5)}°\n` +
        `flapping   ${f.flapping.toFixed(2).padStart(5)}\n` +
        `flapPhase  ${(f.flapPhase % (Math.PI * 2)).toFixed(2).padStart(5)} rad\n` +
        `stall      ${f.stall.toFixed(2).padStart(5)}\n` +
        `onWater    ${String(f.onWater).padStart(5)}`;
    }

    renderer.render(scene, camera);
    shell.tick();
  };

  return {
    frame,
    dispose: () => bin.dispose(),
  };
}
