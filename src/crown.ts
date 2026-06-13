// Entry for crown.html — The Splash, part 5.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountCrownHero,
  mountCrownRing,
  mountDropletArcs,
  mountEnergyCount,
  mountRejoinRings,
  mountSplashAnatomyScrolly,
} from "./demos/splash/crownDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountCrownHero>> = {
  "hero-crown": (el) => mountCrownHero(el),
  "energy-count": (el) => mountEnergyCount(el),
  "droplet-arcs": (el) => mountDropletArcs(el),
  "crown-ring": (el) => mountCrownRing(el),
  "rejoin-rings": (el) => mountRejoinRings(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}

const scrolly = document.querySelector<HTMLElement>('[data-scrolly="splash-anatomy"]');
if (scrolly) mountSplashAnatomyScrolly(scrolly);
