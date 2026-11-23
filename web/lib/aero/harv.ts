import { pchip } from "./curves";
import type { Planform, Station } from "./geometry";
import { type Deg, deg, toRad } from "./units";

/**
 * NASA F/A-18 High Alpha Research Vehicle (HARV), the unarmed research aircraft NASA Dryden flew in 1987–1996.
 * Units: feet. Axes: x aft from the nose tip, y to the right, z up from the ground (gear down).
 *
 * PUBLISHED values (exact): NASA TP-1999-206573 Fig. 2 and Table 3, NASA TM-4786 Fig. 2, NASA TM-112360 —
 *   length 56 ft, wing reference area 400 ft², span 37.4 ft (37.417), MAC 11.52 ft, aspect ratio 3.5,
 *   stabilator span 21.6 ft, height 15.3 ft, vertical tails canted 20° outboard (NASA TM-104261).
 * Wing taper 0.35 and leading-edge sweep 26.7° are the values that reproduce the published MAC and the commonly
 * quoted 20° quarter-chord sweep together (checked in tests).
 * TRACED shapes (approximate, ±0.3 ft; the body under the LEX is hidden in the drawing and estimated): fuselage plan width, side profile, canopy, LEX edge, stabilator and vertical
 * tail outlines, wing and stabilator anhedral — taken from the silhouettes of the NASA three-view (TP-1999-206573
 * Fig. 2) at 300 dpi, then scaled to the published dimensions. Not manufacturer geometry.
 */

export const HARV_PUBLISHED = {
  lengthFt: 56, spanFt: 37.417, wingAreaFt2: 400, macFt: 11.52, aspectRatio: 3.5, stabSpanFt: 21.6, heightFt: 15.3,
  verticalTailCantDeg: 20, stabAreaFt2: 86.48,
} as const;

export const HARV_WING = { taper: 0.35, sweepLeDeg: 26.7, rootLeX: 26.06, zFt: 6.94, anhedralDeg: 4.3, tcRoot: 0.05, tcTip: 0.035 } as const;

/** Fuselage stations: half width (plan), top and bottom (side), feet. */
export interface BodySection { readonly x: number; readonly halfWidth: number; readonly top: number; readonly bottom: number }
export const HARV_BODY: readonly BodySection[] = [
  { x: 0, halfWidth: 0.02, top: 4.62, bottom: 4.58 }, { x: 1, halfWidth: 0.59, top: 5.12, bottom: 4.12 },
  { x: 2, halfWidth: 0.89, top: 5.45, bottom: 3.95 }, { x: 3, halfWidth: 1.16, top: 5.8, bottom: 3.86 },
  { x: 4, halfWidth: 1.32, top: 6.12, bottom: 3.8 }, { x: 5, halfWidth: 1.42, top: 6.42, bottom: 3.78 },
  { x: 6, halfWidth: 1.52, top: 6.78, bottom: 3.78 }, { x: 7, halfWidth: 1.59, top: 7.1, bottom: 3.8 },
  { x: 8.5, halfWidth: 1.62, top: 7.45, bottom: 3.85 }, { x: 10, halfWidth: 1.65, top: 7.75, bottom: 3.9 },
  { x: 12, halfWidth: 1.72, top: 8.05, bottom: 3.7 }, { x: 14, halfWidth: 1.9, top: 8.4, bottom: 3.5 },
  { x: 17, halfWidth: 2.2, top: 8.95, bottom: 3.35 }, { x: 20, halfWidth: 2.45, top: 9.45, bottom: 3.3 },
  { x: 24, halfWidth: 2.75, top: 9.6, bottom: 3.3 }, { x: 28, halfWidth: 3.15, top: 9.55, bottom: 3.35 },
  { x: 32, halfWidth: 3.75, top: 9.4, bottom: 3.5 }, { x: 36, halfWidth: 4.5, top: 9.2, bottom: 3.75 },
  { x: 40, halfWidth: 4.75, top: 9.05, bottom: 3.95 }, { x: 43, halfWidth: 4.86, top: 8.95, bottom: 4.05 },
  { x: 46, halfWidth: 4.95, top: 8.85, bottom: 4.15 }, { x: 48, halfWidth: 4.7, top: 8.7, bottom: 4.3 },
  { x: 50, halfWidth: 4.1, top: 8.45, bottom: 4.6 }, { x: 52.3, halfWidth: 3.1, top: 8.15, bottom: 5.05 },
  { x: 54, halfWidth: 3.0, top: 8.0, bottom: 5.3 }, { x: 55.2, halfWidth: 2.95, top: 7.95, bottom: 5.4 },
];

/** Canopy crest and half width (feet), windscreen base to the aft fairing. */
export const HARV_CANOPY: readonly { x: number; top: number; halfWidth: number }[] = [
  { x: 7, top: 7.15, halfWidth: 0.5 }, { x: 8.5, top: 7.9, halfWidth: 0.95 }, { x: 10, top: 8.6, halfWidth: 1.15 },
  { x: 12, top: 9.3, halfWidth: 1.25 }, { x: 14, top: 9.9, halfWidth: 1.28 }, { x: 16, top: 10.2, halfWidth: 1.25 },
  { x: 18, top: 10.1, halfWidth: 1.15 }, { x: 20, top: 9.65, halfWidth: 0.9 }, { x: 22, top: 9.6, halfWidth: 0.4 },
];

/** LEX outer edge (plan, right half) from its apex to where it meets the wing leading edge. */
export const HARV_LEX: readonly { x: number; y: number }[] = [
  { x: 11.3, y: 1.65 }, { x: 12, y: 2.15 }, { x: 13, y: 2.58 }, { x: 14, y: 2.78 }, { x: 15, y: 2.91 }, { x: 16, y: 3.01 },
  { x: 17, y: 3.14 }, { x: 18, y: 3.27 }, { x: 19, y: 3.44 }, { x: 20, y: 3.67 }, { x: 21, y: 3.83 }, { x: 22, y: 4.03 },
  { x: 23, y: 4.2 }, { x: 24, y: 4.33 }, { x: 25, y: 4.39 },
];

/** Stabilator (all-moving tail): traced leading/trailing edges, then scaled spanwise to the published span. */
export const HARV_STAB = {
  root: { y: 5.6, xLe: 46.4, xTe: 54.38 }, tip: { y: 10.35, xLe: 52.45, xTe: 55.85 }, zFt: 6.6, anhedralDeg: 2.3, tc: 0.04,
} as const;

/** Vertical tails: traced side-view outline (projected heights), canted 20° outboard about the root line. */
export const HARV_VTAIL = {
  root: { z: 8.6, xLe: 39.2, xTe: 48.0 }, tip: { z: 15.3, xLe: 45.9, xTe: 48.0 }, yRoot: 3.73, tc: 0.04,
} as const;

export const HARV_NOZZLES = { x: 54.2, length: 1.8, yCentre: 1.55, z: 6.7, radius: 1.3 } as const;

/** Exact wing trapezoid from published values: root chord, tip chord, semispan, LE x at y. */
export function harvWingGeometry() {
  const semi = HARV_PUBLISHED.spanFt / 2;
  const cr = (2 * HARV_PUBLISHED.wingAreaFt2) / (HARV_PUBLISHED.spanFt * (1 + HARV_WING.taper));
  const ct = cr * HARV_WING.taper;
  const t = Math.tan(toRad(deg(HARV_WING.sweepLeDeg)));
  const xLe = (y: number) => HARV_WING.rootLeX + y * t;
  const xTe = (y: number) => HARV_WING.rootLeX + cr + (y / semi) * (semi * t + ct - cr);
  const mac = (2 / 3) * cr * ((1 + HARV_WING.taper + HARV_WING.taper ** 2) / (1 + HARV_WING.taper));
  const yMac = (semi / 3) * ((1 + 2 * HARV_WING.taper) / (1 + HARV_WING.taper));
  return { semi, cr, ct, xLe, xTe, mac, yMac, quarterChordSweep: deg((Math.atan(t - (4 / HARV_PUBLISHED.aspectRatio) * 0.25 * ((1 - HARV_WING.taper) / (1 + HARV_WING.taper))) * 180) / Math.PI) };
}

/**
 * Wing + LEX planform for the vortex-lattice solver: the body between the LEX apex and the centreline is carried as
 * lifting surface (standard practice for planar VLM). Reference: published S, MAC, and moment reference 0.25 MAC.
 */
export function harvPlanform(): Planform {
  const w = harvWingGeometry();
  const yJoin = 4.49; // traced LEX/wing junction
  const stations: Station[] = [{ y: 0, xLe: HARV_LEX[0]?.x ?? 11.3, chord: w.xTe(0) - (HARV_LEX[0]?.x ?? 11.3) }];
  for (const p of HARV_LEX) stations.push({ y: p.y, xLe: p.x, chord: w.xTe(p.y) - p.x });
  stations.push({ y: yJoin, xLe: w.xLe(yJoin), chord: w.xTe(yJoin) - w.xLe(yJoin) });
  stations.push({ y: w.semi, xLe: w.xLe(w.semi), chord: w.ct });
  const xMacLe = w.xLe(w.yMac);
  return { name: "F/A-18 HARV wing + LEX", stations, sRef: HARV_PUBLISHED.wingAreaFt2, cRef: HARV_PUBLISHED.macFt, xRef: xMacLe + 0.25 * w.mac };
}

/**
 * Stabilator, right half: traced edges scaled spanwise to the published span, then extended inboard along the same
 * edges until the planform area of both halves equals the published 86.48 ft² (the body hides the inboard part).
 */
export function harvStab() {
  const k = HARV_PUBLISHED.stabSpanFt / 2 / HARV_STAB.tip.y;
  const y0 = HARV_STAB.root.y * k, y1 = HARV_STAB.tip.y * k;
  const leSlope = (HARV_STAB.tip.xLe - HARV_STAB.root.xLe) / (y1 - y0), teSlope = (HARV_STAB.tip.xTe - HARV_STAB.root.xTe) / (y1 - y0);
  const c1 = HARV_STAB.tip.xTe - HARV_STAB.tip.xLe, dc = teSlope - leSlope; // chord change per foot outboard
  // Half area from root yr to tip: (c(yr) + c1)/2 · u with c(yr) = c1 − dc·u, u = y1 − yr  →  −dc/2 u² + c1 u − A/2 = 0
  const half = HARV_PUBLISHED.stabAreaFt2 / 2, qa = -dc / 2, qb = c1;
  const u = (-qb + Math.sqrt(qb * qb + 4 * qa * half)) / (2 * qa);
  const yr = y1 - u;
  const at = (y: number) => ({ y, xLe: HARV_STAB.tip.xLe - leSlope * (y1 - y), xTe: HARV_STAB.tip.xTe - teSlope * (y1 - y) });
  return { root: at(yr), tip: at(y1), tracedRootY: y0, scale: k, zFt: HARV_STAB.zFt, anhedralDeg: HARV_STAB.anhedralDeg };
}

/** Cant of the vertical tails as a unit vector in the y–z plane (outboard, up). */
export function harvVtailCant(): { dy: number; dz: number; angle: Deg } {
  const a = toRad(deg(HARV_PUBLISHED.verticalTailCantDeg));
  return { dy: Math.sin(a), dz: Math.cos(a), angle: deg(HARV_PUBLISHED.verticalTailCantDeg) };
}

const BODY_X = HARV_BODY.map((b) => b.x);
const BODY_W = pchip(BODY_X, HARV_BODY.map((b) => b.halfWidth));
const BODY_T = pchip(BODY_X, HARV_BODY.map((b) => b.top));
const BODY_B = pchip(BODY_X, HARV_BODY.map((b) => b.bottom));

/**
 * Body section at x: monotone cubic (Fritsch–Carlson) through the traced stations, so the outline is smooth (continuous
 * slope) and passes exactly through every traced point without overshooting it. Clamped outside the table.
 */
export function bodyAt(x: number): BodySection {
  return { x, halfWidth: BODY_W(x), top: BODY_T(x), bottom: BODY_B(x) };
}

const CANOPY_X = HARV_CANOPY.map((c) => c.x);
const CANOPY_T = pchip(CANOPY_X, HARV_CANOPY.map((c) => c.top));
const CANOPY_W = pchip(CANOPY_X, HARV_CANOPY.map((c) => c.halfWidth));

/** Canopy crest and half width at x, smooth through the traced stations (same interpolation as the body). */
export function canopyAt(x: number): { x: number; top: number; halfWidth: number } {
  return { x, top: CANOPY_T(x), halfWidth: CANOPY_W(x) };
}
