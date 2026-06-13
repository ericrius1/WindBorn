// Photo mode — the machinery behind the game's witness verb.
//
//   FramingGuides   thirds / phi / center lines drawn as a post overlay
//   FreeCamera      detach from the chase rig: drag to look, keys to move
//   PhotoMode       enter/exit (freezes the world clock and the scene's
//                   simulated time), the shutter, and the flash uniform
//   Journal         moments as predicates over spine + flight state, with
//                   the witnessed set persisted in localStorage
//
// fieldnotes.html derives each piece. The controller is deliberately scene
// -agnostic: scenes hand it a camera and ask `worldTime(dt)` instead of
// accumulating their own — that one substitution is what makes freezing
// time a one-flag operation.

import { Vector3 } from "three/webgpu";
import { float, mix, screenSize, smoothstep, uniform, uv, vec3, vec4 } from "three/tsl";
import type { Node, PerspectiveCamera } from "three/webgpu";
import { clock } from "../spine";
import type { FlightState } from "../flight/state";

type NodeF = Node<"float">;
type NodeV4 = Node<"vec4">;

// ---- framing guides --------------------------------------------------------------

export const GUIDE_MODES = ["off", "thirds", "phi", "center"] as const;
export type GuideMode = (typeof GUIDE_MODES)[number];

const PHI_LO = 0.382; // 1 − 1/φ
const PHI_HI = 0.618; // 1/φ

export class FramingGuides {
  /** 0 off · 1 thirds · 2 phi · 3 center. Drive directly or via cycle(). */
  readonly mode = uniform(0);
  readonly opacity = uniform(0.5);

  cycle(): GuideMode {
    this.mode.value = (this.mode.value + 1) % GUIDE_MODES.length;
    return GUIDE_MODES[this.mode.value];
  }

  set(mode: GuideMode): void {
    this.mode.value = GUIDE_MODES.indexOf(mode);
  }

  get current(): GuideMode {
    return GUIDE_MODES[Math.round(this.mode.value)];
  }

  /** Overlay the guide lines on `base`. Pure screen-space; one pixel wide. */
  node(base: NodeV4): NodeV4 {
    const x = uv().x;
    const y = uv().y;
    const w = float(1.25).div(screenSize.y); // line half-width in uv

    // distance to the nearest line of a two-line pair
    const pair = (v: NodeF, a: number, b: number): NodeF =>
      v.sub(a).abs().min(v.sub(b).abs());

    const line = (d: NodeF): NodeF => smoothstep(w.mul(1.6), w.mul(0.4), d);

    const thirds = line(pair(x, 1 / 3, 2 / 3)).max(line(pair(y, 1 / 3, 2 / 3)));
    const phi = line(pair(x, PHI_LO, PHI_HI)).max(line(pair(y, PHI_LO, PHI_HI)));
    // center: a cross that only lives near the middle of the frame
    const nearMid = smoothstep(0.16, 0.1, x.sub(0.5).abs().max(y.sub(0.5).abs()));
    const center = line(x.sub(0.5).abs()).max(line(y.sub(0.5).abs())).mul(nearMid);

    // pick by mode (an integer riding in a float uniform)
    const eq = (n: number): NodeF => float(1).sub(this.mode.sub(n).abs().min(1));
    const mask = thirds
      .mul(eq(1))
      .add(phi.mul(eq(2)))
      .add(center.mul(eq(3)))
      .mul(this.opacity);

    return vec4(mix(base.rgb, vec3(0.92, 0.95, 1.0), mask), base.a);
  }
}

// ---- the free camera ----------------------------------------------------------------

export interface FreeCameraOptions {
  /** Movement speed, m/s (shift = ×4). */
  speed?: number;
  /** Lowest the lens may go (default just under the surface). */
  minY?: number;
  /** Leash radius from the point where photo mode was entered. */
  range?: number;
}

const CAPTURED = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]);

/**
 * Drag to look, WASD to move (Q/E for down/up), all relative to where the
 * lens points. Attach to a focusable canvas; detach to hand control back.
 */
export class FreeCamera {
  speed: number;
  minY: number;
  range: number;

  private yaw = 0;
  private pitch = 0;
  private anchor = new Vector3();
  private keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private el: HTMLElement | null = null;
  private fwd = new Vector3();
  private right = new Vector3();

  constructor(options: FreeCameraOptions = {}) {
    this.speed = options.speed ?? 9;
    this.minY = options.minY ?? -2.5;
    this.range = options.range ?? 220;
  }

  /** Seed pose from the camera's current orientation. */
  syncFrom(camera: PerspectiveCamera): void {
    camera.getWorldDirection(this.fwd);
    this.yaw = Math.atan2(this.fwd.z, this.fwd.x);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, this.fwd.y)));
    this.anchor.copy(camera.position);
  }

  private readonly onDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  private readonly onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.yaw += (e.clientX - this.lastX) * 0.004;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - (e.clientY - this.lastY) * 0.003));
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };
  private readonly onUp = (): void => {
    this.dragging = false;
  };
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (CAPTURED.has(e.code) || e.code === "ShiftLeft" || e.code === "ShiftRight") {
      this.keys.add(e.code);
      e.preventDefault();
    }
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private readonly onBlur = (): void => this.keys.clear();

  attach(el: HTMLElement): void {
    this.el = el;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);
    el.addEventListener("keydown", this.onKeyDown);
    el.addEventListener("keyup", this.onKeyUp);
    el.addEventListener("blur", this.onBlur);
  }

  detach(): void {
    const el = this.el;
    if (!el) return;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onUp);
    el.removeEventListener("keydown", this.onKeyDown);
    el.removeEventListener("keyup", this.onKeyUp);
    el.removeEventListener("blur", this.onBlur);
    this.el = null;
    this.keys.clear();
    this.dragging = false;
  }

  update(camera: PerspectiveCamera, dt: number): void {
    const cp = Math.cos(this.pitch);
    this.fwd.set(Math.cos(this.yaw) * cp, Math.sin(this.pitch), Math.sin(this.yaw) * cp);
    this.right.set(-Math.sin(this.yaw), 0, Math.cos(this.yaw));

    const k = this.keys;
    const boost = k.has("ShiftLeft") || k.has("ShiftRight") ? 4 : 1;
    const v = this.speed * boost * dt;
    const fb = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const lr = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const ud = (k.has("KeyE") ? 1 : 0) - (k.has("KeyQ") ? 1 : 0);

    camera.position.addScaledVector(this.fwd, fb * v);
    camera.position.addScaledVector(this.right, lr * v);
    camera.position.y += ud * v;
    camera.position.y = Math.max(camera.position.y, this.minY);

    // the leash: photo mode explores a moment, it doesn't leave the scene
    const dx = camera.position.x - this.anchor.x;
    const dz = camera.position.z - this.anchor.z;
    const d = Math.hypot(dx, dz);
    if (d > this.range) {
      camera.position.x = this.anchor.x + (dx / d) * this.range;
      camera.position.z = this.anchor.z + (dz / d) * this.range;
    }

    camera.lookAt(
      camera.position.x + this.fwd.x,
      camera.position.y + this.fwd.y,
      camera.position.z + this.fwd.z,
    );
  }
}

// ---- the journal ------------------------------------------------------------------

export interface MomentContext {
  hour: number;
  windSpeed: number;
  underwater: boolean;
  flight: FlightState | null;
}

export interface PhotoMoment {
  id: string;
  title: string;
  /** The journal line the player earns. */
  note: string;
  when(ctx: MomentContext): boolean;
}

export const DEFAULT_MOMENTS: PhotoMoment[] = [
  {
    id: "glass-dawn",
    title: "Glass dawn",
    note: "Before five-thirty the lake forgets it is water. The far ridge floats twice.",
    when: (c) => c.hour >= 4.6 && c.hour <= 6.6 && c.windSpeed < 3,
  },
  {
    id: "golden-hour",
    title: "Golden hour",
    note: "Everything the light touches owes it something warm.",
    when: (c) => (c.hour >= 5.5 && c.hour <= 8.2) || (c.hour >= 17.8 && c.hour <= 20.2),
  },
  {
    id: "blue-hour",
    title: "Blue hour",
    note: "The sun is gone and nothing is dark yet. The whole valley holds one color.",
    when: (c) => (c.hour >= 4.0 && c.hour < 5.2) || (c.hour > 20.4 && c.hour <= 21.6),
  },
  {
    id: "night-water",
    title: "Moonwatch",
    note: "A road of light on black water, and the road moves when you do.",
    when: (c) => c.hour >= 22.5 || c.hour <= 3.2,
  },
  {
    id: "on-the-wing",
    title: "On the wing",
    note: "Caught at full cruise — the wind doing most of the work.",
    when: (c) => !!c.flight && c.flight.airspeed > 14 && !c.flight.onWater,
  },
  {
    id: "the-tuck",
    title: "The tuck",
    note: "Wings folded, the whole bird becomes an argument for gravity.",
    when: (c) => !!c.flight && c.flight.tuck > 0.45 && c.flight.verticalSpeed < -7,
  },
  {
    id: "under-the-mirror",
    title: "Under the mirror",
    note: "The sky shrinks to a circle and the lake becomes the ceiling.",
    when: (c) => c.underwater,
  },
];

export class Journal {
  readonly moments: PhotoMoment[];
  private readonly key: string;
  private readonly seen = new Set<string>();

  constructor(storageKey = "stillwater-fieldnotes", moments: PhotoMoment[] = DEFAULT_MOMENTS) {
    this.key = storageKey;
    this.moments = moments;
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) for (const id of JSON.parse(raw) as string[]) this.seen.add(id);
    } catch {
      /* storage unavailable: the journal still works, it just forgets */
    }
  }

  has(id: string): boolean {
    return this.seen.has(id);
  }

  witnessed(): PhotoMoment[] {
    return this.moments.filter((m) => this.seen.has(m.id));
  }

  /** Test every moment against the context; record and return the new ones. */
  capture(ctx: MomentContext): PhotoMoment[] {
    const fresh: PhotoMoment[] = [];
    for (const m of this.moments) {
      if (!this.seen.has(m.id) && m.when(ctx)) {
        this.seen.add(m.id);
        fresh.push(m);
      }
    }
    if (fresh.length) this.save();
    return fresh;
  }

  reset(): void {
    this.seen.clear();
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify([...this.seen]));
    } catch {
      /* ignore */
    }
  }
}

// ---- the controller ----------------------------------------------------------------

export class PhotoMode {
  readonly guides = new FramingGuides();
  readonly freeCam: FreeCamera;
  /** 0..1 — the shutter flash, decayed in worldTime(). */
  readonly flash = uniform(0);

  active = false;
  /** Fired on enter/exit so HUDs can sync. */
  onToggle: ((active: boolean) => void) | null = null;

  private t = 0;
  private savedPaused = false;
  private savedSpeed = 1;

  constructor(freeCamOptions: FreeCameraOptions = {}) {
    this.freeCam = new FreeCamera(freeCamOptions);
  }

  /**
   * The scene's simulated seconds. Scenes call this once per frame instead
   * of accumulating dt themselves; while photo mode is active the number
   * stops, and with it every wave, wingbeat, and drifting cloud.
   */
  worldTime(dt: number): number {
    if (!this.active) this.t += dt;
    this.flash.value = Math.max(0, this.flash.value - dt * 3.5);
    return this.t;
  }

  enter(camera: PerspectiveCamera, canvas?: HTMLElement): void {
    if (this.active) return;
    this.active = true;
    this.savedPaused = clock.paused;
    this.savedSpeed = clock.speed;
    clock.paused = true;
    this.freeCam.syncFrom(camera);
    if (canvas) this.freeCam.attach(canvas);
    this.onToggle?.(true);
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    clock.paused = this.savedPaused;
    clock.speed = this.savedSpeed;
    this.freeCam.detach();
    this.onToggle?.(false);
  }

  toggle(camera: PerspectiveCamera, canvas?: HTMLElement): boolean {
    if (this.active) this.exit();
    else this.enter(camera, canvas);
    return this.active;
  }

  /** Move the free camera (no-op unless active). */
  update(camera: PerspectiveCamera, dt: number): void {
    if (this.active) this.freeCam.update(camera, dt);
  }

  /** Fire the shutter: flash, then ask the journal what was witnessed. */
  shutter(journal: Journal, ctx: MomentContext): PhotoMoment[] {
    this.flash.value = 1;
    return journal.capture(ctx);
  }

  /** The flash as a node: a brief whole-frame lift toward white. */
  flashNode(base: NodeV4): NodeV4 {
    return vec4(mix(base.rgb, vec3(1, 1, 1), this.flash.mul(0.85)), base.a);
  }

  dispose(): void {
    this.exit();
  }
}
