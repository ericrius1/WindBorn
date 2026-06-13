// Entry for coupling.html — The Splash, part 4.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountBuoyancyScrolly,
  mountCouplingHero,
  mountFloatDunk,
  mountImpulseModes,
  mountMirrorProbe,
  mountWakeCircle,
} from "./demos/splash/couplingDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountCouplingHero>> = {
  "hero-coupling": (el) => mountCouplingHero(el),
  "impulse-modes": (el) => mountImpulseModes(el),
  "mirror-probe": (el) => mountMirrorProbe(el),
  "float-dunk": (el) => mountFloatDunk(el),
  "wake-circle": (el) => mountWakeCircle(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}

const scrolly = document.querySelector<HTMLElement>('[data-scrolly="buoyancy"]');
if (scrolly) mountBuoyancyScrolly(scrolly);
