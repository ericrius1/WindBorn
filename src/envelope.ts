import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy, type Demo } from "./lib/demoShell";
import {
  mountEnvelopeHero,
  mountStallCurve,
  mountMush,
  mountDive,
  mountEnvelopeChart,
} from "./demos/lift/envelopeDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  "hero-envelope": (el) => mountEnvelopeHero(el),
  stallcurve: (el) => mountStallCurve(el),
  mush: (el) => mountMush(el),
  dive: (el) => mountDive(el),
  envelopechart: (el) => mountEnvelopeChart(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
