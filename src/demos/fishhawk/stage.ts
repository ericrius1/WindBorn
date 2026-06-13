// The stage: renderer + camera + a clamped frame loop, and the click-to-focus
// overlay every keyboard demo needs. This is the same minimal context the
// playable milestones run on, rebuilt here so Fish Hawk owns its own assembly
// (the game extends it with a post-fx hook the interludes never needed).
//
// One WebGPURenderer per demo, an optional render-scale for the heavy heroes,
// and a finish() that drives a clamped dt so a hiccuping tab never explodes the
// integration step.

import {
  ACESFilmicToneMapping,
  PerspectiveCamera,
  Scene,
  WebGPURenderer,
} from "three/webgpu";
import { Shell, type Demo } from "../../lib/demoShell";

export interface StageOptions {
  aspect?: number;
  fov?: number;
  near?: number;
  far?: number;
  /** Internal render resolution as a fraction of the canvas (heavy heroes). */
  renderScale?: number;
}

export interface Stage {
  shell: Shell;
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  width: number;
  height: number;
  onDispose(fn: () => void): void;
  /** Build the Demo: clamp dt, run frame(t, dt), then render (or a custom render). */
  finish(frame: (t: number, dt: number) => void, render?: () => void): Demo;
}

export async function makeStage(el: HTMLElement, options: StageOptions = {}): Promise<Stage> {
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

// ---- click-to-focus overlay ------------------------------------------------------
// Keyboard demos must not steal keys from the page; the canvas only listens
// while focused, and this overlay makes that visible: a prompt pill while idle,
// a hint bar while flying.

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
    promptText = "Click to take the stick",
  ) {
    this.wrapper = document.createElement("div");
    this.wrapper.style.position = "relative";
    canvas.parentElement?.insertBefore(this.wrapper, canvas);
    this.wrapper.appendChild(canvas);
    canvas.tabIndex = 0;
    canvas.style.outline = "none";
    canvas.style.cursor = "pointer";

    this.prompt = document.createElement("div");
    this.prompt.style.cssText =
      "position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;";
    const pill = document.createElement("span");
    pill.textContent = promptText;
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

  /** The relative wrapper, for stacking a HUD over the canvas. */
  get layer(): HTMLDivElement {
    return this.wrapper;
  }

  setHint(text: string): void {
    this.bar.textContent = text;
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
