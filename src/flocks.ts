import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountEagle, mountFlocksHero, mountSkim, mountVee } from "./demos/alive/flocksDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-flocks": (el) => mountFlocksHero(el),
  skim: (el) => mountSkim(el),
  vee: (el) => mountVee(el),
  eagle: (el) => mountEagle(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
