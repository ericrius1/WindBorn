import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountHeroWingfold,
  mountFk,
  mountLawCos,
  mountIkWing,
  mountFold,
} from "./demos/bird/wingfoldDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-wingfold": (el) => mountHeroWingfold(el),
  fk: (el) => mountFk(el),
  lawcos: (el) => mountLawCos(el),
  ikwing: (el) => mountIkWing(el),
  fold: (el) => mountFold(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
