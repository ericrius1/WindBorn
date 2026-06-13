// Entry for night.html — Air & Light, part 5 (finale).

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy, type Demo } from "./lib/demoShell";
import { mountMoonArc, mountMoonGlitter, mountNightHero, mountStarDome } from "./demos/sky/nightDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  "hero-night": (el) => mountNightHero(el),
  "moon-arc": (el) => mountMoonArc(el),
  "star-dome": (el) => mountStarDome(el),
  "moon-glitter": (el) => mountMoonGlitter(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
