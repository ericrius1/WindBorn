// Entry for shallows.html — The Splash, part 2.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountColumnScrolly,
  mountLakebedWindow,
  mountShallowsHero,
  mountShoalingRamp,
  mountSpeedOfDepth,
} from "./demos/splash/shallowsDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountShallowsHero>> = {
  "hero-shallows": (el) => mountShallowsHero(el),
  "speed-of-depth": (el) => mountSpeedOfDepth(el),
  "shoaling-ramp": (el) => mountShoalingRamp(el),
  "lakebed-window": (el) => mountLakebedWindow(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}

const scrolly = document.querySelector<HTMLElement>('[data-scrolly="column-flux"]');
if (scrolly) mountColumnScrolly(scrolly);
