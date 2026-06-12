// Clipmap terrain: kilometers of valley inside a fixed vertex budget.
//
// The scheme: a stack of square levels centered on the camera. Level 0 is a
// full n×n-cell grid with cells of `baseCell` meters; every level above it
// is a ring — same n×n footprint in its own (doubled) cell size, with the
// middle n/2 cells cut out, because the finer level below covers them. All
// levels share ONE center, so the rings nest exactly by construction;
// every level's even-indexed vertices land on its parent's lattice.
//
// Heights come from the analytic basin function evaluated in the vertex
// shader (terrainNodes.ts), so there is no heightmap to page in — a vertex
// knows its height wherever it lands.
//
// Seams: where a fine ring meets its coarser parent, the fine edge has
// vertices the coarse edge lacks (T-junctions). Near the outer edge of each
// level, odd vertices morph their height toward the average of their even
// neighbors — at the boundary they sit exactly on the coarse triangle edge.
// The blend region (MORPH_START..1) hides the transition. A skirt (a short
// curtain dropped from the outer edge) papers over the sub-pixel cracks
// that T-junction rasterization can still leave.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
  Vector2,
} from "three/webgpu";
import {
  attribute,
  float,
  mix,
  normalWorld,
  positionLocal,
  positionWorld,
  smoothstep,
  transformNormalToView,
  uniform,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { terrainHeightNode, terrainNormalNode } from "./terrainNodes";

type NodeV3 = Node<"vec3">;

const MORPH_START = 0.7;

export interface ClipmapOptions {
  /** Cells per level side. Must be divisible by 4. Default 96. */
  cells?: number;
  /** Finest cell size in meters. Default 1.5. */
  baseCell?: number;
  /** Number of levels (each doubles the previous cell size). Default 6. */
  levels?: number;
  /**
   * Optional surface coloring, evaluated per fragment. `world` is the
   * displaced world position, `normal` the world-space surface normal —
   * both are cheap pipeline varyings, not height re-evaluations.
   */
  makeColor?: (args: { world: NodeV3; normal: NodeV3; level: number; levelTint: NodeV3 }) => NodeV3;
  /** Per-level debug tint colors, exposed to makeColor as levelTint. */
  levelColors?: Color[];
}

export class ClipmapTerrain {
  readonly group = new Group();
  readonly meshes: Mesh[] = [];
  readonly cells: number;
  readonly baseCell: number;
  readonly levels: number;
  readonly vertexCount: number;

  /** 0 → cracks and pops on display; 1 → seams morphed away. Live uniform. */
  readonly morph = uniform(1);
  /** Skirt drop in units of the local cell size. Live uniform. */
  readonly skirtDrop = uniform(4);

  private readonly origin = uniform(new Vector2());
  private readonly materials: MeshStandardNodeMaterial[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private snapStep: number;

  constructor(opts: ClipmapOptions = {}) {
    this.cells = opts.cells ?? 96;
    this.baseCell = opts.baseCell ?? 1.5;
    this.levels = opts.levels ?? 6;
    if (this.cells % 4 !== 0) throw new Error("clipmap cells must be divisible by 4");
    this.snapStep = 2 * this.baseCell;

    const centerGeo = buildLevelGeometry(this.cells, false);
    const ringGeo = buildLevelGeometry(this.cells, true);
    this.geometries.push(centerGeo, ringGeo);

    let verts = 0;
    for (let l = 0; l < this.levels; l++) {
      const geo = l === 0 ? centerGeo : ringGeo;
      const material = this.buildMaterial(l, this.baseCell * 2 ** l, opts);
      const mesh = new Mesh(geo, material);
      mesh.frustumCulled = false; // geometry is displaced in the shader
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.materials.push(material);
      verts += geo.getAttribute("position").count;
    }
    this.vertexCount = verts;
  }

  /**
   * Re-center on (x, z), snapped to the current snap step so vertices stay
   * put in world space between steps. All levels share the snapped origin.
   */
  update(x: number, z: number): void {
    const s = this.snapStep;
    this.origin.value.set(Math.floor(x / s) * s, Math.floor(z / s) * s);
  }

  /**
   * Snap granularity = 2 × the cell size of `level`. Finer snaps move the
   * grid often but by little; coarser snaps move it rarely but all at once.
   */
  setSnapLevel(level: number): void {
    this.snapStep = 2 * this.baseCell * 2 ** Math.max(0, Math.min(this.levels - 1, level));
  }

  setWireframe(on: boolean): void {
    for (const m of this.materials) m.wireframe = on;
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
  }

  private buildMaterial(level: number, scale: number, opts: ClipmapOptions): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();
    material.side = DoubleSide; // skirts are seen from both sides

    const s = float(scale);
    const half = (this.cells / 2) * scale;

    // Static attributes (see buildLevelGeometry): position.xz = local cell
    // coords, morphDir = even-neighbor axis for odd vertices, skirt = 1 on
    // the dropped curtain copies of the outer edge.
    const local = positionLocal.xz.mul(s).toVar();
    const morphDir = vec2(attribute<"vec2">("morphDir", "vec2"));
    const skirt = float(attribute<"float">("skirt", "float"));

    const world = local.add(this.origin).toVar();

    // Fine height, and the height of the coarse edge this vertex morphs to:
    // the average of its two even neighbors along morphDir.
    const hFine = terrainHeightNode(world).toVar();
    const off = morphDir.mul(s);
    const hCoarse = terrainHeightNode(world.add(off)).add(terrainHeightNode(world.sub(off))).mul(0.5);

    // Morph weight: 0 in the interior, 1 exactly at the outer boundary.
    const edge = local.x.abs().max(local.y.abs()).div(half);
    const isOdd = morphDir.x.abs().add(morphDir.y.abs()).min(1);
    const m = smoothstep(MORPH_START, 1.0, edge).mul(isOdd).mul(this.morph);

    const h = mix(hFine, hCoarse, m).sub(skirt.mul(this.skirtDrop).mul(s));

    // All of the above runs in the vertex stage by definition of positionNode.
    material.positionNode = vec3(world.x, h, world.y);

    // Analytic FD normal, computed per VERTEX (varying() pins it there —
    // re-deriving 4 height taps per fragment would melt the GPU), with the
    // FD step equal to the local cell size so shading detail matches
    // geometric detail per ring.
    const vNormal = varying(terrainNormalNode(world, s));
    material.normalNode = transformNormalToView(vNormal.normalize());

    const palette = opts.levelColors ?? DEFAULT_LEVEL_COLORS;
    const tint = palette[level % palette.length];
    const levelTint = vec3(tint.r, tint.g, tint.b);
    material.colorNode = opts.makeColor
      ? opts.makeColor({ world: positionWorld, normal: normalWorld, level, levelTint })
      : vec3(0.55, 0.55, 0.58);
    material.roughnessNode = float(0.95);
    material.metalnessNode = float(0);

    return material;
  }
}

const DEFAULT_LEVEL_COLORS = [
  new Color("#7aa2ff"),
  new Color("#7dd6a0"),
  new Color("#ffb86b"),
  new Color("#ff8585"),
  new Color("#c39bff"),
  new Color("#9adbe8"),
  new Color("#e8d98a"),
];

// ---- geometry -------------------------------------------------------------------
//
// Local coordinates are in CELL units (integers from -n/2 to n/2); the
// shader multiplies by the level's cell size. One center grid and one ring
// geometry are shared by all levels.
//
// Attributes:
//   position  — (i, 0, j) cell coords
//   morphDir  — (1,0) for odd-i, (0,1) for odd-j, (1,1) for odd-odd
//               (matching the uniform quad diagonal), (0,0) for even-even
//   skirt     — 1 on duplicated outer-edge vertices that drop down
//
// Quads are split along the (+i, +j) diagonal everywhere, so a fully
// morphed odd-odd vertex (which averages its two diagonal neighbors) lands
// exactly on the coarse triangulation's surface.

function buildLevelGeometry(n: number, hole: boolean): BufferGeometry {
  const half = n / 2;
  const holeHalf = n / 4;
  const index = new Map<string, number>();
  const positions: number[] = [];
  const morphDir: number[] = [];
  const skirt: number[] = [];
  const tris: number[] = [];

  const vertex = (i: number, j: number, isSkirt: boolean): number => {
    const key = `${i},${j},${isSkirt ? 1 : 0}`;
    let id = index.get(key);
    if (id === undefined) {
      id = positions.length / 3;
      index.set(key, id);
      positions.push(i, 0, j);
      if (isSkirt) {
        morphDir.push(0, 0);
        skirt.push(1);
      } else {
        morphDir.push(i & 1 ? 1 : 0, j & 1 ? 1 : 0);
        skirt.push(0);
      }
    }
    return id;
  };

  // Surface quads. Cell (i, j) spans i..i+1, j..j+1; cells fully inside the
  // hole are covered by the next finer level and skipped.
  for (let j = -half; j < half; j++) {
    for (let i = -half; i < half; i++) {
      const inside =
        hole && i >= -holeHalf && i + 1 <= holeHalf && j >= -holeHalf && j + 1 <= holeHalf;
      if (inside) continue;
      const a = vertex(i, j, false);
      const b = vertex(i + 1, j, false);
      const c = vertex(i + 1, j + 1, false);
      const d = vertex(i, j + 1, false);
      // diagonal a→c everywhere
      tris.push(a, c, b, a, d, c);
    }
  }

  // Outer-edge skirt: a curtain of quads hanging from each boundary vertex
  // down to its dropped twin.
  const edgeRun = (fromI: number, fromJ: number, di: number, dj: number): void => {
    for (let k = 0; k < n; k++) {
      const i0 = fromI + di * k;
      const j0 = fromJ + dj * k;
      const a = vertex(i0, j0, false);
      const b = vertex(i0 + di, j0 + dj, false);
      const a2 = vertex(i0, j0, true);
      const b2 = vertex(i0 + di, j0 + dj, true);
      tris.push(a, b, b2, a, b2, a2);
    }
  };
  edgeRun(-half, -half, 1, 0); // south edge
  edgeRun(-half, half, 1, 0); // north edge
  edgeRun(-half, -half, 0, 1); // west edge
  edgeRun(half, -half, 0, 1); // east edge

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute("morphDir", new BufferAttribute(new Float32Array(morphDir), 2));
  geo.setAttribute("skirt", new BufferAttribute(new Float32Array(skirt), 1));
  geo.setIndex(tris);
  return geo;
}
