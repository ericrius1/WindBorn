// Demos for "The Lakebed": bathymetry sections, shore continuity, the
// canonical terrainHeightAt probe, and ridge lift joining the spine wind.

import {
  Color,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  SphereGeometry,
  Vector3,
} from "three/webgpu";
import { color, mix, smoothstep } from "three/tsl";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { clock, waterHeightAt, wind } from "../../lib/spine";
import {
  makeRidgeLiftInfluence,
  terrainGrid,
  terrainHeightAt,
  terrainHeightNode,
  terrainSurfaceColor,
  waterDepthAt,
} from "../../lib/terrain";
import { elevationTint, makeDisplacedMaterial, makeGridGeometry, makeKit, makeWater, OrbitRig } from "./shared";

// ---- hero: the bed under the water ----------------------------------------------------

export async function mountLakebedHero(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { aspect: 0.5, far: 16000, fog: [800, 5200] });
  if (!kit) return gpuMissing(el);

  const geo = kit.trackGeo(makeGridGeometry(2600, 384));
  const mat = kit.track(
    makeDisplacedMaterial({
      height: (xz) => terrainHeightNode(xz),
      eps: 3.5,
      makeColor: ({ world, normal }) => terrainSurfaceColor(world, normal, {}),
    }),
  );
  const terrain = new Mesh(geo, mat);
  terrain.frustumCulled = false;
  kit.scene.add(terrain);
  kit.scene.add(makeWater(kit, 8000, 0.5));

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(-120, -10, 60),
      radius: 700,
      polar: 0.5,
      azimuth: 0.9,
      autoSpin: 0.025,
    }),
  );
  kit.shell.setInfo(() => `one function above and below the waterline · drag to orbit`);
  return kit.start((dt) => orbit.update(kit.camera, dt));
}

// ---- step 1: the sounding line (a live cross-section) ----------------------------------------

export function mountSection(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.5);
  const ctx = shell.canvas.getContext("2d");
  if (!ctx) return { frame: () => {} };

  let azimuthDeg = 152; // pointing across the deep hole by default
  let dirty = true;
  shell.slider({
    label: "section bearing (°)",
    min: 0,
    max: 180,
    step: 1,
    value: azimuthDeg,
    onInput: (v) => {
      azimuthDeg = v;
      dirty = true;
    },
  });

  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const rMax = 1500;
  const yMin = -60;
  const yMax = 640;

  const draw = (): void => {
    const a = (azimuthDeg * Math.PI) / 180;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const x0 = 50;
    const x1 = W - 18;
    const y0 = H - 34;
    const y1 = 16;
    const Y = (y: number): number => y0 - ((y - yMin) / (yMax - yMin)) * (y0 - y1);

    ctx.fillStyle = "#06070b";
    ctx.fillRect(0, 0, W, H);

    // terrain profile + water fill
    let deepest = 0;
    let deepestR = 0;
    const pts: Array<[number, number]> = [];
    for (let px = x0; px <= x1; px += 2) {
      const r = ((px - x0) / (x1 - x0)) * 2 * rMax - rMax;
      const h = terrainHeightAt(ca * r, sa * r);
      pts.push([px, h]);
      if (h < deepest) {
        deepest = h;
        deepestR = r;
      }
    }

    // water
    ctx.fillStyle = "rgba(122,162,255,0.18)";
    ctx.beginPath();
    let wet = false;
    for (const [px, h] of pts) {
      if (h < 0 && !wet) {
        ctx.moveTo(px, Y(0));
        wet = true;
      }
      if (wet) ctx.lineTo(px, Y(Math.max(h, yMin)));
      if (h >= 0 && wet) {
        ctx.lineTo(px, Y(0));
        wet = false;
      }
    }
    if (wet) ctx.lineTo(x1, Y(0));
    ctx.fill();

    // ground
    ctx.strokeStyle = "#d7dbe6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach(([px, h], i) => (i === 0 ? ctx.moveTo(px, Y(h)) : ctx.lineTo(px, Y(h))));
    ctx.stroke();

    // water line
    ctx.strokeStyle = "#7aa2ff";
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, Y(0));
    ctx.lineTo(x1, Y(0));
    ctx.stroke();
    ctx.setLineDash([]);

    // deepest sounding
    if (deepest < -1) {
      const px = x0 + ((deepestR + rMax) / (2 * rMax)) * (x1 - x0);
      ctx.strokeStyle = "#ffb86b";
      ctx.beginPath();
      ctx.moveTo(px, Y(0));
      ctx.lineTo(px, Y(deepest));
      ctx.stroke();
      ctx.fillStyle = "#ffb86b";
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${(-deepest).toFixed(1)} m`, px, Y(deepest) + 16);
    }

    ctx.fillStyle = "#8a91a5";
    ctx.font = "11px ui-sans-serif, system-ui";
    ctx.textAlign = "left";
    ctx.fillText(`bearing ${azimuthDeg}° through the lake center · vertical ×2.4`, x0, H - 12);
  };

  shell.setInfo(() => `terrainHeightAt sampled 700× per redraw`);
  return {
    frame: () => {
      if (dirty) {
        draw();
        dirty = false;
      }
      shell.tick();
    },
  };
}

// ---- step 2: shore continuity ---------------------------------------------------------------

export async function mountShoreContinuity(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { far: 8000, fog: [300, 2200] });
  if (!kit) return gpuMissing(el);

  // a close patch of shoreline on the gentle east side
  const cx = 360;
  const cz = -140;
  const geo = kit.trackGeo(makeGridGeometry(420, 300, cx, cz));
  const mat = kit.track(
    makeDisplacedMaterial({
      height: (xz) => terrainHeightNode(xz),
      eps: 1.2,
      makeColor: ({ world, normal }) => {
        const base = terrainSurfaceColor(world, normal, {});
        // Beer–Lambert-flavored blue with depth: the column above the bed
        const depth = world.y.negate().max(0);
        const tint = mix(base, color("#10384a"), smoothstep(0, 14, depth).mul(0.85));
        return tint;
      },
    }),
  );
  const terrain = new Mesh(geo, mat);
  terrain.frustumCulled = false;
  kit.scene.add(terrain);

  const water = makeWater(kit, 1600, 0.42);
  kit.scene.add(water);
  kit.shell.button("toggle water", () => (water.visible = !water.visible));

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, {
      target: new Vector3(cx - 40, -2, cz + 20),
      radius: 220,
      polar: 0.35,
      azimuth: -0.6,
      autoSpin: 0.03,
    }),
  );
  kit.shell.setInfo(() => `no seam at y = 0 — the beach keeps going underwater`);
  return kit.start((dt) => orbit.update(kit.camera, dt));
}

// ---- step 3: the canonical query, probed ----------------------------------------------------------

export async function mountProbe(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { far: 12000, fog: [600, 4000] });
  if (!kit) return gpuMissing(el);

  const geo = kit.trackGeo(makeGridGeometry(1700, 320));
  const mat = kit.track(
    makeDisplacedMaterial({
      height: (xz) => terrainHeightNode(xz),
      eps: 2.5,
      makeColor: ({ world, normal }) => terrainSurfaceColor(world, normal, {}),
    }),
  );
  const terrain = new Mesh(geo, mat);
  terrain.frustumCulled = false;
  kit.scene.add(terrain);
  kit.scene.add(makeWater(kit, 4000, 0.55));

  // the probe: a plumb line from bed to surface, a buoy riding the water
  const lineGeo = kit.trackGeo(new CylinderGeometry(0.5, 0.5, 1, 6, 1, true));
  lineGeo.translate(0, 0.5, 0); // pivot at the bottom
  const lineMat = kit.track(new MeshStandardNodeMaterial());
  lineMat.colorNode = color("#ffd58a");
  lineMat.emissiveNode = color("#b98742");
  const line = new Mesh(lineGeo, lineMat);
  kit.scene.add(line);

  const buoyGeo = kit.trackGeo(new SphereGeometry(4, 12, 8));
  const buoyMat = kit.track(new MeshStandardNodeMaterial());
  buoyMat.colorNode = color("#ff8585");
  const buoy = new Mesh(buoyGeo, buoyMat);
  kit.scene.add(buoy);

  let px = -160;
  let pz = 40;
  const canvas = kit.shell.canvas;
  const dir = new Vector3();
  const pointAt = (e: PointerEvent): void => {
    const r = canvas.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
    dir.set(nx, ny, 0.5).unproject(kit.camera).sub(kit.camera.position).normalize();
    if (dir.y > -1e-4) return; // looking at the sky
    const t = -kit.camera.position.y / dir.y;
    const hx = kit.camera.position.x + dir.x * t;
    const hz = kit.camera.position.z + dir.z * t;
    const rr = Math.hypot(hx, hz);
    if (rr > 800) return;
    px = hx;
    pz = hz;
  };
  let down = false;
  const onDown = (e: PointerEvent): void => {
    down = true;
    pointAt(e);
  };
  const onMove = (e: PointerEvent): void => {
    if (down) pointAt(e);
  };
  const onUp = (): void => {
    down = false;
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  kit.track({
    dispose: () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
    },
  });

  kit.camera.position.set(-680, 360, 520);
  kit.camera.lookAt(0, -10, 0);

  kit.shell.setInfo(() => {
    const ground = terrainHeightAt(px, pz);
    const depth = waterDepthAt(px, pz);
    return depth > 0
      ? `probe (${px.toFixed(0)}, ${pz.toFixed(0)}) · bed ${ground.toFixed(1)} m · depth ${depth.toFixed(1)} m`
      : `probe (${px.toFixed(0)}, ${pz.toFixed(0)}) · ground +${ground.toFixed(1)} m · dry land`;
  });

  return kit.start(() => {
    clock.advance(1 / 60);
    const t = clock.hour * 3600;
    const ground = terrainHeightAt(px, pz);
    const surface = waterHeightAt(px, pz, t);
    const top = Math.max(surface, ground + 2);
    line.position.set(px, ground, pz);
    line.scale.set(1, Math.max(0.5, top - ground), 1);
    if (ground < 0) {
      buoy.visible = true;
      buoy.position.set(px, surface, pz);
    } else {
      buoy.visible = false;
    }
  });
}

// ---- step 4: ridge lift on the shared wind --------------------------------------------------------

export async function mountRidgeLift(el: HTMLElement): Promise<Demo> {
  const kit = await makeKit(el, { far: 16000, fog: [1200, 6000] });
  if (!kit) return gpuMissing(el);

  const geo = kit.trackGeo(makeGridGeometry(2800, 320));
  const mat = kit.track(
    makeDisplacedMaterial({
      height: (xz) => terrainHeightNode(xz),
      eps: 4.5,
      makeColor: ({ world, normal }) => elevationTint(world, normal),
    }),
  );
  const terrain = new Mesh(geo, mat);
  terrain.frustumCulled = false;
  kit.scene.add(terrain);
  kit.scene.add(makeWater(kit, 8000, 0.85));

  // The influence itself — registered on the SHARED wind field, removed on
  // dispose. Every wind.sample() in this scene now knows about the ridges.
  const unsubscribe = wind.addInfluence(makeRidgeLiftInfluence());
  kit.track({ dispose: unsubscribe });

  const windDir0 = wind.direction;
  const windSpeed0 = wind.speed;
  kit.track({
    dispose: () => {
      wind.direction = windDir0;
      wind.speed = windSpeed0;
    },
  });
  kit.shell.slider({
    label: "wind bearing (°)",
    min: 0,
    max: 360,
    step: 5,
    value: Math.round(((windDir0 * 180) / Math.PI + 360) % 360),
    onInput: (v) => (wind.direction = (v * Math.PI) / 180),
  });
  kit.shell.slider({ label: "wind speed (m/s)", min: 1, max: 14, step: 0.5, value: 6, onInput: (v) => (wind.speed = v) });
  wind.speed = 6;

  // tracer particles, advected by wind.sample on the CPU
  const N = 900;
  const pGeo = kit.trackGeo(new SphereGeometry(3.2, 6, 5));
  const pMat = kit.track(new MeshStandardNodeMaterial());
  pMat.emissiveNode = color("#ffffff").mul(0.35);
  pMat.colorNode = color("#ffffff");
  const particles = new InstancedMesh(pGeo, pMat, N);
  particles.frustumCulled = false;

  const pos = new Float32Array(N * 3);
  const grid = terrainGrid();
  const respawn = (i: number): void => {
    // spawn on the upwind rim of the region, at varied heights above ground
    const lateral = (Math.random() - 0.5) * 2200;
    const back = 1250 + Math.random() * 150;
    const ca = Math.cos(wind.direction);
    const sa = Math.sin(wind.direction);
    const x = -ca * back - sa * lateral;
    const z = -sa * back + ca * lateral;
    pos[i * 3] = x;
    pos[i * 3 + 1] = Math.max(grid.heightAt(x, z), 0) + 6 + Math.random() * 260;
    pos[i * 3 + 2] = z;
  };
  const m = new Matrix4();
  const c = new Color();
  for (let i = 0; i < N; i++) {
    respawn(i);
    // pre-roll so the field is full from the first frame
    pos[i * 3] += Math.random() * 2400 * Math.cos(wind.direction);
    pos[i * 3 + 2] += Math.random() * 2400 * Math.sin(wind.direction);
    particles.setMatrixAt(i, m.makeTranslation(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
    particles.setColorAt(i, c.setRGB(1, 1, 1));
  }
  kit.scene.add(particles);

  const v = new Vector3();
  kit.shell.setInfo(() => `tracers ride wind.sample() — lift = V·∇h on windward slopes`);

  const orbit = kit.track(
    new OrbitRig(kit.shell.canvas, { target: new Vector3(0, 160, 0), radius: 1600, polar: 0.35, azimuth: 0.4, autoSpin: 0.015 }),
  );

  return kit.start((dt, t) => {
    const step = Math.min(dt, 0.05) * 3; // 3× time so drift reads at valley scale
    for (let i = 0; i < N; i++) {
      const x = pos[i * 3];
      const y = pos[i * 3 + 1];
      const z = pos[i * 3 + 2];
      wind.sample(x, y, z, t, v);
      const nx = x + v.x * step;
      const ny = y + v.y * step;
      const nz = z + v.z * step;
      const ground = grid.heightAt(nx, nz);
      pos[i * 3] = nx;
      pos[i * 3 + 1] = Math.max(ny, Math.max(ground, 0) + 2);
      pos[i * 3 + 2] = nz;
      if (Math.hypot(nx, nz) > 1700 || ny > 900) respawn(i);
      particles.setMatrixAt(i, m.makeTranslation(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
      // warm = rising, cool = sinking
      const w = Math.max(-4, Math.min(4, v.y));
      if (w >= 0) c.setRGB(1, 1 - w * 0.13, 1 - w * 0.22);
      else c.setRGB(1 + w * 0.16, 1 + w * 0.1, 1);
      particles.setColorAt(i, c);
    }
    particles.instanceMatrix.needsUpdate = true;
    if (particles.instanceColor) particles.instanceColor.needsUpdate = true;
    orbit.update(kit.camera, dt);
  });
}
