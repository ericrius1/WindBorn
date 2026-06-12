// The glass-dawn lake — the finale scene of The Mirror, shared by
// stillwater.html's demos and the landing page hero. Everything the series
// built, in one place: dawn sky, mountain doubles in a planar reflection,
// near-glass wind, and disturbance-bus rings when the world touches the
// water.

import type { PerspectiveCamera, Scene, WebGPURenderer } from "three/webgpu";
import { Group, Mesh, MeshBasicNodeMaterial, Vector3 } from "three/webgpu";
import { clock, disturb, onDisturbance, wind } from "../../lib/spine";
import { LakeSurface, PlanarReflection, RippleRings, createDawnSky, type DawnSky } from "../../lib/water";
import { makeMountainRing, makeSnag, pickWaterPoint } from "./kit";

export interface GlassDawnOptions {
  /** World-clock hour the scene wakes up at. */
  hour?: number;
  /** Mean wind, m/s — glass is ~0.5, anything past 2 breaks the mirror. */
  windSpeed?: number;
  /** Reflection target size relative to the canvas. */
  reflectionScale?: number;
  /** Occasional fish rises on the disturbance bus. */
  autoRises?: boolean;
  /** Lake mesh size/segments — the hero uses a bigger sheet than figures. */
  size?: number;
  segments?: number;
}

export interface GlassDawn {
  sky: DawnSky;
  lake: LakeSurface;
  rings: RippleRings;
  reflection: PlanarReflection;
  snag: Group;
  /** Advance the scene one frame (sim time t seconds). */
  update(t: number, dt: number): void;
  /** Render the mirror pass; call right before the main render. */
  renderReflection(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera): void;
  /** Wire clicks on the canvas to fish-rise disturbances. */
  attachPointer(canvas: HTMLCanvasElement, camera: PerspectiveCamera): void;
  /** Re-key the sky + clock to an hour (for the time-of-day demo). */
  setHour(hour: number): void;
  dispose(): void;
}

export function buildGlassDawn(
  scene: Scene,
  width: number,
  height: number,
  options: GlassDawnOptions = {},
): GlassDawn {
  const {
    hour = 6.05,
    windSpeed = 0.7,
    reflectionScale = 0.5,
    autoRises = true,
    size = 1400,
    segments = 320,
  } = options;

  clock.setHour(hour);
  wind.speed = windSpeed;

  const sky = createDawnSky(hour);
  const dome = sky.makeDome(1100);
  const far = makeMountainRing({ radius: 780, height: 230, seed: 12, baseColor: 0x141c30, crestColor: 0x3c4c72 });
  const near = makeMountainRing({ radius: 480, height: 130, seed: 7, baseColor: 0x0a0f18, crestColor: 0x202a40 });
  const snag = makeSnag(-7, -9, sky.sunDirection);

  const rings = new RippleRings();
  const reflection = new PlanarReflection(
    Math.max(64, Math.round(width * reflectionScale)),
    Math.max(64, Math.round(height * reflectionScale)),
  );
  const lake = new LakeSurface({ env: sky, reflection, rings, size, segments });
  lake.roughness.value = 0.05;

  scene.add(dome, far, near, snag, lake.mesh);

  // The bus: anything that disturbs the water becomes a ring. `now` tracks
  // sim time so events landing between frames get a sensible birth time.
  let now = 0;
  const offBus = onDisturbance((d) => rings.add(d, now));

  let nextRise = 2.5;
  const pointerHandlers: { canvas: HTMLCanvasElement; handler: (e: PointerEvent) => void }[] = [];

  return {
    sky,
    lake,
    rings,
    reflection,
    snag,
    update(t) {
      now = t;
      lake.update(t);
      if (autoRises && t > nextRise) {
        nextRise = t + 2.5 + Math.random() * 5;
        const a = Math.random() * Math.PI * 2;
        const r = 4 + Math.random() * 16;
        disturb({
          kind: "rise",
          x: Math.cos(a) * r,
          z: Math.sin(a) * r,
          energy: 0.02 + Math.random() * 0.06,
          radius: 0.4,
        });
      }
    },
    renderReflection(renderer, sceneRef, camera) {
      reflection.render(renderer, sceneRef, camera, [lake.mesh]);
    },
    attachPointer(canvas, camera) {
      const handler = (e: PointerEvent): void => {
        const hit = pickWaterPoint(e, canvas, camera);
        if (hit) disturb({ kind: "rise", x: hit.x, z: hit.z, energy: 0.06, radius: 0.4 });
      };
      canvas.addEventListener("pointerdown", handler);
      pointerHandlers.push({ canvas, handler });
    },
    setHour(h) {
      clock.setHour(h);
      sky.setHour(clock.hour);
    },
    dispose() {
      offBus();
      for (const { canvas, handler } of pointerHandlers) canvas.removeEventListener("pointerdown", handler);
      lake.dispose();
      reflection.dispose();
      sky.dispose();
      for (const ring of [far, near]) {
        ring.geometry.dispose();
        (ring.material as MeshBasicNodeMaterial).dispose();
      }
      snag.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          (mesh.material as MeshBasicNodeMaterial).dispose();
        }
      });
    },
  };
}

/** Default camera framing the snag against the sunrise — shared so the
 *  landing hero and the finale hero agree. */
export const DAWN_CAMERA = {
  target: new Vector3(-1, 1.1, -1),
  distance: 17,
  polar: 0.1,
  azimuth: 2.45,
};
