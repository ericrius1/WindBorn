import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountHeroLakeday,
  mountConductor,
  mountFront,
  mountDusk,
} from "./demos/interludes/lakedayDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-lakeday": (el) => mountHeroLakeday(el),
  conductor: (el) => mountConductor(el),
  front: (el) => mountFront(el),
  dusk: (el) => mountDusk(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
