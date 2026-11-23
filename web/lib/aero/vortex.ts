import corpus from "../data/aero-corpus.json";
import { type Deg, type Rad, deg, rad, toDeg } from "./units";
import type { VlmResult } from "./vlm";

/**
 * Leading-edge vortex lift by the Polhamus suction analogy (NASA TN D-3767, 1966) with vortex-breakdown loss from the
 * Wentz & Kohlman (1968) breakdown map. Total lift at angle α:
 *   CL = Kp sin α cos²α  +  Kv sin α |sin α| cos α · (1 − lost)
 * where Kv = (Kp − Kp² Ki) Σ share_j / cos Λ_j is the suction-analogy constant and "lost" is the thrust share of the
 * strips whose leading-edge vortex has burst upstream of them.
 */

export interface BreakdownRow { readonly sweepDeg: number; readonly alphaDeg: readonly number[] }
export interface BreakdownMap { readonly positions: readonly number[]; readonly rows: readonly BreakdownRow[]; readonly sigmaAlphaDeg: number }

/** Wentz & Kohlman Fig. 4.1.1; gaps (55° near the trailing edge) are filled from the 60° row's offset and flagged. */
export function breakdownMap(): BreakdownMap {
  const b = corpus.breakdown;
  const rows: BreakdownRow[] = b.rows.map((r) => ({ sweepDeg: r.sweepDeg, alphaDeg: r.alphaDeg.map((a) => (a === null ? Number.NaN : a)) }));
  const r60 = rows.find((r) => r.sweepDeg === 60);
  const filled = rows.map((r) => {
    const known = r.alphaDeg.map((a, k) => ({ a, k })).filter((v) => Number.isFinite(v.a));
    const first = known[0];
    if (first === undefined || first.k === 0 || r60 === undefined) return r;
    const offset = first.a - (r60.alphaDeg[first.k] ?? 0);
    return { sweepDeg: r.sweepDeg, alphaDeg: r.alphaDeg.map((a, k) => (Number.isFinite(a) ? a : (r60.alphaDeg[k] ?? 0) + offset)) };
  });
  return { positions: b.positions, rows: filled, sigmaAlphaDeg: b.sigmaAlphaDeg };
}

export const MAP = breakdownMap();
/**
 * Sweep range where both the breakdown map is fully measured (60–80°, Wentz & Kohlman Fig. 4.1.1) and the lift data
 * agree with the model before breakdown. 50–55° wings separate earlier than the map implies: they stay outside.
 */
export const SWEEP_VALIDATED: readonly [number, number] = [60, 80];

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

/** Angle of attack at which the vortex of a leading edge with this sweep bursts at chord position ξ (0 = TE, 1 = apex). */
export function breakdownAlpha(sweep: Rad, xi: number, map: BreakdownMap = MAP): { alpha: Deg; extrapolated: boolean } {
  const s = toDeg(sweep);
  const rows = map.rows, lo = rows[0], hi = rows[rows.length - 1];
  if (lo === undefined || hi === undefined) throw new Error("empty breakdown map");
  const x = Math.min(1, Math.max(0, xi));
  const along = (r: BreakdownRow) => {
    const ps = map.positions;
    for (let k = 0; k + 1 < ps.length; k++) {
      const p0 = ps[k] ?? 0, p1 = ps[k + 1] ?? 1;
      if (x <= p1) return lerp(r.alphaDeg[k] ?? 0, r.alphaDeg[k + 1] ?? 0, (x - p0) / (p1 - p0));
    }
    return r.alphaDeg[r.alphaDeg.length - 1] ?? 0;
  };
  if (s <= lo.sweepDeg) {
    // Below the mapped range the vortex is weaker and bursts earlier: shift down by the 55→60° slope, floor at 2°.
    const next = rows[1] ?? lo;
    const slope = (along(next) - along(lo)) / Math.max(1e-9, next.sweepDeg - lo.sweepDeg);
    return { alpha: deg(Math.max(2, along(lo) - slope * (lo.sweepDeg - s))), extrapolated: s < lo.sweepDeg - 1e-9 };
  }
  if (s >= hi.sweepDeg) return { alpha: deg(along(hi)), extrapolated: s > hi.sweepDeg + 1e-9 };
  for (let k = 0; k + 1 < rows.length; k++) {
    const a = rows[k], b = rows[k + 1];
    if (a !== undefined && b !== undefined && s <= b.sweepDeg) {
      return { alpha: deg(lerp(along(a), along(b), (s - a.sweepDeg) / (b.sweepDeg - a.sweepDeg))), extrapolated: false };
    }
  }
  return { alpha: deg(along(hi)), extrapolated: false };
}

export interface VortexModel {
  readonly kp: number;
  readonly kv: number;
  /** Per strip: thrust share, sweep, breakdown angle at its leading edge. */
  readonly strips: readonly { readonly share: number; readonly sweep: Rad; readonly xi: number; readonly alphaBd: Deg; readonly xLe: number }[];
  readonly extrapolatedSweep: boolean;
  readonly xVortex: number; // thrust-weighted x of the leading edge (where vortex lift acts)
}

export function vortexModel(v: VlmResult): VortexModel {
  const root = v.props;
  const s0 = v.strips[0];
  const xApex = s0 === undefined ? 0 : s0.xLe;
  const centre = { xLe: xApex, chord: root.rootChord };
  // Chord position of each strip's leading edge on the centreline chord (0 at the centreline trailing edge).
  const firstStation = { x: centre.xLe, te: centre.xLe + centre.chord };
  let invCos = 0, xv = 0, extrapolated = false;
  const strips = v.strips.map((s, j) => {
    const share = v.thrustShare[j] ?? 0;
    const sweep = rad(s.sweepLe);
    invCos += share / Math.cos(sweep);
    xv += share * s.xLe;
    const xi = (firstStation.te - s.xLe) / Math.max(1e-12, firstStation.te - firstStation.x);
    const bd = breakdownAlpha(sweep, xi);
    if (bd.extrapolated && share > 0.02) extrapolated = true;
    return { share, sweep, xi, alphaBd: bd.alpha, xLe: s.xLe };
  });
  const kt = v.kp - v.kp * v.kp * v.ki;
  return { kp: v.kp, kv: kt * invCos, strips, extrapolatedSweep: extrapolated, xVortex: xv };
}

export interface PolarPoint {
  readonly alpha: Deg;
  readonly cl: number; readonly clPotential: number; readonly clVortex: number; readonly clNoBreakdown: number;
  readonly cd: number; readonly cm: number;
  /** Share of the leading-edge vortex lift lost to breakdown (0 none, 1 all). */
  readonly lost: number;
  /** Chord position of the burst point on the centreline chord (1 = apex, 0 = trailing edge; −1 when none). */
  readonly burstXi: number;
}

/** Lift, drag (sharp edges: no leading-edge suction) and pitching moment at angle α. */
/** Share of a strip's vortex lift that survives once the vortex has burst upstream of it (calibrated, see aero-calibration.json). */
export const DEFAULT_RETAINED = 0.37;

/**
 * Share of a strip's vortex that has burst at angle |α|: a step at the strip's breakdown angle when ramp = 0 (the
 * original model), otherwise a smoothstep over [αbd − ramp/2, αbd + ramp/2] degrees. Published delta-wing data show
 * the lift falling gradually while the burst point travels forward (ICAS 2000-221; SAE 910991).
 */
export function burstFraction(absAlphaDeg: number, alphaBdDeg: number, rampDeg: number): number {
  if (!(rampDeg >= 0)) throw new RangeError("ramp must be ≥ 0");
  if (rampDeg === 0) return absAlphaDeg >= alphaBdDeg ? 1 : 0;
  const u = Math.min(1, Math.max(0, (absAlphaDeg - (alphaBdDeg - rampDeg / 2)) / rampDeg));
  return u * u * (3 - 2 * u);
}

/** Breakdown ramp width in degrees used by default (0 = the original step model; see aero-validation.json). */
export const DEFAULT_RAMP = 0;

export function polarPoint(v: VlmResult, m: VortexModel, alpha: Rad, cd0 = 0.006, retained = DEFAULT_RETAINED,
  ramp = DEFAULT_RAMP): PolarPoint {
  const a = toDeg(alpha);
  const sa = Math.sin(alpha), ca = Math.cos(alpha);
  const clP = m.kp * sa * ca * ca;
  const vortexFull = m.kv * sa * Math.abs(sa) * ca;
  let lost = 0, burstXi = -1;
  for (const s of m.strips) {
    const f = burstFraction(Math.abs(a), s.alphaBd, ramp);
    if (f > 0) { lost += s.share * f; burstXi = Math.max(burstXi, s.xi); }
  }
  lost = Math.min(1, lost);
  const clV = vortexFull * (1 - lost * (1 - retained));
  const cl = clP + clV;
  const cRef = v.props.cRef, xRef = v.props.xRef;
  // Vortex lift acts along the leading edge ahead of the burst point; use the unburst thrust-weighted x.
  let xv = 0, w = 0;
  for (const s of m.strips) { const k = s.share * (1 - burstFraction(Math.abs(a), s.alphaBd, ramp) * (1 - retained)); xv += k * s.xLe; w += k; }
  const xVortex = w > 0 ? xv / w : m.xVortex;
  // Lamar & Gloss 1975 (NASA TN D-7921): vortex lift acts at the centroid of the leading-edge suction it replaces.
  const cm = -(clP * (v.xCpPotential - xRef) + clV * (xVortex - xRef)) / cRef;
  const cd = cd0 + cl * Math.tan(alpha);
  return { alpha: a, cl, clPotential: clP, clVortex: clV, clNoBreakdown: clP + vortexFull, cd, cm, lost, burstXi };
}

export function polar(v: VlmResult, m: VortexModel, alphas: readonly Rad[], cd0?: number, retained?: number, ramp?: number): PolarPoint[] {
  return alphas.map((al) => polarPoint(v, m, al, cd0, retained, ramp));
}
