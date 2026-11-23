import { HARV_CANOPY, HARV_LEX, HARV_NOZZLES, HARV_PUBLISHED, HARV_VTAIL, HARV_WING, bodyAt, harvStab, harvVtailCant, harvWingGeometry } from "./harv";
import { deg, toRad } from "./units";

/**
 * Triangle mesh of the HARV in feet (x aft, y right, z up from the ground), grouped by material. Pure data: the 3D
 * view turns it into GPU buffers and the tests check it against the published dimensions.
 */
export type MeshPart = "skin" | "glass" | "dark" | "metal";
export interface MeshGroup { readonly part: MeshPart; readonly positions: number[]; readonly indices: number[] }
type V3 = readonly [number, number, number];

function group(part: MeshPart): MeshGroup { return { part, positions: [], indices: [] }; }
function push(g: MeshGroup, v: V3): number { g.positions.push(v[0], v[1], v[2]); return g.positions.length / 3 - 1; }

/** Connect consecutive rings (each of the same length, closed or open) with quads. */
function loft(g: MeshGroup, rings: readonly (readonly V3[])[], closed: boolean): void {
  const n = rings[0]?.length ?? 0;
  const base = rings.map((r) => r.map((v) => push(g, v)));
  for (let k = 0; k + 1 < base.length; k++) {
    const a = base[k], b = base[k + 1];
    if (a === undefined || b === undefined) continue;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const j = (i + 1) % n;
      const a0 = a[i] ?? 0, a1 = a[j] ?? 0, b0 = b[i] ?? 0, b1 = b[j] ?? 0;
      g.indices.push(a0, b0, b1, a0, b1, a1);
    }
  }
}

/** Fan-cap a ring (polygon) around its centroid. */
function cap(g: MeshGroup, ring: readonly V3[], flip: boolean): void {
  const avg = (d: 0 | 1 | 2) => ring.reduce((s, v) => s + v[d], 0) / ring.length;
  const c: V3 = [avg(0), avg(1), avg(2)];
  const ci = push(g, c);
  const ids = ring.map((v) => push(g, v));
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i] ?? 0, b = ids[(i + 1) % ids.length] ?? 0;
    if (flip) g.indices.push(ci, b, a); else g.indices.push(ci, a, b);
  }
}

const SUPER = 2.6; // superellipse exponent: rounder than a box, flatter-sided than an ellipse
function ring(x: number, halfWidth: number, zc: number, halfHeight: number, m: number, from = 0, to = 2 * Math.PI, closedRing = true): V3[] {
  const out: V3[] = [];
  const count = closedRing ? m : m + 1;
  for (let i = 0; i < count; i++) {
    const t = from + ((to - from) * i) / m;
    const c = Math.cos(t), s = Math.sin(t);
    out.push([x, Math.sign(c) * halfWidth * Math.abs(c) ** (2 / SUPER), zc + Math.sign(s) * halfHeight * Math.abs(s) ** (2 / SUPER)]);
  }
  return out;
}

/** NACA 4-digit symmetric thickness, chord fraction u → half thickness / chord for t/c = tc. */
export function nacaHalfThickness(u: number, tc: number): number {
  const x = Math.min(1, Math.max(0, u));
  return 5 * tc * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
}

/**
 * Thin lifting surface between a root and a tip section. span = tip LE − root LE; thickness is laid along the unit
 * normal of the plane spanned by the chord (x) and the span direction.
 */
function surface(g: MeshGroup, root: { le: V3; chord: number; tc: number }, tip: { le: V3; chord: number; tc: number }, nSpan = 6, nChord = 14): void {
  const s: V3 = [tip.le[0] - root.le[0], tip.le[1] - root.le[1], tip.le[2] - root.le[2]];
  // normal = x̂ × s (normalised), oriented with a positive "up/out" component
  let nx = 0, ny = -s[2], nz = s[1];
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  const us = Array.from({ length: nChord + 1 }, (_, i) => 0.5 * (1 - Math.cos((Math.PI * i) / nChord)));
  const rings: V3[][] = [];
  for (let k = 0; k <= nSpan; k++) {
    const t = k / nSpan;
    const le: V3 = [root.le[0] + t * s[0], root.le[1] + t * s[1], root.le[2] + t * s[2]];
    const chord = root.chord + t * (tip.chord - root.chord), tc = root.tc + t * (tip.tc - root.tc);
    const upper = us.map((u): V3 => { const h = nacaHalfThickness(u, tc) * chord; return [le[0] + u * chord + nx * h, le[1] + ny * h, le[2] + nz * h]; });
    const lower = [...us].reverse().slice(1, -1).map((u): V3 => { const h = nacaHalfThickness(u, tc) * chord; return [le[0] + u * chord - nx * h, le[1] - ny * h, le[2] - nz * h]; });
    rings.push([...upper, ...lower]);
  }
  loft(g, rings, true);
  const last = rings[rings.length - 1], first = rings[0];
  if (last) cap(g, last, false);
  if (first) cap(g, first, true);
}

function mirror(gs: MeshGroup[]): MeshGroup[] {
  return gs.map((g) => {
    const p: number[] = [];
    for (let i = 0; i < g.positions.length; i += 3) p.push(g.positions[i] ?? 0, -(g.positions[i + 1] ?? 0), g.positions[i + 2] ?? 0);
    const idx: number[] = [];
    for (let i = 0; i < g.indices.length; i += 3) idx.push(g.indices[i] ?? 0, g.indices[i + 2] ?? 0, g.indices[i + 1] ?? 0);
    return { part: g.part, positions: p, indices: idx };
  });
}

export interface HarvMesh { readonly groups: readonly MeshGroup[]; readonly bounds: { min: V3; max: V3 } }

export function buildHarvMesh(detail = 1): HarvMesh {
  const m = Math.max(12, Math.round(28 * detail));
  const skin = group("skin"), glass = group("glass"), dark = group("dark"), metal = group("metal");

  // Fuselage: superellipse loft, denser at the nose.
  const xs: number[] = [];
  for (let x = 0; x < 3; x += 0.25) xs.push(x);
  for (let x = 3; x <= 55.2 + 1e-9; x += 0.8) xs.push(x);
  const rings = xs.map((x) => { const b = bodyAt(x); return ring(x, Math.max(0.02, b.halfWidth), 0.5 * (b.top + b.bottom), Math.max(0.02, 0.5 * (b.top - b.bottom)), m); });
  loft(skin, rings, true);
  const tail = rings[rings.length - 1];
  if (tail) cap(dark, tail, false);

  // Canopy: upper half-superellipse riding on the body top.
  const cRings = HARV_CANOPY.map((c) => {
    const b = bodyAt(c.x);
    const base = b.top - 0.35;
    return ring(c.x, c.halfWidth, base, Math.max(0.05, c.top - base), Math.round(m / 2), 0, Math.PI, false);
  });
  loft(glass, cRings, false);

  // Wing (right half), anhedral from the front view.
  const w = harvWingGeometry();
  const yRoot = 2.4, an = Math.tan(toRad(deg(HARV_WING.anhedralDeg)));
  const hs = group("skin"), hd = group("dark"), hm = group("metal");
  surface(hs, { le: [w.xLe(yRoot), yRoot, HARV_WING.zFt], chord: w.xTe(yRoot) - w.xLe(yRoot), tc: HARV_WING.tcRoot },
    { le: [w.xLe(w.semi), w.semi, HARV_WING.zFt - (w.semi - yRoot) * an], chord: w.ct, tc: HARV_WING.tcTip }, 8, 16);

  // LEX: thin plate from the body side to the traced edge, in the wing plane.
  for (let k = 0; k + 1 < HARV_LEX.length; k++) {
    const p = HARV_LEX[k], q = HARV_LEX[k + 1];
    if (!p || !q) continue;
    const yin = (x: number) => bodyAt(x).halfWidth * 0.92;
    const z = HARV_WING.zFt + 0.15;
    const quad: V3[] = [[p.x, yin(p.x), z], [p.x, p.y, z - 0.02], [q.x, q.y, z - 0.02], [q.x, yin(q.x), z]];
    const top = quad.map((v) => push(hs, v)), bot = quad.map((v) => push(hs, [v[0], v[1], v[2] - 0.18]));
    const t = (i: number) => top[i] ?? 0, u = (i: number) => bot[i] ?? 0;
    hs.indices.push(t(0), t(1), t(2), t(0), t(2), t(3), u(0), u(2), u(1), u(0), u(3), u(2), t(1), u(1), u(2), t(1), u(2), t(2));
  }
  // LEX/wing blend: fill between the last LEX point and the wing leading edge at the junction.
  {
    const p = HARV_LEX[HARV_LEX.length - 1];
    if (p) {
      const z = HARV_WING.zFt + 0.15, yj = 4.49;
      const tri: V3[] = [[p.x, bodyAt(p.x).halfWidth * 0.92, z], [p.x, p.y, z], [w.xLe(yj), yj, z], [w.xLe(yj), bodyAt(w.xLe(yj)).halfWidth * 0.92, z]];
      const ids = tri.map((v) => push(hs, v));
      const k = (i: number) => ids[i] ?? 0;
      hs.indices.push(k(0), k(1), k(2), k(0), k(2), k(3), k(0), k(2), k(1), k(0), k(3), k(2));
    }
  }

  // Stabilator (all-moving), anhedral.
  const st = harvStab(), sa = Math.tan(toRad(deg(st.anhedralDeg)));
  surface(hs, { le: [st.root.xLe, st.root.y, st.zFt], chord: st.root.xTe - st.root.xLe, tc: 0.045 },
    { le: [st.tip.xLe, st.tip.y, st.zFt - (st.tip.y - st.root.y) * sa], chord: st.tip.xTe - st.tip.xLe, tc: 0.035 }, 4, 12);

  // Vertical tail canted 20° outboard; projected tip height from the side view.
  const cant = harvVtailCant();
  const vh = HARV_VTAIL.tip.z - HARV_VTAIL.root.z;
  surface(hs, { le: [HARV_VTAIL.root.xLe, HARV_VTAIL.yRoot, HARV_VTAIL.root.z], chord: HARV_VTAIL.root.xTe - HARV_VTAIL.root.xLe, tc: 0.05 },
    { le: [HARV_VTAIL.tip.xLe, HARV_VTAIL.yRoot + vh * (cant.dy / cant.dz), HARV_VTAIL.tip.z], chord: HARV_VTAIL.tip.xTe - HARV_VTAIL.tip.xLe, tc: 0.035 }, 5, 12);

  // Wingtip pods with air-data probes (HARV research instrumentation).
  const podY = w.semi + 0.3, podZ = HARV_WING.zFt - (w.semi - yRoot) * an;
  const podRings = [[30.6, 0.05], [31.2, 0.22], [32, 0.3], [40, 0.3], [40.8, 0.18]].map(([x, r]) => ring(x ?? 0, r ?? 0, podZ, r ?? 0, 12).map((v): V3 => [v[0], v[1] + podY, v[2]]));
  loft(hm, podRings, true);
  const probe = [[28.2, 0.03], [30.6, 0.05]].map(([x, r]) => ring(x ?? 0, r ?? 0, podZ, r ?? 0, 8).map((v): V3 => [v[0], v[1] + podY, v[2]]));
  loft(hm, probe, true);

  // Engine inlet mouth under the LEX (dark face) and nozzle (metal shell, dark exit).
  const inlet: V3[] = [[17.6, 2.15, 4.05], [17.6, 3.45, 4.05], [17.6, 3.55, 5.9], [17.6, 2.05, 5.9]];
  const ii = inlet.map((v) => push(hd, v));
  const q = (i: number) => ii[i] ?? 0;
  hd.indices.push(q(0), q(2), q(1), q(0), q(3), q(2), q(0), q(1), q(2), q(0), q(2), q(3));
  const N = HARV_NOZZLES;
  const nz = [[N.x, N.radius * 1.02], [N.x + N.length, N.radius * 0.88]].map(([x, r]) => ring(x ?? 0, r ?? 0, N.z, r ?? 0, 20, 0, 2 * Math.PI).map((v): V3 => [v[0], v[1] + N.yCentre, v[2]]));
  loft(hm, nz, true);
  const exit = nz[1];
  if (exit) cap(hd, exit, false);

  const half = [hs, hd, hm];
  const groups = [skin, glass, dark, metal, ...half, ...mirror(half)];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const g of groups) for (let i = 0; i < g.positions.length; i += 3) for (let d = 0; d < 3; d++) {
    const v = g.positions[i + d] ?? 0;
    if (v < (min[d] ?? 0)) min[d] = v;
    if (v > (max[d] ?? 0)) max[d] = v;
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
  return {
    body,
    canopy: HARV_CANOPY,
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
