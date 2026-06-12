import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy, type Demo } from "./lib/demoShell";
import {
  mountUpdraftsHero,
  mountGusts,
  mountRidge,
  mountThermal,
  mountVario,
} from "./demos/lift/updraftsDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  "hero-updrafts": (el) => mountUpdraftsHero(el),
  gusts: (el) => mountGusts(el),
  ridge: (el) => mountRidge(el),
  thermal: (el) => mountThermal(el),
  vario: (el) => mountVario(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
