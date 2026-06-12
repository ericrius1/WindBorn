import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountBudget,
  mountFarshoreHero,
  mountRings,
  mountSeams,
  mountSnap,
} from "./demos/basin/farshoreDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-farshore": (el) => mountFarshoreHero(el),
  budget: (el) => mountBudget(el),
  rings: (el) => mountRings(el),
  seams: (el) => mountSeams(el),
  snap: (el) => mountSnap(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
