// Entry for air.html — Air & Light, part 1.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy, type Demo } from "./lib/demoShell";
import {
  mountAirHero,
  mountGoldenHours,
  mountScattering,
  mountSunArc,
  mountSunGeometryScrolly,
} from "./demos/sky/airDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  "hero-air": (el) => mountAirHero(el),
  "sun-arc": (el) => mountSunArc(el),
  scattering: (el) => mountScattering(el),
  "golden-hours": (el) => mountGoldenHours(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}

const scrolly = document.querySelector<HTMLElement>("[data-scrolly='sun-geometry']");
if (scrolly) mountSunGeometryScrolly(scrolly);
