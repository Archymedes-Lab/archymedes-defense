/**
 * F-16 outer shape for display, traced from NASA TP-1538 Fig. 2 (three-view, "all dimensions given in meters").
 * The scan was deskewed (1.26°), the silhouettes extracted, and every view anchored nose = 0, nozzle exit = 15.09 m
 * (the published length). Drawing scale 15.09 m / 1,219 px at 300 dpi; tracing uncertainty about ±0.05 m.
 * Axes: x aft from the nose, y to starboard, z up from the nose-tip line (metres).
 *
 * What it is for: an accurately proportioned picture of the aircraft whose NASA data the simulation flies. It is not
 * used by the aerodynamics. Simplified: no landing gear, ventral fins, flaps or stores; the published height (5.01 m)
 * is measured on the landing gear, so this gear-up shape is shorter (tested).
 */
export const F16_SHAPE_SOURCE = "NASA TP-1538 Fig. 2 three-view, traced (deskewed 1.26°, ±0.05 m)";
export const F16_LENGTH_M = 15.09;
export const F16_SPAN_LAUNCHERS_M = 9.45;
export const F16_HEIGHT_ON_GEAR_M = 5.01;

/** Plan-view half-width of the fuselage including the strakes (m), side-view top of the spine without canopy, bottom. */
export const F16_BODY: readonly { x: number; halfWidth: number; top: number; bottom: number }[] = [
  { x: 0.0, halfWidth: 0.06, top: 0.06, bottom: -0.06 },
  { x: 0.5, halfWidth: 0.29, top: 0.26, bottom: -0.14 },
  { x: 1.0, halfWidth: 0.4, top: 0.4, bottom: -0.16 },
  { x: 1.5, halfWidth: 0.49, top: 0.53, bottom: -0.17 },
  { x: 2.0, halfWidth: 0.57, top: 0.65, bottom: -0.16 },
  { x: 2.5, halfWidth: 0.63, top: 0.72, bottom: -0.15 },
  { x: 3.0, halfWidth: 0.71, top: 0.78, bottom: -0.12 },
  { x: 4.0, halfWidth: 0.82, top: 0.92, bottom: -0.1 },
  { x: 4.5, halfWidth: 0.89, top: 0.98, bottom: -0.68 },
  { x: 5.0, halfWidth: 0.98, top: 1.04, bottom: -0.68 },
  { x: 5.5, halfWidth: 1.1, top: 1.1, bottom: -0.68 },
  { x: 6.0, halfWidth: 1.23, top: 1.16, bottom: -0.67 },
  { x: 6.5, halfWidth: 1.34, top: 1.1, bottom: -0.67 },
  { x: 7.0, halfWidth: 1.45, top: 1.04, bottom: -0.66 },
  { x: 8.0, halfWidth: 1.45, top: 0.92, bottom: -0.66 },
  { x: 9.0, halfWidth: 1.3, top: 0.88, bottom: -0.66 },
  { x: 10.0, halfWidth: 1.15, top: 0.88, bottom: -0.65 },
  { x: 11.0, halfWidth: 1.11, top: 0.9, bottom: -0.64 },
  { x: 12.5, halfWidth: 1.11, top: 0.92, bottom: -0.6 },
  { x: 13.5, halfWidth: 0.95, top: 0.9, bottom: -0.51 },
  { x: 14.2, halfWidth: 0.7, top: 0.8, bottom: -0.44 },
  { x: 15.09, halfWidth: 0.42, top: 0.45, bottom: -0.3 },
];
/** The round fuselage under the strakes is at most this wide (half-width, m): the rest of the plan width is strake. */
export const F16_BODY_MAX_HALF_WIDTH = 0.8;
/** Canopy: side-view top (m) over the spine, and its half-width (front view, about 0.8 m wide). */
export const F16_CANOPY: readonly { x: number; top: number }[] = [
  { x: 2.8, top: 0.76 }, { x: 3.0, top: 1.04 }, { x: 3.5, top: 1.29 }, { x: 4.0, top: 1.42 }, { x: 4.25, top: 1.45 },
  { x: 4.5, top: 1.42 }, { x: 5.0, top: 1.36 }, { x: 5.5, top: 1.28 }, { x: 6.0, top: 1.16 },
];
export const F16_CANOPY_HALF_WIDTH = 0.4;

export interface Surface {
  /** Root and tip: leading-edge x, trailing-edge x, spanwise station (y or, for the fin, z) and offset (z or y). */
  readonly root: { readonly xLe: number; readonly xTe: number; readonly s: number; readonly o: number };
  readonly tip: { readonly xLe: number; readonly xTe: number; readonly s: number; readonly o: number };
  /** Thickness at the root (m); thins to 40% at the tip. */
  readonly thickness: number;
}
/** Wing (plan view): leading edge swept 40.7° (registry: 40.2° ± 2.5°), unswept trailing edge, plane at z = 0.48 m. */
export const F16_WING: Surface = { root: { xLe: 6.51, xTe: 11.23, s: 0.75, o: 0.48 }, tip: { xLe: 9.82, xTe: 11.19, s: 4.6, o: 0.48 }, thickness: 0.2 };
/** Horizontal tail: leading edge swept about 42°, tip at 2.86 m, anhedral from the front view (root z 0.38, tip 0.19). */
export const F16_HTAIL: Surface = { root: { xLe: 12.27, xTe: 14.78, s: 0.7, o: 0.4 }, tip: { xLe: 14.11, xTe: 14.78, s: 2.86, o: 0.19 }, thickness: 0.12 };
/** Fin (side view): leading edge swept about 49° from vertical, tip at 3.52 m above the nose line. */
export const F16_FIN: Surface = { root: { xLe: 11.31, xTe: 14.23, s: 0.9, o: 0 }, tip: { xLe: 14.2, xTe: 15.55, s: 3.52, o: 0 }, thickness: 0.14 };
/** Wingtip launcher rails: centre at half the published span over launchers. */
export const F16_LAUNCHER = { xFront: 9.3, xBack: 11.4, y: F16_SPAN_LAUNCHERS_M / 2, z: 0.48, radius: 0.07 } as const;

export interface MeshPart { readonly name: string; readonly positions: Float32Array; readonly indices: Uint32Array }

function lerpTable<T extends { x: number }>(t: readonly T[], x: number, get: (row: T) => number): number {
  const n = t.length, c = Math.min(t[n - 1]?.x ?? 0, Math.max(t[0]?.x ?? 0, x));
  for (let i = 0; i + 1 < n; i++) {
    const a = t[i], b = t[i + 1];
    if (a && b && c <= b.x) { const u = (c - a.x) / (b.x - a.x); return get(a) + (get(b) - get(a)) * u; }
  }
  const last = t[n - 1];
  return last ? get(last) : 0;
}
export const bodyAt = (x: number) => ({
  halfWidth: lerpTable(F16_BODY, x, (r) => r.halfWidth), top: lerpTable(F16_BODY, x, (r) => r.top), bottom: lerpTable(F16_BODY, x, (r) => r.bottom),
});

/** Superellipse ring: half-width a, half-height c, exponent n (2 = ellipse, larger = boxier). */
function ring(a: number, c: number, zc: number, n: number, k: number): [number, number][] {
  const out: [number, number][] = [];
  for (let j = 0; j < k; j++) {
    const t = (2 * Math.PI * j) / k, ct = Math.cos(t), st = Math.sin(t);
    out.push([a * Math.sign(ct) * Math.abs(ct) ** (2 / n), zc + c * Math.sign(st) * Math.abs(st) ** (2 / n)]);
  }
  return out;
}

/** Loft rings along x into a closed tube (end caps fanned to the ring centre). */
function loft(name: string, xs: readonly number[], rings: readonly [number, number][][], closeEnds = true): MeshPart {
  const k = rings[0]?.length ?? 0, P: number[] = [], I: number[] = [];
  xs.forEach((x, i) => (rings[i] ?? []).forEach(([y, z]) => P.push(x, y, z)));
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j < k; j++) {
    const a = i * k + j, b = i * k + ((j + 1) % k), c = (i + 1) * k + j, d = (i + 1) * k + ((j + 1) % k);
    I.push(a, c, b, b, c, d);
  }
  if (closeEnds) for (const [i, flip] of [[0, true], [xs.length - 1, false]] as const) {
    const r = rings[i] ?? [], cy = r.reduce((s, p) => s + p[0], 0) / k, cz = r.reduce((s, p) => s + p[1], 0) / k, centre = P.length / 3;
    P.push(xs[i] ?? 0, cy, cz);
    for (let j = 0; j < k; j++) { const a = i * k + j, b = i * k + ((j + 1) % k); flip ? I.push(centre, b, a) : I.push(centre, a, b); }
  }
  return { name, positions: new Float32Array(P), indices: new Uint32Array(I) };
}

/** A tapered slab between root and tip chords (biconvex-ish: diamond section), mirrored if `mirror`. */
function slab(name: string, s: Surface, axis: "y" | "z", mirror: boolean): MeshPart {
  const P: number[] = [], I: number[] = [], N = 8;
  const sides = mirror ? [1, -1] : [1];
  for (const side of sides) {
    const base = P.length / 3;
    for (const [e, t] of [[s.root, s.thickness], [s.tip, s.thickness * 0.4]] as const) {
      for (let i = 0; i <= N; i++) {
        const u = i / N, x = e.xLe + (e.xTe - e.xLe) * u, half = (t / 2) * Math.sin(Math.PI * u) ** 0.6; // thickest mid-chord, sharp edges
        for (const sgn of [1, -1]) {
          const th = sgn * half;
          if (axis === "y") P.push(x, side * e.s, e.o + th); else P.push(x, e.o + th, e.s);
        }
      }
    }
    const row = 2 * (N + 1), flip = side < 0;
    for (let i = 0; i < N; i++) for (const sgn of [0, 1]) {
      const a = base + 2 * i + sgn, b = base + 2 * (i + 1) + sgn, c = a + row, d = b + row;
      const up = sgn === 0 ? !flip : flip;
      up ? I.push(a, b, c, b, d, c) : I.push(a, c, b, b, c, d);
    }
    for (const r of [0, row]) for (let i = 0; i < N; i++) { // close the ends
      const a = base + r + 2 * i, b = base + r + 2 * (i + 1);
      const f = (r === 0) !== flip;
      f ? I.push(a, a + 1, b, b, a + 1, b + 1) : I.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { name, positions: new Float32Array(P), indices: new Uint32Array(I) };
}

/** Strakes: thin plates from the round fuselage out to the plan outline, from the nose chine back to the wing root. */
function strakes(): MeshPart {
  const P: number[] = [], I: number[] = [], xs: number[] = [];
  for (let x = 2.0; x <= 7.51; x += 0.25) xs.push(x);
  for (const side of [1, -1]) {
    const base = P.length / 3;
    for (const x of xs) {
      const w = bodyAt(x).halfWidth, z = 0.25 + ((0.48 - 0.25) * Math.min(1, (x - 2) / 5)), inner = Math.min(w, F16_BODY_MAX_HALF_WIDTH) - 0.05;
      for (const [y, dz] of [[inner, 0.04], [w, 0.0], [inner, -0.04]] as const) P.push(x, side * y, z + dz);
    }
    for (let i = 0; i + 1 < xs.length; i++) {
      const a = base + 3 * i, b = a + 3;
      const quads: [number, number, number, number][] = [[a, b, a + 1, b + 1], [a + 1, b + 1, a + 2, b + 2]];
      for (const [p, q, r, s] of quads) side > 0 ? I.push(p, q, r, q, s, r) : I.push(p, r, q, q, r, s);
    }
  }
  return { name: "strakes", positions: new Float32Array(P), indices: new Uint32Array(I) };
}

/** Every part of the traced shape, in metres (x aft, y starboard, z up). */
export function f16ShapeParts(stations = 64, around = 28): MeshPart[] {
  const xs: number[] = [];
  for (let i = 0; i <= stations; i++) { const u = i / stations; xs.push(F16_LENGTH_M * (0.5 * u + 0.5 * (1 - Math.cos((Math.PI * u) / 2)))); } // denser at the nose
  const fus = loft("fuselage", xs, xs.map((x) => {
    const b = bodyAt(x), a = Math.min(b.halfWidth, F16_BODY_MAX_HALF_WIDTH), c = (b.top - b.bottom) / 2;
    return ring(Math.max(0.02, a), Math.max(0.02, c), (b.top + b.bottom) / 2, x > 4.3 && x < 11 ? 3 : 2.4, around);
  }));
  const cx: number[] = [];
  for (let i = 0; i <= 24; i++) cx.push(2.8 + ((6.0 - 2.8) * i) / 24);
  const canopy = loft("canopy", cx, cx.map((x) => {
    const spine = bodyAt(x).top, top = lerpTable(F16_CANOPY, x, (r) => r.top), h = Math.max(0.01, top - spine);
    const r = ring(F16_CANOPY_HALF_WIDTH * Math.min(1, Math.sqrt(h / 0.45)), h, spine, 2, around);
    return r.map(([y, z]): [number, number] => [y, Math.max(spine - 0.02, z)]);
  }));
  const L = F16_LAUNCHER, rail = (side: number) => {
    const rx: number[] = [];
    for (let i = 0; i <= 8; i++) rx.push(L.xFront + ((L.xBack - L.xFront) * i) / 8);
    const p = loft(`launcher-${side > 0 ? "right" : "left"}`, rx, rx.map((x) => {
      const taper = Math.min(1, (x - L.xFront) / 0.4 + 0.3);
      return ring(L.radius * taper, L.radius * taper, L.z, 2, 10).map(([y, z]): [number, number] => [side * L.y + y, z]);
    }));
    return p;
  };
  return [fus, canopy, strakes(), slab("wing", F16_WING, "y", true), slab("horizontal-tail", F16_HTAIL, "y", true), slab("fin", F16_FIN, "z", false), rail(1), rail(-1)];
}

/** Axis-aligned bounds of a set of parts. */
export function bounds(parts: readonly MeshPart[]): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = p.positions[i + k] ?? 0; min[k] = Math.min(min[k] ?? v, v); max[k] = Math.max(max[k] ?? v, v);
  }
  return { min, max };
}
