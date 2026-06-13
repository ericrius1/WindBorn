import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountHeroGame, mountController, mountCredits } from "./demos/fishhawk/gameDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-game": (el) => mountHeroGame(el),
  controller: (el) => mountController(el),
  credits: (el) => mountCredits(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
