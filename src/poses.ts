import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import {
  mountHeroPoses,
  mountTargets,
  mountSpringLab,
  mountBlend,
  mountSequence,
} from "./demos/bird/posesDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-poses": (el) => mountHeroPoses(el),
  targets: (el) => mountTargets(el),
  springlab: (el) => mountSpringLab(el),
  blend: (el) => mountBlend(el),
  sequence: (el) => mountSequence(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
