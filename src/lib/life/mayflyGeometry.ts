// A mayfly you can afford three thousand of: an elongated diamond body
// (two triangles), two upright sail wings (a mayfly dun sits on the water
// like a tiny sloop), and two tail filaments as hair-thin quads. ~12
// triangles. The wing flutter for airborne flies lives in the material.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { float, hash, instanceIndex, positionLocal, sin, step, time, uniform, vec3, vertexColor } from "three/tsl";
import { DUN, FLYING, NYMPH, SPENT, SPINNER, type Mayfly, type MayflyStage } from "./hatch";

const BODY = 0xc9bd96; // pale dun body
const WING = 0xdfdcc8; // smoky translucent wing, opaque-cheap

function colored(geo: BufferGeometry, hex: number): BufferGeometry {
  geo.deleteAttribute("uv");
  geo.deleteAttribute("normal");
  const n = geo.getAttribute("position").count;
  const c = new Color(hex);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  return geo;
}

/** Unit = real size: body ~14 mm, wings ~10 mm tall. Faces +z. */
export function makeMayflyGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];

  // body: a flat diamond, nose +z, abdomen curling slightly up at the back
  const body = new BufferGeometry();
  body.setAttribute(
    "position",
    new BufferAttribute(
      new Float32Array([
        0, 0, 0.007, -0.0012, 0, 0.0, 0, 0.001, -0.007,
        0, 0, 0.007, 0, 0.001, -0.007, 0.0012, 0, 0.0,
      ]),
      3,
    ),
  );
  parts.push(colored(body, BODY));

  // wings: two upright quads in a shallow V (the sailboat read)
  for (const side of [1, -1]) {
    const w = new BufferGeometry();
    const tilt = side * 0.0015;
    w.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([
          0, 0.0005, 0.002, tilt, 0.0105, 0.0005, 0, 0.0005, -0.0035,
          tilt, 0.0105, 0.0005, tilt * 1.4, 0.009, -0.004, 0, 0.0005, -0.0035,
        ]),
        3,
      ),
    );
    parts.push(colored(w, WING));
  }

  // tail filaments: two thin quads trailing aft
  for (const side of [1, -1]) {
    const tail = new BufferGeometry();
    tail.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([
          0, 0.0008, -0.006, side * 0.003, 0.0035, -0.016, side * 0.0034, 0.0033, -0.0158,
        ]),
        3,
      ),
    );
    parts.push(colored(tail, BODY));
  }

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

export interface MayflyMaterialKit {
  material: MeshStandardNodeMaterial;
  /** 0 = matte daylight, 1 = full backlit-mote glow for the dusk scenes. */
  setGlow(amount: number): void;
}

/** Wing flutter above the body line; warm emissive so low sun reads through. */
export function makeMayflyMaterial(): MayflyMaterialKit {
  const uGlow = uniform(0.5);
  const material = new MeshStandardNodeMaterial();
  material.side = DoubleSide;

  // flutter: wing vertices (local y above 3 mm) blur sideways at ~30 Hz
  const ph = hash(float(instanceIndex).add(3.1)).mul(Math.PI * 2);
  const isWing = step(0.003, positionLocal.y);
  const flutter = sin(time.mul(30 * Math.PI * 2).add(ph)).mul(0.002).mul(isWing);
  material.positionNode = positionLocal.add(vec3(flutter, 0, 0));

  material.colorNode = vertexColor();
  material.emissiveNode = vertexColor().mul(vec3(1.0, 0.85, 0.6)).mul(uGlow);
  material.roughnessNode = float(0.8);
  material.metalnessNode = float(0);

  return {
    material,
    setGlow: (amount: number) => {
      uGlow.value = amount;
    },
  };
}

const _m = new Matrix4();

/**
 * Write flies into an InstancedMesh, optionally only one life stage (the
 * lifecycle demo colors each stage with its own mesh). Yaw faces velocity
 * for fliers, drifts for surface stages; spent flies lie flat (rolled 90°).
 */
export function fillMayflyInstances(
  mesh: InstancedMesh,
  flies: readonly Mayfly[],
  scale = 1,
  stage: MayflyStage | -1 = -1,
): number {
  let w = 0;
  const max = mesh.instanceMatrix.count;
  for (let i = 0; i < flies.length && w < max; i++) {
    const f = flies[i];
    if (stage !== -1 && f.stage !== stage) continue;
    if (f.stage === NYMPH && stage === -1) continue; // underwater, invisible from above
    const yaw = f.stage === FLYING || f.stage === SPINNER ? Math.atan2(f.vx, f.vz) : f.seed * Math.PI * 2;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const s = scale * (0.85 + 0.3 * f.seed);
    if (f.stage === SPENT) {
      // spread-eagled on the film: roll the wings down flat
      _m.set(
        0, -cy * s, sy * s, f.x,
        s * 0.25, 0, 0, f.y,
        0, sy * s, cy * s, f.z,
        0, 0, 0, 1,
      );
    } else {
      _m.set(
        cy * s, 0, sy * s, f.x,
        0, s, 0, f.y,
        -sy * s, 0, cy * s, f.z,
        0, 0, 0, 1,
      );
    }
    mesh.setMatrixAt(w++, _m);
  }
  mesh.count = w;
  if (w > 0) mesh.instanceMatrix.needsUpdate = true;
  return w;
}

// re-export the stage constants next to the renderer that needs them
export { NYMPH, DUN, FLYING, SPINNER, SPENT };
