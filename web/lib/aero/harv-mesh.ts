import { HARV_CANOPY, HARV_LEX, HARV_NOZZLES, HARV_PUBLISHED, HARV_VTAIL, HARV_WING, bodyAt, canopyAt, harvStab, harvVtailCant, harvWingGeometry } from "./harv";
import { deg, toRad } from "./units";

/**
 * Triangle mesh of the HARV in feet (x aft, y right, z up from the ground). Built the way a solid modeller would:
 *  - every component is a closed, consistently oriented 2-manifold (each edge shared by exactly two triangles), one
 *    shell (Euler characteristic 2), with outward normals (positive enclosed volume) and shared (welded) vertices;
 *  - sections are swept between rings that share vertices; pointed ends close on a single pole vertex, flat ends on
 *    a fan around the section centroid; no degenerate triangles;
 *  - the fuselage and canopy follow smooth monotone cubics through the traced stations (harv.ts);
 *  - lifting surfaces use the NACA four-digit thickness form with a closed (sharp) trailing edge;
 *  - the left side is the exact mirror image of the right.
 * Pure data: the 3D view turns it into GPU buffers; tests/aero-geometry.test.ts checks all of the above.
 */
export type MeshPart = "skin" | "glass" | "dark" | "metal";
export interface MeshGroup { readonly part: MeshPart; readonly name: string; readonly positions: number[]; readonly indices: number[] }
type V3 = readonly [number, number, number];

/** Exponent of the fuselage cross-section |y/a|^n + |z/b|^n = 1: rounder than a box, flatter-sided than an ellipse. */
export const SUPERELLIPSE_N = 2.6;

/** Exact area of the superellipse |y/a|^n + |z/b|^n = 1: 4ab Γ(1+1/n)² / Γ(1+2/n). */
export function superellipseArea(a: number, b: number, n: number): number {
  return (4 * a * b * gamma(1 + 1 / n) ** 2) / gamma(1 + 2 / n);
}

/** Lanczos approximation of Γ(z) for z > 0 (g = 7, 9 terms; relative error below 1e-13). */
function gamma(z: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const x = z - 1;
  let a = c[0] ?? 1;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += (c[i] ?? 0) / (x + i);
  return Math.sqrt(2 * Math.PI) * t ** (x + 0.5) * Math.exp(-t) * a;
}

// ---------------------------------------------------------------- solid builder

function solid(part: MeshPart, name: string): MeshGroup { return { part, name, positions: [], indices: [] }; }
function add(g: MeshGroup, v: V3): number { g.positions.push(v[0], v[1], v[2]); return g.positions.length / 3 - 1; }
function ringIds(g: MeshGroup, pts: readonly V3[]): number[] { return pts.map((v) => add(g, v)); }

/** Quads between two closed rings of equal length (a, then b further along the sweep). */
function bridge(g: MeshGroup, a: readonly number[], b: readonly number[]): void {
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a0 = a[i] ?? 0, a1 = a[j] ?? 0, b0 = b[i] ?? 0, b1 = b[j] ?? 0;
    g.indices.push(a0, b0, b1, a0, b1, a1);
  }
}

/** Close the first ring of a sweep: fan from a point (a pole or the ring's centroid). */
function closeStart(g: MeshGroup, ring: readonly number[], apex?: V3): void {
  const c = add(g, apex ?? centroid(g, ring));
  for (let i = 0; i < ring.length; i++) g.indices.push(c, ring[i] ?? 0, ring[(i + 1) % ring.length] ?? 0);
}

/** Close the last ring of a sweep (opposite winding to closeStart, so shared edges pair up). */
function closeEnd(g: MeshGroup, ring: readonly number[], apex?: V3): void {
  const c = add(g, apex ?? centroid(g, ring));
  for (let i = 0; i < ring.length; i++) g.indices.push(c, ring[(i + 1) % ring.length] ?? 0, ring[i] ?? 0);
}

function centroid(g: MeshGroup, ring: readonly number[]): V3 {
  let x = 0, y = 0, z = 0;
  for (const i of ring) { x += g.positions[3 * i] ?? 0; y += g.positions[3 * i + 1] ?? 0; z += g.positions[3 * i + 2] ?? 0; }
  return [x / ring.length, y / ring.length, z / ring.length];
}

/** Sweep closed rings into a solid. `start`/`end` give a pole vertex for a pointed end; otherwise the end is capped. */
function sweep(g: MeshGroup, rings: readonly (readonly V3[])[], ends: { start?: V3; end?: V3 } = {}): MeshGroup {
  const ids = rings.map((r) => ringIds(g, r));
  for (let k = 0; k + 1 < ids.length; k++) bridge(g, ids[k] ?? [], ids[k + 1] ?? []);
  closeStart(g, ids[0] ?? [], ends.start);
  closeEnd(g, ids[ids.length - 1] ?? [], ends.end);
  return orientOutward(g);
}

/** Flip every triangle if the enclosed volume is negative, so normals point out of the solid. */
function orientOutward(g: MeshGroup): MeshGroup {
  let vol = 0;
  const p = g.positions;
  for (let f = 0; f + 2 < g.indices.length; f += 3) {
    const a = 3 * (g.indices[f] ?? 0), b = 3 * (g.indices[f + 1] ?? 0), c = 3 * (g.indices[f + 2] ?? 0);
    const ax = p[a] ?? 0, ay = p[a + 1] ?? 0, az = p[a + 2] ?? 0, bx = p[b] ?? 0, by = p[b + 1] ?? 0, bz = p[b + 2] ?? 0, cx = p[c] ?? 0, cy = p[c + 1] ?? 0, cz = p[c + 2] ?? 0;
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  if (vol < 0) for (let f = 0; f + 2 < g.indices.length; f += 3) { const t = g.indices[f + 1] ?? 0; g.indices[f + 1] = g.indices[f + 2] ?? 0; g.indices[f + 2] = t; }
  return g;
}

/** Mirror a right-side solid to the left: negate y and reverse winding (keeps normals outward). */
function mirrored(g: MeshGroup): MeshGroup {
  const positions: number[] = [];
  for (let i = 0; i < g.positions.length; i += 3) positions.push(g.positions[i] ?? 0, -(g.positions[i + 1] ?? 0), g.positions[i + 2] ?? 0);
  const indices: number[] = [];
  for (let i = 0; i < g.indices.length; i += 3) indices.push(g.indices[i] ?? 0, g.indices[i + 2] ?? 0, g.indices[i + 1] ?? 0);
  return { part: g.part, name: g.name.replace(" (right)", " (left)"), positions, indices };
}

// ---------------------------------------------------------------- sections

/** Superellipse ring in the y–z plane at x: m points, no duplicates, symmetric about y = 0 for even m. */
function superRing(x: number, halfWidth: number, zc: number, halfHeight: number, m: number, yc = 0): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < m; i++) {
    const t = (2 * Math.PI * i) / m, c = Math.cos(t), s = Math.sin(t);
    const y = Math.abs(c) < 1e-12 ? 0 : Math.sign(c) * halfWidth * Math.abs(c) ** (2 / SUPERELLIPSE_N);
    const z = Math.abs(s) < 1e-12 ? 0 : Math.sign(s) * halfHeight * Math.abs(s) ** (2 / SUPERELLIPSE_N);
    out.push([x, yc + y, zc + z]);
  }
  return out;
}

/** NACA four-digit symmetric thickness with a closed trailing edge: chord fraction u → half thickness / chord. */
export function nacaHalfThickness(u: number, tc: number): number {
  const x = Math.min(1, Math.max(0, u));
  return 5 * tc * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
}

/** Airfoil ring: upper surface LE → TE (cosine-spaced), lower TE → LE without repeating either end point. */
function airfoilRing(le: V3, chord: number, tc: number, normal: V3, nChord: number): V3[] {
  const us = Array.from({ length: nChord + 1 }, (_, i) => 0.5 * (1 - Math.cos((Math.PI * i) / nChord)));
  const at = (u: number, side: 1 | -1): V3 => {
    const h = side * nacaHalfThickness(u, tc) * chord;
    return [le[0] + u * chord + normal[0] * h, le[1] + normal[1] * h, le[2] + normal[2] * h];
  };
  return [...us.map((u) => at(u, 1)), ...us.slice(1, -1).reverse().map((u) => at(u, -1))];
}

/** Closed lifting surface between a root and a tip section; thickness along the normal of the chord–span plane. */
function liftingSurface(g: MeshGroup, root: { le: V3; chord: number; tc: number }, tip: { le: V3; chord: number; tc: number },
  nSpan: number, nChord: number): MeshGroup {
  const s: V3 = [tip.le[0] - root.le[0], tip.le[1] - root.le[1], tip.le[2] - root.le[2]];
  const len = Math.hypot(s[2], s[1]) || 1;
  const n: V3 = [0, -s[2] / len, s[1] / len];
  const rings: V3[][] = [];
  for (let k = 0; k <= nSpan; k++) {
    const t = k / nSpan;
    const le: V3 = [root.le[0] + t * s[0], root.le[1] + t * s[1], root.le[2] + t * s[2]];
    rings.push(airfoilRing(le, root.chord + t * (tip.chord - root.chord), root.tc + t * (tip.tc - root.tc), n, nChord));
  }
  return sweep(g, rings);
}

/** LEX section across the strake: thick at the body side, sharp at the outer edge (y, z ring at station x). */
function lexRing(x: number, yIn: number, yOut: number, z: number, halfThick: number, k: number): V3[] {
  const upper: V3[] = [], lower: V3[] = [];
  for (let i = 0; i <= k; i++) { const s = i / k, y = yIn + s * (yOut - yIn), h = halfThick * (1 - s) ** 0.75; upper.push([x, y, z + h]); if (i < k) lower.push([x, y, z - h]); }
  return [...upper, ...lower.reverse()];
}


// ---------------------------------------------------------------- the aircraft

export interface HarvMesh { readonly groups: readonly MeshGroup[]; readonly bounds: { min: V3; max: V3 } }

export function buildHarvMesh(detail = 1): HarvMesh {
  const d = Math.max(0.25, detail);
  const m = 2 * Math.max(6, Math.round(14 * d)); // even, so rings are symmetric about the centreline
  const right: MeshGroup[] = [], centre: MeshGroup[] = [];

  // Fuselage: smooth sections, pointed nose on a single pole vertex, flat tail cap.
  const xs: number[] = [];
  for (let x = 0.25 / d; x < 3; x += 0.25 / d) xs.push(x);
  for (let x = 3; x < 55.2 - 1e-9; x += 0.8 / d) xs.push(x);
  xs.push(55.2);
  const nose = bodyAt(0);
  centre.push(sweep(solid("skin", "fuselage"), xs.map((x) => { const b = bodyAt(x); return superRing(x, b.halfWidth, 0.5 * (b.top + b.bottom), 0.5 * (b.top - b.bottom), m); }),
    { start: [0, 0, 0.5 * (nose.top + nose.bottom)] }));

  // Canopy: upper half-superellipse over a flat base sunk into the body, smooth along x.
  const c0 = HARV_CANOPY[0]?.x ?? 7, c1 = HARV_CANOPY[HARV_CANOPY.length - 1]?.x ?? 22;
  const cxs: number[] = [];
  for (let x = c0; x < c1 - 1e-9; x += 0.5 / d) cxs.push(x);
  cxs.push(c1);
  const half = m / 2;
  centre.push(sweep(solid("glass", "canopy"), cxs.map((x) => {
    const c = canopyAt(x), base = bodyAt(x).top - 0.35, h = Math.max(0.05, c.top - base);
    return Array.from({ length: half + 1 }, (_, i): V3 => {
      const t = (Math.PI * i) / half, cc = Math.cos(t), s = Math.sin(t);
      const y = Math.abs(cc) < 1e-12 ? 0 : Math.sign(cc) * c.halfWidth * Math.abs(cc) ** (2 / SUPERELLIPSE_N);
      return [x, y, base + (s < 1e-12 ? 0 : h * s ** (2 / SUPERELLIPSE_N))];
    });
  })));

  // Wing (right), anhedral from the front view, root rib inside the body.
  const w = harvWingGeometry(), yRoot = 2.4, an = Math.tan(toRad(deg(HARV_WING.anhedralDeg)));
  const tipZ = HARV_WING.zFt - (w.semi - yRoot) * an;
  right.push(liftingSurface(solid("skin", "wing (right)"), { le: [w.xLe(yRoot), yRoot, HARV_WING.zFt], chord: w.xTe(yRoot) - w.xLe(yRoot), tc: HARV_WING.tcRoot },
    { le: [w.xLe(w.semi), w.semi, tipZ], chord: w.ct, tc: HARV_WING.tcTip }, 8, 16));

  // LEX (right): swept along x from the apex to where its edge meets the wing leading edge (traced junction y = 4.49).
  const yJoin = 4.49;
  const lexStations = [...HARV_LEX, { x: w.xLe(yJoin), y: yJoin }];
  const zLex = HARV_WING.zFt + 0.15;
  right.push(sweep(solid("skin", "lex (right)"), lexStations.map((p) => lexRing(p.x, Math.min(bodyAt(p.x).halfWidth * 0.92, p.y - 0.05), p.y, zLex, 0.09, 6))));

  // Stabilator (right), all-moving, anhedral.
  const st = harvStab(), sa = Math.tan(toRad(deg(st.anhedralDeg)));
  right.push(liftingSurface(solid("skin", "stabilator (right)"), { le: [st.root.xLe, st.root.y, st.zFt], chord: st.root.xTe - st.root.xLe, tc: 0.045 },
    { le: [st.tip.xLe, st.tip.y, st.zFt - (st.tip.y - st.root.y) * sa], chord: st.tip.xTe - st.tip.xLe, tc: 0.035 }, 4, 12));

  // Vertical tail (right), canted 20° outboard; projected tip height from the side view.
  const cant = harvVtailCant(), vh = HARV_VTAIL.tip.z - HARV_VTAIL.root.z;
  right.push(liftingSurface(solid("skin", "fin (right)"), { le: [HARV_VTAIL.root.xLe, HARV_VTAIL.yRoot, HARV_VTAIL.root.z], chord: HARV_VTAIL.root.xTe - HARV_VTAIL.root.xLe, tc: 0.05 },
    { le: [HARV_VTAIL.tip.xLe, HARV_VTAIL.yRoot + vh * (cant.dy / cant.dz), HARV_VTAIL.tip.z], chord: HARV_VTAIL.tip.xTe - HARV_VTAIL.tip.xLe, tc: 0.035 }, 5, 12));

  // Wingtip pod (research instrumentation) with a pointed nose, and its air-data probe.
  const podY = w.semi + 0.3;
  right.push(sweep(solid("metal", "wingtip pod (right)"), ([[31.2, 0.22], [32, 0.3], [40, 0.3], [40.8, 0.18]] as const).map(([x, r]) => superRing(x, r, tipZ, r, 12, podY)),
    { start: [30.4, podY, tipZ] }));
  right.push(sweep(solid("metal", "air-data probe (right)"), [superRing(30.5, 0.05, tipZ, 0.05, 8, podY)], { start: [28.2, podY, tipZ] }));

  // Engine intake under the LEX: a D-shaped duct from the mouth (x 17.6) aft, narrowing and sinking into the body
  // by x 34; a dark face just inside the mouth stands for the open duct.
  const intake = (x: number) => {
    const t = Math.min(1, Math.max(0, (x - 17.6) / (34 - 17.6))), e = t * t * (3 - 2 * t);
    return { yc: 2.8 - 0.75 * e, zc: 4.98 + 0.35 * e, hw: 0.76 - 0.2 * e, hh: 0.93 - 0.28 * e };
  };
  const ixs = Array.from({ length: Math.round(12 * d) + 1 }, (_, i) => 17.6 + ((34 - 17.6) * i) / Math.round(12 * d));
  right.push(sweep(solid("skin", "intake (right)"), ixs.map((x) => { const q = intake(x); return superRing(x, q.hw, q.zc, q.hh, m, q.yc); })));
  const mouth = intake(17.6);
  right.push(sweep(solid("dark", "intake face (right)"), [17.54, 17.62].map((x) => superRing(x, mouth.hw * 0.86, mouth.zc, mouth.hh * 0.86, m, mouth.yc))));

  // Nozzle (metal shell with a dark exit plug).
  const N = HARV_NOZZLES;
  right.push(sweep(solid("metal", "nozzle (right)"), [superRing(N.x, N.radius * 1.02, N.z, N.radius * 1.02, 20, N.yCentre), superRing(N.x + N.length, N.radius * 0.88, N.z, N.radius * 0.88, 20, N.yCentre)]));
  right.push(sweep(solid("dark", "nozzle exit (right)"), [superRing(N.x + N.length - 0.06, N.radius * 0.8, N.z, N.radius * 0.8, 20, N.yCentre), superRing(N.x + N.length + 0.01, N.radius * 0.8, N.z, N.radius * 0.8, 20, N.yCentre)]));

  const groups = [...centre, ...right, ...right.map(mirrored)];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const g of groups) for (let i = 0; i < g.positions.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = g.positions[i + k] ?? 0;
    if (v < (min[k] ?? 0)) min[k] = v;
    if (v > (max[k] ?? 0)) max[k] = v;
  }
  return { groups, bounds: { min, max } };
}

const pts = (a: [number, number][]): [number, number][] => a;

/** Outline polylines for the engineering drawing (feet), all derived from the same tables as the mesh. */
export function harvOutlines() {
  const w = harvWingGeometry(), st = harvStab(), cant = harvVtailCant();
  const xs = Array.from({ length: 112 }, (_, i) => (55.2 * i) / 111);
  const body = xs.map((x) => bodyAt(x));
  const yRoot = 2.4, an = Math.tan(toRad(deg(HARV_WING.anhedralDeg))), sa = Math.tan(toRad(deg(st.anhedralDeg)));
  const vh = HARV_VTAIL.tip.z - HARV_VTAIL.root.z;
  const c0 = HARV_CANOPY[0]?.x ?? 7, c1 = HARV_CANOPY[HARV_CANOPY.length - 1]?.x ?? 22;
  return {
    body,
    canopy: Array.from({ length: 31 }, (_, i) => canopyAt(c0 + ((c1 - c0) * i) / 30)),
    lex: HARV_LEX,
    wing: pts([[w.xLe(yRoot), yRoot], [w.xLe(w.semi), w.semi], [w.xLe(w.semi) + w.ct, w.semi], [w.xTe(yRoot), yRoot]]),
    wingZ: { root: HARV_WING.zFt, tip: HARV_WING.zFt - (w.semi - yRoot) * an, yRoot, tipY: w.semi },
    stab: pts([[st.root.xLe, st.root.y], [st.tip.xLe, st.tip.y], [st.tip.xTe, st.tip.y], [st.root.xTe, st.root.y]]),
    stabZ: { root: st.zFt, tip: st.zFt - (st.tip.y - st.root.y) * sa, yRoot: st.root.y, tipY: st.tip.y },
    vtailSide: pts([[HARV_VTAIL.root.xLe, HARV_VTAIL.root.z], [HARV_VTAIL.tip.xLe, HARV_VTAIL.tip.z], [HARV_VTAIL.tip.xTe, HARV_VTAIL.tip.z], [HARV_VTAIL.root.xTe, HARV_VTAIL.root.z]]),
    vtailFront: { yRoot: HARV_VTAIL.yRoot, zRoot: HARV_VTAIL.root.z, yTip: HARV_VTAIL.yRoot + vh * (cant.dy / cant.dz), zTip: HARV_VTAIL.tip.z },
    nozzles: HARV_NOZZLES,
    published: HARV_PUBLISHED,
    wingGeometry: { cr: w.cr, ct: w.ct, mac: w.mac, yMac: w.yMac, xMacLe: w.xLe(w.yMac), semi: w.semi },
  };
}
