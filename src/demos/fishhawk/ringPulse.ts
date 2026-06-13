// Far-field telegraph + a drag orbit + a clock formatter — the small stage
// helpers Fish Hawk's figures share. Rebuilt here so the series owns them
// (the surface shaders answer disturbances locally; the hunt needs rises
// readable from cruise altitude, so the bus also feeds flat expanding rings).

import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  RingGeometry,
  Vector3,
} from "three/webgpu";
import { onDisturbance, type DisturbanceKind } from "../../lib/spine";

interface LiveRing {
  mesh: Mesh;
  material: MeshBasicMaterial;
  age: number;
  life: number;
}

/** Bus events → expanding geometry rings, one mesh per live event, faded by age. */
export class RingPulse {
  readonly group = new Group();

  private readonly geometry = new RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
  private readonly live: LiveRing[] = [];
  private readonly unsub: () => void;

  constructor(kinds: DisturbanceKind[] = ["rise", "splash"], capacity = 24, minEnergy = 0.015) {
    this.unsub = onDisturbance((d) => {
      if (!kinds.includes(d.kind) || d.energy < minEnergy) return;
      if (this.live.length >= capacity) return;
      const material = new MeshBasicMaterial({
        color: 0xd6e8f2,
        transparent: true,
        opacity: Math.min(0.55, 0.18 + d.energy * 0.4),
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(this.geometry, material);
      mesh.position.set(d.x, 0.03, d.z);
      mesh.scale.setScalar(Math.max(0.15, d.radius));
      this.group.add(mesh);
      this.live.push({ mesh, material, age: 0, life: 1.6 + Math.min(1.4, d.energy) });
    });
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const r = this.live[i];
      r.age += dt;
      if (r.age >= r.life) {
        this.group.remove(r.mesh);
        r.material.dispose();
        this.live.splice(i, 1);
        continue;
      }
      r.mesh.scale.addScalar(dt * 1.2);
      r.material.opacity = (1 - r.age / r.life) ** 2 * 0.5;
    }
  }

  dispose(): void {
    this.unsub();
    for (const r of this.live) r.material.dispose();
    this.live.length = 0;
    this.geometry.dispose();
  }
}

// ---- drag orbit -------------------------------------------------------------------------

export interface OrbitOptions {
  target?: Vector3;
  azimuth?: number;
  polar?: number;
  distance?: number;
  minPolar?: number;
  maxPolar?: number;
  /** Idle drift, radians/s; stops the first time the user grabs the canvas. */
  drift?: number;
}

export interface Orbit {
  target: Vector3;
  update(dt: number): void;
  dispose(): void;
}

export function addOrbit(
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
  options: OrbitOptions = {},
): Orbit {
  const target = options.target ?? new Vector3(0, 0, 0);
  let azimuth = options.azimuth ?? 0.8;
  let polar = options.polar ?? 0.5;
  const distance = options.distance ?? 20;
  const minPolar = options.minPolar ?? 0.05;
  const maxPolar = options.maxPolar ?? 1.35;
  let drift = options.drift ?? 0;
  let azimuthGoal = azimuth;
  let polarGoal = polar;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const down = (e: PointerEvent): void => {
    dragging = true;
    drift = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent): void => {
    if (!dragging) return;
    azimuthGoal -= (e.clientX - lastX) * 0.005;
    polarGoal = Math.min(maxPolar, Math.max(minPolar, polarGoal + (e.clientY - lastY) * 0.004));
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const up = (e: PointerEvent): void => {
    dragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);

  return {
    target,
    update(dt: number) {
      azimuthGoal += drift * dt;
      const k = Math.min(1, dt * 7);
      azimuth += (azimuthGoal - azimuth) * k;
      polar += (polarGoal - polar) * k;
      camera.position.set(
        target.x + distance * Math.cos(polar) * Math.cos(azimuth),
        target.y + distance * Math.sin(polar),
        target.z + distance * Math.cos(polar) * Math.sin(azimuth),
      );
      camera.lookAt(target);
    },
    dispose() {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    },
  };
}

/** "6:03" from a clock hour. */
export function fmtHour(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  return `${Math.floor(hh)}:${String(Math.floor((hh % 1) * 60)).padStart(2, "0")}`;
}
