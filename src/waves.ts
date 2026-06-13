// Entry for waves.html — The Splash, part 1.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountBoundaries,
  mountCflCliff,
  mountPebblePond,
  mountPingPong,
  mountStencilScrolly,
  mountWavesHero,
} from "./demos/splash/wavesDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountWavesHero>> = {
  "hero-waves": (el) => mountWavesHero(el),
  "pebble-pond": (el) => mountPebblePond(el),
  "ping-pong": (el) => mountPingPong(el),
  "cfl-cliff": (el) => mountCflCliff(el),
  boundaries: (el) => mountBoundaries(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}

const scrolly = document.querySelector<HTMLElement>('[data-scrolly="stencil"]');
if (scrolly) mountStencilScrolly(scrolly);
