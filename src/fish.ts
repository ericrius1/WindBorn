import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountBoidsTank,
  mountDepthPreference,
  mountFishHero,
  mountGlints,
} from "./demos/alive/fishDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-fish": (el) => mountFishHero(el),
  boids: (el) => mountBoidsTank(el),
  depth: (el) => mountDepthPreference(el),
  glints: (el) => mountGlints(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
