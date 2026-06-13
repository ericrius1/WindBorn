import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountBlade,
  mountOneWeather,
  mountShoreHero,
  mountShorePlacement,
} from "./demos/alive/shoreDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-shore": (el) => mountShoreHero(el),
  blade: (el) => mountBlade(el),
  placement: (el) => mountShorePlacement(el),
  oneweather: (el) => mountOneWeather(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
