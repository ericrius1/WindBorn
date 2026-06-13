import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountHeroLoop, mountStateMachine, mountDaylight } from "./demos/fishhawk/loopDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-loop": (el) => mountHeroLoop(el),
  statemachine: (el) => mountStateMachine(el),
  daylight: (el) => mountDaylight(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
