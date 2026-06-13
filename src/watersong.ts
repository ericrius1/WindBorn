import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy, type Demo } from "./lib/demoShell";
import {
  mountWatersongHero,
  mountSplashAnatomy,
  mountLapping,
  mountRain,
} from "./demos/ear/watersongDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  "hero-watersong": (el) => mountWatersongHero(el),
  anatomy: (el) => mountSplashAnatomy(el),
  lapping: (el) => mountLapping(el),
  rain: (el) => mountRain(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
