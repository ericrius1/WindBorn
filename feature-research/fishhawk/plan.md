# S11 Fish Hawk — the capstone plan

Six posts that turn the assembled systems into an actual game. The brain lives
in `src/lib/game`; the pages mount it. `game.html` is the finale of the whole
project.

## Design spine

- `src/lib/game` is **pure TypeScript** (no TSL, no three import beyond types):
  - `GameState` — hunger, daylight, day count, nest stage, journal-ish flags,
    save/load to `localStorage` (`fishhawk:save`). A small state machine.
  - `hunt.ts` — spotting/telegraph math: given the school's rises + glints +
    cruising shadows, score "attention" per candidate (no markers, the
    ecosystem IS the HUD). Pure functions over fish/rise data.
  - `dive.ts` — dive scoring: entry angle, speed, timing vs fish position →
    catch probability; carried-fish weight model (drag + sink penalty).
  - `nest.ts` — nest progression: feed events advance build stages across days.
  - `controller.ts` — `Game` top-level controller that wires spine + libs +
    postfx into one update(). game.html mounts it whole; reckoning.html stresses
    it. This is the only file in the lib that imports three/webgpu types (for
    Scene/Camera/Renderer handles); the rest stay number-only.
  - `index.ts` — barrel.

- Demos (`src/demos/fishhawk/`) reuse the interlude assembly patterns:
  `interludeCtx`/`PilotOverlay` (firstflightScene), `PlayerBird`/`steerToward`
  (playerBird), `buildDayWorld` (dayWorld), `ScriptedDiver` (scriptedDive),
  `RingPulse`/`addOrbit`/`fmtHour` (valley). REBUILD anything cross-imported
  from interludes into my own files — DO NOT import across src/demos/. So I
  copy the minimal pieces I need (a context helper, the player-bird bridge, the
  scripted diver, a world builder) into `src/demos/fishhawk/` rather than
  importing `../interludes/*`.

  Rebuilt-in-my-own-files modules:
  - `src/demos/fishhawk/stage.ts` — interludeCtx + PilotOverlay + a small
    HUD-less overlay, rebuilt minimal (mirrors firstflightScene's ctx).
  - `src/demos/fishhawk/bird.ts` — the PlayerBird flight/float/run/plunge
    bridge + steerToward, rebuilt from playerBird.ts (it's the integration
    reference; I own a copy so the game can extend it with scoring hooks).
  - `src/demos/fishhawk/world.ts` — buildGameWorld: sky+water+terrain+life,
    rebuilt minimal from dayWorld.ts but trimmed to the game's needs and with
    scaling knobs surfaced for reckoning.html.
  - `src/demos/fishhawk/diver.ts` — ScriptedDiver for self-playing figures,
    rebuilt from scriptedDive.ts.
  - `src/demos/fishhawk/ringPulse.ts` — RingPulse + addOrbit + fmtHour helpers,
    rebuilt from valley.ts.

  (Rebuilding is required by the rule "do not import across src/demos/". These
  are small, mechanical copies; comments note the algorithm is derived here.)

- Per-page demo file: `<slug>Demos.ts` exporting `mount*` functions.

## Page-by-page

1. **loop.html** — `src/loop.ts` + `loopDemos.ts`
   - hero-loop: a self-flying loop showing the state cycle (soar→spot→dive→
     feed→day passing), HUD-less but readout shows hunger/day/daylight.
   - statemachine: a canvas-2d-free interactive — sliders that advance hunger /
     time, buttons to feed/sleep, save/load to localStorage; pure GameState.
   - daylight: the clock as the daylight budget; a dive costs daylight.
   - Exports nothing new beyond using GameState from the lib.

2. **hunt.html** — `src/hunt.ts` + `huntDemos.ts`
   - hero-hunt: fly over the bay; rises/glints telegraph fish, no markers.
   - telegraph: orbit a school; chop hides glints, watch for rings (reuses the
     life school + RingPulse). Slider: feeding activity, wind.
   - attention: visualize the hunt scoring (which rise is "freshest/closest")
     as the bird's gaze — still no UI marker on the fish, just a soft vignette
     toward the best candidate.

3. **thedive.html** — `src/thedive.ts` + `thediveDemos.ts`
   - hero-thedive: player dives a real fluid window (FluidSim + SimSurface +
     installSimProvider), catch scored.
   - scoring: a scripted diver with sliders for entry angle/speed/lead; the
     scoreboard shows catch probability from `dive.ts`.
   - carry: show drag+weight change when carrying a fish (flight handling).

4. **nest.html** — `src/nest.ts` + `nestDemos.ts`
   - hero-nest: the NEST_SNAG perch; land, eat, the nest grows a stage.
   - build: nest stages across days (nest.ts), gentle goals, no grind.
   - feed: carry→land→eat loop at the snag.

5. **reckoning.html** — `src/reckoning.ts` + `reckoningDemos.ts`
   - hero-reckoning: EVERYTHING on at once (Game controller, full world +
     postfx + audio), live per-system frame budget readout + scaling knobs.
   - budgets: toggles for each subsystem (sim res, cloud steps, life counts,
     postfx stages) with the fps readout responding.
   - scaling: a quality preset slider (low/med/high) wiring the knobs.

6. **game.html** — `src/game.ts` + `gameDemos.ts`
   - hero-game: THE GAME. Title screen → play → the full loop across days →
     pause/photo/settings → credits. Mounts the `Game` controller whole.
   - Credits list every series (from posts.ts SERIES_TAGLINES / SEASONS) and
     link to each. This is the project finale.
   - One in-article demo: a compact "settings & credits" panel showcase, or the
     menu system in isolation. Keep it light — the hero is the deliverable.

## Verification

- `npm run typecheck` — zero errors.
- `OUT_DIR=dist-fishhawk ONLY=loop,hunt,thedive,nest,reckoning,game npx vite build`.
- Every data-demo has a mounts entry; all six pages exist; titles match
  posts.ts; game.html credits cover every series.

## Files touched (create/edit ONLY these — strict ownership)

Lib (`src/lib/game/`):
- src/lib/game/index.ts
- src/lib/game/state.ts
- src/lib/game/hunt.ts
- src/lib/game/dive.ts
- src/lib/game/nest.ts
- src/lib/game/controller.ts

Demos (`src/demos/fishhawk/`):
- src/demos/fishhawk/stage.ts
- src/demos/fishhawk/bird.ts
- src/demos/fishhawk/world.ts
- src/demos/fishhawk/diver.ts
- src/demos/fishhawk/ringPulse.ts
- src/demos/fishhawk/hud.ts          (shared lightweight DOM HUD/menu helpers)
- src/demos/fishhawk/loopDemos.ts
- src/demos/fishhawk/huntDemos.ts
- src/demos/fishhawk/thediveDemos.ts
- src/demos/fishhawk/nestDemos.ts
- src/demos/fishhawk/reckoningDemos.ts
- src/demos/fishhawk/gameDemos.ts

Entry modules (repo root src/):
- src/loop.ts
- src/hunt.ts
- src/thedive.ts
- src/nest.ts
- src/reckoning.ts
- src/game.ts

Pages (repo root):
- loop.html
- hunt.html
- thedive.html
- nest.html
- reckoning.html
- game.html

Research dir (process only):
- feature-research/fishhawk/plan.md
- feature-research/fishhawk/audit.md

## TODO(game) notes anticipated
- Stretch birds (swallow/loon/eagle) left as TODO(game) hooks.
- Sleep-through-night at the nest is a simple clock skip, noted as extensible.
