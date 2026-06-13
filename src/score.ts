import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy, type Demo } from "./lib/demoShell";
import {
  mountScoreHero,
  mountHarmony,
  mountCrossfade,
  mountLayerMap,
} from "./demos/ear/scoreDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  "hero-score": (el) => mountScoreHero(el),
  harmony: (el) => mountHarmony(el),
  crossfade: (el) => mountCrossfade(el),
  layermap: (el) => mountLayerMap(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
