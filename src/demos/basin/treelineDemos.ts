// Demos for "The Treeline": altitude bands, slope tests, dithered edges,
// and the fully painted basin.

import { Mesh, Vector3 } from "three/webgpu";
import type { Node } from "three/webgpu";
import { uniform } from "three/tsl";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { terrainHeightNode, terrainSurfaceColor, SNOWLINE, TREELINE, type SurfaceColorOptions } from "../../lib/terrain";
import { makeDisplacedMaterial, makeGridGeometry, makeKit, makeWater, OrbitRig, type Kit } from "./shared";

type NodeF = Node<"float">;

// One painted basin mesh, shared recipe across the four demos.
function addBasin(kit: Kit, size: number, segments: number, opts: SurfaceColorOptions): Mesh {
  const geo = kit.trackGeo(makeGridGeometry(size, segments));
  const mat = kit.track(
    makeDisplacedMaterial({
      height: (xz) => terrainHeightNode(xz),
      eps: Math.max(2, size / segments),
      makeColor: ({ world, normal }) => terrainSurfaceColor(world, normal, opts),
    }),
  );
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  kit.scene.add(mesh);
  return mesh;
}

// ---- hero: the painted basin ---------------------------------------------------

export async function mountTreelineHero(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { aspect: 0.5, far: 16000 });
  if (!kit) return gpuMissing(el);

  addBasin(kit, 3000, 384, { mode: "full" });
  kit.scene.add(makeWater(kit));

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(0, 60, 0),
      radius: 1450,
      polar: 0.33,
      azimuth: -2.4,
      autoSpin: 0.022,
    }),
  );
  kit.shell.setInfo(() => `every color is a rule on altitude and slope · drag to orbit`);
  return kit.start((dt) => orbit.update(kit.camera, dt));
}

// ---- step 1: altitude bands alone (the layer cake) -----------------------------------

export async function mountAltitudeBands(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { far: 16000 });
  if (!kit) return gpuMissing(el);

  addBasin(kit, 2600, 320, { mode: "altitude" });
  kit.scene.add(makeWater(kit, 6000, 0.75));

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, { target: new Vector3(0, 50, 0), radius: 1300, polar: 0.42, azimuth: 0.9, autoSpin: 0.03 }),
  );
  kit.shell.setInfo(() => `color from altitude only — every edge is a contour line`);
  return kit.start((dt) => orbit.update(kit.camera, dt));
}

// ---- step 2: the slope map -----------------------------------------------------------

export async function mountSlopeMap(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { far: 16000 });
  if (!kit) return gpuMissing(el);

  addBasin(kit, 2600, 320, { mode: "slope" });
  kit.scene.add(makeWater(kit, 6000, 0.75));

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, { target: new Vector3(0, 50, 0), radius: 1300, polar: 0.42, azimuth: 2.1, autoSpin: 0.03 }),
  );
  kit.shell.setInfo(() => `green = flat · amber = hillside · red = wall (normal.y, nothing else)`);
  return kit.start((dt) => orbit.update(kit.camera, dt));
}

// ---- step 3: the full rules, with the lines exposed --------------------------------------

export async function mountPaint(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { far: 16000 });
  if (!kit) return gpuMissing(el);

  const uTreeline = uniform(TREELINE);
  const uSnowline = uniform(SNOWLINE);
  const uDither = uniform(1);

  let showBand = false;
  let mesh: Mesh | null = null;
  const build = (): void => {
    if (mesh) {
      kit.scene.remove(mesh);
      (mesh.material as { dispose(): void }).dispose();
      mesh.geometry.dispose();
    }
    const geo = makeGridGeometry(2400, 340);
    const mat = makeDisplacedMaterial({
      height: (xz) => terrainHeightNode(xz),
      eps: 4,
      makeColor: ({ world, normal }) =>
        terrainSurfaceColor(world, normal, {
          mode: showBand ? "treeline" : "full",
          treeline: uTreeline as NodeF,
          snowline: uSnowline as NodeF,
          dither: uDither as NodeF,
        }),
    });
    mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    kit.scene.add(mesh);
  };
  build();
  kit.track({
    dispose: () => {
      if (!mesh) return;
      (mesh.material as { dispose(): void }).dispose();
      mesh.geometry.dispose();
    },
  });

  kit.scene.add(makeWater(kit, 6000, 0.8));

  kit.shell.slider({ label: "treeline (m)", min: 100, max: 400, step: 5, value: TREELINE, onInput: (v) => (uTreeline.value = v) });
  kit.shell.slider({ label: "snowline (m)", min: 180, max: 520, step: 5, value: SNOWLINE, onInput: (v) => (uSnowline.value = v) });
  kit.shell.button("dither on/off", () => (uDither.value = uDither.value > 0.5 ? 0 : 1));
  kit.shell.button("show tree band", () => {
    showBand = !showBand;
    build();
  });

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, { target: new Vector3(-200, 120, 200), radius: 850, polar: 0.35, azimuth: 1.7, autoSpin: 0.025 }),
  );
  kit.shell.setInfo(() => `dither off → the contour lines come back`);
  return kit.start((dt) => orbit.update(kit.camera, dt));
}
