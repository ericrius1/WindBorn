// Every post on the site, in reading order. The nav, the menus, the landing
// page, and the read-next cards are all generated from this one list.
//
// The whole registry is pre-written from PLAN.md: pages are added by creating
// the .html file — never by editing this file. (Series agents: hands off.)

export const SITE_NAME = "Stillwater";
export const SITE_REPO = "https://github.com/ericrius1/stillwater";

export interface Post {
  href: string;
  series: string;
  part: number;
  title: string;
  subtitle: string;
}

// One-line pitch per series, in site order — the landing page is built from
// these plus POSTS.
export const SERIES_TAGLINES: Record<string, string> = {
  "The Mirror":
    "The surface of a mountain lake: Fresnel reflectance, wind ripples, planar reflections, and depth-tinted shallows.",
  "New Feathers":
    "An osprey built from capsules, rigged with folding wings, and posed for everything a fish hawk does.",
  "Lift":
    "A flight model you can feel: four forces, a stall envelope, invisible rivers of wind, and the tuning that makes it joyful.",
  "Interludes":
    "Playable milestone builds where the finished series snap together — the game, growing in public.",
  "The Basin":
    "A glacial valley for the lake to live in: ridged noise carved into a cirque, clipmap distances, treelines, and a lakebed.",
  "The Splash":
    "The flagship: a real fluid simulation that lives only where the action is, blended into an ambient lake.",
  "Under":
    "What happens below: crossing the surface, Snell's window, caustics, and the breach.",
  "Air & Light":
    "A sky that keeps time: aerial perspective, morning mist, volumetric clouds, weather fronts, and night.",
  "Alive":
    "An ecosystem that telegraphs itself: schooling fish, a dusk hatch, other wings, and a shore that moves with the wind.",
  "The Ear":
    "Procedural sound: wind synthesized from airspeed, water that speaks when disturbed, echoes off the cirque, and an adaptive score.",
  "Glass & Grain":
    "Post-processing: grading that follows the hour, the speed of sight, a wet lens, and a field journal.",
  "Fish Hawk":
    "The game. Hunger and daylight, a hunt without a HUD, a scored dive, a nest that grows — every series converging at 60 fps.",
};

// Season grouping for the landing page. Every series above appears exactly once.
export interface Season {
  name: string;
  blurb: string;
  series: string[];
}

export const SEASONS: Season[] = [
  {
    name: "Season 1 · Water & Wings",
    blurb: "A lake with a convincing surface, a bird with working wings, and flight that feels like flight.",
    series: ["The Mirror", "New Feathers", "Lift"],
  },
  {
    name: "Season 2 · The Plunge",
    blurb: "A valley to hold the water, a fluid simulation worth diving into, and the world below the surface.",
    series: ["The Basin", "The Splash", "Under"],
  },
  {
    name: "Season 3 · A Living Valley",
    blurb: "Sky, weather, and time; fish, insects, and other wings; and a soundscape synthesized from all of it.",
    series: ["Air & Light", "Alive", "The Ear"],
  },
  {
    name: "Season 4 · Polish & Play",
    blurb: "The cinematic pass, and then the game itself.",
    series: ["Glass & Grain", "Fish Hawk"],
  },
  {
    name: "Interludes",
    blurb: "Milestone builds — one playable artifact at the end of every season.",
    series: ["Interludes"],
  },
];

export const POSTS: Post[] = [
  // ---- Season 1 · The Mirror --------------------------------------------
  {
    href: "/skin.html",
    series: "The Mirror",
    part: 1,
    title: "The Skin of the Lake",
    subtitle: "Fresnel reflectance, roughness, and why water looks like water",
  },
  {
    href: "/ripples.html",
    series: "The Mirror",
    part: 2,
    title: "Wind over Water",
    subtitle: "Capillary ripples from a spectrum of moving waves, steered by the wind field",
  },
  {
    href: "/mirrorworld.html",
    series: "The Mirror",
    part: 3,
    title: "The Mirror World",
    subtitle: "Planar reflections rendered upside down, then perturbed by the rippled surface",
  },
  {
    href: "/depths.html",
    series: "The Mirror",
    part: 4,
    title: "Seeing the Bottom",
    subtitle: "Beer-Lambert absorption, refraction offsets, and the lakebed through shallow water",
  },
  {
    href: "/stillwater.html",
    series: "The Mirror",
    part: 5,
    title: "Glass Dawn",
    subtitle: "The still-lake finale: calm water, mountain silhouettes, and first light",
  },
  // ---- Season 1 · New Feathers ------------------------------------------
  {
    href: "/osprey.html",
    series: "New Feathers",
    part: 1,
    title: "The Osprey",
    subtitle: "A fish hawk lofted from capsules — body, wings, talons, and that piercing eye",
  },
  {
    href: "/wingfold.html",
    series: "New Feathers",
    part: 2,
    title: "The Folding Wing",
    subtitle: "A three-segment wing rig that folds, extends, and twists",
  },
  {
    href: "/flap.html",
    series: "New Feathers",
    part: 3,
    title: "The Flap Cycle",
    subtitle: "An asymmetric wingbeat clock, with gaits blended from hover to glide",
  },
  {
    href: "/poses.html",
    series: "New Feathers",
    part: 4,
    title: "Action Poses",
    subtitle: "Tuck, brake, strike, and float as pose targets blended by springs",
  },
  {
    href: "/touchgo.html",
    series: "New Feathers",
    part: 5,
    title: "Touch and Go",
    subtitle: "Landing on water, floating with buoyancy, and getting airborne again",
  },
  // ---- Season 1 · Lift ----------------------------------------------------
  {
    href: "/forces.html",
    series: "Lift",
    part: 1,
    title: "Four Forces",
    subtitle: "Lift, drag, weight, and flap thrust integrated on a point-mass bird",
  },
  {
    href: "/stick.html",
    series: "Lift",
    part: 2,
    title: "The Stick",
    subtitle: "Bank and pitch commands, keyboard and gamepad, and a chase camera that breathes",
  },
  {
    href: "/envelope.html",
    series: "Lift",
    part: 3,
    title: "The Envelope",
    subtitle: "Stall, dive, and flare — finding the edges of controlled flight",
  },
  {
    href: "/updrafts.html",
    series: "Lift",
    part: 4,
    title: "Invisible Rivers",
    subtitle: "One wind field: gusts, ridge lift, and thermals you can ride",
  },
  {
    href: "/joy.html",
    series: "Lift",
    part: 5,
    title: "The Joy Pass",
    subtitle: "FOV, shake, and response curves — the difference between moving and flying",
  },
  // ---- Season 2 · The Basin -----------------------------------------------
  {
    href: "/cirque.html",
    series: "The Basin",
    part: 1,
    title: "Carving the Cirque",
    subtitle: "A ring of mountains around a lake basin, shaped from warped ridged noise",
  },
  {
    href: "/farshore.html",
    series: "The Basin",
    part: 2,
    title: "The Far Shore",
    subtitle: "Clipmap LOD: kilometers of terrain inside a fixed vertex budget",
  },
  {
    href: "/treeline.html",
    series: "The Basin",
    part: 3,
    title: "The Treeline",
    subtitle: "Slope- and altitude-driven materials — meadow, scree, snow, and where the trees stop",
  },
  {
    href: "/forest.html",
    series: "The Basin",
    part: 4,
    title: "The Forest",
    subtitle: "Instanced conifers and scatter by the hundred thousand",
  },
  {
    href: "/lakebed.html",
    series: "The Basin",
    part: 5,
    title: "The Lakebed",
    subtitle: "Bathymetry: the terrain continues under the water, and the water knows it",
  },
  // ---- Season 2 · The Splash ----------------------------------------------
  {
    href: "/waves.html",
    series: "The Splash",
    part: 1,
    title: "Waves as Arithmetic",
    subtitle: "The wave equation on a GPU grid: height, velocity, and ping-pong textures",
  },
  {
    href: "/shallows.html",
    series: "The Splash",
    part: 2,
    title: "Shallow Water",
    subtitle: "The shallow water equations, with depth read straight from the lakebed",
  },
  {
    href: "/simbubble.html",
    series: "The Splash",
    part: 3,
    title: "The Sim Bubble",
    subtitle: "A local simulation window that follows the action and blends into the ambient lake",
  },
  {
    href: "/coupling.html",
    series: "The Splash",
    part: 4,
    title: "Two-way Coupling",
    subtitle: "Impacts push the water down; buoyancy and drag push the body back",
  },
  {
    href: "/crown.html",
    series: "The Splash",
    part: 5,
    title: "The Crown",
    subtitle: "Spray particles born from impact energy — the anatomy of a splash",
  },
  {
    href: "/wake.html",
    series: "The Splash",
    part: 6,
    title: "Wakes and Foam",
    subtitle: "Kelvin wakes, advected foam, and the slow-motion strike",
  },
  // ---- Season 2 · Under ----------------------------------------------------
  {
    href: "/lens.html",
    series: "Under",
    part: 1,
    title: "Crossing the Lens",
    subtitle: "The camera passes through the surface: meniscus, droplets, and two color worlds",
  },
  {
    href: "/snell.html",
    series: "Under",
    part: 2,
    title: "Snell's Window",
    subtitle: "From below, the entire sky fits inside a circle of light",
  },
  {
    href: "/caustics.html",
    series: "Under",
    part: 3,
    title: "Light, Bent",
    subtitle: "Caustics, depth fog, god rays, and bubbles",
  },
  {
    href: "/breach.html",
    series: "Under",
    part: 4,
    title: "The Breach",
    subtitle: "The full dive assembled: spot, plunge, grab, and burst back into the air",
  },
  // ---- Season 3 · Air & Light ----------------------------------------------
  {
    href: "/air.html",
    series: "Air & Light",
    part: 1,
    title: "The Color of Air",
    subtitle: "A sky model and a sun that keeps time with the world clock",
  },
  {
    href: "/mist.html",
    series: "Air & Light",
    part: 2,
    title: "Morning Mist",
    subtitle: "Aerial perspective, height fog, and the lake exhaling at dawn",
  },
  {
    href: "/clouds.html",
    series: "Air & Light",
    part: 3,
    title: "The Cloud Layer",
    subtitle: "Volumetric cumulus drifting on the same wind the bird rides",
  },
  {
    href: "/weather.html",
    series: "Air & Light",
    part: 4,
    title: "Weather Fronts",
    subtitle: "Wind, whitecaps, and rain — a million tiny splashes on the disturbance bus",
  },
  {
    href: "/night.html",
    series: "Air & Light",
    part: 5,
    title: "The Night Shift",
    subtitle: "A moon with a path, stars, and moonlight on black water",
  },
  // ---- Season 3 · Alive ------------------------------------------------------
  {
    href: "/fish.html",
    series: "Alive",
    part: 1,
    title: "The Fish",
    subtitle: "Underwater boids that school, cruise the shallows, and rise",
  },
  {
    href: "/hatch.html",
    series: "Alive",
    part: 2,
    title: "The Hatch",
    subtitle: "Mayflies at dusk and rise rings on the bus — the food chain telegraphs itself",
  },
  {
    href: "/flocks.html",
    series: "Alive",
    part: 3,
    title: "Other Wings",
    subtitle: "Swallows skim the surface, geese pass through, and an eagle patrols",
  },
  {
    href: "/shore.html",
    series: "Alive",
    part: 4,
    title: "The Shore",
    subtitle: "Grass, reeds, and conifers all swaying to the one wind field",
  },
  {
    href: "/dusk.html",
    series: "Alive",
    part: 5,
    title: "The Dusk Event",
    subtitle: "The whole chain assembled at golden hour",
  },
  // ---- Season 3 · The Ear -----------------------------------------------------
  {
    href: "/rush.html",
    series: "The Ear",
    part: 1,
    title: "The Sound of Speed",
    subtitle: "Wind synthesized from live airspeed — filtered noise that follows the flight model",
  },
  {
    href: "/watersong.html",
    series: "The Ear",
    part: 2,
    title: "What Water Says",
    subtitle: "Lap, ripple, and splash synthesis driven by disturbance-bus events",
  },
  {
    href: "/echo.html",
    series: "The Ear",
    part: 3,
    title: "The Far Wall",
    subtitle: "An osprey's call, a syrinx, and echoes timed off the cirque walls",
  },
  {
    href: "/score.html",
    series: "The Ear",
    part: 4,
    title: "The Adaptive Score",
    subtitle: "Music layers keyed to altitude, hour, and weather",
  },
  {
    href: "/blind.html",
    series: "The Ear",
    part: 5,
    title: "Blind Flight",
    subtitle: "The finale flown by ear, with the screen faded to black",
  },
  // ---- Season 4 · Glass & Grain -----------------------------------------------
  {
    href: "/grade.html",
    series: "Glass & Grain",
    part: 1,
    title: "The Grade",
    subtitle: "Color grading and bloom that follow the hour",
  },
  {
    href: "/speedsight.html",
    series: "Glass & Grain",
    part: 2,
    title: "The Speed of Sight",
    subtitle: "Dive depth of field, motion blur, and the FOV kick",
  },
  {
    href: "/wetlens.html",
    series: "Glass & Grain",
    part: 3,
    title: "The Wet Lens",
    subtitle: "Underwater grading, droplets on the camera, and clean surface transitions",
  },
  {
    href: "/fieldnotes.html",
    series: "Glass & Grain",
    part: 4,
    title: "Field Notes",
    subtitle: "Photo mode: framing, freezing time, and a journal that fills itself",
  },
  // ---- Season 4 · Fish Hawk ------------------------------------------------------
  {
    href: "/loop.html",
    series: "Fish Hawk",
    part: 1,
    title: "The Loop",
    subtitle: "Hunger, daylight, and a save file — the game's skeleton",
  },
  {
    href: "/hunt.html",
    series: "Fish Hawk",
    part: 2,
    title: "The Hunt",
    subtitle: "Reading glints and rise rings — fishing without a HUD",
  },
  {
    href: "/thedive.html",
    series: "Fish Hawk",
    part: 3,
    title: "The Dive",
    subtitle: "Scoring entry angle, speed, and timing against a moving fish",
  },
  {
    href: "/nest.html",
    series: "Fish Hawk",
    part: 4,
    title: "The Nest",
    subtitle: "Carrying catches home and building something across days",
  },
  {
    href: "/reckoning.html",
    series: "Fish Hawk",
    part: 5,
    title: "The Reckoning",
    subtitle: "Every system on at once, and a frame budget that holds sixty",
  },
  {
    href: "/game.html",
    series: "Fish Hawk",
    part: 6,
    title: "Fish Hawk",
    subtitle: "The game. Fifty-some posts converge on one lake",
  },
  // ---- Interludes -------------------------------------------------------------------
  {
    href: "/firstflight.html",
    series: "Interludes",
    part: 1,
    title: "First Flight",
    subtitle: "Milestone: open water, first light, a bird, and you",
  },
  {
    href: "/firstcatch.html",
    series: "Interludes",
    part: 2,
    title: "The First Catch",
    subtitle: "Milestone: the full fishing loop in a graybox valley",
  },
  {
    href: "/lakeday.html",
    series: "Interludes",
    part: 3,
    title: "A Day at the Lake",
    subtitle: "Milestone: a whole day's cycle in a valley that lives",
  },
];

export function currentPost(): { post: Post | null; index: number } {
  let file = location.pathname.split("/").pop() || "index.html";
  if (file === "") file = "index.html";
  const index = POSTS.findIndex((p) => p.href === `/${file}`);
  return { post: index >= 0 ? POSTS[index] : null, index };
}
