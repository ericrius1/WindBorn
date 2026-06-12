import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountHeroTouchgo,
  mountFlare,
  mountBuoy,
  mountBus,
  mountRun,
} from "./demos/bird/touchgoDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-touchgo": (el) => mountHeroTouchgo(el),
  flare: (el) => mountFlare(el),
  buoy: (el) => mountBuoy(el),
  bus: (el) => mountBus(el),
  run: (el) => mountRun(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
