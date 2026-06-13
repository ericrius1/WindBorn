import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountBudget,
  mountConductor,
  mountDuskHero,
  mountFoodChain,
} from "./demos/alive/duskDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-dusk": (el) => mountDuskHero(el),
  conductor: (el) => mountConductor(el),
  chain: (el) => mountFoodChain(el),
  budget: (el) => mountBudget(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
