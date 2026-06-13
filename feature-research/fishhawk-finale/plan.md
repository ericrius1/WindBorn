# Fish Hawk finale — thedive, nest, reckoning, game

Continue the predecessor's architecture (src/lib/game/* + src/demos/fishhawk/*).
Keep loop.html + hunt.html working. Keep typecheck clean.

## Files touched (create unless noted)

- thedive.html
- nest.html
- reckoning.html
- game.html
- src/thedive.ts
- src/nest.ts
- src/reckoning.ts
- src/game.ts
- src/demos/fishhawk/thediveDemos.ts
- src/demos/fishhawk/nestDemos.ts
- src/demos/fishhawk/reckoningDemos.ts
- src/demos/fishhawk/gameDemos.ts
- src/demos/fishhawk/nestMesh.ts (new helper: snag + growing cup mesh from nest.ts data)
- src/demos/fishhawk/game.ts (new: the Game controller — title/play/pause/photo/credits state machine)

No edits to existing demos/lib except possibly re-reading. loop/hunt untouched.

## Architecture reuse (the predecessor's brain, kept wholesale)

- GameState (state.ts): hunger/daylight/day/nest, save. Used by loop+game+reckoning.
- hunt.ts scanForFish/bestChance: no-marker spotting (game camera lean).
- dive.ts scoreDive/leadTarget/timeToImpact/makeCatch/carryEffect: thedive scoring + carry.
- nest.ts NEST_STAGE_INFO/nestBuild/nestGoal: nest stages.
- demos/fishhawk: stage.ts (makeStage, PilotOverlay), world.ts (buildGameWorld + WorldQuality knobs + QUALITY_*), bird.ts (PlayerBird with lastEntry/onEntry/onCatch/carried + steerToward), diver.ts (ScriptedDiver with lastEntry), hud.ts (StatusLine/Toast/Panel/buildCredits), ringPulse.ts (RingPulse/addOrbit/fmtHour).

## thedive.html — "The Dive" (part 3)

Hero `hero-thedive`: player dives a REAL fluid window (FluidSim + SimSurface +
SpraySystem + installSimProvider, exactly the firstcatch hero pattern) at a
school; on each surface entry score the captured DiveEntry with scoreDive and
roll a fish with makeCatch; show grade as a brief toast (clean/good/scrappy/miss)
— NOT a marker, feedback after the fact. Carry changes flight via carryEffect
(already wired in bird.ts). StatusLine shows entry speed/angle/grade.

Step demos:
1. `scoring` — ScriptedDiver with vigor + altitude sliders feeding diveVigor;
   a scoreboard panel reads diver.lastEntry through scoreDive and shows the
   four factor bars (angle/speed/aim/depth) + probability + grade. Pure
   teaching of the product-of-factors. Over a small fluid window so the splash
   is real.
2. `carry` — same scripted diver but after a catch, a second pass shows
   carryEffect: a side-by-side flight readout (effort scale, sink accel) and the
   bird visibly labors home. Simplest honest version: orbit a scripted dive that
   catches, then climbs slower with the fish; readout prints carryEffect numbers
   for a slider-controlled fish weight.

Links: /hunt.html (worth feeds the dive), /loop.html, /firstcatch.html (the
plunge), /breach.html, /coupling.html.

## nest.html — "The Nest" (part 4)

Hero `hero-nest`: the NEST_SNAG promontory with the growing nest mesh; the
player (or autopilot) carries catches home and feeds at the nest; GameState
feedAtNest advances stages; nestGoal toast nudges. Build the snag + cup from
nestMesh.ts (direct CylinderGeometry sticks faded by nestBuild()).

Step demos:
1. `stages` — no flight: orbit the snag, a "feed at nest" button advances
   GameState.feedAtNest, the mesh grows stage by stage with the journal note
   shown. Scrub/replay. Own throwaway save key.
2. `goals` — the gentle-goal model: a tiny DOM panel showing nestGoal() across
   hunger words + stages, and the feeds-per-stage curve (3,4,5,6) — proving "no
   grind". Could be pure DOM like loop's statemachine.

Links: /loop.html, /thedive.html, /touchgo.html (landing), /lakebed.html
(NEST_SNAG lives on the bathymetry shore).

## reckoning.html — "The Reckoning" (part 5)

Hero `hero-reckoning`: the full game world (buildGameWorld QUALITY_HIGH) with a
player bird + PostFxStack(grade+bloom+speed) and a live per-system frame budget
readout + quality knobs (cloudSteps/terrainCells/waterCells/fish/hatch/swallows/
geese/eagle toggles) as sliders/buttons that rebuild the world. fps held visibly.

Step demos:
1. `budget` — the same world but with a frame-time bar broken down by approximate
   cost class (sky/water/terrain/life/post), and the quality preset buttons
   (low/medium/high) showing how the budget redistributes. Honest: we time the
   whole frame and attribute via the knob deltas, stated as estimates in prose.
2. `knobs` — isolate the single heaviest knob (cloud raymarch steps) on an
   orbiting world: slide steps 0..20, watch fps and the cloud quality trade.

Prose states the 60fps budget explicitly (per CONVENTIONS + task).

Links: every heavy series — /clouds.html, /simbubble.html, /farshore.html,
/fish.html, /grade.html, /speedsight.html.

## game.html — "Fish Hawk" (part 6, THE finale)

Hero `hero-game`: the actual playable game. A new Game controller
(src/demos/fishhawk/game.ts) is a small state machine over the existing pieces:

- States: title → playing → paused (also photo, settings, credits panels).
- Assembles: makeStage, buildGameWorld (quality from a settings menu, default
  MEDIUM), PlayerBird, ChaseCamera, StickControls, PilotOverlay, GameState
  (real "fishhawk:save"), hunt scanForFish camera-lean, dive scoreDive+makeCatch
  on entry, feed/feedAtNest at the nest (NEST_SNAG) with nestMesh, RingPulse,
  PostFxStack(grade+bloom+speed+photo), Journal + GameState.witness, attachSoundscape
  (gesture-gated), nestGoal toasts.
- Title screen: New game / Continue (GameState.hasSave) / Credits / Settings.
- Pause (Esc/P): Resume / Photo mode (PhotoMode.enter) / Settings (quality +
  audio toggle) / Credits / Quit to title.
- Credits: buildCredits (already lists every series from posts.ts).
- The full loop: soar (flight+wind), spot (hunt lean), dive (scored, real fluid
  window), feed (hunger), carry home + nest build across days (sleep at night),
  witness (journal). Day rolls when you roost at the nest at night.

game.ts entry mounts hero-game + a couple of small in-article figures:
1. `verbs` — a static-ish DOM diagram of the five verbs each linking to its
   series? Better: reuse — a small loop autopilot OR just the credits panel
   demo. Keep it a real demo: `controller` — a compact mount of the Game's
   title→play in a smaller frame (same controller, hero:false sizing).
2. `credits` — mount a Panel with buildCredits visible inline (proves the
   credits cover every series; the landing button now resolves).

Prose: closes the whole project; situates each verb in its series; states the
budget; the "Play Fish Hawk" landing button now resolves here.

Links: ALL series (credits do this; prose links the five verbs to loop/hunt/
thedive/nest + the pillar series).

## localStorage keys (namespaced, no collisions)

- game.html real save: "fishhawk:save" (the canonical one the landing implies)
- game journal: "fishhawk:journal"
- thedive figures: "fishhawk:thedive-*"
- nest figures: "fishhawk:nest-figure", hero "fishhawk:nest-hero"
- reckoning: no save needed
- hero-game uses real save; figures use throwaway keys with load:false

## Verification

1. npm run typecheck — 0 errors.
2. OUT_DIR=dist-fishhawk ONLY=loop,hunt,thedive,nest,reckoning,game npx vite build
3. Self-review: every data-demo has a mounts entry; six pages exist; titles match
   posts.ts; credits cover every series; hero-game mounts a playable game.

## Risks / notes

- FluidSim heroes are heavy; cap resolution as firstcatch does (160) and
  QUALITY_MEDIUM. dispose() everything incl. sim/provider/spray/audio/post.
- PostFxStack render path: render via post.render() not renderer.render — wire
  through stage.finish's custom render arg.
- installSimProvider must be restored on dispose (restoreProvider()).
- Photo mode freezes clock; the Game must use post.photo.worldTime(dt) for scene
  time when photo present (or accept frozen-by-clock only). Keep it simple: use
  PhotoMode.enter/exit which pauses clock; scene t keeps its own accumulation
  via stage — acceptable since waves read clock-independent t. Use worldTime for
  the bird/world t so freeze is real in the hero.
