import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy, type Demo } from "./lib/demoShell";
import {
  mountStickHero,
  mountCommands,
  mountBankTurn,
  mountChaseCam,
  mountFovSpeed,
} from "./demos/lift/stickDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  "hero-stick": (el) => mountStickHero(el),
  commands: (el) => mountCommands(el),
  bankturn: (el) => mountBankTurn(el),
  chasecam: (el) => mountChaseCam(el),
  fovspeed: (el) => mountFovSpeed(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
