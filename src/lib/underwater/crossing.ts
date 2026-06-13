// The above/below state machine. One comparison decides everything the
// camera believes about the world: cameraY against waterHeightAt(camX, camZ)
// — the same CPU function every floating body on the site already queries,
// which is why the moment the lens crosses the rendered surface is exactly
// the moment the state flips. No second opinion, no drift.

export type CrossingSide = "above" | "below";
export type CrossingEvent = "enter" | "exit" | null;

export class SurfaceCrossing {
  /** Which side of the surface the camera is on right now. */
  state: CrossingSide = "above";
  /** Smoothed 0..1: 0 fully in air, 1 fully in water. Grades blend on this. */
  submergence = 0;
  /** Signed depth, meters: positive below the surface. */
  depth = 0;
  /** 1 when the lens sits within the meniscus band of the surface, 0 far away. */
  proximity = 0;

  /** Half-width of the "near the surface" band, meters. */
  band = 0.45;
  /** How fast the grade blend chases the state, 1/s. Crossings are fast. */
  rate = 10;

  /** Feed the camera's y and the water height under it; returns the crossing
   *  event if the lens passed through the surface this step. */
  update(cameraY: number, waterY: number, dt: number): CrossingEvent {
    this.depth = waterY - cameraY;
    const below = this.depth > 0;
    let event: CrossingEvent = null;
    if (below && this.state === "above") {
      this.state = "below";
      event = "enter";
    } else if (!below && this.state === "below") {
      this.state = "above";
      event = "exit";
    }
    const target = below ? 1 : 0;
    const k = Math.min(1, dt * this.rate);
    this.submergence += (target - this.submergence) * k;
    this.proximity = Math.max(0, 1 - Math.abs(this.depth) / this.band);
    return event;
  }
}
