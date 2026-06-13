// Entry for weather.html — Air & Light, part 4.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy, type Demo } from "./lib/demoShell";
import {
  mountRainRings,
  mountStateMachine,
  mountStormLight,
  mountWeatherHero,
  mountWhitecaps,
} from "./demos/sky/weatherDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  "hero-weather": (el) => mountWeatherHero(el),
  "state-machine": (el) => mountStateMachine(el),
  whitecaps: (el) => mountWhitecaps(el),
  "rain-rings": (el) => mountRainRings(el),
  "storm-light": (el) => mountStormLight(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
