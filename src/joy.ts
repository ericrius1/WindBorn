import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy, type Demo } from "./lib/demoShell";
import {
  mountJoyHero,
  mountCurves,
  mountBreathing,
  mountFovKick,
  mountTelemetry,
} from "./demos/lift/joyDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  "hero-joy": (el) => mountJoyHero(el),
  curves: (el) => mountCurves(el),
  breathing: (el) => mountBreathing(el),
  fovkick: (el) => mountFovKick(el),
  telemetry: (el) => mountTelemetry(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
