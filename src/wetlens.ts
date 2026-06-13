// Entry for wetlens.html — Glass & Grain, part 3.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountDepthGrade,
  mountDropRefract,
  mountMeniscusBand,
  mountTheCrossing,
  mountWetLensHero,
} from "./demos/glass/wetlensDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountWetLensHero>> = {
  "hero-wetlens": (el) => mountWetLensHero(el),
  "drop-refract": (el) => mountDropRefract(el),
  "depth-grade": (el) => mountDepthGrade(el),
  "meniscus-band": (el) => mountMeniscusBand(el),
  "the-crossing": (el) => mountTheCrossing(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
