import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountHeroNest, mountStages, mountGoals } from "./demos/fishhawk/nestDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-nest": (el) => mountHeroNest(el),
  stages: (el) => mountStages(el),
  goals: (el) => mountGoals(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
