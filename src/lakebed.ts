import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountLakebedHero,
  mountProbe,
  mountRidgeLift,
  mountSection,
  mountShoreContinuity,
} from "./demos/basin/lakebedDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-lakebed": (el) => mountLakebedHero(el),
  section: (el) => mountSection(el),
  continuity: (el) => mountShoreContinuity(el),
  probe: (el) => mountProbe(el),
  ridgelift: (el) => mountRidgeLift(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
