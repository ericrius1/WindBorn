# Glass & Grain — finish the series (wetlens + fieldnotes)

## Audit verdict (predecessor's interrupted run)

KEPT as-is (all typecheck clean, coherent API):
- `src/lib/postfx/{grade,speed,wetLens,photo,stack,index}.ts` — complete composable stack.
  `index.ts` exports grade (Grade/gradeForHour/curves), speed (SpeedEffects + nodes),
  WetLensFx, PhotoMode/FramingGuides/FreeCamera/Journal/DEFAULT_MOMENTS, PostFxStack.
- `src/demos/glass/{kit,gradeDemos,speedsightDemos}.ts` — kit has `makeCrossingStage`
  (wetlens-ready: lake + ceiling + bed + depth dome + SurfaceCrossing + onCrossing cb)
  and `makeLakeStage`/`makeFloater`/`makeDiveFlier` (fieldnotes-ready).
- `grade.html`+`src/grade.ts`, `speedsight.html`+`src/speedsight.ts` — finished, link
  forward to `/wetlens.html`. No fixes needed.

BUILD (only missing work — purely additive, no shared-lib edits):
1. wetlens: `src/demos/glass/wetlensDemos.ts`, `wetlens.html`, `src/wetlens.ts`
2. fieldnotes: `src/demos/glass/fieldnotesDemos.ts`, `fieldnotes.html`, `src/fieldnotes.ts`

The library already exposes the exact surface both pages need. WetLensFx.notify(event,t)
is wired from makeCrossingStage's onCrossing callback; PhotoMode + Journal drive fieldnotes.

## wetlens.html — "The Wet Lens" (part 3)
Title/subtitle from posts.ts: "The Wet Lens" / "Underwater grading, droplets on the
camera, and clean surface transitions". Theme: the dive transition as a post-process —
refract the frame instead of pasting quads (the lens.html upgrade speedsight promised).

Steps (each ends in a live demo):
- Step 1 · The frame as a texture — droplet refraction (height-field bulb → gradient →
  uv offset). Demo: droplet field over a still lake, sliders for refraction/count seed.
- Step 2 · The two color worlds — depth-keyed underwater multiply grade (Beer-Lambert
  red-first), entering flash. Demo: scrub camera depth, watch the filter deepen.
- Step 3 · The meniscus band — magnify just below the waterline; project the line.
- Step 4 · The whole crossing — makeCrossingStage + PostFxStack{wetLens}, scripted
  plunge/breach driving submergence; notify() reseeds droplets on exit.
Hero: `hero-wetlens` — the full crossing running through the chain.
Demos: hero-wetlens, drop-refract, depth-grade, meniscus-band, the-crossing.
Internal links: /lens.html, /breach.html, /speedsight.html, /grade.html, /depths.html.

## fieldnotes.html — "Field Notes" (part 4, series finale)
Title/subtitle: "Field Notes" / "Photo mode: framing, freezing time, and a journal that
fills itself". Theme: the game's witness verb. Export the photo-mode controller from
postfx (already done: PhotoMode/Journal in photo.ts).

Steps:
- Step 1 · Freezing time — worldTime(dt) substitution; clock.paused; demo pauses world.
- Step 2 · Framing guides — thirds/phi/center as a screen-space overlay node. Demo
  cycles guide modes over the live lake.
- Step 3 · The free camera — detach, drag-look, WASD, leash. Demo: enter/exit photo mode.
- Step 4 · A journal that fills itself — moments as predicates over spine+flight; shutter
  captures; localStorage persistence; HTML journal panel below the canvas.
Hero: `hero-fieldnotes` — photo mode over the lake with guides + shutter flash.
Demos: hero-fieldnotes, freeze-clock, framing-guides, free-camera, the-journal.
Internal links: /joy.html, /air.html, /night.html, /stillwater.html, /grade.html,
/wetlens.html, intra-series.

## Files touched (create only)
- CREATE src/demos/glass/wetlensDemos.ts
- CREATE src/demos/glass/fieldnotesDemos.ts
- CREATE wetlens.html
- CREATE src/wetlens.ts
- CREATE fieldnotes.html
- CREATE src/fieldnotes.ts
- CREATE feature-research/glass-grain-finish/{plan.md,audit.md}

NO edits to src/lib/postfx/* (already complete), kit.ts, shared files, or other series.

## Verification
1. `npx tsc --noEmit` — my files zero errors.
2. `OUT_DIR=dist-glass ONLY=grade,speedsight,wetlens,fieldnotes npx vite build` — succeeds.
3. Every data-demo has a mounts entry; 4 pages exist; titles match posts.ts.
