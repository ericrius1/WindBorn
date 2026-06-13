// Entry for fieldnotes.html — Glass & Grain, part 4 (series finale).

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountFieldnotesHero,
  mountFramingGuides,
  mountFreeCamera,
  mountFreezeClock,
  mountTheJournal,
} from "./demos/glass/fieldnotesDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountFieldnotesHero>> = {
  "hero-fieldnotes": (el) => mountFieldnotesHero(el),
  "freeze-clock": (el) => mountFreezeClock(el),
  "framing-guides": (el) => mountFramingGuides(el),
  "free-camera": (el) => mountFreeCamera(el),
  "the-journal": (el) => mountTheJournal(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
