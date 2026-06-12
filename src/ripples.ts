// Entry for ripples.html — The Mirror, part 2.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountFloatParity,
  mountOneWave,
  mountRipplesHero,
  mountWaveChorus,
  mountWaveSumScrolly,
  mountWindSteer,
} from "./demos/mirror/ripplesDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountRipplesHero>> = {
  "hero-ripples": (el) => mountRipplesHero(el),
  "one-wave": (el) => mountOneWave(el),
  "wave-chorus": (el) => mountWaveChorus(el),
  "wind-steer": (el) => mountWindSteer(el),
  "float-parity": (el) => mountFloatParity(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}

const scrolly = document.querySelector<HTMLElement>('[data-scrolly="wave-sum"]');
if (scrolly) mountWaveSumScrolly(scrolly);
