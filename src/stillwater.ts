// Entry for stillwater.html — The Mirror, part 5 (finale).

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountAssembly,
  mountDawnHour,
  mountGlassWind,
  mountRiseRings,
  mountStillwaterHero,
} from "./demos/mirror/stillwaterDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountStillwaterHero>> = {
  "hero-stillwater": (el) => mountStillwaterHero(el),
  assembly: (el) => mountAssembly(el),
  "dawn-hour": (el) => mountDawnHour(el),
  "glass-wind": (el) => mountGlassWind(el),
  "rise-rings": (el) => mountRiseRings(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
