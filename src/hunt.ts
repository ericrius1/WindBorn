import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountHeroHunt, mountTelegraph, mountAttention } from "./demos/fishhawk/huntDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-hunt": (el) => mountHeroHunt(el),
  telegraph: (el) => mountTelegraph(el),
  attention: (el) => mountAttention(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
