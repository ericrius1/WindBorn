// Demos for "Touch and Go" — flare to feet-down, buoyant floating against
// the shared waterHeightAt, disturbance-bus events on every contact, and the
// takeoff run.

import * as THREE from "three/webgpu";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { wind, waterHeightAt, waterNormalAt, disturb, onDisturbance, type Disturbance } from "../../lib/spine";
import { buildOsprey, type Osprey } from "../../lib/bird/build";
import { OspreyAnimator } from "../../lib/bird/animator";
import { createStage, makeTimer, type Stage } from "./stage";

type Phase = "approach" | "flare" | "float" | "run" | "climb";

interface SimOptions {
  flareHeight?: number;
  immersion?: number; // how deep the keel sits at rest, meters
  floatSeconds?: number; // hero: how long to ride before taking off
  loop?: boolean; // hero: approach again after the climb
  startPhase?: Phase;
}

// The landing/float/takeoff state machine. All water queries go through the
// spine's waterHeightAt — the same function the GPU surface displaces with —
// and every contact announces itself on the disturbance bus.
class TouchGoSim {
  pos = new THREE.Vector3(0, 2.0, -8);
  vel = new THREE.Vector3(0, -1.1, 4.4);
  phase: Phase = "approach";
  phaseTime = 0;
  skimCount = 0;
  flareHeight: number;
  immersion: number;
  flapRate = 3.4;
  private floatSeconds: number;
  private loop: boolean;
  private skimTimer = 0;
  private wakeTimer = 0;
  private normal = new THREE.Vector3();

  constructor(
    readonly osprey: Osprey,
    readonly anim: OspreyAnimator,
    opts: SimOptions = {},
  ) {
    this.flareHeight = opts.flareHeight ?? 0.9;
    this.immersion = opts.immersion ?? 0.16;
    this.floatSeconds = opts.floatSeconds ?? 6;
    this.loop = opts.loop ?? true;
    if (opts.startPhase) this.setPhase(opts.startPhase);
  }

  setPhase(p: Phase): void {
    this.phase = p;
    this.phaseTime = 0;
    if (p === "approach") {
      this.pos.set(0, 2.0, -8);
      this.vel.set(0, -1.1, 4.4);
    }
    if (p === "float") this.vel.multiplyScalar(0.2);
    if (p === "run") this.skimCount = 0;
  }

  update(h: number, time: number): void {
    const anim = this.anim;
    this.phaseTime += h;
    const water = waterHeightAt(this.pos.x, this.pos.z, time);
    const height = this.pos.y - water;

    switch (this.phase) {
      case "approach": {
        anim.requestPose(null);
        anim.gait01 += (1 - anim.gait01) * Math.min(1, h * 2);
        if (height < this.flareHeight) this.setPhase("flare");
        break;
      }
      case "flare": {
        anim.requestPose("brake");
        // the air brake: forward speed bleeds off fast, sink settles gentle
        this.vel.z *= Math.exp(-1.7 * h);
        this.vel.y += (-0.5 - this.vel.y) * Math.min(1, h * 4);
        if (height < 0.06) {
          const speed = this.vel.length();
          disturb({
            kind: "splash",
            x: this.pos.x,
            z: this.pos.z,
            energy: Math.min(1.2, Math.max(0.25, (speed * speed) / 12)),
            radius: 0.4,
            vx: this.vel.x,
            vz: this.vel.z,
          });
          this.setPhase("float");
          anim.requestPose("float");
        }
        break;
      }
      case "float": {
        anim.requestPose("float");
        anim.gait01 += (1 - anim.gait01) * Math.min(1, h * 2);
        // buoyancy as a damped spring toward (surface − immersion):
        // Archimedes linearized — restoring force grows with depth error
        const targetY = water - this.immersion + 0.16;
        this.vel.y += ((targetY - this.pos.y) * 22 - this.vel.y * 7.5) * h;
        // wind drift and water drag
        const w = wind.sample(this.pos.x, 0.2, this.pos.z, time);
        this.vel.x += (w.x * 0.045 - this.vel.x * 1.6) * h;
        this.vel.z += (w.z * 0.045 - this.vel.z * 1.6) * h;
        // ride the wave slope
        waterNormalAt(this.pos.x, this.pos.z, time, this.normal);
        this.osprey.group.rotation.x += (this.normal.z * 1.1 - this.osprey.group.rotation.x) * Math.min(1, h * 3);
        this.osprey.group.rotation.z += (-this.normal.x * 1.1 - this.osprey.group.rotation.z) * Math.min(1, h * 3);
        // a floating body is a slow, continuous disturbance
        this.wakeTimer -= h;
        if (this.wakeTimer <= 0) {
          this.wakeTimer = 1.3;
          disturb({ kind: "wake", x: this.pos.x, z: this.pos.z, energy: 0.025, radius: 0.32, vx: this.vel.x, vz: this.vel.z });
        }
        if (this.loop && this.phaseTime > this.floatSeconds) this.setPhase("run");
        break;
      }
      case "run": {
        anim.requestPose(null);
        anim.gait01 += (0.1 - anim.gait01) * Math.min(1, h * 3); // deep hover-flaps
        anim.flapRateHz = this.flapRate;
        // thrust builds forward speed; lift follows speed
        this.vel.z += 2.3 * h;
        const lift = Math.max(0, this.vel.z - 1.4) * 0.55;
        this.vel.y += (lift - 9.81 * 0.06 - this.vel.y * 0.8) * h;
        // feet slapping the surface while we're still low
        if (height < 0.2) {
          this.vel.y = Math.max(this.vel.y, (0.1 - height) * 6 * h + this.vel.y);
          this.skimTimer -= h;
          if (this.skimTimer <= 0) {
            this.skimTimer = 0.16;
            this.skimCount++;
            disturb({
              kind: "skim",
              x: this.pos.x,
              z: this.pos.z,
              energy: 0.06 + this.vel.z * 0.012,
              radius: 0.2,
              vx: this.vel.x,
              vz: this.vel.z,
            });
          }
        }
        this.osprey.group.rotation.x *= Math.exp(-3 * h);
        this.osprey.group.rotation.z *= Math.exp(-3 * h);
        if (height > 0.55) this.setPhase("climb");
        break;
      }
      case "climb": {
        anim.requestPose(null);
        anim.gait01 += (0.55 - anim.gait01) * Math.min(1, h * 1.5);
        this.vel.y += (1.1 - this.vel.y) * Math.min(1, h * 2);
        this.vel.z += (4.4 - this.vel.z) * Math.min(1, h);
        break;
      }
    }

    if (this.phase === "approach" || this.phase === "flare" || this.phase === "climb") {
      // simple kinematics in the air
      this.osprey.group.rotation.x *= Math.exp(-2 * h);
      this.osprey.group.rotation.z *= Math.exp(-2 * h);
    }

    this.pos.addScaledVector(this.vel, h);
    if (this.loop && this.pos.z > 9) this.setPhase("approach");
    this.osprey.group.position.copy(this.pos);
  }
}

function followCamera(stage: Stage, sim: TouchGoSim, h: number): void {
  stage.orbit.target.lerp(sim.pos, Math.min(1, h * 2.2));
}

// ---- hero: the whole loop -----------------------------------------------------------

export async function mountHeroTouchgo(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    water: true,
    rings: true,
    orbit: { target: [0, 0.6, 0], radius: 4.2, azimuth: 1.0, polar: 0.16, autoSpin: 0.03 },
  });
  const osprey = buildOsprey();
  stage.scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);
  const sim = new TouchGoSim(osprey, anim, { loop: true, floatSeconds: 5 });

  shell.setInfo(() => sim.phase);

  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      sim.update(h, stage.time);
      anim.update(h);
      followCamera(stage, sim, h);
      stage.update(h);
      stage.render();
      shell.tick();
    },
    dispose() {
      osprey.dispose();
      stage.dispose();
    },
  };
}

// ---- step 1: the flare ----------------------------------------------------------------

export async function mountFlare(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    water: true,
    rings: true,
    orbit: { target: [0, 0.7, -1], radius: 5.2, azimuth: Math.PI / 2, polar: 0.1, autoSpin: 0 },
  });
  const osprey = buildOsprey();
  stage.scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);
  const sim = new TouchGoSim(osprey, anim, { loop: false });

  // a faint sheet at flare height — the trigger surface
  const sheetGeo = new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2);
  const sheetMat = new THREE.MeshBasicMaterial({ color: 0xffb86b, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide });
  const sheet = new THREE.Mesh(sheetGeo, sheetMat);
  stage.scene.add(sheet);

  shell.slider({ label: "flare height m", min: 0.4, max: 1.6, step: 0.05, value: sim.flareHeight, onInput: (v) => (sim.flareHeight = v) });
  shell.button("replay", () => sim.setPhase("approach"));
  shell.setInfo(() => {
    const hgt = sim.pos.y - waterHeightAt(sim.pos.x, sim.pos.z, stage.time);
    return `${sim.phase} · height ${Math.max(0, hgt).toFixed(2)} m · speed ${sim.vel.length().toFixed(1)} m/s`;
  });

  let settle = 0;
  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      sheet.position.y = sim.flareHeight;
      sim.update(h, stage.time);
      anim.update(h);
      if (sim.phase === "float") {
        settle += h;
        if (settle > 2.4) {
          settle = 0;
          sim.setPhase("approach");
        }
      }
      followCamera(stage, sim, h);
      stage.update(h);
      stage.render();
      shell.tick();
    },
    dispose() {
      sheetGeo.dispose();
      sheetMat.dispose();
      osprey.dispose();
      stage.dispose();
    },
  };
}

// ---- step 2: buoyancy against the shared water -------------------------------------------

export async function mountBuoy(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    water: true,
    rings: true,
    orbit: { target: [0, 0.25, 0], radius: 2.4, azimuth: 0.7, polar: 0.2, autoSpin: 0.05 },
  });
  const osprey = buildOsprey();
  stage.scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);
  const sim = new TouchGoSim(osprey, anim, { loop: false, startPhase: "float" });
  sim.pos.set(0, 0, 0);
  sim.vel.set(0, 0, 0);

  // four probes riding the exact CPU waterHeightAt — glued to the GPU surface
  const probeGeo = new THREE.SphereGeometry(0.02, 10, 8);
  const probeMat = new THREE.MeshBasicMaterial({ color: 0xffb86b });
  const probes: THREE.Mesh[] = [];
  const probeXZ: [number, number][] = [[0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]];
  for (const [px, pz] of probeXZ) {
    const m = new THREE.Mesh(probeGeo, probeMat);
    m.position.set(px, 0, pz);
    stage.scene.add(m);
    probes.push(m);
  }

  shell.slider({ label: "wind m/s", min: 0.5, max: 7, step: 0.1, value: wind.speed, onInput: (v) => (wind.speed = v) });
  shell.slider({ label: "immersion m", min: 0.06, max: 0.26, step: 0.01, value: sim.immersion, onInput: (v) => (sim.immersion = v) });
  shell.setInfo(() => `waterHeightAt(bird) = ${waterHeightAt(sim.pos.x, sim.pos.z, stage.time).toFixed(3)} m`);

  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      sim.update(h, stage.time);
      anim.update(h);
      for (let i = 0; i < probes.length; i++) {
        const [px, pz] = probeXZ[i];
        probes[i].position.y = waterHeightAt(px, pz, stage.time) + 0.02;
      }
      stage.update(h);
      stage.render();
      shell.tick();
    },
    dispose() {
      probeGeo.dispose();
      probeMat.dispose();
      osprey.dispose();
      stage.dispose();
    },
  };
}

// ---- step 3: the disturbance bus, witnessed ------------------------------------------------

export async function mountBus(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    water: true,
    rings: true,
    orbit: { target: [0, 0.2, 0], radius: 3.4, azimuth: 0.5, polar: 0.3, autoSpin: 0.04 },
  });
  const osprey = buildOsprey();
  stage.scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);
  const sim = new TouchGoSim(osprey, anim, { loop: false, startPhase: "float" });
  sim.pos.set(0, 0, 0);
  sim.vel.set(0, 0, 0);

  // a second listener on the same bus: the log
  const log: string[] = [];
  const unsub = onDisturbance((d: Disturbance) => {
    log.unshift(`${d.kind} E=${d.energy.toFixed(3)}`);
    if (log.length > 3) log.pop();
  });

  const rand = (r: number): number => (Math.random() * 2 - 1) * r;
  shell.button("raindrop", () => disturb({ kind: "rain", x: rand(2.2), z: rand(2.2), energy: 0.004, radius: 0.06 }));
  shell.button("fish rise", () => disturb({ kind: "rise", x: rand(2.5), z: rand(2.5), energy: 0.05, radius: 0.18 }));
  shell.button("talon strike", () => disturb({ kind: "splash", x: rand(1.6), z: rand(1.6), energy: 1.0, radius: 0.4 }));
  shell.setInfo(() => (log.length ? log.join("  ·  ") : "press a button — or wait for the float's wake"));

  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      sim.update(h, stage.time);
      anim.update(h);
      stage.update(h);
      stage.render();
      shell.tick();
    },
    dispose() {
      unsub();
      osprey.dispose();
      stage.dispose();
    },
  };
}

// ---- step 4: the takeoff run ----------------------------------------------------------------

export async function mountRun(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    water: true,
    rings: true,
    orbit: { target: [0, 0.4, 0], radius: 4.4, azimuth: 1.2, polar: 0.14, autoSpin: 0 },
  });
  const osprey = buildOsprey();
  stage.scene.add(osprey.group);
  const anim = new OspreyAnimator(osprey);
  const sim = new TouchGoSim(osprey, anim, { loop: false, startPhase: "float" });
  sim.pos.set(0, 0, -4);
  sim.vel.set(0, 0, 0);

  shell.slider({ label: "flap rate Hz", min: 2.4, max: 4.6, step: 0.1, value: sim.flapRate, onInput: (v) => (sim.flapRate = v) });
  shell.button("take off", () => {
    if (sim.phase === "float") sim.setPhase("run");
  });
  shell.button("reset", () => {
    sim.setPhase("float");
    sim.pos.set(0, 0, -4);
    sim.vel.set(0, 0, 0);
  });
  shell.setInfo(() => `${sim.phase} · ${sim.vel.z.toFixed(1)} m/s · ${sim.skimCount} skims`);

  let airTime = 0;
  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      sim.update(h, stage.time);
      anim.update(h);
      if (sim.phase === "climb") {
        airTime += h;
        if (airTime > 3.2) {
          airTime = 0;
          sim.setPhase("float");
          sim.pos.set(0, 0, -4);
          sim.vel.set(0, 0, 0);
        }
      }
      followCamera(stage, sim, h);
      stage.update(h);
      stage.render();
      shell.tick();
    },
    dispose() {
      osprey.dispose();
      stage.dispose();
    },
  };
}
