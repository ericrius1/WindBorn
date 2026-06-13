// Entry for caustics.html — Under, part 3.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountBubbleColumns,
  mountCausticSheet,
  mountCausticsHero,
  mountFocusScrolly,
  mountGodRays,
} from "./demos/under/causticsDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountCausticsHero>> = {
  "hero-caustics": (el) => mountCausticsHero(el),
  "caustic-sheet": (el) => mountCausticSheet(el),
  "god-rays": (el) => mountGodRays(el),
  "bubble-columns": (el) => mountBubbleColumns(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}

const scrolly = document.querySelector<HTMLElement>('[data-scrolly="focus"]');
if (scrolly) mountFocusScrolly(scrolly);
