// Entry for simbubble.html — The Splash, part 3.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountEdgeBlend,
  mountFloatAnywhere,
  mountFollowHeat,
  mountSimbubbleHero,
  mountWindowScrolly,
} from "./demos/splash/simbubbleDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountSimbubbleHero>> = {
  "hero-simbubble": (el) => mountSimbubbleHero(el),
  "follow-heat": (el) => mountFollowHeat(el),
  "edge-blend": (el) => mountEdgeBlend(el),
  "float-anywhere": (el) => mountFloatAnywhere(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}

const scrolly = document.querySelector<HTMLElement>('[data-scrolly="window-shift"]');
if (scrolly) mountWindowScrolly(scrolly);
