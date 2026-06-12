# Stillwater — project plan

Part blog, part video series, part game. Every essay teaches one concept with
live GPU figures; every season ends in a playable milestone; everything
converges on **Fish Hawk**, a game about being an osprey on a mountain lake.

## The game (final form)

You are an osprey — folk name *fish hawk* — living on Stillwater, a glacial
lake ringed by mountains. Tone: *A Short Hike* × *AER*. Small, dense,
gorgeous, finishable in an evening, endlessly re-soakable. No fail states: a
missed dive costs daylight, not progress.

Five verbs, each the payoff of a series:

- **Soar** — flapping costs stamina; lift lives in the landscape (thermals
  over sun-warmed scree, ridge lift on windward slopes). Reading terrain +
  wind is the movement economy.
- **Spot** — no UI markers. Fish telegraph themselves: glints, cruising
  shadows, rise rings at the hatch. The ecosystem is the HUD.
- **Dive** — the centerpiece. Tuck, accelerate, hit the water talons-first
  into a real local fluid sim — crown splash, spreading rings, foam — a brief
  submarine moment, then breach with water streaming off.
- **Feed & build** — carry catches to the snag perch, eat, grow the nest
  across days. Light progression, zero grind.
- **Witness** — the world runs on a clock: dawn mist burning off glass water,
  the dusk mayfly hatch, storm fronts, moonlit night. Photo mode doubles as a
  field journal.

Arc: arrive in spring, claim the nest, fill the journal across a handful of
in-game days. ~90 minutes to roll credits; sandbox forever. Stretch:
unlockable birds, each a tech showcase — swallow (skims, wingtips writing
ripple lines), loon (swims, dives from the surface, runway takeoff), eagle
(pure thermal soarer, occasionally steals your fish).

## The spine (how series connect)

Four shared contracts in `src/lib/spine/`, defined before any series starts:

1. **Water state API** (`water.ts`) — `waterHeightAt/waterNormalAt(x, z, t)`,
   swappable provider. Mean surface is world `y = 0`. The Mirror ships the
   ambient provider; The Splash swaps in one that overlays a real sim inside
   a moving local window. Callers never know.
2. **One wind field** (`wind.ts`) — `wind.sample(x, y, z, t)`. Flight lift,
   ripple direction, cloud drift, swaying grass, and the audio whoosh all
   read the same vector field. Ridge lift and thermals register as
   influences. One source = the world agrees about the weather.
3. **World clock** (`clock.ts`) — `clock.hour` (0–24). Sun path, fish
   behavior, hatch timing, music mood all subscribe.
4. **Disturbance bus** (`disturbance.ts`) — `disturb({kind, x, z, energy,
   radius})`. Bird strikes, fish rises, raindrops, wingtip kisses all inject;
   the fluid sim, the foam layer, and the splash synthesizer all listen.

## Seasons and series

Slugs, titles, and subtitles are pre-registered in `src/lib/posts.ts` — that
file is the single source of truth for page names. Don't edit it; create the
pages it promises.

### Season 1 · Water & Wings

**S1 The Mirror** (water surface) — `src/lib/water/`, demos `src/demos/mirror/`
1. `skin.html` — Fresnel reflectance, roughness, why water reads as water.
2. `ripples.html` — capillary ripples as a sum of directional waves steered
   by the wind field; amplitude follows wind speed.
3. `mirrorworld.html` — planar reflection render target, mirrored camera,
   perturbed by the rippled normal.
4. `depths.html` — Beer-Lambert absorption, depth tint, refraction offset,
   seeing the lakebed in the shallows.
5. `stillwater.html` — finale: the glass-dawn lake scene. Also replaces
   `src/demos/homeHero.ts` (keep export `mountHomeHero`).
   The surface material built here becomes the shared lake used by every
   later series.

**S2 New Feathers** (the bird) — `src/lib/bird/`, demos `src/demos/bird/`
1. `osprey.html` — osprey modeled from capsules/SDF smooth unions (mine the
   old repo's wren + bear pipeline), distinctive silhouette: long crooked
   wings, white belly, dark eye-stripe, talons.
2. `wingfold.html` — three-segment wing rig (shoulder/elbow/wrist), fold,
   extend, twist; law-of-cosines IK.
3. `flap.html` — asymmetric wingbeat clock, gait blending (hover flap,
   cruise flap, glide), feather secondary motion.
4. `poses.html` — pose targets (tuck, brake, strike, float) blended by
   springs; layered on top of the gait.
5. `touchgo.html` — water landing: flare to feet-down, buoyant float reading
   `waterHeightAt`, takeoff run. Emits `disturb()` events on contact.

**S3 Lift** (flight model + feel) — `src/lib/flight/`, demos `src/demos/lift/`
1. `forces.html` — point-mass bird: lift/drag/weight/flap-thrust, integrated
   per frame; angle of attack, airspeed.
2. `stick.html` — bank/pitch/effort commands from keyboard+gamepad; chase
   camera with smoothing and speed-reactive FOV.
3. `envelope.html` — stall behavior, dive acceleration, flare; the flight
   envelope visualized.
4. `updrafts.html` — the wind field as gameplay: gusts, ridge lift (wind
   deflected up windward slopes), thermal columns; vario feel.
5. `joy.html` — game-feel tuning pass: response curves, camera breathing,
   FOV kick, the difference between moving and flying.
   Exposes a `FlightState` (airspeed, bank, flapping, altitude) other
   systems read — the audio series synthesizes wind noise from it.

**Interlude `firstflight.html`** — playable: open dawn water, fly, land,
float, take off. S1+S2+S3 integrated.

### Season 2 · The Plunge

**S4 The Basin** (terrain) — `src/lib/terrain/`, demos `src/demos/basin/`
1. `cirque.html` — basin-shaped world from warped ridged noise: mountains
   ring a lake at y=0; shorelines fall where terrain crosses zero.
2. `farshore.html` — clipmap/LOD rings for kilometers of terrain in budget.
3. `treeline.html` — altitude/slope materials: meadow, scree, snow, exposed
   rock; treeline altitude band.
4. `forest.html` — instanced conifers + scatter (mine old repo's trees/
   scatter); perch data published.
5. `lakebed.html` — bathymetry: depth function under the lake, shore
   continuity, `terrainHeightAt(x, z)` exported for everything else
   (ridge-lift influences, fish depth, the shallow-water sim's depth term).

**S5 The Splash** (the flagship: local fluid sim) — `src/lib/fluid/`, demos
`src/demos/splash/`
1. `waves.html` — height+velocity wave equation on a GPU grid (TSL compute,
   ping-pong), damping, boundary handling.
2. `shallows.html` — proper shallow-water equations; depth term read from
   S4's bathymetry; waves slow and steepen near shore.
3. `simbubble.html` — THE trick: a fixed-size sim grid whose world-space
   window follows the action (the bird); edge blending into the ambient
   analytic water so the seam is invisible; provider swap via
   `setWaterProvider`.
4. `coupling.html` — two-way: disturbance bus events inject momentum;
   buoyancy + drag integrate back onto floating bodies.
5. `crown.html` — spray: particles spawned from impact energy and surface
   velocity; ballistic flight; rejoin as small disturbances.
6. `wake.html` — advected foam field, Kelvin wake from moving floaters,
   slow-motion strike showcase.

**S6 Under** (underwater) — `src/lib/underwater/`, demos `src/demos/under/`
1. `lens.html` — camera crossing the surface: above/below state, meniscus
   band, droplet streaks on exit.
2. `snell.html` — Snell's window: total internal reflection beyond the
   critical angle; the sky in a circle.
3. `caustics.html` — projected caustics, depth-graded fog, god rays,
   bubble columns after impacts.
4. `breach.html` — the full dive cycle assembled; underwater fish-grab
   moment; breach with streaming water.

**Interlude `firstcatch.html`** — playable: spot, dive, splash, grab,
breach in the basin valley.

### Season 3 · A Living Valley

**S7 Air & Light** (sky/weather) — `src/lib/sky/`, demos `src/demos/sky/`
1. `air.html` — sky gradient model + sun position from the world clock;
   golden hour, blue hour.
2. `mist.html` — aerial perspective on distant ridges; height fog; dawn
   lake mist that burns off as the clock passes morning.
3. `clouds.html` — volumetric-feel cumulus drifting on the wind field
   (the procedural-clouds skill has the recipes).
4. `weather.html` — weather state machine: wind speed drives whitecaps;
   rain emits "rain" disturbances across the lake; storm light.
5. `night.html` — moon path, stars, moonlight specular path on black water.

**S8 Alive** (ecosystem) — `src/lib/life/`, demos `src/demos/alive/`
1. `fish.html` — fish as underwater boids; depth preference from
   bathymetry; surface glints when they cruise shallow.
2. `hatch.html` — mayfly particles at dusk (clock-driven); fish rise to
   them, emitting "rise" disturbances — rings that mark fish for the hunt.
3. `flocks.html` — swallow flock skimming the surface (skim disturbances),
   geese in V transit, a patrolling eagle.
4. `shore.html` — instanced grass/reeds swaying via the wind field; shore
   ambience.
5. `dusk.html` — the dusk event assembled: hatch + rises + swallows +
   golden light.

**S9 The Ear** (procedural audio) — `src/lib/audio/`, demos `src/demos/ear/`
USER EMPHASIS: dynamic wind audio from bird speed; splash audio from the bus.
1. `rush.html` — wind synthesized from **live airspeed**: filtered noise
   banks whose cutoff/gain track the flight model's `FlightState` (and the
   wind field's gusts) — dive scream, glide hiss, flap whump.
2. `watersong.html` — water audio: lapping from ambient wave state; splash
   synthesis (noise burst + filtered body + droplet tail) triggered by
   disturbance-bus events, scaled by event energy; rain patter as granular
   rain events.
3. `echo.html` — the osprey call (two-voice syrinx synthesis, mine old
   repo's landing.html syrinx); echoes: delay taps timed from distance to
   the cirque walls.
4. `score.html` — adaptive music: layers keyed to altitude/hour/weather,
   crossfaded; calm harmonic language.
5. `blind.html` — finale: fly the lake by ear with the screen faded.
   All audio is raw WebAudio (no new deps); one shared AudioContext with a
   master limiter; everything subscribes to spine state, nothing polls UI.

**Interlude `lakeday.html`** — playable: one full day, dawn to night, with
weather, the hatch, and the full soundscape.

### Season 4 · Polish & Play

**S10 Glass & Grain** (post-processing) — `src/lib/postfx/`, demos
`src/demos/glass/`
1. `grade.html` — hour-keyed color grade + bloom (three/tsl post-processing).
2. `speedsight.html` — dive DOF, motion blur/streaks, FOV kick tied to
   airspeed.
3. `wetlens.html` — underwater grade swap, lens droplets after breach,
   meniscus transition polish.
4. `fieldnotes.html` — photo mode: pause world clock, free camera, framing
   guides, journal entries unlocked by moments witnessed.

**S11 Fish Hawk** (the game) — `src/lib/game/`, demos `src/demos/fishhawk/`
1. `loop.html` — game state: hunger, daylight, day count, save/load
   (localStorage).
2. `hunt.html` — spotting mechanics: glint/shadow/rise telegraphing,
   attention without UI.
3. `thedive.html` — dive scoring: entry angle, speed, timing vs fish
   position; catch probability; fish carried (drag + weight changes
   flight).
4. `nest.html` — the snag nest: eat there, build stages across days,
   gentle goals.
5. `reckoning.html` — performance: everything enabled, budgets per system,
   scaling knobs, holding 60.
6. `game.html` — THE GAME. Full integration, menus, settings, credits
   listing every essay.

## Status

- [x] Scaffold (this commit)
- [ ] Season 1 (S1, S2, S3, firstflight)
- [ ] Season 2 (S4, S5, S6, firstcatch)
- [ ] Season 3 (S7, S8, S9, lakeday)
- [ ] Season 4 (S10, S11, game)
