// Demos for fieldnotes.html — photo mode, the game's witness verb.
// Part 4 of Glass & Grain (the series finale).
//
// The same lake stage as the grade demos, but now the camera can detach from
// its rig, the world clock can be frozen, framing guides overlay the frame,
// and a Journal earns entries from moments the lens witnesses. Everything
// here drives the PhotoMode + Journal controllers exported from postfx — the
// scene stays agnostic, asking worldTime(dt) instead of accumulating its own
// seconds, which is the one substitution that makes freezing time a one-flag
// operation.

import { Vector3 } from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { clock, wind } from "../../lib/spine";
import {
  DEFAULT_MOMENTS,
  Journal,
  PostFxStack,
  type MomentContext,
} from "../../lib/postfx";
import { addOrbit, fmtHour, glassCtx, makeFloater, makeLakeStage } from "./kit";

// A drifting look the photo camera detaches from. A small helper so each demo
// can aim the lens at the lake before handing control to the free camera.
function aimAtLake(cam: { position: Vector3; lookAt: (x: number, y: number, z: number) => void }): void {
  cam.position.set(-22, 4.5, 16);
  cam.lookAt(20, 2, -18);
}

// ---- hero: photo mode over the lake -------------------------------------------------
// The full thing: enter photo mode (clock freezes, free camera attaches),
// cycle the guides, fire the shutter. The hero canvas is focusable so WASD +
// drag fly the lens; the journal moments tick as you scrub the hour.

export async function mountFieldnotesHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { aspect: 0.5, fov: 52, renderScale: 0.85 });
  const stage = makeLakeStage(ctx, { hour: 5.6 });
  const floater = makeFloater(ctx.scene, 4, -6);
  ctx.onDispose(() => floater.dispose());
  wind.speed = 1.6;

  const stack = new PostFxStack(ctx.renderer, ctx.scene, ctx.camera, {
    grade: true,
    bloom: true,
    photo: true,
    keyGradeToClock: false,
  });
  ctx.onDispose(() => stack.dispose());
  const photo = stack.photo!;
  const journal = new Journal("stillwater-fieldnotes-hero");

  // make the canvas focusable so the free camera can grab keys
  ctx.shell.canvas.tabIndex = 0;
  aimAtLake(ctx.camera);

  let hour = 5.6;
  const slider = ctx.shell.slider({
    label: "hour",
    min: 0,
    max: 24,
    step: 0.05,
    value: hour,
    format: fmtHour,
    onInput: (v) => (hour = v),
  });
  ctx.shell.button("enter photo mode", () => {
    photo.toggle(ctx.camera, ctx.shell.canvas);
    if (photo.active) ctx.shell.canvas.focus();
  });
  ctx.shell.button("guides", () => photo.guides.cycle());
  ctx.shell.button("shutter", () => {
    const ctxM: MomentContext = { hour, windSpeed: wind.speed, underwater: false, flight: null };
    photo.shutter(journal, ctxM);
  });

  ctx.shell.setInfo(
    () =>
      `${photo.active ? "PHOTO · drag + WASD" : "live"} · guides ${photo.guides.current} · clock ${clock.paused ? "frozen" : "running"} · ${journal.witnessed().length}/${DEFAULT_MOMENTS.length} seen`,
  );

  return ctx.finish(
    (_t, dt) => {
      // worldTime stops while photo mode is active — the whole scene freezes
      const wt = photo.worldTime(dt);
      stage.setHour(hour);
      slider.value = String(hour);
      photo.update(ctx.camera, dt); // moves the free camera (no-op when live)
      floater.update(photo.active ? 0 : dt, wt);
      stage.update(wt, photo.active ? 0 : dt);
      stack.update(dt, { t: wt, hour });
    },
    () => stack.render(),
  );
}

// ---- Step 1: freezing time ---------------------------------------------------------
// The substitution, made visible. A clock readout and a ripple-rich lake; one
// button pauses the spine clock and the scene's worldTime at once — every wave
// and wingbeat stops mid-stride.

export async function mountFreezeClock(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { fov: 50 });
  const stage = makeLakeStage(ctx, { hour: 18.6 });
  const floater = makeFloater(ctx.scene, 0, -2);
  ctx.onDispose(() => floater.dispose());
  wind.speed = 3.2;

  const stack = new PostFxStack(ctx.renderer, ctx.scene, ctx.camera, {
    grade: true,
    bloom: true,
    keyGradeToClock: false,
  });
  ctx.onDispose(() => stack.dispose());

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(0, 0.4, -1),
    distance: 7,
    azimuth: 2.1,
    polar: 0.12,
    drift: 0.02,
  });
  ctx.onDispose(() => orbit.dispose());

  // a local clock so this demo can fast-forward the day without touching the page one
  const startHour = 18.6;
  let simT = 0;
  let frozen = false;
  let hour = startHour;
  const daySpeed = 0.35; // hours of sim time per second

  ctx.shell.button("freeze time", () => (frozen = !frozen));
  ctx.shell.setInfo(
    () => `${fmtHour(hour)} · ${frozen ? "FROZEN — every wave held mid-stride" : "the world runs"}`,
  );

  return ctx.finish(
    (_t, dt) => {
      // worldTime, hand-rolled: the scene's seconds stop when frozen
      if (!frozen) {
        simT += dt;
        hour = (startHour + simT * daySpeed) % 24;
      }
      stage.setHour(hour);
      orbit.update(dt); // the camera still moves — only the WORLD freezes
      floater.update(frozen ? 0 : dt, simT);
      stage.update(simT, frozen ? 0 : dt);
      stack.update(dt, { t: simT, hour });
    },
    () => stack.render(),
  );
}

// ---- Step 2: framing guides --------------------------------------------------------
// The guides as a pure screen-space overlay node. A still lake, an orbiting
// look, and buttons that cycle thirds / phi / center so the composition lines
// snap on over the live frame.

export async function mountFramingGuides(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { fov: 48 });
  const stage = makeLakeStage(ctx, { hour: 7.1 });
  const floater = makeFloater(ctx.scene, 3, -4);
  ctx.onDispose(() => floater.dispose());
  wind.speed = 2;

  const stack = new PostFxStack(ctx.renderer, ctx.scene, ctx.camera, {
    grade: true,
    bloom: true,
    photo: true,
    keyGradeToClock: false,
  });
  ctx.onDispose(() => stack.dispose());
  const guides = stack.photo!.guides;
  guides.set("thirds");

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new Vector3(2, 0.3, -3),
    distance: 9,
    azimuth: 2.4,
    polar: 0.1,
    drift: 0.015,
  });
  ctx.onDispose(() => orbit.dispose());

  for (const mode of ["off", "thirds", "phi", "center"] as const) {
    ctx.shell.button(mode, () => guides.set(mode));
  }
  ctx.shell.slider({
    label: "opacity",
    min: 0,
    max: 1,
    step: 0.02,
    value: guides.opacity.value,
    onInput: (v) => (guides.opacity.value = v),
  });
  ctx.shell.setInfo(
    () =>
      `${guides.current} · thirds split the frame in 3, phi at 0.382 / 0.618 — the golden ratio's two cuts`,
  );

  return ctx.finish(
    (t, dt) => {
      orbit.update(dt);
      floater.update(dt, t);
      stage.update(t, dt);
      stack.update(dt, { t, hour: stage.hour });
    },
    () => stack.render(),
  );
}

// ---- Step 3: the free camera -------------------------------------------------------
// Enter photo mode and the lens detaches: drag to look, WASD to move, Q/E down
// and up, a leash so the moment is explored, not left. The canvas is focusable
// so it can capture the keys.

export async function mountFreeCamera(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { fov: 55 });
  const stage = makeLakeStage(ctx, { hour: 6.2 });
  const floater = makeFloater(ctx.scene, 2, -5);
  ctx.onDispose(() => floater.dispose());
  wind.speed = 1.8;

  const stack = new PostFxStack(ctx.renderer, ctx.scene, ctx.camera, {
    grade: true,
    bloom: true,
    photo: true,
    keyGradeToClock: false,
  });
  ctx.onDispose(() => stack.dispose());
  const photo = stack.photo!;
  photo.freeCam.speed = 7;
  photo.freeCam.range = 60;

  ctx.shell.canvas.tabIndex = 0;
  aimAtLake(ctx.camera);

  ctx.shell.button("enter / exit photo mode", () => {
    photo.toggle(ctx.camera, ctx.shell.canvas);
    if (photo.active) ctx.shell.canvas.focus();
    else aimAtLake(ctx.camera);
  });
  ctx.shell.setInfo(
    () =>
      photo.active
        ? "drag to look · WASD move · Q/E down/up · shift to sprint · leashed to the moment"
        : "click enter, then click the frame and fly the lens",
  );

  return ctx.finish(
    (_t, dt) => {
      const wt = photo.worldTime(dt);
      photo.update(ctx.camera, dt);
      floater.update(photo.active ? 0 : dt, wt);
      stage.update(wt, photo.active ? 0 : dt);
      stack.update(dt, { t: wt, hour: stage.hour });
    },
    () => stack.render(),
  );
}

// ---- Step 4: a journal that fills itself -------------------------------------------
// The witness verb's payoff: moments as predicates over spine + flight state.
// Scrub the hour, fire the shutter, and the journal earns whichever entries
// the current moment satisfies — persisted to localStorage, rendered into a
// panel below the canvas.

export async function mountTheJournal(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await glassCtx(el, { fov: 50 });
  const stage = makeLakeStage(ctx, { hour: 5.2 });
  wind.speed = 1.4;

  const stack = new PostFxStack(ctx.renderer, ctx.scene, ctx.camera, {
    grade: true,
    bloom: true,
    photo: true,
    keyGradeToClock: false,
  });
  ctx.onDispose(() => stack.dispose());
  const photo = stack.photo!;
  const journal = new Journal("stillwater-fieldnotes-demo");

  ctx.camera.position.set(-26, 3.0, 14);
  ctx.camera.lookAt(30, 5, -22);

  // the journal panel, built into the demo's control strip (inline styled, so
  // it needs nothing from the shared stylesheet)
  const panel = document.createElement("div");
  panel.style.cssText =
    "width:100%;margin-top:8px;display:flex;flex-direction:column;gap:5px;font-size:13px;line-height:1.35;";
  ctx.shell.controls.appendChild(panel);
  const renderPanel = (): void => {
    panel.innerHTML = "";
    for (const m of DEFAULT_MOMENTS) {
      const seen = journal.has(m.id);
      const row = document.createElement("div");
      row.style.cssText = `opacity:${seen ? 1 : 0.34};display:flex;gap:8px;align-items:baseline;`;
      const title = document.createElement("strong");
      title.style.cssText = "flex:0 0 9.5em;color:#bfe4ee;";
      title.textContent = seen ? m.title : "· · · · ·";
      const note = document.createElement("span");
      note.style.opacity = "0.85";
      note.textContent = seen ? m.note : "an unwitnessed moment";
      row.appendChild(title);
      row.appendChild(note);
      panel.appendChild(row);
    }
  };
  renderPanel();

  let hour = 5.2;
  const slider = ctx.shell.slider({
    label: "hour",
    min: 0,
    max: 24,
    step: 0.05,
    value: hour,
    format: fmtHour,
    onInput: (v) => (hour = v),
  });
  let flash = "";
  ctx.shell.button("shutter", () => {
    const fresh = photo.shutter(journal, {
      hour,
      windSpeed: wind.speed,
      underwater: false,
      flight: null,
    });
    flash = fresh.length ? `captured: ${fresh.map((m) => m.title).join(", ")}` : "nothing new here — try another hour";
    renderPanel();
  });
  ctx.shell.button("clear journal", () => {
    journal.reset();
    flash = "journal cleared";
    renderPanel();
  });
  ctx.shell.setInfo(
    () => flash || `${fmtHour(hour)} · point the lens at a moment and press the shutter`,
  );

  let simT = 0;
  return ctx.finish(
    (_t, dt) => {
      simT += dt;
      slider.value = String(hour);
      stage.setHour(hour);
      // the shutter flash decays in worldTime; call it so the white pop fades
      photo.worldTime(dt);
      stage.update(simT, dt);
      stack.update(dt, { t: simT, hour });
    },
    () => stack.render(),
  );
}
