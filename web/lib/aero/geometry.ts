import { type Deg, type Rad, deg, rad, toDeg, toRad } from "./units";

/** Spanwise station of a half wing (y ≥ 0 from the centreline). Lengths in any consistent unit. */
export interface Station { readonly y: number; readonly xLe: number; readonly chord: number }

/**
 * A symmetric planform described by its right half. The edge between consecutive stations is straight.
 * sRef / cRef / xRef override the computed reference values (aircraft data use the wing-only reference area).
 */
export interface Planform {
  readonly name: string;
  readonly stations: readonly Station[];
  readonly sRef?: number;
  readonly cRef?: number;
  readonly xRef?: number;
}

export interface Segment { readonly y0: number; readonly y1: number; readonly sweepLe: Rad; readonly sweepTe: Rad }

export interface PlanformProps {
  readonly area: number;         // full planform area
  readonly span: number;         // full span
  readonly aspectRatio: number;  // span² / area
  readonly mac: number;          // mean aerodynamic chord
  readonly xMacLe: number;       // x of the MAC leading edge
  readonly yMac: number;         // spanwise station of the MAC
  readonly rootChord: number;
  readonly sRef: number;
  readonly cRef: number;
  readonly xRef: number;
  readonly segments: readonly Segment[];
}

export class GeometryError extends Error {}

/** All reasons a planform is unusable; empty when valid. */
export function validatePlanform(p: Planform): string[] {
  const e: string[] = [];
  const s = p.stations;
  if (s.length < 2) e.push("needs at least two stations");
  s.forEach((st, i) => {
    if (![st.y, st.xLe, st.chord].every(Number.isFinite)) e.push(`station ${i}: non-finite value`);
    if (st.chord < 0) e.push(`station ${i}: negative chord`);
    if (i < s.length - 1 && st.chord <= 0) e.push(`station ${i}: zero chord before the tip`);
    const prev = i > 0 ? s[i - 1] : undefined;
    if (prev !== undefined && st.y <= prev.y) e.push(`station ${i}: y must increase`);
  });
  const first = s[0];
  if (first !== undefined && first.y !== 0) e.push("first station must be on the centreline (y = 0)");
  for (const [k, v] of [["sRef", p.sRef], ["cRef", p.cRef], ["xRef", p.xRef]] as const) {
    if (v !== undefined && !Number.isFinite(v)) e.push(`${k} must be finite`);
    if (v !== undefined && k !== "xRef" && v <= 0) e.push(`${k} must be positive`);
  }
  return e;
}

export function assertPlanform(p: Planform): void {
  const e = validatePlanform(p);
  if (e.length > 0) throw new GeometryError(`${p.name}: ${e.join("; ")}`);
}

/** Integrated properties of the full (mirrored) planform. */
export function planformProps(p: Planform): PlanformProps {
  assertPlanform(p);
  const s = p.stations;
  let half = 0, c2 = 0, xle = 0, yc = 0;
  const segments: Segment[] = [];
  for (let i = 0; i + 1 < s.length; i++) {
    const a = s[i], b = s[i + 1];
    if (a === undefined || b === undefined) continue;
    const dy = b.y - a.y;
    half += 0.5 * (a.chord + b.chord) * dy;
    // ∫c² dy, ∫c·xLe dy and ∫c·y dy for linear c, xLe over the segment (exact Simpson for quadratics).
    const m = { chord: 0.5 * (a.chord + b.chord), xLe: 0.5 * (a.xLe + b.xLe), y: 0.5 * (a.y + b.y) };
    const simpson = (f: (t: { chord: number; xLe: number; y: number }) => number) => (dy / 6) * (f(a) + 4 * f(m) + f(b));
    c2 += simpson((t) => t.chord * t.chord);
    xle += simpson((t) => t.chord * t.xLe);
    yc += simpson((t) => t.chord * t.y);
    segments.push({ y0: a.y, y1: b.y, sweepLe: rad(Math.atan2(b.xLe - a.xLe, dy)), sweepTe: rad(Math.atan2(b.xLe + b.chord - (a.xLe + a.chord), dy)) });
  }
  const area = 2 * half, last = s[s.length - 1], root = s[0];
  const span = 2 * (last?.y ?? 0);
  const mac = c2 / half;
  const sRef = p.sRef ?? area, cRef = p.cRef ?? mac;
  const xMacLe = xle / half;
  return {
    area, span, aspectRatio: (span * span) / area, mac, xMacLe, yMac: yc / half, rootChord: root?.chord ?? 0,
    sRef, cRef, xRef: p.xRef ?? xMacLe + 0.25 * mac, segments,
  };
}

/** Leading-edge sweep at spanwise station y (of the segment containing y). */
export function sweepAt(props: PlanformProps, y: number): Rad {
  const seg = props.segments.find((g) => y >= g.y0 && y <= g.y1) ?? props.segments[props.segments.length - 1];
  return seg?.sweepLe ?? rad(0);
}

/** Pointed delta wing with apex at the origin. Aspect ratio = 4 / tan(sweep). */
export function deltaWing(sweepLe: Deg, rootChord = 1): Planform {
  if (!(sweepLe > 0 && sweepLe < 89)) throw new GeometryError("delta sweep must be between 0 and 89 degrees");
  const semi = rootChord / Math.tan(toRad(sweepLe));
  return { name: `${sweepLe}° delta`, stations: [{ y: 0, xLe: 0, chord: rootChord }, { y: semi, xLe: rootChord, chord: 0 }] };
}

/** Delta wing with a given aspect ratio. */
export function deltaFromAspectRatio(aspectRatio: number, rootChord = 1): Planform {
  if (!(aspectRatio > 0 && aspectRatio < 8)) throw new GeometryError("aspect ratio must be between 0 and 8");
  return deltaWing(toDeg(rad(Math.atan(4 / aspectRatio))), rootChord);
}

/** Straight-tapered wing (rectangular when taper = 1). */
export function trapezoidWing(aspectRatio: number, taper: number, sweepLe: Deg, rootChord = 1): Planform {
  if (!(aspectRatio > 0 && taper >= 0 && taper <= 1)) throw new GeometryError("aspect ratio > 0 and 0 ≤ taper ≤ 1 required");
  const semi = (aspectRatio * rootChord * (1 + taper)) / 4;
  return { name: `AR ${aspectRatio} trapezoid`, stations: [{ y: 0, xLe: 0, chord: rootChord }, { y: semi, xLe: semi * Math.tan(toRad(sweepLe)), chord: rootChord * taper }] };
}

export interface LexWingParams {
  readonly wingArea: number; readonly span: number; readonly taper: number; readonly wingSweepLe: Deg;
  readonly lexLength: number; readonly lexSpan: number;
}

/**
 * Generic fighter-class layout: a trapezoidal wing with a leading-edge extension (LEX) running forward to the
 * centreline. Reference area and chord are the wing's, as in published aircraft data. This is a public-reference
 * approximation for analysis and teaching, not any aircraft's actual geometry.
 */
export function lexWing(q: LexWingParams): Planform {
  const semi = q.span / 2;
  const cr = q.wingArea / ((1 + q.taper) * semi);
  const ct = cr * q.taper;
  const t = Math.tan(toRad(q.wingSweepLe));
  const teAt = (y: number) => cr + (y / semi) * (semi * t + ct - cr);
  const xAtLex = q.lexSpan * t;
  const stations: Station[] = [
    { y: 0, xLe: -q.lexLength, chord: cr + q.lexLength },
    { y: q.lexSpan, xLe: xAtLex, chord: teAt(q.lexSpan) - xAtLex },
    { y: semi, xLe: semi * t, chord: ct },
  ];
  const mac = (2 / 3) * cr * ((1 + q.taper + q.taper * q.taper) / (1 + q.taper));
  const yMac = (semi / 3) * ((1 + 2 * q.taper) / (1 + q.taper));
  return { name: "Fighter-class LEX wing (generic)", stations, sRef: q.wingArea, cRef: mac, xRef: yMac * t + 0.25 * mac };
}

/** Public reference dimensions (NASA TM-112360): S = 400 ft², b = 37.417 ft, MAC = 11.517 ft. Other values are generic. */
export const FIGHTER_REFERENCE: LexWingParams = { wingArea: 400, span: 37.417, taper: 0.35, wingSweepLe: deg(26.7), lexLength: 17, lexSpan: 4 };
