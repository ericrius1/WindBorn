import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountHeroFirstflight,
  mountContracts,
  mountWingbeat,
  mountHandoff,
} from "./demos/interludes/firstflightDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-firstflight": (el) => mountHeroFirstflight(el),
  contracts: (el) => mountContracts(el),
  wingbeat: (el) => mountWingbeat(el),
  handoff: (el) => mountHandoff(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
