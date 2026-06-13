// The nest, meshed. nest.ts is the geometry-free model — which stage, how built,
// the cup's radius and rim — and this turns that data into a standing dead spar
// with a cup of sticks that fills in across the stages. Direct geometry only: a
// tapered cylinder for the spar, short cylinders laid in a ring for the rim
// twigs, a shallow cone for the bowl, three little spheres for the brood. No SDF,
// no isosurface — sticks placed by hand, exactly the house rule.
//
// The mesh reads the same NestStageInfo + nestBuild the GameState advances, so
// the nest the player grows and the nest the article scrubs are the same nest.

import {
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { NEST_STAGE_INFO, nestStageInfo, type NestStageInfo } from "../../lib/game";

const UP = new Vector3(0, 1, 0);

/** Hash a small integer to a stable pseudo-random in [0,1). */
function rng(seed: number): () => number {
  let s = (seed * 9301 + 49297) % 233280;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** A ring of short twigs laid around a cup of the given radius/rim height. */
function makeTwigRing(radius: number, rim: number, count: number, seed: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const q = new Quaternion();
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + r() * 0.5;
    const len = radius * (0.7 + r() * 0.7);
    const thick = 0.012 + r() * 0.02;
    // Twigs lie roughly tangent, tilted up toward the rim, jumbled.
    const tangent = new Vector3(-Math.sin(a), 0.15 + r() * 0.5, Math.cos(a)).normalize();
    const stick = new CylinderGeometry(thick * 0.7, thick, len, 4, 1);
    stick.applyQuaternion(q.setFromUnitVectors(UP, tangent));
    const ringR = radius * (0.78 + r() * 0.22);
    const h = rim * (0.2 + r() * 0.9);
    stick.translate(Math.cos(a) * ringR, h, Math.sin(a) * ringR);
    parts.push(stick);
  }
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

export interface NestMesh {
  group: Group;
  /** Show the nest at a stage with optional sub-stage build progress 0..1. */
  setStage(stage: number, progress01?: number): void;
  /** Current stage's journal note + name (for HUD/journal). */
  info(stage: number): NestStageInfo;
  dispose(): void;
}

/**
 * Build the nest spar + a cup whose sticks fade in across the stages. `scale`
 * matches the snag instance scale so this sits on top of the dead pine; `seed`
 * keeps the jumble deterministic. Lights elsewhere shade the standard material.
 */
export function buildNestMesh(scale = 1, seed = 7): NestMesh {
  const group = new Group();
  group.scale.setScalar(scale);

  const woodMat = new MeshStandardMaterial({ color: 0x6f6453, roughness: 1, metalness: 0 });
  const mossMat = new MeshStandardMaterial({ color: 0x5b6a3c, roughness: 1, metalness: 0 });
  const eggMat = new MeshStandardMaterial({ color: 0xcfc4a8, roughness: 0.85, metalness: 0 });

  // The bowl: a shallow inverted cone that the rim twigs sit around. Hidden at
  // stage 0 (bare spar), grown with the cup.
  const bowlGeo = new ConeGeometry(1, 0.5, 16, 1, true);
  bowlGeo.translate(0, 0.25, 0);
  bowlGeo.rotateX(Math.PI); // open side up
  const bowl = new Mesh(bowlGeo, mossMat);
  group.add(bowl);

  // One twig ring per stage ≥ 1, built at that stage's radius/rim; we fade them
  // by toggling visibility + scaling so the growth reads as accumulation.
  const rings: Mesh[] = [];
  for (let s = 1; s <= 4; s++) {
    const info = NEST_STAGE_INFO[s];
    const geo = makeTwigRing(info.radius, Math.max(0.05, info.rim), 10 + s * 4, seed + s * 13);
    const mesh = new Mesh(geo, woodMat);
    mesh.visible = false;
    rings.push(mesh);
    group.add(mesh);
  }

  // The brood: three eggs in the lined cup, only at the final stage.
  const eggGeo = new SphereGeometry(0.06, 10, 8);
  eggGeo.scale(1, 1.25, 1);
  const eggs = new Group();
  const er = rng(seed + 99);
  for (let i = 0; i < 3; i++) {
    const egg = new Mesh(eggGeo, eggMat);
    const a = (i / 3) * Math.PI * 2 + er();
    egg.position.set(Math.cos(a) * 0.14, 0.18, Math.sin(a) * 0.14);
    egg.rotation.set(er() * 0.6, er() * 6, 0.3 + er() * 0.4);
    eggs.add(egg);
  }
  eggs.visible = false;
  group.add(eggs);

  const setStage = (stage: number, progress01 = 0): void => {
    const s = Math.max(0, Math.min(4, stage | 0));
    const info = nestStageInfo(s);
    // Bowl scales with the cup; invisible while it's a bare spar.
    const build = info.build;
    bowl.visible = build > 0.01;
    bowl.scale.set(info.radius, Math.max(0.05, info.rim) * 1.6, info.radius);
    // Show every ring up to the current stage; the next one fades in with
    // the sub-stage progress so a feed visibly adds sticks.
    for (let i = 0; i < rings.length; i++) {
      const ringStage = i + 1;
      if (ringStage < s) {
        rings[i].visible = true;
        rings[i].scale.setScalar(1);
      } else if (ringStage === s) {
        rings[i].visible = build > 0.01;
        rings[i].scale.setScalar(1);
      } else if (ringStage === s + 1) {
        const g = Math.max(0, Math.min(1, progress01));
        rings[i].visible = g > 0.02;
        rings[i].scale.setScalar(0.2 + 0.8 * g);
      } else {
        rings[i].visible = false;
      }
    }
    eggs.visible = s >= 4;
  };

  setStage(0);

  return {
    group,
    setStage,
    info: (stage: number) => nestStageInfo(stage),
    dispose() {
      bowlGeo.dispose();
      eggGeo.dispose();
      for (const r of rings) r.geometry.dispose();
      woodMat.dispose();
      mossMat.dispose();
      eggMat.dispose();
    },
  };
}
