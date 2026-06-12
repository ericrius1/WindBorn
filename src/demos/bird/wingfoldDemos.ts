// Demos for "The Folding Wing" — forward kinematics on the three-segment
// chain, the law-of-cosines two-bone solve, pole vectors, and the full fold.

import * as THREE from "three/webgpu";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { PAL } from "../../lib/scrolly";
import { buildOsprey } from "../../lib/bird/build";
import { SkeletonViz } from "../../lib/bird/rig";
import { WINGS, applyWingTip, tipFromParams, unfoldTarget, makeWingSolveResult } from "../../lib/bird/wing";
import { createStage, makeTimer } from "./stage";

const FOLD_POLE = new THREE.Vector3(0, 0.5, -1).normalize();

// ---- hero: fold and extend, forever --------------------------------------------

export async function mountHeroWingfold(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    water: true,
    orbit: { target: [0, 0.62, 0], radius: 2.0, azimuth: 0.45, polar: 0.2, autoSpin: 0.06 },
  });
  const osprey = buildOsprey();
  osprey.group.position.y = 0.3;
  stage.scene.add(osprey.group);
  osprey.setTailSpread(0.2);
  osprey.rig.setEulerDeg("thighL", 56, 0, 6);
  osprey.rig.setEulerDeg("thighR", 56, 0, -6);
  osprey.rig.setEulerDeg("tarsusL", 34, 0, 0);
  osprey.rig.setEulerDeg("tarsusR", 34, 0, 0);

  const tip = new THREE.Vector3();
  shell.setInfo(() => "fold ↔ extend, on a loop");

  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      const cyc = 0.5 - 0.5 * Math.cos(stage.time * 0.55);
      const f = cyc * cyc * (3 - 2 * cyc); // smooth in and out
      for (const side of [WINGS.L, WINGS.R]) {
        unfoldTarget(side, f, 0, tip);
        applyWingTip(osprey.rig, side, tip, { pole: FOLD_POLE, twist: 0.08 * f });
      }
      osprey.group.position.y = 0.3 + f * 0.12 + Math.sin(stage.time * 0.8) * 0.02;
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

// ---- step 1: forward kinematics on the chain ------------------------------------

export async function mountFk(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    orbit: { target: [0, 0.4, 0], radius: 1.7, azimuth: 0.1, polar: 0.5, autoSpin: 0 },
  });
  const osprey = buildOsprey();
  stage.scene.add(osprey.group);
  // x-ray the flesh so the skeleton reads
  osprey.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const m = mesh.material as THREE.Material;
      m.transparent = true;
      m.opacity = 0.22;
      m.depthWrite = false;
    }
  });
  const viz = new SkeletonViz();
  stage.scene.add(viz.group);

  let dihedral = 8;
  let sweep = 0;
  let elbow = 0;
  let wrist = 0;
  const apply = (): void => {
    osprey.rig.setEulerDeg("humerusL", 0, sweep, dihedral);
    osprey.rig.setEulerDeg("humerusR", 0, -sweep, -dihedral);
    osprey.rig.setEulerDeg("forearmL", 0, elbow, 0);
    osprey.rig.setEulerDeg("forearmR", 0, -elbow, 0);
    osprey.rig.setEulerDeg("handL", 0, wrist, 0);
    osprey.rig.setEulerDeg("handR", 0, -wrist, 0);
  };
  apply();

  shell.slider({ label: "shoulder dihedral °", min: -50, max: 60, step: 1, value: dihedral, onInput: (v) => { dihedral = v; apply(); } });
  shell.slider({ label: "shoulder sweep °", min: -40, max: 80, step: 1, value: sweep, onInput: (v) => { sweep = v; apply(); } });
  shell.slider({ label: "elbow fold °", min: 0, max: 140, step: 1, value: elbow, onInput: (v) => { elbow = v; apply(); } });
  shell.slider({ label: "wrist fold °", min: 0, max: 150, step: 1, value: wrist, onInput: (v) => { wrist = v; apply(); } });

  const tipPos = new THREE.Vector3();
  shell.setInfo(() => {
    osprey.rig.root.updateWorldMatrix(true, true);
    tipPos.set(0.335, -0.012, -0.078).applyMatrix4(osprey.rig.bone("handL").matrixWorld);
    return `left wingtip (${tipPos.x.toFixed(2)}, ${tipPos.y.toFixed(2)}, ${tipPos.z.toFixed(2)}) m`;
  });

  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      viz.update(osprey.rig);
      stage.update(h);
      stage.render();
      shell.tick();
    },
    dispose() {
      viz.dispose();
      osprey.dispose();
      stage.dispose();
    },
  };
}

// ---- step 2: the law of cosines, flat on the table --------------------------------

export function mountLawCos(el: HTMLElement): Demo {
  const shell = new Shell(el, 0.56);
  const canvas = shell.canvas;
  const ctx = canvas.getContext("2d")!;

  let a = 0.9; // upper length, abstract units
  let b = 1.2; // lower length
  let flip = 1; // which intersection: the pole choice
  let px: number | null = null;
  let py: number | null = null;

  shell.slider({ label: "upper length a", min: 0.4, max: 1.6, step: 0.01, value: a, onInput: (v) => (a = v) });
  shell.slider({ label: "lower length b", min: 0.4, max: 1.6, step: 0.01, value: b, onInput: (v) => (b = v) });
  shell.button("flip elbow side", () => (flip = -flip));

  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    px = ((e.clientX - r.left) / r.width) * canvas.width;
    py = ((e.clientY - r.top) / r.height) * canvas.height;
  });
  canvas.addEventListener("pointerleave", () => {
    px = null;
    py = null;
  });

  let clamped = false;
  shell.setInfo(() => (clamped ? "out of reach — chain goes straight and waits" : "move the pointer: the target"));

  let t = 0;
  const dt = makeTimer();
  return {
    frame() {
      t += dt();
      const w = canvas.width;
      const h = canvas.height;
      const unit = Math.min(w, h) * 0.21;
      const sx = w * 0.32;
      const sy = h * 0.58;

      // target: pointer, or a slow lissajous when nobody's home
      const tx = px ?? sx + Math.cos(t * 0.5) * unit * 1.6;
      const ty = py ?? sy - unit * 0.8 + Math.sin(t * 0.8) * unit * 0.7;

      let dx = tx - sx;
      let dy = ty - sy;
      let d = Math.hypot(dx, dy) / unit;
      clamped = d >= a + b - 1e-4;
      d = Math.min(Math.max(d, Math.abs(a - b) + 1e-3), a + b - 1e-3);
      const dn = Math.hypot(dx, dy) || 1;
      dx /= dn;
      dy /= dn;
      const cosA = (a * a + d * d - b * b) / (2 * a * d);
      const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA)) * flip;
      // rotate the unit target direction by ±A
      const ex = sx + (dx * cosA - dy * sinA) * a * unit;
      const ey = sy + (dy * cosA + dx * sinA) * a * unit;
      const endX = sx + dx * d * unit;
      const endY = sy + dy * d * unit;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = PAL.bg;
      ctx.fillRect(0, 0, w, h);

      // the two circles every elbow must live on
      ctx.strokeStyle = PAL.dim;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, a * unit, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(endX, endY, b * unit, 0, Math.PI * 2);
      ctx.stroke();

      // the shoulder→target chord
      ctx.strokeStyle = PAL.grid;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.setLineDash([]);

      // the solved chain
      ctx.strokeStyle = PAL.accent;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      const dot = (x: number, y: number, r: number, c: string): void => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      };
      dot(sx, sy, 7, PAL.text);
      dot(ex, ey, 6, PAL.warm);
      dot(endX, endY, 6, clamped ? PAL.red : PAL.good);

      ctx.fillStyle = PAL.muted;
      ctx.font = `${Math.round(unit * 0.16)}px ui-monospace, monospace`;
      ctx.fillText("shoulder", sx - unit * 0.5, sy + unit * 0.25);
      ctx.fillText("elbow", ex + unit * 0.1, ey - unit * 0.1);
      ctx.fillText("target", endX + unit * 0.1, endY + unit * 0.22);
      ctx.fillStyle = PAL.text;
      const A = (Math.acos(Math.min(1, Math.max(-1, cosA))) * 180) / Math.PI;
      ctx.fillText(`d = ${d.toFixed(2)}   cos A = (a² + d² − b²) / 2ad   A = ${A.toFixed(0)}°`, 16, 26);

      shell.tick();
    },
  };
}

// ---- step 3: the solve on the actual wing -------------------------------------------

export async function mountIkWing(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    orbit: { target: [0.28, 0.4, 0], radius: 1.25, azimuth: 0.35, polar: 0.35, autoSpin: 0 },
  });
  const osprey = buildOsprey();
  stage.scene.add(osprey.group);
  osprey.setTailSpread(0.2);

  // markers along the solved chain
  const mkSphere = (r: number, c: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), new THREE.MeshBasicMaterial({ color: c, depthTest: false }));
    m.renderOrder = 20;
    stage.scene.add(m);
    return m;
  };
  const elbowM = mkSphere(0.013, 0xffb86b);
  const wristM = mkSphere(0.013, 0x7fd4ff);
  const targetM = mkSphere(0.016, 0xffffff);
  const chainGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
  const chainMat = new THREE.LineBasicMaterial({ color: 0xaab4d4, depthTest: false, transparent: true, opacity: 0.9 });
  const chain = new THREE.Line(chainGeo, chainMat);
  chain.renderOrder = 19;
  stage.scene.add(chain);

  let ext = 0.85;
  let lift = 0.1;
  let sweep = -0.05;
  let poleUp = 0.4;
  shell.slider({ label: "extension", min: 0.2, max: 1, step: 0.01, value: ext, onInput: (v) => (ext = v) });
  shell.slider({ label: "tip lift m", min: -0.3, max: 0.38, step: 0.01, value: lift, onInput: (v) => (lift = v) });
  shell.slider({ label: "tip sweep m", min: -0.3, max: 0.16, step: 0.01, value: sweep, onInput: (v) => (sweep = v) });
  shell.slider({ label: "pole (elbow up)", min: 0, max: 1, step: 0.01, value: poleUp, onInput: (v) => (poleUp = v) });

  const solve = makeWingSolveResult();
  const tip = new THREE.Vector3();
  const pole = new THREE.Vector3();
  shell.setInfo(() => (solve.clamped ? "clamped: target beyond reach" : `elbow (${solve.elbow.x.toFixed(2)}, ${solve.elbow.y.toFixed(2)}, ${solve.elbow.z.toFixed(2)})`));

  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      pole.set(0, THREE.MathUtils.lerp(0.15, 1, poleUp), THREE.MathUtils.lerp(-1, -0.25, poleUp)).normalize();
      tipFromParams(WINGS.L, ext, lift, sweep, tip);
      applyWingTip(osprey.rig, WINGS.L, tip, { pole }, solve);
      tipFromParams(WINGS.R, ext, lift, sweep, tip);
      applyWingTip(osprey.rig, WINGS.R, tip, { pole });

      tipFromParams(WINGS.L, ext, lift, sweep, tip);
      targetM.position.copy(tip);
      elbowM.position.copy(solve.elbow);
      wristM.position.copy(solve.wrist);
      const pos = chainGeo.getAttribute("position") as THREE.BufferAttribute;
      pos.setXYZ(0, WINGS.L.shoulder.x, WINGS.L.shoulder.y, WINGS.L.shoulder.z);
      pos.setXYZ(1, solve.elbow.x, solve.elbow.y, solve.elbow.z);
      pos.setXYZ(2, solve.wrist.x, solve.wrist.y, solve.wrist.z);
      pos.setXYZ(3, solve.tip.x, solve.tip.y, solve.tip.z);
      pos.needsUpdate = true;

      stage.update(h);
      stage.render();
      shell.tick();
    },
    dispose() {
      chainGeo.dispose();
      chainMat.dispose();
      osprey.dispose();
      stage.dispose();
    },
  };
}

// ---- step 4: the fold, one scalar -----------------------------------------------------

export async function mountFold(el: HTMLElement): Promise<Demo> {
  if (!navigator.gpu) return gpuMissing(el);
  const shell = new Shell(el);
  const stage = await createStage(shell, {
    orbit: { target: [0, 0.4, 0], radius: 1.6, azimuth: 0.4, polar: 0.35, autoSpin: 0.05 },
  });
  const osprey = buildOsprey();
  stage.scene.add(osprey.group);
  osprey.setTailSpread(0.2);

  // the arc the tip rides, drawn once
  const arcPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 60; i++) arcPts.push(unfoldTarget(WINGS.L, i / 60, 0, new THREE.Vector3()));
  const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
  const arcMat = new THREE.LineBasicMaterial({ color: 0x7aa2ff, transparent: true, opacity: 0.8, depthTest: false });
  const arc = new THREE.Line(arcGeo, arcMat);
  arc.renderOrder = 18;
  stage.scene.add(arc);
  const tipM = new THREE.Mesh(new THREE.SphereGeometry(0.014, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
  tipM.renderOrder = 20;
  stage.scene.add(tipM);

  let f = 1;
  let twist = 0;
  shell.slider({ label: "fold ↔ extend", min: 0, max: 1, step: 0.005, value: f, onInput: (v) => (f = v) });
  shell.slider({ label: "twist (rad)", min: -0.4, max: 0.5, step: 0.01, value: twist, onInput: (v) => (twist = v) });

  const tip = new THREE.Vector3();
  shell.setInfo(() => `f = ${f.toFixed(2)} · span ${(2 * Math.abs(unfoldTarget(WINGS.L, f, 0, tip).x)).toFixed(2)} m`);

  const dt = makeTimer();
  return {
    frame() {
      const h = dt();
      for (const side of [WINGS.L, WINGS.R]) {
        unfoldTarget(side, f, 0, tip);
        applyWingTip(osprey.rig, side, tip, { pole: FOLD_POLE, twist });
      }
      unfoldTarget(WINGS.L, f, 0, tip);
      tipM.position.copy(tip);
      stage.update(h);
      stage.render();
      shell.tick();
    },
    dispose() {
      arcGeo.dispose();
      arcMat.dispose();
      osprey.dispose();
      stage.dispose();
    },
  };
}
