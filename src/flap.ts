import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountHeroFlap,
  mountClock,
  mountBeat,
  mountGaits,
  mountFeathers,
} from "./demos/bird/flapDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-flap": (el) => mountHeroFlap(el),
  clock: (el) => mountClock(el),
  beat: (el) => mountBeat(el),
  gaits: (el) => mountGaits(el),
  feathers: (el) => mountFeathers(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
