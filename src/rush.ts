import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy, type Demo } from "./lib/demoShell";
import { mountRushHero, mountBands, mountSpeedMap, mountWhump } from "./demos/ear/rushDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  "hero-rush": (el) => mountRushHero(el),
  bands: (el) => mountBands(el),
  speedmap: (el) => mountSpeedMap(el),
  whump: (el) => mountWhump(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
