// Entry for grade.html — Glass & Grain, part 1.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountBloomGlitter,
  mountGradeHero,
  mountGradeKnobs,
  mountGradeScrolly,
  mountHourKey,
  mountToneCurves,
} from "./demos/glass/gradeDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountGradeHero>> = {
  "hero-grade": (el) => mountGradeHero(el),
  "tone-curves": (el) => mountToneCurves(el),
  "grade-knobs": (el) => mountGradeKnobs(el),
  "bloom-glitter": (el) => mountBloomGlitter(el),
  "hour-key": (el) => mountHourKey(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}

const scrolly = document.querySelector<HTMLElement>('[data-scrolly="grade-chain"]');
if (scrolly) mountGradeScrolly(scrolly);
