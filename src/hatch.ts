import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountHatchClock,
  mountHatchHero,
  mountLifeCycle,
  mountRises,
} from "./demos/alive/hatchDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-hatch": (el) => mountHatchHero(el),
  clock: (el) => mountHatchClock(el),
  lifecycle: (el) => mountLifeCycle(el),
  rises: (el) => mountRises(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
