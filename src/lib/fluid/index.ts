// The Splash's library: a real fluid simulation that lives only where the
// action is, plus everything needed to blend it into the ambient lake and
// couple it to the rest of the world.
//
//   heightWave   the minimal wave-equation sim (waves.html's teaching object)
//   sim          FluidSim — shallow water + moving window + foam (flagship)
//   provider     SimWaterProvider / installSimProvider — the spine swap
//   surface      SimSurface — one seamless sheet: sim core, ambient apron
//   spray        SpraySystem — GPU droplets from impact energy
//   floater      Floater — buoyancy + drag back onto floating bodies
//
// Typical wiring (what the game and the interludes do):
//
//   const sim = new FluidSim(renderer, { depth, mirror: true });
//   const detachBus = sim.attachToBus();        // bus → sim
//   const restore = installSimProvider(sim);    // sim → waterHeightAt
//   const surface = new SimSurface(sim, { env });
//   each frame: sim.moveTo(bird.x, bird.z); sim.step(dt); surface.update(t);

export { HeightWaveSim, MAX_SPLASHES, type HeightWaveSimOptions } from "./heightWave";
export { FluidSim, MAX_IMPULSES, type FluidSimOptions, type DepthSpec } from "./sim";
export { SimWaterProvider, installSimProvider } from "./provider";
export { SimSurface, makeGradedSheetGeometry, type SimSurfaceOptions } from "./surface";
export { SpraySystem, MAX_SPRAY_REQUESTS, type SpraySystemOptions, type EmitSpec } from "./spray";
export { Floater, type FloaterOptions } from "./floater";
