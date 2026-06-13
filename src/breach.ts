// Entry for breach.html — Under, part 4.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountBreachHero, mountDiveProfile, mountTheGrab, mountWaterOff } from "./demos/under/breachDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountBreachHero>> = {
  "hero-breach": (el) => mountBreachHero(el),
  "dive-profile": (el) => mountDiveProfile(el),
  "the-grab": (el) => mountTheGrab(el),
  "water-off": (el) => mountWaterOff(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
