// Demos for firstflight.html — Season 1's playable milestone. The hero is
// the deliverable: the Mirror's lake, the New Feathers osprey, and the Lift
// flight model in one flyable scene. The in-article figures each isolate one
// integration seam: the spine wiring, the shared wingbeat clock, and the
// air/float/run ownership handoff.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { clock, wind } from "../../lib/spine";
import { ChaseCamera, StickControls, damp, type FlightCommands } from "../../lib/flight";
import { PAL, arrow, label } from "../../lib/scrolly";
import { buildDawnWorld, interludeCtx, PilotOverlay } from "./firstflightScene";
import { PlayerBird, steerToward } from "./playerBird";

const freshCommands = (): FlightCommands => ({ bank: 0, pitch: 0, effort: 0, tuck: 0 });

// ---- hero: the milestone ---------------------------------------------------------

export async function mountHeroFirstflight(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await interludeCtx(el, { aspect: 0.52, fov: 55 });

  const bird = new PlayerBird();
  const world = buildDawnWorld(ctx.scene, ctx.width, ctx.height, {
    hour: 5.9,
    windSpeed: 1.4,
    reflection: true,
    size: 1500,
    segments: 280,
    mountains: true,
    snag: [-16, -26],
    autoRises: true,
    riseCenter: () => ({ x: bird.body.pos.x, z: bird.body.pos.z }),
    followClock: true,
  });
  ctx.scene.add(bird.group);
  bird.reset(-70, 22, -30, 0.45, 10.5);

  // Dawn creeps forward while you fly: one world clock, gently accelerated.
  const prevClockSpeed = clock.speed;
  clock.speed = 0.4;
  ctx.onDispose(() => {
    clock.speed = prevClockSpeed;
  });

  const chase = new ChaseCamera();
  chase.distance = 6;
  chase.height = 1.9;
  chase.aimAhead = 6;
  chase.fovSpeedGain = 1.1;
  chase.fovKickGain = 0.4;
  chase.breathe = 0.6;
  chase.flapBob = 0.6;

  const controls = new StickControls();
  controls.expo = 0.45;
  controls.attach(ctx.shell.canvas);
  const overlay = new PilotOverlay(
    ctx.shell.canvas,
    "A/D bank · W/S pitch · Space flap · Shift tuck — land slow, hold Space to take off",
  );

  ctx.shell.slider({
    label: "wind (m/s)",
    min: 0,
    max: 5,
    step: 0.1,
    value: wind.speed,
    onInput: (v) => (wind.speed = v),
  });
  ctx.shell.button("reset flight", () => {
    bird.reset(-70, 22, -30, 0.45, 10.5);
    chase.reset();
  });
  ctx.shell.setInfo(() => {
    const b = bird.body;
    const state = bird.state === "air" ? "flying" : bird.state === "float" ? "floating" : "takeoff run";
    return `${state} · V ${b.airspeed.toFixed(1)} m/s · alt ${Math.max(0, b.pos.y).toFixed(1)} m`;
  });

  const cmds = freshCommands();
  let idleFloat = 0;
  let shake = 0;

  ctx.onDispose(() => {
    controls.detach();
    overlay.dispose();
    bird.dispose();
    world.dispose();
  });

  return ctx.finish(
    (t, dt) => {
      clock.advance(dt);

      cmds.bank = 0;
      cmds.pitch = 0;
      cmds.effort = 0;
      cmds.tuck = 0;
      if (overlay.focused) {
        controls.update(dt);
        cmds.bank = controls.bank;
        cmds.pitch = controls.pitch;
        cmds.effort = controls.effort;
        cmds.tuck = controls.tuck;
        idleFloat = 0;
      } else if (bird.state === "air") {
        // Nobody at the stick: a lazy circuit over the lake.
        const a = Math.atan2(bird.body.pos.z + 10, bird.body.pos.x) + 0.5;
        steerToward(bird.body, cmds, Math.cos(a) * 60, 26, -10 + Math.sin(a) * 60);
        idleFloat = 0;
      } else {
        // Floating unattended: drift a while, then take off and resume.
        idleFloat += dt;
        if (idleFloat > 6) cmds.effort = 1;
      }

      bird.update(dt, t, cmds);
      bird.softBounds(330, dt);

      chase.update(ctx.camera, bird.body, dt, t);
      // Stall buffet: the airframe talks before it lets go.
      shake = damp(shake, bird.body.stall, 6, dt);
      if (shake > 0.02) {
        ctx.camera.position.x += (Math.random() - 0.5) * 0.07 * shake;
        ctx.camera.position.y += (Math.random() - 0.5) * 0.07 * shake;
      }

      world.update(t);
    },
    () => {
      world.renderReflection(ctx.renderer, ctx.scene, ctx.camera);
      ctx.renderer.render(ctx.scene, ctx.camera);
    },
  );
}

// ---- Step 1: the spine wiring, drawn ------------------------------------------------

interface Wire {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  text: string;
  dashed?: boolean;
}

export function mountContracts(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.62);
  const ctx = shell.canvas.getContext("2d")!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.scale(dpr, dpr);
  const w = shell.canvas.width / dpr;
  const h = shell.canvas.height / dpr;

  // Layout: the three finished systems around the four spine contracts.
  const box = (cx: number, cy: number, bw: number, bh: number) => ({ cx, cy, bw, bh });
  const surface = box(w * 0.155, h * 0.5, w * 0.21, h * 0.17);
  const birdBox = box(w * 0.845, h * 0.22, w * 0.21, h * 0.15);
  const flight = box(w * 0.845, h * 0.74, w * 0.21, h * 0.15);
  const chipW = w * 0.13;
  const chipH = h * 0.085;
  const chips: { y: number; text: string; color: string }[] = [
    { y: h * 0.13, text: "wind", color: PAL.accent },
    { y: h * 0.37, text: "clock", color: PAL.warm },
    { y: h * 0.61, text: "water", color: PAL.good },
    { y: h * 0.85, text: "bus", color: PAL.red },
  ];
  const chipL = w * 0.5 - chipW / 2;
  const chipR = w * 0.5 + chipW / 2;

  const wires: Wire[] = [
    // one wind field
    { x0: chipL, y0: chips[0].y, x1: surface.cx + surface.bw / 2, y1: surface.cy - surface.bh * 0.42, color: PAL.accent, text: "steers the ripples" },
    { x0: chipR, y0: chips[0].y, x1: flight.cx - flight.bw / 2, y1: flight.cy - flight.bh * 0.42, color: PAL.accent, text: "sets the airspeed" },
    // one clock
    { x0: chipL, y0: chips[1].y, x1: surface.cx + surface.bw / 2, y1: surface.cy - surface.bh * 0.1, color: PAL.warm, text: "keys the dawn light" },
    // one water query: the surface provides it, everything floats on it
    { x0: surface.cx + surface.bw / 2, y0: surface.cy + surface.bh * 0.25, x1: chipL, y1: chips[2].y, color: PAL.good, text: "provides heightAt" },
    { x0: chipR, y0: chips[2].y - chipH * 0.3, x1: birdBox.cx - birdBox.bw / 2, y1: birdBox.cy + birdBox.bh * 0.3, color: PAL.good, text: "float height + tilt" },
    { x0: chipR, y0: chips[2].y + chipH * 0.3, x1: flight.cx - flight.bw / 2, y1: flight.cy + flight.bh * 0.1, color: PAL.good, text: "the floor" },
    // one bus
    { x0: flight.cx - flight.bw * 0.2, y0: flight.cy + flight.bh / 2, x1: chipR, y1: chips[3].y, color: PAL.red, text: "splash · skim · wake" },
    { x0: chipL, y0: chips[3].y, x1: surface.cx - surface.bw * 0.1, y1: surface.cy + surface.bh / 2, color: PAL.red, text: "rings" },
    // the one private wire that isn't a spine contract
    { x0: flight.cx, y0: flight.cy - flight.bh / 2, x1: birdBox.cx, y1: birdBox.cy + birdBox.bh / 2, color: PAL.muted, text: "α · bank · effort · phase", dashed: true },
  ];

  let t = 0;
  let last = performance.now();

  const drawBox = (b: { cx: number; cy: number; bw: number; bh: number }, title: string, sub: string): void => {
    ctx.strokeStyle = PAL.dim;
    ctx.lineWidth = 1.2;
    ctx.fillStyle = "rgba(18,21,32,.85)";
    ctx.beginPath();
    ctx.roundRect(b.cx - b.bw / 2, b.cy - b.bh / 2, b.bw, b.bh, 9);
    ctx.fill();
    ctx.stroke();
    label(ctx, title, b.cx, b.cy - 7, { color: PAL.text, size: 12.5, align: "center" });
    label(ctx, sub, b.cx, b.cy + 9, { color: PAL.muted, size: 10, align: "center" });
  };

  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    t += dt;

    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, w, h);

    // wires under everything
    for (const wire of wires) {
      ctx.strokeStyle = wire.color;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 1.4;
      if (wire.dashed) ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(wire.x0, wire.y0);
      ctx.lineTo(wire.x1, wire.y1);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      arrow(ctx, wire.x1 - (wire.x1 - wire.x0) * 0.06, wire.y1 - (wire.y1 - wire.y0) * 0.06, wire.x1, wire.y1, wire.color, 1.4, 6);
      // label at the midpoint, nudged off the line
      const mx = (wire.x0 + wire.x1) / 2;
      const my = (wire.y0 + wire.y1) / 2;
      label(ctx, wire.text, mx, my - 8, { color: wire.color, size: 9.5, align: "center", alpha: 0.85 });
    }

    // pulses: live reads and events travelling the wires
    for (let i = 0; i < wires.length; i++) {
      const wire = wires[i];
      for (const offset of [0, 0.5]) {
        const p = (t / 1.9 + i * 0.13 + offset) % 1;
        const px = wire.x0 + (wire.x1 - wire.x0) * p;
        const py = wire.y0 + (wire.y1 - wire.y0) * p;
        ctx.fillStyle = wire.color;
        ctx.globalAlpha = 0.9 * Math.sin(p * Math.PI);
        ctx.beginPath();
        ctx.arc(px, py, 2.6, 0, 7);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    drawBox(surface, "the surface", "The Mirror · lake material");
    drawBox(birdBox, "the bird", "New Feathers · mesh + animator");
    drawBox(flight, "the flight model", "Lift · point mass");

    for (const chip of chips) {
      ctx.fillStyle = "rgba(10,12,18,.92)";
      ctx.strokeStyle = chip.color;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.roundRect(chipL, chip.y - chipH / 2, chipW, chipH, 999);
      ctx.fill();
      ctx.stroke();
      label(ctx, chip.text, w * 0.5, chip.y, { color: chip.color, size: 11.5, align: "center", mono: true });
    }
    label(ctx, "the spine", w * 0.5, h * 0.025, { color: PAL.muted, size: 10, align: "center" });

    shell.tick();
  };

  shell.setInfo(() => "the dashed wire is the only coupling that is not a spine contract");
  return { frame };
}

// ---- Step 2: one wingbeat clock ------------------------------------------------------

export async function mountWingbeat(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await interludeCtx(el, { aspect: 0.56, fov: 50 });
  const bird = new PlayerBird();
  const world = buildDawnWorld(ctx.scene, ctx.width, ctx.height, {
    hour: 6.5,
    windSpeed: 1.2,
    reflection: false,
    size: 900,
    segments: 160,
    mountains: true,
  });
  ctx.scene.add(bird.group);
  bird.reset(-45, 16, -20, 0, 9);

  const chase = new ChaseCamera();
  chase.distance = 5;
  chase.height = 1.4;
  chase.aimAhead = 5;
  chase.fovSpeedGain = 0.8;
  chase.flapBob = 0.7;

  let effort = 0.55;
  ctx.shell.slider({
    label: "flap effort",
    min: 0,
    max: 1,
    step: 0.05,
    value: effort,
    onInput: (v) => (effort = v),
  });
  ctx.shell.setInfo(() => {
    const b = bird.body;
    const hz = b.commands.effort > 0.03 ? `${(2.5 + 2 * b.commands.effort).toFixed(1)} Hz` : "glide (clock paused)";
    return `wingbeat ${hz} · airspeed ${b.airspeed.toFixed(1)} m/s`;
  });

  const cmds = freshCommands();
  ctx.onDispose(() => {
    bird.dispose();
    world.dispose();
  });

  return ctx.finish((t, dt) => {
    // A lazy circle; the slider owns the effort channel.
    const a = Math.atan2(bird.body.pos.z + 20, bird.body.pos.x) + 0.5;
    steerToward(bird.body, cmds, Math.cos(a) * 40, 16, -20 + Math.sin(a) * 40);
    cmds.effort = effort;
    cmds.tuck = 0;
    bird.update(dt, t, cmds);
    bird.softBounds(260, dt);
    chase.update(ctx.camera, bird.body, dt, t);
    world.update(t);
  });
}

// ---- Step 3: the ownership handoff ----------------------------------------------------

export async function mountHandoff(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await interludeCtx(el, { aspect: 0.56, fov: 50 });
  const bird = new PlayerBird();
  const world = buildDawnWorld(ctx.scene, ctx.width, ctx.height, {
    hour: 6.8,
    windSpeed: 1.6,
    reflection: false,
    size: 700,
    segments: 140,
    mountains: true,
  });
  ctx.scene.add(bird.group);
  bird.reset(-60, 10, 0, 0, 10);

  const chase = new ChaseCamera();
  chase.distance = 5.5;
  chase.height = 1.7;
  chase.aimAhead = 4.5;
  chase.flapBob = 0.5;

  ctx.shell.slider({
    label: "handoff speed (m/s)",
    min: 1,
    max: 6,
    step: 0.25,
    value: bird.landSpeed,
    onInput: (v) => (bird.landSpeed = v),
  });
  ctx.shell.slider({
    label: "buoyancy stiffness",
    min: 6,
    max: 40,
    step: 1,
    value: bird.buoyancyStiffness,
    onInput: (v) => (bird.buoyancyStiffness = v),
  });
  ctx.shell.setInfo(() => {
    const owner =
      bird.state === "air" ? "flight model" : bird.state === "float" ? "buoyancy spring" : "takeoff script";
    const gs = Math.hypot(bird.body.vel.x, bird.body.vel.z);
    return `owner: ${owner} · ground speed ${gs.toFixed(1)} m/s`;
  });

  const cmds = freshCommands();
  let leg: "approach" | "away" | "return" = "approach";
  let awayDir = 0;
  let floatT = 0;
  let prevState = bird.state;

  ctx.onDispose(() => {
    bird.dispose();
    world.dispose();
  });

  return ctx.finish((t, dt) => {
    cmds.bank = 0;
    cmds.pitch = 0;
    cmds.effort = 0;
    cmds.tuck = 0;
    const body = bird.body;

    if (bird.state === "air") {
      floatT = 0;
      const d = Math.hypot(body.pos.x, body.pos.z);
      if (leg === "approach") {
        // Glide in on a sinking slope toward the lake centre; the flare
        // assist and the model's belly drag do the rest.
        steerToward(body, cmds, 0, Math.min(8, 0.8 + d * 0.11), 0);
        if (d < 30) cmds.effort = 0;
      } else if (leg === "away") {
        steerToward(body, cmds, Math.cos(awayDir) * 140, 13, Math.sin(awayDir) * 140);
        if (d > 60) leg = "return";
      } else {
        steerToward(body, cmds, -60, 11, 0);
        if (Math.hypot(body.pos.x + 60, body.pos.z) < 22) leg = "approach";
      }
    } else if (bird.state === "float") {
      floatT += dt;
      if (floatT > 3.2) cmds.effort = 1; // drift a moment, then go
    } else {
      cmds.effort = 1;
    }

    if (prevState === "run" && bird.state === "air") {
      leg = "away";
      awayDir = bird.heading;
    }
    prevState = bird.state;

    bird.update(dt, t, cmds);
    bird.softBounds(240, dt);
    chase.update(ctx.camera, bird.body, dt, t);
    world.update(t);
  });
}
