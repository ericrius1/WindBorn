// Entry for lens.html — Under, part 1.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountDroplets, mountLensHero, mountMeniscus, mountTwoWorlds } from "./demos/under/lensDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountLensHero>> = {
  "hero-lens": (el) => mountLensHero(el),
  "two-worlds": (el) => mountTwoWorlds(el),
  meniscus: (el) => mountMeniscus(el),
  droplets: (el) => mountDroplets(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
