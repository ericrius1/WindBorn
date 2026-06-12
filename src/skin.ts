// Entry for skin.html — The Mirror, part 1.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountFresnelPaint,
  mountFresnelScrolly,
  mountGlitterPath,
  mountSkinHero,
  mountWaterSkin,
} from "./demos/mirror/skinDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountSkinHero>> = {
  "hero-skin": (el) => mountSkinHero(el),
  "fresnel-paint": (el) => mountFresnelPaint(el),
  "glitter-path": (el) => mountGlitterPath(el),
  "water-skin": (el) => mountWaterSkin(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}

const scrolly = document.querySelector<HTMLElement>('[data-scrolly="fresnel"]');
if (scrolly) mountFresnelScrolly(scrolly);
