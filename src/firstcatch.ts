import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountHeroFirstcatch,
  mountTelegraph,
  mountWindow,
  mountGrab,
} from "./demos/interludes/firstcatchDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-firstcatch": (el) => mountHeroFirstcatch(el),
  telegraph: (el) => mountTelegraph(el),
  window: (el) => mountWindow(el),
  grab: (el) => mountGrab(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
