/**
 * Topology and geometry checks for an indexed triangle mesh: the same tests a CAD or 3D-printing tool runs before it
 * trusts a solid. A closed, consistently oriented 2-manifold has every undirected edge in exactly two triangles,
 * traversed once in each direction; one shell of genus 0 has Euler characteristic V − E + F = 2; with outward
 * normals its signed volume (divergence theorem, Σ v0·(v1×v2)/6) is positive.
 */
export interface IndexedMesh { readonly name: string; readonly positions: readonly number[]; readonly indices: readonly number[] }

export interface Topology {
  readonly vertices: number; readonly edges: number; readonly faces: number; readonly euler: number;
  readonly boundaryEdges: number; readonly nonManifoldEdges: number; readonly misorientedEdges: number;
  readonly signedVolume: number; readonly area: number;
  readonly minTriangleArea: number; readonly minVertexDistance: number;
}

const at = (p: readonly number[], i: number): [number, number, number] => [p[3 * i] ?? 0, p[3 * i + 1] ?? 0, p[3 * i + 2] ?? 0];

export function meshTopology(m: IndexedMesh): Topology {
  const used = new Set<number>(m.indices);
  const directed = new Map<string, number>(), undirected = new Map<string, number>();
  let vol = 0, area = 0, minA = Number.POSITIVE_INFINITY;
  for (let f = 0; f + 2 < m.indices.length; f += 3) {
    const tri = [m.indices[f] ?? 0, m.indices[f + 1] ?? 0, m.indices[f + 2] ?? 0];
    for (let k = 0; k < 3; k++) {
      const a = tri[k] ?? 0, b = tri[(k + 1) % 3] ?? 0;
      directed.set(`${a}>${b}`, (directed.get(`${a}>${b}`) ?? 0) + 1);
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      undirected.set(key, (undirected.get(key) ?? 0) + 1);
    }
    const [p, q, r] = [at(m.positions, tri[0] ?? 0), at(m.positions, tri[1] ?? 0), at(m.positions, tri[2] ?? 0)];
    vol += (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const cx = (u[1] ?? 0) * (v[2] ?? 0) - (u[2] ?? 0) * (v[1] ?? 0), cy = (u[2] ?? 0) * (v[0] ?? 0) - (u[0] ?? 0) * (v[2] ?? 0), cz = (u[0] ?? 0) * (v[1] ?? 0) - (u[1] ?? 0) * (v[0] ?? 0);
    const a = 0.5 * Math.hypot(cx, cy, cz);
    area += a; minA = Math.min(minA, a);
  }
  let boundary = 0, nonManifold = 0, misoriented = 0;
  for (const [key, count] of undirected) {
    if (count === 1) boundary++;
    else if (count > 2) nonManifold++;
    else {
      const [a, b] = key.split("-");
      if (directed.get(`${a}>${b}`) !== 1 || directed.get(`${b}>${a}`) !== 1) misoriented++;
    }
  }
  // Closest pair of distinct vertices on a grid (welded meshes have none closer than the modelling tolerance).
  const cell = 0.05, grid = new Map<string, number[]>();
  let minD = Number.POSITIVE_INFINITY;
  for (const i of used) {
    const p = at(m.positions, i), c = p.map((x) => Math.floor(x / cell));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of grid.get(`${(c[0] ?? 0) + dx},${(c[1] ?? 0) + dy},${(c[2] ?? 0) + dz}`) ?? []) {
        const q = at(m.positions, j);
        minD = Math.min(minD, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
      }
    }
    const key = `${c[0]},${c[1]},${c[2]}`;
    grid.set(key, [...(grid.get(key) ?? []), i]);
  }
  const faces = Math.floor(m.indices.length / 3);
  return { vertices: used.size, edges: undirected.size, faces, euler: used.size - undirected.size + faces,
    boundaryEdges: boundary, nonManifoldEdges: nonManifold, misorientedEdges: misoriented, signedVolume: vol, area,
    minTriangleArea: minA, minVertexDistance: minD };
}

/** Area of the triangles facing +axis, projected on the plane normal to that axis (planform area for axis 2 = z). */
export function projectedArea(m: IndexedMesh, axis: 0 | 1 | 2): number {
  const [i, j] = axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1];
  let s = 0;
  for (let f = 0; f + 2 < m.indices.length; f += 3) {
    const p = at(m.positions, m.indices[f] ?? 0), q = at(m.positions, m.indices[f + 1] ?? 0), r = at(m.positions, m.indices[f + 2] ?? 0);
    const a = 0.5 * (((q[i] ?? 0) - (p[i] ?? 0)) * ((r[j] ?? 0) - (p[j] ?? 0)) - ((q[j] ?? 0) - (p[j] ?? 0)) * ((r[i] ?? 0) - (p[i] ?? 0)));
    if (a > 0) s += a;
  }
  return s;
}
