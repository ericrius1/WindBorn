import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy, type Demo } from "./lib/demoShell";
import {
  mountForcesHero,
  mountLiftCurve,
  mountGlide,
  mountFlapClimb,
  mountFreeFlight,
  mountForcesScrolly,
} from "./demos/lift/forcesDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  "hero-forces": (el) => mountForcesHero(el),
  liftcurve: (el) => mountLiftCurve(el),
  glide: (el) => mountGlide(el),
  flapclimb: (el) => mountFlapClimb(el),
  freeflight: (el) => mountFreeFlight(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}

const scrolly = document.querySelector<HTMLElement>('[data-scrolly="fourforces"]');
if (scrolly) mountForcesScrolly(scrolly);
