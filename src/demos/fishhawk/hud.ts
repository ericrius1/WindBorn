// The game's chrome — DOM overlays stacked over the canvas. Fish Hawk keeps the
// in-world HUD almost invisible (the ecosystem is the real readout), but it
// still needs a quiet status line, a few menu panels, and the credits roll that
// closes the whole project. All of it is plain DOM laid over the PilotOverlay's
// relative wrapper, styled inline so it carries no dependency on the article CSS.
//
// Nothing here touches three or the GPU; it is the game's paper UI.

const PANEL_BG = "rgba(10,11,16,.82)";
const BORDER = "1px solid rgba(122,162,255,.28)";
const INK = "#d7dbe6";
const DIM = "#9aa4c2";

function styleButton(b: HTMLButtonElement, primary = false): void {
  b.style.cssText =
    `padding:.5rem 1.1rem;border-radius:999px;cursor:pointer;` +
    `font:600 .82rem ui-sans-serif,system-ui,sans-serif;letter-spacing:.04em;` +
    (primary
      ? `border:1px solid rgba(122,162,255,.7);background:rgba(122,162,255,.16);color:#eaf0ff;`
      : `border:${BORDER};background:rgba(10,11,16,.6);color:${INK};`);
}

// ---- the quiet status line ----------------------------------------------------------
// A single low-contrast strip top-left: the hour, the day, and a soft hunger /
// nest readout. Deliberately understated — a glance, not a dashboard.

export class StatusLine {
  readonly el: HTMLDivElement;

  constructor(layer: HTMLElement) {
    this.el = document.createElement("div");
    this.el.style.cssText =
      `position:absolute;left:.7rem;top:.7rem;pointer-events:none;` +
      `font:600 .72rem ui-monospace,Menlo,monospace;color:${DIM};` +
      `text-shadow:0 1px 3px rgba(0,0,0,.6);line-height:1.5;white-space:pre;`;
    layer.appendChild(this.el);
  }

  set(text: string): void {
    this.el.textContent = text;
  }

  dispose(): void {
    this.el.remove();
  }
}

// ---- a soft goal toast (bottom center, fades) ----------------------------------------

export class Toast {
  private readonly el: HTMLDivElement;
  private timer = 0;

  constructor(layer: HTMLElement) {
    this.el = document.createElement("div");
    this.el.style.cssText =
      `position:absolute;left:50%;bottom:2.6rem;transform:translateX(-50%);` +
      `max-width:80%;text-align:center;pointer-events:none;opacity:0;transition:opacity .4s;` +
      `padding:.4rem 1rem;border-radius:.6rem;background:${PANEL_BG};border:${BORDER};` +
      `font:600 .8rem ui-sans-serif,system-ui,sans-serif;color:${INK};`;
    layer.appendChild(this.el);
  }

  show(text: string, seconds = 3.2): void {
    this.el.textContent = text;
    this.el.style.opacity = "1";
    this.timer = seconds;
  }

  update(dt: number): void {
    if (this.timer > 0) {
      this.timer -= dt;
      if (this.timer <= 0) this.el.style.opacity = "0";
    }
  }

  dispose(): void {
    this.el.remove();
  }
}

// ---- a centered modal panel (title screen, pause, settings, credits) -----------------

export class Panel {
  readonly root: HTMLDivElement;
  readonly body: HTMLDivElement;
  private visible = false;

  constructor(layer: HTMLElement) {
    this.root = document.createElement("div");
    this.root.style.cssText =
      `position:absolute;inset:0;display:none;place-items:center;` +
      `background:rgba(6,7,11,.55);backdrop-filter:blur(2px);z-index:5;`;
    this.body = document.createElement("div");
    this.body.style.cssText =
      `max-width:min(34rem,90%);max-height:86%;overflow:auto;` +
      `padding:1.5rem 1.7rem;border-radius:1rem;background:${PANEL_BG};border:${BORDER};` +
      `box-shadow:0 24px 60px rgba(0,0,0,.5);color:${INK};` +
      `font:400 .9rem/1.55 ui-sans-serif,system-ui,sans-serif;`;
    this.root.appendChild(this.body);
    layer.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.visible;
  }

  open(): void {
    this.visible = true;
    this.root.style.display = "grid";
  }

  close(): void {
    this.visible = false;
    this.root.style.display = "none";
  }

  clear(): void {
    this.body.replaceChildren();
  }

  title(text: string): HTMLHeadingElement {
    const h = document.createElement("h3");
    h.textContent = text;
    h.style.cssText =
      `margin:0 0 .3rem;font:700 1.35rem ui-sans-serif,system-ui,sans-serif;color:#eaf0ff;letter-spacing:.01em;`;
    this.body.appendChild(h);
    return h;
  }

  para(text: string): HTMLParagraphElement {
    const p = document.createElement("p");
    p.textContent = text;
    p.style.cssText = `margin:.5rem 0;color:${DIM};`;
    this.body.appendChild(p);
    return p;
  }

  /** A row of buttons. Returns the button elements in order. */
  buttons(specs: { label: string; primary?: boolean; onClick: () => void }[]): HTMLButtonElement[] {
    const row = document.createElement("div");
    row.style.cssText = `display:flex;flex-wrap:wrap;gap:.6rem;margin-top:1rem;`;
    const out: HTMLButtonElement[] = [];
    for (const s of specs) {
      const b = document.createElement("button");
      b.textContent = s.label;
      styleButton(b, s.primary);
      b.addEventListener("click", s.onClick);
      row.appendChild(b);
      out.push(b);
    }
    this.body.appendChild(row);
    return out;
  }

  /** A labelled toggle row; returns a setter for the displayed state. */
  toggle(label: string, initial: boolean, onChange: (on: boolean) => void): (on: boolean) => void {
    let on = initial;
    const row = document.createElement("button");
    const render = (): void => {
      row.textContent = `${label}: ${on ? "on" : "off"}`;
    };
    styleButton(row);
    row.style.margin = ".3rem .4rem .3rem 0";
    row.addEventListener("click", () => {
      on = !on;
      render();
      onChange(on);
    });
    render();
    this.body.appendChild(row);
    return (v: boolean) => {
      on = v;
      render();
    };
  }

  dispose(): void {
    this.root.remove();
  }
}

// ---- the credits roll: every series, linked ------------------------------------------
// The finale of the whole project. Built from posts.ts so it can never drift out
// of sync with the site, and grouped by season exactly as the landing page is.

import { SEASONS, SERIES_TAGLINES, POSTS } from "../../lib/posts";

export function buildCredits(panel: Panel, onClose: () => void): void {
  panel.clear();
  panel.title("Fish Hawk");
  const sub = panel.para(
    "An osprey on a mountain lake, and the fifty-some essays that built it. Every system you just flew through started as one of these.",
  );
  sub.style.marginBottom = "1rem";

  for (const season of SEASONS) {
    const sh = document.createElement("div");
    sh.textContent = season.name;
    sh.style.cssText =
      `margin:1.1rem 0 .2rem;font:700 .95rem ui-sans-serif,system-ui,sans-serif;color:#eaf0ff;`;
    panel.body.appendChild(sh);
    const blurb = document.createElement("div");
    blurb.textContent = season.blurb;
    blurb.style.cssText = `margin:0 0 .5rem;font-size:.78rem;color:${DIM};`;
    panel.body.appendChild(blurb);

    for (const series of season.series) {
      const seriesEl = document.createElement("div");
      seriesEl.style.cssText = `margin:.5rem 0 .7rem;`;
      const name = document.createElement("div");
      name.textContent = series;
      name.style.cssText = `font:600 .85rem ui-sans-serif,system-ui,sans-serif;color:${INK};`;
      seriesEl.appendChild(name);
      const tag = document.createElement("div");
      tag.textContent = SERIES_TAGLINES[series] ?? "";
      tag.style.cssText = `font-size:.74rem;color:${DIM};margin:.1rem 0 .35rem;`;
      seriesEl.appendChild(tag);

      const links = document.createElement("div");
      links.style.cssText = `display:flex;flex-wrap:wrap;gap:.3rem .7rem;`;
      for (const post of POSTS.filter((p) => p.series === series)) {
        const a = document.createElement("a");
        a.href = post.href;
        a.textContent = post.title;
        a.style.cssText =
          `font-size:.74rem;color:#9fb6ff;text-decoration:none;border-bottom:1px solid rgba(159,182,255,.25);`;
        links.appendChild(a);
      }
      seriesEl.appendChild(links);
      panel.body.appendChild(seriesEl);
    }
  }

  const close = document.createElement("button");
  close.textContent = "Back to the lake";
  styleButton(close, true);
  close.style.marginTop = "1.2rem";
  close.addEventListener("click", onClose);
  panel.body.appendChild(close);
}
