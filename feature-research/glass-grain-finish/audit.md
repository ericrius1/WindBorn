# Glass & Grain — finish audit

## Files changed (created — nothing modified outside this list)
- CREATE src/demos/glass/wetlensDemos.ts   (5 demos: hero + 4 steps)
- CREATE src/wetlens.ts                     (entry module)
- CREATE wetlens.html                       (page, "The Wet Lens", 1353 words)
- CREATE src/demos/glass/fieldnotesDemos.ts (5 demos: hero + 4 steps)
- CREATE src/fieldnotes.ts                  (entry module)
- CREATE fieldnotes.html                    (page, "Field Notes", 1306 words)
- CREATE feature-research/glass-grain-finish/{plan.md, audit.md}

NO edits to src/lib/postfx/* (kept the predecessor's complete library as-is),
kit.ts, posts.ts, style.css, spine, or any other series' files.

## Kept vs fixed vs built
KEPT (audited, all typecheck-clean, no changes):
- src/lib/postfx/{grade,speed,wetLens,photo,stack,index}.ts — the composable stack.
- src/demos/glass/{kit,gradeDemos,speedsightDemos}.ts.
- grade.html + src/grade.ts, speedsight.html + src/speedsight.ts (finished, link
  forward to /wetlens.html, which this task created).

FIXED: nothing was broken. The only in-progress fix was during my own build —
CrossingStage doesn't expose `hour`, so wetlens demos track the hour in a local
const instead (no kit edit needed).

BUILT: the two missing pages and their demo modules (above).

## Demos per page
- wetlens.html: hero-wetlens, drop-refract, depth-grade, meniscus-band, the-crossing.
- fieldnotes.html: hero-fieldnotes, freeze-clock, framing-guides, free-camera, the-journal.
Each data-demo has a matching mounts entry (verified).

## How the new pages use the existing postfx API
- wetlens demos: PostFxStack({ grade, bloom, wetLens }) + makeCrossingStage, with
  onCrossing wired to stack.wetLens.notify(event, t). Step demos isolate one effect
  by muting WetLensFx public uniforms (bandWidth=0 for droplets-only, etc.) and
  scripting the camera y through the plunge so the SurfaceCrossing drives submergence.
- fieldnotes demos: PostFxStack({ grade, bloom, photo }) + makeLakeStage. PhotoMode
  drives clock freeze via worldTime(dt); FramingGuides overlay; FreeCamera attaches to
  the focusable Shell canvas; Journal (DEFAULT_MOMENTS) earns entries on shutter() and
  persists to localStorage. The journal panel is inline-styled (no shared-CSS edit).

## Verification
- `npx tsc --noEmit` → 0 errors repo-wide (my files contribute 0).
- `OUT_DIR=dist-glass ONLY=grade,speedsight,wetlens,fieldnotes npx vite build` → built
  in 1.28s, all four pages emitted. The 909 kB kit chunk is the shared three/webgpu
  bundle (identical across all glass pages); the chunk-size note is informational.
- Self-review: 4 pages exist; titles match posts.ts ("The Wet Lens", "Field Notes");
  all internal links resolve to real pages; no external URLs or forbidden phrases.

## TODO(postfx) notes left
None. The library was complete; no minimal-stub gaps were needed. The exported API
(grade/bloom/speed/wetLens/photo/PostFxStack) covers everything the four pages mount,
and reckoning.html + game.html can mount PostFxStack wholesale as index.ts documents.
