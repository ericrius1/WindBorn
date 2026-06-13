// The provider swap — the whole point of the sim bubble. The spine's water
// registry (src/lib/spine/water.ts) lets one provider answer every
// `waterHeightAt(x, z, t)` on the site. The Mirror shipped the ambient
// analytic provider; this file ships the one The Splash promised:
//
//   height = ambient(x, z, t) + fade(x, z) · sim η(x, z)
//
// Inside the window the simulation rides on top of the ambient waves; in
// the blend rim it fades out; beyond the window the ambient term is all
// that's left — which is exactly what the ambient provider would have said.
// Callers never know. A floating bird, a bobbing fish, an audio listener:
// they ask the same question they always asked and the splash is just
// *there* when they're near it.
//
// The sim term answers from the CPU mirror (one or two frames stale — see
// coupling.html for why that's fine for buoyancy), so construct the sim
// with `mirror: true` or call `enableMirror()` before installing.

import type { WaterProvider } from "../spine";
import { ambientWater, setWaterProvider, waterProvider } from "../spine";
import type { FluidSim } from "./sim";

export class SimWaterProvider implements WaterProvider {
  constructor(readonly sim: FluidSim) {}

  heightAt(x: number, z: number, t: number): number {
    return ambientWater.heightAt(x, z, t) + this.sim.offsetAt(x, z);
  }
  // No normalAt on purpose: the registry's finite-difference fallback
  // differentiates the *composed* surface, sim term included.
}

/**
 * Swap the site's water provider for this sim's composed surface. Returns
 * a restore function — call it in your demo's dispose so the page goes back
 * to whatever provider was installed before (usually the ambient one).
 */
export function installSimProvider(sim: FluidSim): () => void {
  sim.enableMirror();
  const previous = waterProvider();
  setWaterProvider(new SimWaterProvider(sim));
  return () => setWaterProvider(previous);
}
