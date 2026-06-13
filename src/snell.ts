// Entry for snell.html — Under, part 2.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountCriticalAngle,
  mountCriticalScrolly,
  mountSnellHero,
  mountTirMirror,
  mountWindowCircle,
} from "./demos/under/snellDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountSnellHero>> = {
  "hero-snell": (el) => mountSnellHero(el),
  "critical-angle": (el) => mountCriticalAngle(el),
  "window-circle": (el) => mountWindowCircle(el),
  "tir-mirror": (el) => mountTirMirror(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}

const scrolly = document.querySelector<HTMLElement>('[data-scrolly="critical"]');
if (scrolly) mountCriticalScrolly(scrolly);
