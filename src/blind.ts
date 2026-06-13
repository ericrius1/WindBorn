import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy, type Demo } from "./lib/demoShell";
import { mountBlindHero, mountStems, mountEarcheck } from "./demos/ear/blindDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  "hero-blind": (el) => mountBlindHero(el),
  stems: (el) => mountStems(el),
  earcheck: (el) => mountEarcheck(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
