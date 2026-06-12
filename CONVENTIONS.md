# Conventions (read me before writing anything)

This file is the contract for every agent working on Stillwater. Read
PLAN.md first for what to build; this file is how.

## The one-paragraph version

Each post is a top-level `<slug>.html` plus an entry module `src/<slug>.ts`
plus demo modules in your series' demo directory. Slugs/titles/subtitles are
already registered in `src/lib/posts.ts` — create exactly those pages, never
edit the registry. Stay inside your series' file ownership. Verify with
`npm run typecheck` and `OUT_DIR=dist-<series> npx vite build`. Never start a
dev server, never commit, never touch shared files.

## File ownership

Shared, read-only for everyone (only the coordinator edits these):
`src/lib/posts.ts`, `src/lib/spine/*`, `src/lib/demoShell.ts`,
`src/lib/siteNav.ts`, `src/lib/scrolly.ts`, `src/lib/gpu.ts`,
`src/style.css`, `src/home.ts`, `index.html`, `vite.config.ts`,
`package.json`, `tsconfig.json`, `PLAN.md`, this file.

Per-series ownership (html slugs per PLAN.md / posts.ts):

| Series | lib | demos | entries + pages |
|---|---|---|---|
| The Mirror | `src/lib/water/` | `src/demos/mirror/` | skin, ripples, mirrorworld, depths, stillwater (+ replaces `src/demos/homeHero.ts`) |
| New Feathers | `src/lib/bird/` | `src/demos/bird/` | osprey, wingfold, flap, poses, touchgo |
| Lift | `src/lib/flight/` | `src/demos/lift/` | forces, stick, envelope, updrafts, joy |
| The Basin | `src/lib/terrain/` | `src/demos/basin/` | cirque, farshore, treeline, forest, lakebed |
| The Splash | `src/lib/fluid/` | `src/demos/splash/` | waves, shallows, simbubble, coupling, crown, wake |
| Under | `src/lib/underwater/` | `src/demos/under/` | lens, snell, caustics, breach |
| Air & Light | `src/lib/sky/` | `src/demos/sky/` | air, mist, clouds, weather, night |
| Alive | `src/lib/life/` | `src/demos/alive/` | fish, hatch, flocks, shore, dusk |
| The Ear | `src/lib/audio/` | `src/demos/ear/` | rush, watersong, echo, score, blind |
| Glass & Grain | `src/lib/postfx/` | `src/demos/glass/` | grade, speedsight, wetlens, fieldnotes |
| Fish Hawk | `src/lib/game/` | `src/demos/fishhawk/` | loop, hunt, thedive, nest, reckoning, game |
| Interludes | — | `src/demos/interludes/` | firstflight, firstcatch, lakeday |

Reading another series' `src/lib/<dir>` and importing from it is encouraged
(that's the whole point); editing it is not. If an upstream lib is missing
something you need, build the minimal version inside your own lib and leave a
`// TODO(<series>):` note.

## Page anatomy

Copy this skeleton (it matches the reference posts byte-for-byte in
structure):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="/favicon.png" sizes="512x512" type="image/png" />
    <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="theme-color" content="#0a0b10" />
    <title>{Title} — Stillwater</title>
    <meta name="description" content="{subtitle, expanded a little}" />
  </head>
  <body>
    <header class="hero">
      <div data-demo="hero-{slug}"></div>
      <div class="hero-title">
        <h1>{Title}</h1>
        <p class="subtitle">{2–3 sentence framing}</p>
      </div>
      <div class="hero-scroll-hint" aria-hidden="true">
        <span class="hero-scroll-hint-text">Scroll down to read</span>
        <span class="hero-scroll-hint-arrow">↓</span>
      </div>
    </header>
    <main>
      <p>…prose…</p>
      <h2><span class="kicker">Step 1 · {short}</span>{Heading}</h2>
      <p>…</p>
      <div data-demo="{name}"></div>
      <aside class="note">
        <span class="note-label">Aside · {label}</span>
        <p>…</p>
      </aside>
      …
    </main>
    <script type="module" src="/src/{slug}.ts"></script>
  </body>
</html>
```

The entry module `src/{slug}.ts`:

```ts
import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountThing, mountOther } from "./demos/{series}/{slug}Demos";

initNav();

const mounts: Record<string, (el: HTMLElement) => any> = {
  "hero-{slug}": (el) => mountThing(el, { hero: true }),
  thing: (el) => mountThing(el),
  other: (el) => mountOther(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
```

Nav, prev/next, and read-next cards are injected by `initNav()` — never
hand-write navigation.

## Writing the prose

Voice: your own. You are a game developer building Fish Hawk in public,
walking the reader through each system step by step — always aware of how
today's topic plugs into the final game. Open by situating the post in the
bigger build (what the game needs and why); close with what it unlocks
next. Confident, concrete, plainspoken, curious about the craft; "we" that
includes the reader is welcome. Don't imitate anything external — this
project sounds like itself. Rules of thumb:

- Teach from first principles; derive, don't assert. Equations appear as
  plain prose + inline `<code>` or small `<pre>` blocks, not images.
- `Step N` kickers structure the build; each step ends in a live demo that
  shows exactly what was just explained.
- `aside.note` blocks for tangents (history, why-not-X, real-bird facts).
- Every post links to the posts it builds on (`<a href="/slug.html">`).
- 1,000–1,800 words. No filler, no "in this post we will".
- Real ornithology and real physics, accurately stated. Ospreys: ~1.5 kg,
  ~1.6 m span, dive at 15–30 m/s, feet-first entry, reversible outer toe.
- Optional: one `mountScrolly` canvas-2D scrolly diagram for the trickiest
  concept of the post (see `src/lib/scrolly.ts`).

## Demos

- `Shell` from `src/lib/demoShell.ts` gives canvas + sliders + buttons +
  fps readout. `mountLazy` handles lifecycle — demos only run on screen.
  Export `mount*(el: HTMLElement, opts?) => Demo | Promise<Demo>` functions.
- Three.js WebGPU: `import ... from "three/webgpu"` and TSL from
  `"three/tsl"`. **Before writing any TSL/WebGPU code, invoke the
  `webgpu-threejs-tsl` skill** and follow it. For clouds, also the
  `procedural-clouds-threejs` skill.
- Construct `WebGPURenderer({ canvas, antialias: true })`, `await
  renderer.init()`. If `!navigator.gpu`, call `gpuMissing(container)` from
  demoShell and return it. WebGL fallback is NOT required.
- Renderer per demo is fine (the lazy mount keeps offscreen demos asleep),
  but dispose what you create in `dispose()`.
- Units: meters, +y up, lake mean surface at y = 0 (`WATER_LEVEL`).
- Use the spine (`src/lib/spine`) — sample `wind`, query `waterHeightAt`,
  read `clock.hour`, and `disturb()` anything that touches water. Never
  invent a private wind/clock/water of your own.
- Performance: every demo at 60 fps on an M-series laptop. Hero demos can
  be richer; in-article demos stay focused on one idea.

## Standalone identity (hard rule)

Stillwater is its own project with its own voice. Published prose must NEVER
mention, link to, or allude to any other project, site, repo, or series
outside this one — no "as we did in…", no "our previous series", no
"ported from…", no external blog links. Each post may assume only what
EARLIER STILLWATER POSTS established (link to those liberally). If a reader
landed here from a search engine, nothing should hint that other projects
exist. This applies to html prose, subtitles, code comments are exempt but
keep them about the code, not about other projects.

## Geometry house rule

No SDF / isosurface / marching-cubes / surface-nets pipelines for character
or creature modeling. Model meshes DIRECTLY: lofted cross-section rings
along spine curves, quad strips for wing surfaces, merged low-poly
primitives, hand-placed BufferGeometry. (SDF-style math is still fine inside
shaders for clouds/water/effects — the rule is about character geometry.)

## Self-contained (hard rule)

This repo is the whole world. Do not read, reference, adapt from, or import
code or prose from any other repo or project — derive every algorithm from
first principles right here. (This also makes the standalone-identity rule
trivially true.)

## Verification (required before you call a task done)

1. `npm run typecheck` — zero errors.
2. `OUT_DIR=dist-<yourseries> npx vite build` — succeeds. (Per-series out
   dir so parallel builds don't fight; dist-* is gitignored.)
3. Self-review every page: does each demo mount have a corresponding mounts
   entry? Does every `data-demo` name match? Are all your registry pages
   created?

Do NOT: run `npm run dev`, run bare `npx vite build` (shared dist/), edit
shared or other-series files, add npm dependencies, commit, or push.
