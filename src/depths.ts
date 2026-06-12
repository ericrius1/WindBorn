// Entry for depths.html — The Mirror, part 4.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountAbsorbRamp,
  mountAbsorbScrolly,
  mountDepthsHero,
  mountRefractionBend,
  mountShallows,
} from "./demos/mirror/depthsDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountDepthsHero>> = {
  "hero-depths": (el) => mountDepthsHero(el),
  "absorb-ramp": (el) => mountAbsorbRamp(el),
  "refraction-bend": (el) => mountRefractionBend(el),
  shallows: (el) => mountShallows(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}

const scrolly = document.querySelector<HTMLElement>('[data-scrolly="absorb"]');
if (scrolly) mountAbsorbScrolly(scrolly);
