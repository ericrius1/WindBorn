import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy, type Demo } from "./lib/demoShell";
import {
  mountEchoHero,
  mountSyrinx,
  mountDelayLab,
  mountEchoScrolly,
} from "./demos/ear/echoDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  "hero-echo": (el) => mountEchoHero(el),
  syrinx: (el) => mountSyrinx(el),
  delaylab: (el) => mountDelayLab(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}

const scrolly = document.querySelector<HTMLElement>('[data-scrolly="echogeometry"]');
if (scrolly) mountEchoScrolly(scrolly);
