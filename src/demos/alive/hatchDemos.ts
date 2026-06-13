// Demos for "The Hatch": the dusk emergence over the bay, the intensity
// clock, the mayfly life cycle up close, and fish rises arriving on the
// disturbance bus as rings.

import {
  CircleGeometry,
  Color,
  InstancedMesh,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Vector3,
} from "three/webgpu";
import { color } from "three/tsl";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { WorldClock, onDisturbance } from "../../lib/spine";
import {
  DUN,
  FLYING,
  FishSchool,
  GlintField,
  HatchSwarm,
  NYMPH,
  SPENT,
  SPINNER,
  fillFishInstances,
  fillMayflyInstances,
  hatchIntensity,
  makeFishGeometry,
  makeFishMaterial,
  makeMayflyGeometry,
  makeMayflyMaterial,
  type MayflyStage,
} from "../../lib/life";
import { addDusk, addLake, addTerrain, makeKit, OrbitRig, setDuskHour, type Kit } from "./shared";

const BAY_X = 60;
const BAY_Z = 320;

function addMayflies(kit: Kit, capacity: number): { mesh: InstancedMesh; setGlow(a: number): void } {
  const geo = kit.trackGeo(makeMayflyGeometry());
  const matKit = makeMayflyMaterial();
  kit.track(matKit.material);
  const mesh = new InstancedMesh(geo, matKit.material, capacity);
  mesh.frustumCulled = false;
  mesh.count = 0;
  kit.scene.add(mesh);
  return { mesh, setGlow: matKit.setGlow };
}

// ---- hero: the dusk emergence --------------------------------------------------------

export async function mountHatchHero(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { aspect: 0.5, fog: [150, 1600], far: 6000 });
  if (!kit) return gpuMissing(el);

  const dusk = addDusk(kit, 18.6);
  const lakeKit = addLake(kit, dusk, 600, 240);
  addTerrain(kit, 1100, 220, BAY_X, BAY_Z, 4);

  const hatch = new HatchSwarm({ centerX: BAY_X, centerZ: BAY_Z, radius: 50 });
  const flies = addMayflies(kit, hatch.params.capacity);

  const school = new FishSchool({ count: 160, homeX: BAY_X, homeZ: BAY_Z, homeRadius: 45, swimDepth: -1.0 });
  const fishGeo = kit.trackGeo(makeFishGeometry());
  const fishMat = makeFishMaterial();
  kit.track(fishMat.material);
  const fishMesh = new InstancedMesh(fishGeo, fishMat.material, school.fish.length);
  fishMesh.frustumCulled = false;
  kit.scene.add(fishMesh);

  const glints = kit.track(new GlintField(200));
  kit.scene.add(glints.mesh);

  // this scene runs its own evening, 17:30 → 21:30 in about two minutes
  const clock = new WorldClock(17.5);
  clock.speed = 14;

  let rises = 0;
  kit.track({ dispose: onDisturbance((d) => d.kind === "rise" && rises++) });

  kit.shell.setInfo(() => {
    const h = clock.hour;
    const hh = `${Math.floor(h)}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
    return `${hh} · hatch ${(hatch.intensity * 100).toFixed(0)}% · ${hatch.flies.length} mayflies · ${rises} rises`;
  });

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(BAY_X, 1.5, BAY_Z),
      radius: 55,
      polar: 0.1,
      azimuth: 2.4,
      autoSpin: 0.02,
      minPolar: 0.04,
      maxPolar: 0.6,
    }),
  );

  return kit.start((dt, t) => {
    clock.advance(dt);
    if (clock.hour > 21.6 || clock.hour < 17.4) clock.setHour(17.5);
    const hour = clock.hour;

    setDuskHour(kit, dusk, hour);
    flies.setGlow(0.4 + 1.6 * hatch.intensity);

    hatch.update(dt, t, hour);
    const food = hatch.surfaceFood();
    school.update(dt, t, {
      hunger: hatch.intensity,
      food,
      onEat: (i) => hatch.eat(food[i]),
    });

    fillMayflyInstances(flies.mesh, hatch.flies, 6); // ×6: motes must read at 50 m
    fillFishInstances(fishMesh, school.fish);
    glints.update(school.fish, t);
    lakeKit.update(t);
    orbit.update(kit.camera, dt);
  });
}

// ---- step 1: the intensity clock (plain canvas — no GPU needed) ------------------------------

export function mountHatchClock(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.5);
  const ctx = shell.canvas.getContext("2d")!;
  let hour = 19.4;
  let auto = true;

  shell.slider({
    label: "hour",
    min: 12,
    max: 24,
    step: 0.05,
    value: hour,
    format: (v) => `${Math.floor(v)}:${String(Math.floor((v % 1) * 60)).padStart(2, "0")}`,
    onInput: (v) => {
      hour = v;
      auto = false;
    },
  });
  shell.button("play the evening", () => (auto = true));
  shell.setInfo(() => `intensity ${(hatchIntensity(hour) * 100).toFixed(0)}%`);

  return {
    frame: () => {
      if (auto) {
        hour += 0.012;
        if (hour > 24) hour = 12;
      }
      const w = shell.canvas.width;
      const h = shell.canvas.height;
      ctx.clearRect(0, 0, w, h);

      // sky strip: day → gold → night across the plotted window
      const pad = w * 0.07;
      const plotW = w - pad * 2;
      const plotH = h * 0.62;
      const top = h * 0.16;
      const grad = ctx.createLinearGradient(pad, 0, pad + plotW, 0);
      grad.addColorStop(0, "#7396c2");
      grad.addColorStop(0.55, "#c98e54");
      grad.addColorStop(0.72, "#8a4a44");
      grad.addColorStop(1, "#101830");
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(pad, top, plotW, plotH);
      ctx.globalAlpha = 1;

      const xAt = (hr: number): number => pad + ((hr - 12) / 12) * plotW;
      const yAt = (v: number): number => top + plotH - v * plotH;

      // the curve
      ctx.beginPath();
      for (let i = 0; i <= 240; i++) {
        const hr = 12 + (i / 240) * 12;
        const x = xAt(hr);
        const y = yAt(hatchIntensity(hr));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "#e8b46a";
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // hour ticks
      ctx.fillStyle = "rgba(200, 210, 225, 0.7)";
      ctx.font = `${Math.round(h * 0.035)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      for (let hr = 12; hr <= 24; hr += 2) {
        ctx.fillText(`${hr}:00`, xAt(hr), top + plotH + h * 0.06);
        ctx.fillRect(xAt(hr), top + plotH, 1, h * 0.015);
      }

      // sunset marker (the dusk light's horizon crossing, ~19:55)
      ctx.strokeStyle = "rgba(255, 150, 90, 0.5)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(xAt(19.9), top);
      ctx.lineTo(xAt(19.9), top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255, 170, 110, 0.8)";
      ctx.fillText("sunset", xAt(19.9), top - h * 0.03);

      // the now-cursor and its mayfly density dots
      const x = xAt(hour);
      const v = hatchIntensity(hour);
      ctx.strokeStyle = "#f2e8d8";
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + plotH);
      ctx.stroke();
      ctx.fillStyle = "#f2e8d8";
      ctx.beginPath();
      ctx.arc(x, yAt(v), 4.5, 0, Math.PI * 2);
      ctx.fill();
      // dots: a visual census of the swarm at this instant
      const n = Math.round(v * 130);
      ctx.fillStyle = "rgba(240, 220, 170, 0.85)";
      for (let i = 0; i < n; i++) {
        const a = i * 2.399963; // golden angle — even, deterministic spread
        const r = Math.sqrt(i / Math.max(1, n)) * h * 0.1;
        ctx.fillRect(x + Math.cos(a) * r * 1.6, yAt(v) - h * 0.05 + Math.sin(a) * r, 2, 2);
      }
      shell.tick();
    },
  };
}

// ---- step 2: the life cycle, up close ------------------------------------------------------------

const STAGE_COLORS: Record<number, string> = {
  [NYMPH]: "#7d8a64",
  [DUN]: "#e3d9ae",
  [FLYING]: "#f0e6c0",
  [SPINNER]: "#d8b66a",
  [SPENT]: "#9a8f78",
};
export async function mountLifeCycle(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { fog: null, far: 300 });
  if (!kit) return gpuMissing(el);
  kit.scene.background = new Color("#1d2b38");
  kit.sun.position.set(-60, 40, 30);
  kit.sun.intensity = 2.0;
  kit.sun.color.set("#ffd9a8");

  // a see-through water sheet so the nymph leg of the journey stays visible
  const bedGeo = kit.trackGeo(new CircleGeometry(26, 32));
  bedGeo.rotateX(-Math.PI / 2);
  const bedMat = kit.track(new MeshStandardNodeMaterial());
  bedMat.colorNode = color("#3c4034");
  const bed = new Mesh(bedGeo, bedMat);
  bed.position.y = -3;
  kit.scene.add(bed);

  const sheetGeo = kit.trackGeo(new CircleGeometry(26, 32));
  sheetGeo.rotateX(-Math.PI / 2);
  const sheetMat = kit.track(new MeshBasicNodeMaterial());
  sheetMat.transparent = true;
  sheetMat.opacity = 0.32;
  sheetMat.colorNode = color("#9fc4cc");
  kit.scene.add(new Mesh(sheetGeo, sheetMat));

  // a flat-bottomed pond for the swarm: override the emergence sites by
  // pointing the swarm at deep-enough lake water but keeping the camera local
  const hatch = new HatchSwarm({
    centerX: 0,
    centerZ: 0,
    radius: 14,
    capacity: 700,
    peakRate: 26,
    swarmHeight: 4,
  });
  // local pond: the lake's bathymetry doesn't apply at the origin (that's
  // mid-lake, ~26 m deep) so plant the nymphs at our prop bed instead
  const plantNymphs = (): void => {
    for (const f of hatch.flies) if (f.stage === NYMPH && f.y < -3) f.y = -2.9;
  };

  const flies: Record<number, InstancedMesh> = {};
  for (const stage of [NYMPH, DUN, FLYING, SPINNER, SPENT]) {
    const geo = kit.trackGeo(makeMayflyGeometry());
    const mat = kit.track(new MeshStandardNodeMaterial());
    mat.colorNode = color(STAGE_COLORS[stage]);
    mat.emissiveNode = color(STAGE_COLORS[stage]).mul(0.35);
    const mesh = new InstancedMesh(geo, mat, 700);
    mesh.frustumCulled = false;
    mesh.count = 0;
    kit.scene.add(mesh);
    flies[stage] = mesh;
  }

  let hour = 19.4;
  kit.shell.slider({
    label: "hour",
    min: 16,
    max: 23,
    step: 0.1,
    value: hour,
    onInput: (v) => (hour = v),
  });
  kit.shell.setInfo(() => {
    const c = hatch.counts;
    return `${c.nymph} nymphs · ${c.dun} duns · ${c.flying} fliers · ${c.spinner} spinners · ${c.spent} spent`;
  });

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(0, 1.2, 0),
      radius: 16,
      polar: 0.12,
      azimuth: 0.8,
      autoSpin: 0.04,
      maxPolar: 0.8,
    }),
  );

  return kit.start((dt, t) => {
    hatch.update(dt, t, hour);
    plantNymphs();
    for (const stage of [NYMPH, DUN, FLYING, SPINNER, SPENT]) {
      fillMayflyInstances(flies[stage], hatch.flies, 10, stage as MayflyStage);
    }
    orbit.update(kit.camera, dt);
  });
}

// ---- step 3: rises on the bus ------------------------------------------------------------------

export async function mountRises(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { fog: [120, 1400], far: 5000 });
  if (!kit) return gpuMissing(el);

  const dusk = addDusk(kit, 19.5);
  const lakeKit = addLake(kit, dusk, 400, 220);
  addTerrain(kit, 700, 180, BAY_X, BAY_Z, 4);

  const hatch = new HatchSwarm({ centerX: BAY_X, centerZ: BAY_Z, radius: 35, capacity: 1200 });
  const flies = addMayflies(kit, hatch.params.capacity);
  flies.setGlow(1.6);

  const school = new FishSchool({
    count: 120,
    homeX: BAY_X,
    homeZ: BAY_Z,
    homeRadius: 35,
    swimDepth: -1.0,
    riseRate: 0.05,
  });
  const fishGeo = kit.trackGeo(makeFishGeometry());
  const fishMat = makeFishMaterial();
  kit.track(fishMat.material);
  const fishMesh = new InstancedMesh(fishGeo, fishMat.material, school.fish.length);
  fishMesh.frustumCulled = false;
  kit.scene.add(fishMesh);

  let hunger = 0.8;
  let eaten = 0;
  const recent: number[] = [];
  kit.track({
    dispose: onDisturbance((d) => {
      if (d.kind === "rise") recent.push(performance.now());
    }),
  });

  kit.shell.slider({
    label: "hunger",
    min: 0,
    max: 1,
    step: 0.05,
    value: hunger,
    onInput: (v) => (hunger = v),
  });
  kit.shell.setInfo(() => {
    const now = performance.now();
    while (recent.length && now - recent[0] > 10000) recent.shift();
    return `${recent.length} rises in the last 10 s · ${eaten} duns eaten · every ring = one bus event`;
  });

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(BAY_X, 0.5, BAY_Z),
      radius: 38,
      polar: 0.22,
      azimuth: 2.0,
      autoSpin: 0.03,
      minPolar: 0.08,
      maxPolar: 0.8,
    }),
  );

  return kit.start((dt, t) => {
    hatch.update(dt, t, 19.5);
    const food = hatch.surfaceFood();
    school.update(dt, t, {
      hunger,
      food,
      onEat: (i) => {
        hatch.eat(food[i]);
        eaten++;
      },
    });
    fillMayflyInstances(flies.mesh, hatch.flies, 5);
    fillFishInstances(fishMesh, school.fish);
    lakeKit.update(t);
    orbit.update(kit.camera, dt);
  });
}
