import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountHeroOsprey,
  mountRings,
  mountWingStrip,
  mountDetails,
  mountSilhouette,
} from "./demos/bird/ospreyDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-osprey": (el) => mountHeroOsprey(el),
  rings: (el) => mountRings(el),
  wingstrip: (el) => mountWingStrip(el),
  details: (el) => mountDetails(el),
  silhouette: (el) => mountSilhouette(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
