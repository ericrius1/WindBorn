// Keyboard + gamepad → FlightCommands. stick.html is the essay.
//
// Keys are digital (0 or 1), so we ramp them toward their target at a finite
// rate to fake an analog stick — tap for a nudge, hold for full deflection.
// Gamepad sticks are analog already; they get a deadzone and (from joy.html)
// an expo curve instead.
//
// Bindings: A/D or ←/→ bank · W/S or ↑/↓ pitch · Space flap · Shift tuck.
// Gamepad: left stick bank/pitch · right trigger flap · left trigger tuck.

import { expoCurve, applyDeadzone, clamp } from "./tuning";

export class StickControls {
  // Smoothed command values, -1..1 (bank/pitch) and 0..1 (effort/tuck).
  bank = 0;
  pitch = 0;
  effort = 0;
  tuck = 0;

  // Raw targets before smoothing — the commands demo plots these.
  rawBank = 0;
  rawPitch = 0;

  // Tuning (joy.html).
  expo = 0; // 0 = linear stick response
  deadzone = 0.12;
  riseRate = 5; // 1/s — how fast a held key reaches full deflection
  fallRate = 9; // 1/s — how fast release returns to center

  gamepadActive = false;

  private keys = new Set<string>();
  private el: HTMLElement | null = null;
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (CAPTURED.has(e.code)) {
      this.keys.add(e.code);
      e.preventDefault();
    }
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private readonly onBlur = (): void => {
    this.keys.clear();
  };

  // Listen on a focusable element (the demo canvas). The caller handles
  // focus UX; we only read keys while the element has focus.
  attach(el: HTMLElement): void {
    this.el = el;
    el.addEventListener("keydown", this.onKeyDown);
    el.addEventListener("keyup", this.onKeyUp);
    el.addEventListener("blur", this.onBlur);
  }

  detach(): void {
    if (!this.el) return;
    this.el.removeEventListener("keydown", this.onKeyDown);
    this.el.removeEventListener("keyup", this.onKeyUp);
    this.el.removeEventListener("blur", this.onBlur);
    this.el = null;
    this.keys.clear();
  }

  private key(code: string): boolean {
    return this.keys.has(code);
  }

  // Poll inputs and advance the smoothed commands by dt seconds.
  update(dt: number): void {
    // -- keyboard targets ---------------------------------------------------
    let bankT = (this.key("KeyD") || this.key("ArrowRight") ? 1 : 0) - (this.key("KeyA") || this.key("ArrowLeft") ? 1 : 0);
    let pitchT = (this.key("KeyW") || this.key("ArrowUp") ? 1 : 0) - (this.key("KeyS") || this.key("ArrowDown") ? 1 : 0);
    let effortT = this.key("Space") ? 1 : 0;
    let tuckT = this.key("ShiftLeft") || this.key("ShiftRight") ? 1 : 0;

    // -- gamepad overrides when it speaks ------------------------------------
    this.gamepadActive = false;
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || pad.mapping !== "standard") continue;
      const gx = applyDeadzone(pad.axes[0] ?? 0, this.deadzone);
      const gy = applyDeadzone(pad.axes[1] ?? 0, this.deadzone);
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      const a = pad.buttons[0]?.pressed ? 1 : 0;
      if (gx !== 0 || gy !== 0 || rt > 0.02 || lt > 0.02 || a) {
        this.gamepadActive = true;
        bankT = expoCurve(gx, this.expo);
        pitchT = expoCurve(-gy, this.expo); // stick forward = nose down
        effortT = Math.max(rt, a);
        tuckT = lt;
      }
      break; // first standard pad wins
    }

    this.rawBank = bankT;
    this.rawPitch = pitchT;

    // -- ramp digital inputs into analog commands ----------------------------
    const ramp = (v: number, target: number): number => {
      const rate = Math.abs(target) > Math.abs(v) ? this.riseRate : this.fallRate;
      return v + clamp(target - v, -rate * dt, rate * dt);
    };
    if (this.gamepadActive) {
      // Analog hardware already gives us a smooth signal; pass it through.
      this.bank = bankT;
      this.pitch = pitchT;
    } else {
      this.bank = ramp(this.bank, bankT);
      this.pitch = ramp(this.pitch, pitchT);
    }
    this.effort = ramp(this.effort, effortT);
    this.tuck = ramp(this.tuck, tuckT);
  }
}

const CAPTURED = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "ShiftLeft",
  "ShiftRight",
]);
