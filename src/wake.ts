// Entry for wake.html — The Splash, part 6 (the finale).

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountFoamPaint,
  mountKelvinScrolly,
  mountStrikeMix,
  mountWakeAngle,
  mountWakeHero,
} from "./demos/splash/wakeDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountWakeHero>> = {
  "hero-wake": (el) => mountWakeHero(el),
  "foam-paint": (el) => mountFoamPaint(el),
  "wake-angle": (el) => mountWakeAngle(el),
  "strike-mix": (el) => mountStrikeMix(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}

const scrolly = document.querySelector<HTMLElement>('[data-scrolly="kelvin-fan"]');
if (scrolly) mountKelvinScrolly(scrolly);
