// Entry for mist.html — Air & Light, part 2.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy, type Demo } from "./lib/demoShell";
import { mountAerialRidges, mountBurnoff, mountHeightFog, mountMistHero } from "./demos/sky/mistDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  "hero-mist": (el) => mountMistHero(el),
  "aerial-ridges": (el) => mountAerialRidges(el),
  "height-fog": (el) => mountHeightFog(el),
  burnoff: (el) => mountBurnoff(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
