import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountHeroThedive, mountScoring, mountCarry } from "./demos/fishhawk/thediveDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-thedive": (el) => mountHeroThedive(el),
  scoring: (el) => mountScoring(el),
  carry: (el) => mountCarry(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
