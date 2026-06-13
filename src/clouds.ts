// Entry for clouds.html — Air & Light, part 3.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy, type Demo } from "./lib/demoShell";
import { mountCloudField, mountCloudLight, mountCloudWind, mountCloudsHero } from "./demos/sky/cloudsDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  "hero-clouds": (el) => mountCloudsHero(el),
  "cloud-field": (el) => mountCloudField(el),
  "cloud-light": (el) => mountCloudLight(el),
  "cloud-wind": (el) => mountCloudWind(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
