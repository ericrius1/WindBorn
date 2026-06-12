import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountCirqueHero,
  mountProfileScrolly,
  mountRidged,
  mountShoreline,
  mountSkeleton,
  mountWarped,
} from "./demos/basin/cirqueDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-cirque": (el) => mountCirqueHero(el),
  ridged: (el) => mountRidged(el),
  warped: (el) => mountWarped(el),
  skeleton: (el) => mountSkeleton(el),
  shoreline: (el) => mountShoreline(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}

const scrolly = document.querySelector<HTMLElement>("[data-scrolly='profile']");
if (scrolly) mountProfileScrolly(scrolly);
