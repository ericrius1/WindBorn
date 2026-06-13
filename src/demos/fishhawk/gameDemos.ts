// Demos for game.html — THE GAME. The hero is the finished thing: the Game
// controller mounted whole, title screen and all, the actual playable Fish
// Hawk that the landing page's "Play" button now resolves to. The figures are
// small: a compact second mount of the same controller (so the article can talk
// about the assembly while it runs), and the credits panel inline, proving the
// roll covers every series the project shipped.

import { gpuMissing, type Demo } from "../../lib/demoShell";
import { clock } from "../../lib/spine";
import { resumeAudio } from "../../lib/audio";
import { makeStage } from "./stage";
import { Game, type GameOptions } from "./game";
import { Panel, buildCredits } from "./hud";

/** Mount the Game on a fresh stage; shared by the hero and the compact figure. */
async function mountGame(el: HTMLElement, opts: { aspect: number; options?: GameOptions }): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await makeStage(el, { aspect: opts.aspect, fov: 55, far: 5600 });

  // The game owns the clock while it runs; restore the shared clock on teardown
  // so the next page starts clean.
  const prevSpeed = clock.speed;
  const prevDay = clock.dayLength;
  const prevPaused = clock.paused;
  ctx.onDispose(() => {
    clock.speed = prevSpeed;
    clock.dayLength = prevDay;
    clock.paused = prevPaused;
  });

  const game = new Game(ctx, opts.options?.compact ?? false, opts.options);
  const offKeys = game.bindKeys();

  ctx.shell.button("click for sound", () => {
    // Routed through the settings flow; this is just a convenient top-level
    // gesture so a reader can turn on audio without opening the menu.
    void import("../../lib/audio").then((m) => {
      void m.resumeAudio();
    });
  });
  ctx.shell.setInfo(() => `Fish Hawk · ${game.phase}`);

  ctx.onDispose(() => {
    offKeys();
    game.dispose();
  });

  return ctx.finish(
    (t, dt) => game.frame(t, dt),
    () => game.render(),
  );
}

// ---- hero: the playable game ------------------------------------------------------------

export async function mountHeroGame(el: HTMLElement): Promise<Demo> {
  return mountGame(el, { aspect: 0.56, options: { quality: "medium", saveKey: "fishhawk:save" } });
}

// ---- Step 1: the controller, in miniature -----------------------------------------------
// The same Game class, mounted small on its own throwaway save, so the article
// can point at the running assembly while explaining how the pieces snap
// together. Identical code path to the hero — just a smaller frame and a save
// key that never touches the real game.

export async function mountController(el: HTMLElement): Promise<Demo> {
  return mountGame(el, {
    aspect: 0.6,
    options: { quality: "low", saveKey: "fishhawk:game-figure", compact: true },
  });
}

// ---- Step 2: the credits, inline --------------------------------------------------------
// The roll that closes the project, shown on the page itself. Built from the
// same posts.ts the site nav reads, grouped by season exactly as the landing
// page is — so it can never drift out of sync, and every series the project
// shipped is linked here.

export function mountCredits(el: HTMLElement): Demo {
  el.classList.add("demo");
  const host = document.createElement("div");
  host.style.cssText = "position:relative;min-height:24rem;";
  el.appendChild(host);

  const panel = new Panel(host);
  // The credits panel is normally a modal over the game; here we let it sit
  // inline and fill the figure, with the backdrop dimmed but static.
  panel.root.style.position = "relative";
  panel.root.style.background = "transparent";
  panel.root.style.backdropFilter = "none";
  buildCredits(panel, () => {
    /* inline: the "back to the lake" button scrolls to the playable hero */
    document.querySelector('[data-demo="hero-game"]')?.scrollIntoView({ behavior: "smooth" });
  });
  panel.open();

  return { frame: () => {}, dispose: () => el.replaceChildren() };
}
