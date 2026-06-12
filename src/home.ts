// Landing page: a water hero plus an index of every essay, grouped by season
// and series. The index is generated from posts.ts, so it never drifts from
// the nav. Pages that haven't shipped yet simply don't exist; the registry is
// the roadmap.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountHomeHero } from "./demos/homeHero";
import { POSTS, SEASONS, SERIES_TAGLINES, type Post } from "./lib/posts";

initNav();

// ---- hero --------------------------------------------------------------------
const heroEl = document.querySelector<HTMLElement>("[data-demo='hero']");
if (heroEl) {
  mountLazy(heroEl, () => mountHomeHero(heroEl));
}

// ---- stats line under the title ------------------------------------------------
const meta = document.querySelector<HTMLElement>("[data-home-meta]");
if (meta) {
  const seriesCount = new Set(POSTS.map((p) => p.series)).size;
  meta.textContent = `${POSTS.length} essays · ${seriesCount} series · 4 seasons · 1 game · every figure simulated live`;
}

// ---- the essay index -------------------------------------------------------------
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function card(post: Post): HTMLAnchorElement {
  const a = el("a", "home-card");
  a.href = post.href;
  a.appendChild(el("span", "home-card-num", String(post.part)));
  const body = el("span", "home-card-body");
  body.appendChild(el("strong", "", post.title));
  body.appendChild(el("span", "home-card-sub", post.subtitle));
  a.appendChild(body);
  return a;
}

const index = document.querySelector<HTMLElement>("[data-home-series]");
if (index) {
  for (const season of SEASONS) {
    const wrap = el("section", "home-season");
    const h2 = el("h2");
    const kicker = el("span", "kicker", season.name);
    h2.appendChild(kicker);
    h2.appendChild(document.createTextNode(season.blurb));
    wrap.appendChild(h2);

    for (const name of season.series) {
      const posts = POSTS.filter((p) => p.series === name);
      const section = el("section", "home-series");

      const h3 = el("h3");
      h3.appendChild(document.createTextNode(name));
      const count = el("span", "home-series-count", ` · ${posts.length} parts`);
      h3.appendChild(count);
      section.appendChild(h3);

      const tagline = SERIES_TAGLINES[name];
      if (tagline) section.appendChild(el("p", "home-series-tag", tagline));

      const grid = el("div", "home-grid");
      for (const post of posts) grid.appendChild(card(post));
      section.appendChild(grid);

      wrap.appendChild(section);
    }
    index.appendChild(wrap);
  }
}
