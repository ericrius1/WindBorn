// Entry for speedsight.html — Glass & Grain, part 2.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountDiveDof,
  mountFlightBridge,
  mountRadialStreaks,
  mountSpeedHero,
  mountVelocityBlur,
} from "./demos/glass/speedsightDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountSpeedHero>> = {
  "hero-speedsight": (el) => mountSpeedHero(el),
  "velocity-blur": (el) => mountVelocityBlur(el),
  "radial-streaks": (el) => mountRadialStreaks(el),
  "dive-dof": (el) => mountDiveDof(el),
  "flight-bridge": (el) => mountFlightBridge(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
