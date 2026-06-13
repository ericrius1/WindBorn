import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountHeroReckoning, mountBudget, mountKnobs } from "./demos/fishhawk/reckoningDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-reckoning": (el) => mountHeroReckoning(el),
  budget: (el) => mountBudget(el),
  knobs: (el) => mountKnobs(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
