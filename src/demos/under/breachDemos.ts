// Demos for breach.html — the full dive cycle assembled. Part 4 of Under,
// and the payoff of Season 2 so far: the real osprey from New Feathers,
// poses from poses.html, the crossing from lens.html, Snell's ceiling, the
// caustic-lit bed, bubble columns, and water streaming off on the way out.

import * as THREE from "three/webgpu";
import { gpuMissing, type Demo } from "../../lib/demoShell";
import { wind, waterHeightAt, disturb, onDisturbance } from "../../lib/spine";
import { createDawnSky, createWaveUniforms, LakeSurface, RippleRings } from "../../lib/water";
import {
  BubblePlume,
  FishCruiser,
  Spray,
  SurfaceCeiling,
  buildFish,
  makeDepthDome,
  type Fish,
} from "../../lib/underwater";
import { buildOsprey, type Osprey } from "../../lib/bird/build";
import { OspreyAnimator } from "../../lib/bird/animator";
import { addOrbit, buildCrossingScene, makeSandBed, sandLakeBed, underCtx } from "./kit";

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// ---- the dive cycle ------------------------------------------------------------------

export type DivePhase = "circle" | "hover" | "dive" | "strike" | "plunge" | "rise" | "climb" | "recover";

interface DiveCycleOptions {
  /** "full" starts with a circling pass; "profile" goes straight to hover. */
  mode?: "full" | "profile";
  altitude?: number;
  circleRadius?: number;
  /** Live fish to hunt, or null for a fixed strike point. */
  fish?: { cruiser: FishCruiser; fish: Fish } | null;
  /** Where to strike when there is no fish. */
  targetX?: number;
  targetZ?: number;
  /** The bed: don't plunge past this. */
  maxDepth?: number;
  scene: THREE.Scene;
}

export class DiveCycle {
  phase: DivePhase;
  phaseTime = 0;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  entrySpeed = 0;
  peakDecel = 0; // m/s², during the plunge
  wet = 0;
  carried = false;
  altitude: number;

  private mode: "full" | "profile";
  private circleRadius: number;
  private fishRef: { cruiser: FishCruiser; fish: Fish } | null;
  private targetX: number;
  private targetZ: number;
  private maxDepth: number;
  private scene: THREE.Scene;
  private theta = 0;
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private shakeT = 99;
  private prevSpeed = 0;

  constructor(
    readonly osprey: Osprey,
    readonly anim: OspreyAnimator,
    opts: DiveCycleOptions,
  ) {
    this.mode = opts.mode ?? "full";
    this.altitude = opts.altitude ?? 9;
    this.circleRadius = opts.circleRadius ?? 6;
    this.fishRef = opts.fish ?? null;
    this.targetX = opts.targetX ?? 0;
    this.targetZ = opts.targetZ ?? 0;
    this.maxDepth = opts.maxDepth ?? 2.2;
    this.scene = opts.scene;
    this.phase = this.mode === "full" ? "circle" : "hover";
    this.osprey.group.rotation.order = "YXZ";
    this.reset();
  }

  private aimX(): number {
    return this.fishRef ? this.fishRef.cruiser.x : this.targetX;
  }
  private aimZ(): number {
    return this.fishRef ? this.fishRef.cruiser.z : this.targetZ;
  }

  reset(): void {
    this.releaseFish();
    this.setPhase(this.mode === "full" ? "circle" : "hover");
    if (this.mode === "full") {
      this.theta = 0;
      this.pos.set(this.circleRadius, this.altitude, 0);
    } else {
      this.pos.set(this.aimX() - 1.2, this.altitude, this.aimZ());
    }
    this.vel.set(0, 0, 0);
    this.wet = 0;
    this.entrySpeed = 0;
    this.peakDecel = 0;
  }

  diveNow(): void {
    if (this.phase === "circle" || this.phase === "hover") this.setPhase("dive");
  }

  /** The mid-air dog-shake every wet osprey does. */
  shake(): void {
    this.shakeT = 0;
  }

  get shaking(): boolean {
    return this.shakeT < 0.7;
  }

  private setPhase(p: DivePhase): void {
    this.phase = p;
    this.phaseTime = 0;
  }

  private grabFish(): void {
    if (!this.fishRef || this.carried) return;
    const { cruiser, fish } = this.fishRef;
    cruiser.caught = true;
    this.osprey.group.add(fish.group);
    // carried head-first — a real osprey turns its catch to cut drag
    fish.group.position.set(0, 0.01, 0.1);
    fish.group.rotation.set(0, 0, 0);
    fish.swim.value = 0.25; // a tired struggle
    this.carried = true;
  }

  private releaseFish(): void {
    if (!this.fishRef || !this.carried) return;
    const { cruiser, fish } = this.fishRef;
    this.scene.add(fish.group);
    fish.swim.value = 1;
    cruiser.caught = false;
    this.carried = false;
  }

  update(dt: number, t: number): void {
    const h = clamp(dt, 0, 0.05);
    this.phaseTime += h;
    this.shakeT += h;
    const anim = this.anim;
    const water = waterHeightAt(this.pos.x, this.pos.z, t);

    switch (this.phase) {
      case "circle": {
        anim.requestPose(null);
        anim.gait01 += (0.85 - anim.gait01) * Math.min(1, h * 2);
        anim.flapRateHz = 2.6;
        anim.bank = 0.45;
        const speed = 5.5;
        this.theta += (speed / this.circleRadius) * h;
        this.pos.set(
          Math.cos(this.theta) * this.circleRadius,
          this.altitude + Math.sin(this.theta * 2.3) * 0.3,
          Math.sin(this.theta) * this.circleRadius,
        );
        this.vel.set(-Math.sin(this.theta), 0, Math.cos(this.theta)).multiplyScalar(speed);
        if (this.phaseTime > 4.6) this.setPhase("hover");
        break;
      }
      case "hover": {
        anim.requestPose(null);
        anim.bank = 0;
        anim.gait01 += (0.04 - anim.gait01) * Math.min(1, h * 3);
        anim.flapRateHz = 4.6;
        // hold position above the fish, head down, reading the water
        const gx = this.aimX();
        const gz = this.aimZ();
        this.vel.multiplyScalar(Math.exp(-2.5 * h));
        this.pos.x += (gx - this.pos.x) * Math.min(1, h * 1.4);
        this.pos.z += (gz - this.pos.z) * Math.min(1, h * 1.4);
        this.pos.y += (this.altitude - this.pos.y) * Math.min(1, h * 1.2);
        if (this.phaseTime > 1.6) this.setPhase("dive");
        break;
      }
      case "dive": {
        anim.requestPose("tuck");
        anim.bank = 0;
        // gravity plus a committed tuck; track the fish on the way down
        this.vel.y = Math.max(this.vel.y - 14 * h, -16.5);
        const lead = 0.25; // seconds of fish lead the bird aims for
        const dx = this.aimX() - this.pos.x;
        const dz = this.aimZ() - this.pos.z;
        const tti = Math.max(0.15, (this.pos.y - water) / Math.max(2, -this.vel.y));
        this.vel.x += ((dx / (tti + lead)) * 1.6 - this.vel.x) * Math.min(1, h * 4);
        this.vel.z += ((dz / (tti + lead)) * 1.6 - this.vel.z) * Math.min(1, h * 4);
        if (this.pos.y - water < 1.5) this.setPhase("strike");
        break;
      }
      case "strike": {
        anim.requestPose("strike");
        this.vel.y = Math.max(this.vel.y - 12 * h, -17);
        if (this.pos.y <= water + 0.02) {
          this.entrySpeed = this.vel.length();
          this.prevSpeed = this.entrySpeed;
          this.peakDecel = 0;
          this.wet = 1;
          disturb({
            kind: "splash",
            x: this.pos.x,
            z: this.pos.z,
            energy: clamp((this.entrySpeed * this.entrySpeed) / 200, 0.35, 1.3),
            radius: 0.5,
            vx: this.vel.x,
            vz: this.vel.z,
          });
          this.setPhase("plunge");
        }
        break;
      }
      case "plunge": {
        anim.requestPose("strike");
        // water is ~830× denser than air: drag does in a quarter second what
        // a whole climb-out undoes
        this.vel.multiplyScalar(Math.exp(-3.6 * h));
        this.vel.y += 5.2 * h; // buoyancy: a feathered body wants back up
        const speed = this.vel.length();
        if (h > 0) this.peakDecel = Math.max(this.peakDecel, (this.prevSpeed - speed) / h);
        this.prevSpeed = speed;
        if (this.fishRef && !this.carried) {
          const f = this.fishRef.fish.group.position;
          if (this.pos.distanceTo(f) < 0.5) this.grabFish();
        }
        const floor = -this.maxDepth;
        if (this.pos.y < floor) {
          this.pos.y = floor;
          this.vel.y = Math.max(this.vel.y, 0);
        }
        if (this.phaseTime > 0.45 && speed < 2.4) this.setPhase("rise");
        break;
      }
      case "rise": {
        // rowing for the light — deep hover-flaps against the water
        anim.requestPose(null);
        anim.gait01 += (0.03 - anim.gait01) * Math.min(1, h * 4);
        anim.flapRateHz = 5;
        this.vel.y += (2.9 - this.vel.y) * Math.min(1, h * 2.6);
        this.vel.x *= Math.exp(-1.2 * h);
        this.vel.z *= Math.exp(-1.2 * h);
        if (this.pos.y > water + 0.1) {
          disturb({
            kind: "splash",
            x: this.pos.x,
            z: this.pos.z,
            energy: 0.45,
            radius: 0.45,
            vx: this.vel.x,
            vz: this.vel.z,
          });
          this.setPhase("climb");
        }
        break;
      }
      case "climb": {
        anim.requestPose(null);
        anim.gait01 += (0.16 - anim.gait01) * Math.min(1, h * 2);
        anim.flapRateHz = 4.4;
        this.vel.y += (1.5 - this.vel.y) * Math.min(1, h * 1.6);
        // head somewhere: away from the strike point
        const ex = this.pos.x - this.aimX() || 1;
        const ez = this.pos.z - this.aimZ();
        const el = Math.hypot(ex, ez) || 1;
        this.vel.x += ((ex / el) * 4.2 - this.vel.x) * Math.min(1, h * 1.2);
        this.vel.z += ((ez / el) * 4.2 - this.vel.z) * Math.min(1, h * 1.2);
        if (this.phaseTime > 2.8) this.setPhase("recover");
        break;
      }
      case "recover": {
        anim.requestPose(null);
        anim.gait01 += (0.6 - anim.gait01) * Math.min(1, h);
        anim.flapRateHz = 3.2;
        this.vel.y += ((this.altitude - this.pos.y) * 0.5 - this.vel.y) * Math.min(1, h * 1.2);
        if (this.phaseTime > 2.4) this.releaseFish();
        if (this.phaseTime > 3.2) this.reset();
        break;
      }
    }

    // wetness dries off only in the air
    if (this.pos.y > water + 0.05 && this.wet > 0) {
      this.wet = Math.max(0, this.wet - h / (this.shaking ? 0.45 : 1.8));
    }

    this.pos.addScaledVector(this.vel, h);

    // ---- orientation: face the velocity, no roll surprises ------------------
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (hSpeed > 0.35) {
      const targetYaw = Math.atan2(this.vel.x, this.vel.z);
      const d = ((targetYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.yaw += d * Math.min(1, h * 4);
    }
    const targetPitch =
      this.phase === "hover" ? -0.25 : clamp(Math.atan2(-this.vel.y, Math.max(hSpeed, 0.8)), -1.5, 1.5);
    this.pitch += (targetPitch - this.pitch) * Math.min(1, h * 3.5);
    const targetRoll = this.phase === "circle" ? -0.4 : 0;
    this.roll += (targetRoll - this.roll) * Math.min(1, h * 2);
    const shakeRoll = this.shaking ? Math.sin(this.shakeT * 42) * 0.45 * (1 - this.shakeT / 0.7) : 0;

    const g = this.osprey.group;
    g.position.copy(this.pos);
    g.rotation.y = this.yaw;
    g.rotation.x = this.pitch;
    g.rotation.z = this.roll + shakeRoll;
  }
}

// ---- shared bird lighting -----------------------------------------------------------

interface BirdLights {
  update(depth: number): void;
  dispose(): void;
}

function addBirdLights(scene: THREE.Scene): BirdLights {
  const hemi = new THREE.HemisphereLight(0x9db8d8, 0x1c2a28, 0.9);
  const sun = new THREE.DirectionalLight(0xffd9b3, 2.3);
  sun.position.set(-5, 6, 4);
  const rim = new THREE.DirectionalLight(0x6f87b8, 0.7);
  rim.position.set(4, 2, -6);
  scene.add(hemi, sun, rim);
  return {
    update(depth: number) {
      // sunlight follows the bird down: Beer–Lambert on the key light
      const d = Math.max(0, depth);
      sun.color.setRGB(Math.exp(-0.42 * d), 0.85 * Math.exp(-0.09 * d), 0.7 * Math.exp(-0.035 * d));
      hemi.intensity = 0.9 - Math.min(0.45, d * 0.12);
    },
    dispose() {
      scene.remove(hemi, sun, rim);
    },
  };
}

// ---- hero: the whole thing ------------------------------------------------------------

export async function mountBreachHero(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await underCtx(el, { aspect: 0.48, fov: 55 });
  const scene = buildCrossingScene(ctx, { hour: 7.4, bedDepth: 2.6, size: 300 });
  const lights = addBirdLights(ctx.scene);

  const osprey = buildOsprey();
  ctx.scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);

  const fish = buildFish(0.34);
  ctx.scene.add(fish.group);
  const cruiser = new FishCruiser(fish, { radiusX: 1.4, radiusZ: 0.9, depth: 1.0, period: 14 });

  const spray = new Spray(320);
  const plume = new BubblePlume(220);
  plume.attachToBus();
  ctx.scene.add(spray.mesh, plume.mesh);

  const cycle = new DiveCycle(osprey, anim, {
    mode: "full",
    altitude: 8.5,
    circleRadius: 6,
    fish: { cruiser, fish },
    maxDepth: 2.1,
    scene: ctx.scene,
  });

  ctx.onDispose(() => {
    lights.dispose();
    osprey.dispose();
    fish.dispose();
    spray.dispose();
    plume.dispose();
  });

  let timeScale = 1;
  ctx.shell.button("dive now", () => cycle.diveNow());
  ctx.shell.slider({
    label: "time scale",
    min: 0.25,
    max: 1,
    step: 0.05,
    value: 1,
    onInput: (v) => (timeScale = v),
  });
  ctx.shell.setInfo(() => `${cycle.phase}${cycle.carried ? " · fish aboard" : ""}`);

  wind.speed = 1.8;
  ctx.camera.position.set(8.5, 2.5, 8.5);
  const camGoal = new THREE.Vector3();
  const sprayAt = new THREE.Vector3();
  return ctx.finish((t, dt) => {
    const h = dt * timeScale;
    cycle.update(h, t);
    anim.update(h);
    cruiser.update(h, t);
    fish.time.value = t;
    plume.update(h, t);
    spray.update(h, t);
    lights.update(-cycle.pos.y);

    // shed water in the air while wet
    const water = waterHeightAt(cycle.pos.x, cycle.pos.z, t);
    if (cycle.wet > 0.02 && cycle.pos.y > water + 0.1) {
      const rate = cycle.wet * (cycle.shaking ? 420 : 130);
      sprayAt.set(cycle.pos.x, cycle.pos.y + 0.25, cycle.pos.z);
      spray.emit(sprayAt, cycle.vel, rate, h, 0.32, cycle.shaking ? 1.6 : 0.7);
    }

    // chase camera: behind the bird, dipping under right along with it
    const behindX = -Math.sin(cycle.osprey.group.rotation.y);
    const behindZ = -Math.cos(cycle.osprey.group.rotation.y);
    const lift = cycle.phase === "plunge" || cycle.phase === "rise" ? 0.25 : cycle.phase === "dive" || cycle.phase === "strike" ? 0.35 : 0.85;
    camGoal.set(
      cycle.pos.x + behindX * 2.6,
      Math.max(cycle.pos.y + lift, -1.9),
      cycle.pos.z + behindZ * 2.6,
    );
    ctx.camera.position.lerp(camGoal, Math.min(1, dt * 2.4));
    ctx.camera.lookAt(cycle.pos);

    scene.sync(t, dt);
  });
}

// ---- Step 1: the dive profile, cut away ---------------------------------------------------

// Expanding rings drawn as geometry — the cutaway view can't use the
// surface shader's rings, so the bus is made visible directly.
class RingFlash {
  readonly group = new THREE.Group();
  private geo = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
  private live: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; age: number; life: number }[] = [];
  private unsub: () => void;

  constructor() {
    this.unsub = onDisturbance((d) => {
      if (this.live.length > 24) return;
      const mat = new THREE.MeshBasicMaterial({
        color: 0xcfe3ee,
        transparent: true,
        opacity: Math.min(0.6, 0.2 + d.energy * 0.4),
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.position.set(d.x, 0.02, d.z);
      mesh.scale.setScalar(Math.max(0.1, d.radius));
      this.group.add(mesh);
      this.live.push({ mesh, mat, age: 0, life: 1.4 + Math.min(1.2, d.energy) });
    });
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const r = this.live[i];
      r.age += dt;
      if (r.age >= r.life) {
        this.group.remove(r.mesh);
        r.mat.dispose();
        this.live.splice(i, 1);
        continue;
      }
      r.mesh.scale.addScalar(dt * 1.1);
      r.mat.opacity = (1 - r.age / r.life) ** 2 * 0.55;
    }
  }

  dispose(): void {
    this.unsub();
    for (const r of this.live) r.mat.dispose();
    this.geo.dispose();
  }
}

export async function mountDiveProfile(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await underCtx(el, { fov: 42 });

  const sky = createDawnSky(7.2);
  const skyDome = sky.makeDome();
  ctx.scene.add(skyDome);
  const lights = addBirdLights(ctx.scene);

  // the cutaway: a translucent surface sheet and water slab instead of the
  // opaque lake, so the camera can watch both sides at once
  const sheetGeo = new THREE.PlaneGeometry(16, 10).rotateX(-Math.PI / 2);
  const sheetMat = new THREE.MeshBasicMaterial({
    color: 0x3a7d99,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const sheet = new THREE.Mesh(sheetGeo, sheetMat);
  const slabGeo = new THREE.BoxGeometry(16, 2.6, 10);
  const slabMat = new THREE.MeshBasicMaterial({
    color: 0x103442,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  const slab = new THREE.Mesh(slabGeo, slabMat);
  slab.position.y = -1.3;
  const bedWaves = createWaveUniforms();
  const bed = makeSandBed({ env: sky, waves: bedWaves, depth: 2.6, size: 26, segments: 48 });
  const rings = new RingFlash();
  ctx.scene.add(sheet, slab, bed.mesh, rings.group);

  const osprey = buildOsprey();
  ctx.scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);
  const cycle = new DiveCycle(osprey, anim, {
    mode: "profile",
    altitude: 7,
    fish: null,
    targetX: 0,
    targetZ: 0,
    maxDepth: 2.3,
    scene: ctx.scene,
  });

  // the trail: last few seconds of the flight path
  const TRAIL = 240;
  const trailGeo = new THREE.BufferGeometry();
  const trailArr = new Float32Array(TRAIL * 3);
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailArr, 3));
  const trailMat = new THREE.LineBasicMaterial({ color: 0x7aa2ff, transparent: true, opacity: 0.7 });
  const trail = new THREE.Line(trailGeo, trailMat);
  trail.frustumCulled = false;
  ctx.scene.add(trail);
  const trailPts: THREE.Vector3[] = [];

  ctx.onDispose(() => {
    lights.dispose();
    osprey.dispose();
    bed.dispose();
    rings.dispose();
    sky.dispose();
    sheetGeo.dispose();
    sheetMat.dispose();
    slabGeo.dispose();
    slabMat.dispose();
    trailGeo.dispose();
    trailMat.dispose();
  });

  ctx.shell.slider({
    label: "dive altitude (m)",
    min: 3,
    max: 13,
    step: 0.5,
    value: cycle.altitude,
    onInput: (v) => (cycle.altitude = v),
  });
  ctx.shell.button("replay", () => {
    cycle.reset();
    trailPts.length = 0;
  });
  ctx.shell.setInfo(() => {
    const v = cycle.vel.length();
    const entry = cycle.entrySpeed > 0 ? ` · entry ${cycle.entrySpeed.toFixed(1)} m/s` : "";
    const dec = cycle.peakDecel > 0 ? ` · peak decel ${(cycle.peakDecel / 9.81).toFixed(1)} g` : "";
    return `${cycle.phase} · ${v.toFixed(1)} m/s${entry}${dec}`;
  });

  ctx.camera.position.set(11, 0.6, 5.5);
  return ctx.finish((t, dt) => {
    bedWaves.time.value = t;
    cycle.update(dt, t);
    anim.update(dt);
    rings.update(dt);
    lights.update(-cycle.pos.y);

    trailPts.push(cycle.pos.clone());
    if (trailPts.length > TRAIL) trailPts.shift();
    for (let i = 0; i < trailPts.length; i++) {
      trailArr[i * 3] = trailPts[i].x;
      trailArr[i * 3 + 1] = trailPts[i].y;
      trailArr[i * 3 + 2] = trailPts[i].z;
    }
    trailGeo.setDrawRange(0, trailPts.length);
    (trailGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;

    ctx.camera.lookAt(0, Math.min(3.2, cycle.pos.y * 0.4), 0);
  });
}

// ---- Step 2: the grab, slowed down ----------------------------------------------------------

export async function mountTheGrab(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await underCtx(el, { fov: 54 });

  const sky = createDawnSky(7.6);
  const skyDome = sky.makeDome();
  const depthDome = makeDepthDome(200);
  const rings = new RippleRings();
  const ceiling = new SurfaceCeiling({ env: sky, size: 220, segments: 150, rings });
  const bed = makeSandBed({ env: sky, waves: ceiling.waves, depth: 2.6, size: 70 });
  const plume = new BubblePlume(200);
  plume.attachToBus();
  ctx.scene.add(skyDome, depthDome.mesh, ceiling.mesh, bed.mesh, plume.mesh);
  const lights = addBirdLights(ctx.scene);

  const osprey = buildOsprey();
  ctx.scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);

  const fish = buildFish(0.34);
  ctx.scene.add(fish.group);
  const cruiser = new FishCruiser(fish, { radiusX: 1.0, radiusZ: 0.7, depth: 1.0, period: 11 });

  const cycle = new DiveCycle(osprey, anim, {
    mode: "profile",
    altitude: 7.5,
    fish: { cruiser, fish },
    maxDepth: 2.2,
    scene: ctx.scene,
  });

  let simT = 0;
  const unsub = onDisturbance((d) => rings.add(d, simT));
  ctx.onDispose(() => {
    unsub();
    lights.dispose();
    osprey.dispose();
    fish.dispose();
    plume.dispose();
    ceiling.dispose();
    bed.dispose();
    depthDome.dispose();
    sky.dispose();
  });

  const orbit = addOrbit(ctx.shell.canvas, ctx.camera, {
    target: new THREE.Vector3(0, -0.9, 0),
    distance: 3.0,
    azimuth: 0.8,
    polar: 0.0,
    minPolar: -0.45,
    maxPolar: 0.12,
  });
  ctx.onDispose(() => orbit.dispose());

  let timeScale = 0.35;
  ctx.shell.slider({
    label: "time scale (slow-mo)",
    min: 0.12,
    max: 1,
    step: 0.02,
    value: timeScale,
    onInput: (v) => (timeScale = v),
  });
  ctx.shell.button("replay", () => cycle.reset());
  ctx.shell.setInfo(() => `${cycle.phase}${cycle.carried ? " · GRABBED" : ""}`);

  const focus = new THREE.Vector3();
  return ctx.finish((t, dt) => {
    simT = t;
    const h = dt * timeScale;
    cycle.update(h, t);
    anim.update(h);
    cruiser.update(h, t);
    plume.update(h, t);
    ceiling.update(t);
    lights.update(-cycle.pos.y);
    depthDome.mesh.position.copy(ctx.camera.position);
    depthDome.camDepth.value = Math.max(0, -ctx.camera.position.y);
    depthDome.sunDirection.value.copy(sky.sunDirection.value);
    // the camera tracks the action without leaving the water
    focus.set(cycle.pos.x, clamp(cycle.pos.y, -1.6, -0.4), cycle.pos.z);
    orbit.target.lerp(focus, Math.min(1, dt * 1.6));
    orbit.update(dt);
  });
}

// ---- Step 3: water off ------------------------------------------------------------------------

export async function mountWaterOff(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const ctx = await underCtx(el, { fov: 48 });

  const sky = createDawnSky(7.1);
  const skyDome = sky.makeDome();
  const rings = new RippleRings();
  const lake = new LakeSurface({ env: sky, size: 220, segments: 160, rings, bed: sandLakeBed(2.6) });
  ctx.scene.add(skyDome, lake.mesh);
  const lights = addBirdLights(ctx.scene);

  const osprey = buildOsprey();
  ctx.scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);
  const spray = new Spray(320);
  ctx.scene.add(spray.mesh);

  const cycle = new DiveCycle(osprey, anim, {
    mode: "profile",
    altitude: 3.4,
    fish: null,
    maxDepth: 1.6,
    scene: ctx.scene,
  });

  let simT = 0;
  const unsub = onDisturbance((d) => rings.add(d, simT));
  ctx.onDispose(() => {
    unsub();
    lights.dispose();
    osprey.dispose();
    spray.dispose();
    lake.dispose();
    sky.dispose();
  });

  let sprayRate = 1;
  ctx.shell.slider({
    label: "shedding rate ×",
    min: 0.3,
    max: 2.5,
    step: 0.05,
    value: 1,
    onInput: (v) => (sprayRate = v),
  });
  ctx.shell.button("shake", () => cycle.shake());
  ctx.shell.setInfo(() => `${cycle.phase} · wetness ${cycle.wet.toFixed(2)} · ${spray.count} drops`);

  const camGoal = new THREE.Vector3();
  const sprayAt = new THREE.Vector3();
  return ctx.finish((t, dt) => {
    simT = t;
    cycle.update(dt, t);
    anim.update(dt);
    lake.update(t);
    spray.update(dt, t);
    lights.update(-cycle.pos.y);

    const water = waterHeightAt(cycle.pos.x, cycle.pos.z, t);
    if (cycle.wet > 0.02 && cycle.pos.y > water + 0.1) {
      const rate = cycle.wet * sprayRate * (cycle.shaking ? 460 : 150);
      sprayAt.set(cycle.pos.x, cycle.pos.y + 0.25, cycle.pos.z);
      spray.emit(sprayAt, cycle.vel, rate, dt, 0.32, cycle.shaking ? 1.7 : 0.7);
    }

    camGoal.set(cycle.pos.x + 2.6, Math.max(0.5, cycle.pos.y + 0.4), cycle.pos.z + 2.6);
    ctx.camera.position.lerp(camGoal, Math.min(1, dt * 2));
    ctx.camera.lookAt(cycle.pos.x, Math.max(cycle.pos.y, 0.1), cycle.pos.z);
  });
}
