// Entry for mirrorworld.html — The Mirror, part 3.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountMirrorScrolly,
  mountMirrorSkin,
  mountMirrorworldHero,
  mountPerfectMirror,
  mountRippledMirror,
  mountSecondCamera,
} from "./demos/mirror/mirrorworldDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<typeof mountMirrorworldHero>> = {
  "hero-mirrorworld": (el) => mountMirrorworldHero(el),
  "second-camera": (el) => mountSecondCamera(el),
  "perfect-mirror": (el) => mountPerfectMirror(el),
  "rippled-mirror": (el) => mountRippledMirror(el),
  "mirror-skin": (el) => mountMirrorSkin(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}

const scrolly = document.querySelector<HTMLElement>('[data-scrolly="mirror-camera"]');
if (scrolly) mountMirrorScrolly(scrolly);
