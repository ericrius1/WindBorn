import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountForestHero,
  mountInstancing,
  mountOneConifer,
  mountPerches,
  mountScatterRules,
} from "./demos/basin/forestDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-forest": (el) => mountForestHero(el),
  conifer: (el) => mountOneConifer(el),
  instancing: (el) => mountInstancing(el),
  scatter: (el) => mountScatterRules(el),
  perches: (el) => mountPerches(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
