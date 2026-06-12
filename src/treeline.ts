import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountAltitudeBands,
  mountPaint,
  mountSlopeMap,
  mountTreelineHero,
} from "./demos/basin/treelineDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-treeline": (el) => mountTreelineHero(el),
  altitude: (el) => mountAltitudeBands(el),
  slope: (el) => mountSlopeMap(el),
  paint: (el) => mountPaint(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
