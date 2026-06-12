// Demos for "Carving the Cirque": ridged noise, domain warping, the radial
// skeleton, and the finished basin with its zero-crossing shoreline.

import { Mesh, MeshStandardNodeMaterial, Vector3 } from "three/webgpu";
import type { Node } from "three/webgpu";
import { color, float, mix, smoothstep, uniform, vec2 } from "three/tsl";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { mountScrolly, PAL, label, phase, lerp } from "../../lib/scrolly";
import { fbm2Node, makeBasinHeightNode, terrainHeightNode, BASIN } from "../../lib/terrain";
import { fbm2, smooth01 } from "../../lib/terrain/noise";
import {
  elevationTint,
  makeDisplacedMaterial,
  makeGridGeometry,
  makeKit,
  makeWater,
  OrbitRig,
} from "./shared";

type NodeF = Node<"float">;
type NodeV2 = Node<"vec2">;

// ---- hero: the finished cirque ------------------------------------------------

export async function mountCirqueHero(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { aspect: 0.5, far: 16000 });
  if (!kit) return gpuMissing(el);

  const geo = kit.trackGeo(makeGridGeometry(3000, 384));
  const mat = kit.track(
    makeDisplacedMaterial({
      height: (xz) => terrainHeightNode(xz),
      eps: 4,
      makeColor: ({ world, normal }) => elevationTint(world, normal),
    }),
  );
  const terrain = new Mesh(geo, mat);
  terrain.frustumCulled = false;
  kit.scene.add(terrain);
  kit.scene.add(makeWater(kit));

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(0, 40, 0),
      radius: 1500,
      polar: 0.38,
      azimuth: 2.2,
      autoSpin: 0.025,
    }),
  );
  kit.shell.setInfo(() => `${(geo.getAttribute("position").count / 1000).toFixed(0)}k verts · drag to orbit`);

  return kit.start((dt) => orbit.update(kit.camera, dt));
}

// ---- step 1: folding noise into ridges ---------------------------------------------

export async function mountRidged(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { fog: null, far: 6000 });
  if (!kit) return gpuMissing(el);

  const uGain = uniform(0.5);
  const uRidge = uniform(0.85);
  const uAmp = uniform(70);
  let octaves = 5;

  const buildMaterial = (): MeshStandardNodeMaterial =>
    makeDisplacedMaterial({
      height: (xz) => fbm2Node(xz.mul(1 / 150), { octaves, seed: 9001, gain: uGain, ridge: uRidge }).mul(uAmp),
      eps: 2,
      makeColor: ({ world, normal }) => {
        const c = mix(color("#5a5e55"), color("#9b988f"), smoothstep(-40, 70, world.y));
        return mix(c, color("#e9edf3"), smoothstep(45, 75, world.y).mul(smoothstep(0.55, 0.8, normal.y)));
      },
    });

  const geo = kit.trackGeo(makeGridGeometry(640, 256));
  let mat = buildMaterial();
  const terrain = new Mesh(geo, mat);
  terrain.frustumCulled = false;
  kit.scene.add(terrain);
  kit.track({ dispose: () => mat.dispose() });

  kit.shell.slider({
    label: "octaves",
    min: 1,
    max: 6,
    step: 1,
    value: octaves,
    onInput: (v) => {
      octaves = v;
      const next = buildMaterial();
      terrain.material = next;
      mat.dispose();
      mat = next;
    },
  });
  kit.shell.slider({ label: "ridge fold", min: 0, max: 1, step: 0.01, value: 0.85, onInput: (v) => (uRidge.value = v) });
  kit.shell.slider({ label: "gain", min: 0.25, max: 0.75, step: 0.01, value: 0.5, onInput: (v) => (uGain.value = v) });
  kit.shell.slider({ label: "height (m)", min: 10, max: 140, step: 1, value: 70, onInput: (v) => (uAmp.value = v) });

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, { target: new Vector3(0, 10, 0), radius: 560, polar: 0.5, azimuth: 1.1, autoSpin: 0.04 }),
  );
  kit.shell.setInfo(() => `ridge 0 = rolling fBm · ridge 1 = crests`);
  return kit.start((dt) => orbit.update(kit.camera, dt));
}

// ---- step 2: domain warping ----------------------------------------------------------

export async function mountWarped(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { fog: null, far: 8000 });
  if (!kit) return gpuMissing(el);

  const uWarp = uniform(0);
  const wf = 1 / 320;

  const height = (xz: NodeV2): NodeF => {
    const u = fbm2Node(xz.mul(wf), { octaves: 3, seed: 9101 });
    const v = fbm2Node(vec2(xz.x.mul(wf).add(13.1), xz.y.mul(wf).sub(4.7)), { octaves: 3, seed: 9211 });
    const w = xz.add(vec2(u, v).mul(uWarp));
    return fbm2Node(w.mul(1 / 170), { octaves: 5, seed: 9001, ridge: 0.85 }).mul(80);
  };

  const geo = kit.trackGeo(makeGridGeometry(900, 288));
  const mat = kit.track(
    makeDisplacedMaterial({
      height,
      eps: 2.5,
      makeColor: ({ world, normal }) => {
        const c = mix(color("#56584f"), color("#a09c92"), smoothstep(-50, 80, world.y));
        return mix(c, color("#e9edf3"), smoothstep(52, 82, world.y).mul(smoothstep(0.55, 0.8, normal.y)));
      },
    }),
  );
  const terrain = new Mesh(geo, mat);
  terrain.frustumCulled = false;
  kit.scene.add(terrain);

  kit.shell.slider({ label: "warp (m)", min: 0, max: 220, step: 1, value: 0, onInput: (v) => (uWarp.value = v) });

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, { target: new Vector3(0, 15, 0), radius: 760, polar: 0.55, azimuth: 0.6, autoSpin: 0.035 }),
  );
  kit.shell.setInfo(() => `warp 0 m: every ridge remembers the lattice`);
  return kit.start((dt) => orbit.update(kit.camera, dt));
}

// ---- step 3: the radial skeleton --------------------------------------------------------

export async function mountSkeleton(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { far: 16000 });
  if (!kit) return gpuMissing(el);

  const uRim = uniform(BASIN.rimHeight);
  const uBowl = uniform(BASIN.bowlDepth);
  const uWarp = uniform(BASIN.warpAmp);
  const uMountain = uniform(0);
  const heightFn = makeBasinHeightNode({
    rimHeight: uRim,
    bowlDepth: uBowl,
    warpAmp: uWarp,
    mountainAmp: uMountain,
  });

  const geo = kit.trackGeo(makeGridGeometry(3000, 320));
  const mat = kit.track(
    makeDisplacedMaterial({
      height: (xz) => heightFn(xz),
      eps: 4.5,
      makeColor: ({ world, normal }) => elevationTint(world, normal),
    }),
  );
  const terrain = new Mesh(geo, mat);
  terrain.frustumCulled = false;
  kit.scene.add(terrain);
  kit.scene.add(makeWater(kit));

  kit.shell.slider({ label: "rim height (m)", min: 80, max: 520, step: 5, value: BASIN.rimHeight, onInput: (v) => (uRim.value = v) });
  kit.shell.slider({ label: "tarn depth (m)", min: 4, max: 60, step: 1, value: BASIN.bowlDepth, onInput: (v) => (uBowl.value = v) });
  kit.shell.slider({ label: "warp (m)", min: 0, max: 220, step: 2, value: BASIN.warpAmp, onInput: (v) => (uWarp.value = v) });
  kit.shell.slider({ label: "mountains (m)", min: 0, max: 400, step: 5, value: 0, onInput: (v) => (uMountain.value = v) });

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, { target: new Vector3(0, 30, 0), radius: 1700, polar: 0.5, azimuth: -0.9, autoSpin: 0.02 }),
  );
  kit.shell.setInfo(() => `mountains at 0 m: just the skeleton`);
  return kit.start((dt) => orbit.update(kit.camera, dt));
}

// ---- step 4: shorelines fall out of the math -----------------------------------------------

export async function mountShoreline(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { far: 16000 });
  if (!kit) return gpuMissing(el);

  const geo = kit.trackGeo(makeGridGeometry(2200, 360));
  const mat = kit.track(
    makeDisplacedMaterial({
      height: (xz) => terrainHeightNode(xz),
      eps: 3,
      makeColor: ({ world, normal }) => {
        const c = elevationTint(world, normal);
        // paint the zero crossing — this IS the shoreline
        const line = float(1).sub(smoothstep(0.15, 1.1, world.y.abs()));
        return mix(c, color("#ffd58a"), line.mul(0.85));
      },
    }),
  );
  const terrain = new Mesh(geo, mat);
  terrain.frustumCulled = false;
  kit.scene.add(terrain);

  const water = makeWater(kit, 4000, 0.7);
  kit.scene.add(water);
  kit.shell.button("toggle water", () => (water.visible = !water.visible));

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, { target: new Vector3(0, 10, 0), radius: 950, polar: 0.55, azimuth: 2.6, autoSpin: 0.03 }),
  );
  kit.shell.setInfo(() => `gold line = terrain crossing y 0`);
  return kit.start((dt) => orbit.update(kit.camera, dt));
}

// ---- scrolly: assembling the radial profile ----------------------------------------------

export function mountProfileScrolly(el: HTMLElement): void {
  // CPU mirror of the skeleton terms, drawn one at a time along a diameter.
  const p = BASIN;
  const rMax = 1900;
  const yMin = -90;
  const yMax = 720;

  const skeleton = (r: number, bowlK: number, shoreK: number, rimK: number): number => {
    const ar = Math.abs(r);
    const bowl = -p.bowlDepth * (1 - smooth01(0.45, 1.0, ar / p.shoreRadius)) * bowlK;
    const shore = Math.min(p.shoreClampHi, Math.max(p.shoreClampLo, ar - p.shoreRadius)) * p.shoreSlope * shoreK;
    const rise = smooth01(p.shoreRadius, p.crestRadius, ar);
    const settle = smooth01(p.crestRadius, p.settleRadius, ar);
    return bowl + shore + (p.rimHeight * rise - (p.rimHeight - p.outerHeight) * settle) * rimK;
  };
  const ridges = (r: number): number =>
    p.mountainAmp *
    smooth01(p.envInner, p.envOuter, Math.abs(r)) *
    (1 - p.envFar * smooth01(p.crestRadius, p.settleRadius, Math.abs(r))) *
    fbm2(r * p.mountainFreq, 0.37, { octaves: p.mountainOctaves, ridge: p.ridge, seed: p.seed });
  const outletFloor = (r: number): number => p.lipHeight + (Math.abs(r) - p.shoreRadius) * p.outletFall;
  const outletBlend = (r: number): number =>
    smooth01(p.shoreRadius * 0.55, p.shoreRadius * 1.1, Math.abs(r));

  mountScrolly(el, {
    screens: 4,
    aspect: 0.52,
    steps: [
      { at: 0.0, text: "One slice through the valley. Water will sit at <b>y = 0</b> — everything is measured against that line." },
      { at: 0.18, text: "The <b>bowl</b>: a flat-floored tarn, deepest off-center, easing to nothing at the shore radius." },
      { at: 0.36, text: "A clamped linear <b>beach ramp</b> crosses zero with real slope, so the shoreline is a line, not a marsh." },
      { at: 0.54, text: "The <b>rim</b> rises to the crest ring, then settles — the world beyond stays mountainous but lower." },
      { at: 0.72, text: "Along one bearing the rim is clamped down to a low <b>outlet lip</b>: every tarn drains somewhere." },
      { at: 0.88, text: "Warped <b>ridged noise</b>, masked to grow away from the shore, lands on the skeleton. Where the sum crosses zero is the shoreline." },
    ],
    draw(ctx, w, h, t) {
      const x0 = 46;
      const x1 = w - 16;
      const y0 = h - 30;
      const y1 = 14;
      const X = (r: number): number => x0 + ((r + rMax) / (2 * rMax)) * (x1 - x0);
      const Y = (y: number): number => y0 - ((y - yMin) / (yMax - yMin)) * (y0 - y1);

      const kBowl = phase(t, 0.18, 0.32);
      const kShore = phase(t, 0.36, 0.5);
      const kRim = phase(t, 0.54, 0.68);
      const kOutlet = phase(t, 0.72, 0.86);
      const kRidge = phase(t, 0.88, 0.99);

      // water line
      ctx.strokeStyle = PAL.accent;
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, Y(0));
      ctx.lineTo(x1, Y(0));
      ctx.stroke();
      ctx.setLineDash([]);
      label(ctx, "y = 0 (water)", x0 + 6, Y(0) - 9, { color: PAL.accent, size: 11 });

      // the profile: skeleton + optional ridges, with the outlet clamp blended in
      const profile = (r: number, ridged: boolean): number => {
        let y = skeleton(r, kBowl, kShore, kRim);
        if (ridged) y += ridges(r) * kRidge;
        if (kOutlet > 0 && r > 0) {
          const fl = outletFloor(r);
          y = lerp(y, Math.min(y, fl), kOutlet * outletBlend(r));
        }
        return y;
      };

      // water fill under y=0
      ctx.fillStyle = "rgba(122,162,255,0.16)";
      ctx.beginPath();
      let inWater = false;
      for (let px = x0; px <= x1; px += 2) {
        const r = ((px - x0) / (x1 - x0)) * 2 * rMax - rMax;
        const y = profile(r, kRidge > 0);
        if (y < 0 && !inWater) {
          ctx.moveTo(px, Y(0));
          inWater = true;
        }
        if (inWater) ctx.lineTo(px, Y(Math.max(y, yMin)));
        if (y >= 0 && inWater) {
          ctx.lineTo(px, Y(0));
          inWater = false;
        }
      }
      ctx.fill();

      // terrain curve
      ctx.strokeStyle = PAL.text;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let px = x0; px <= x1; px += 2) {
        const r = ((px - x0) / (x1 - x0)) * 2 * rMax - rMax;
        const y = profile(r, kRidge > 0);
        if (px === x0) ctx.moveTo(px, Y(y));
        else ctx.lineTo(px, Y(y));
      }
      ctx.stroke();

      // markers
      if (kBowl > 0.5) {
        label(ctx, "tarn", X(p.bowlOffsetX), Y(-p.bowlDepth) + 14, { color: PAL.muted, size: 11, align: "center", alpha: kBowl });
      }
      if (kRim > 0.5) {
        label(ctx, "crest ring", X(-p.crestRadius), Y(p.rimHeight) - 10, { color: PAL.muted, size: 11, align: "center", alpha: kRim });
      }
      if (kOutlet > 0.5) {
        label(ctx, "outlet lip", X(p.shoreRadius * 1.6), Y(p.lipHeight) - 10, { color: PAL.warm, size: 11, align: "center", alpha: kOutlet });
      }
      if (kShore > 0.5 && kRidge < 0.3) {
        label(ctx, "shoreline = zero crossing", X(-p.shoreRadius), Y(0) + 16, { color: PAL.good, size: 11, align: "center", alpha: kShore });
      }
      label(ctx, "vertical ×2 exaggeration · left: headwall side · right: outlet side", x0, h - 10, {
        color: PAL.dim,
        size: 10,
      });
    },
  });
}
