/**
 * Measured error bands. The physics estimate is never bias-corrected: the band beside it says how far published
 * data have fallen from this estimate in the same flow regime. Residuals are scaled by the predicted lift so the band
 * grows with load: s = (CL_data − CL_model) / (S0 + |CL_model|).
 * Bands are split conformal intervals: with n residuals, the lower and upper bounds are the ⌊(n+1)·q⌋-th order
 * statistics, which cover a new exchangeable point with probability ≥ 1 − q_lo − (1 − q_hi) (Vovk et al. 2005).
 */

export type Regime = "attached" | "bursting" | "burst";
export const REGIMES: readonly Regime[] = ["attached", "bursting", "burst"];
export const S0 = 0.05;
export const NOMINAL = 0.9;

export function regimeOf(lost: number): Regime {
  if (!(lost >= 0 && lost <= 1)) throw new RangeError("lost share must be within [0, 1]");
  return lost === 0 ? "attached" : lost < 0.98 ? "bursting" : "burst";
}

export function scaledResidual(clData: number, clModel: number): number {
  return (clData - clModel) / (S0 + Math.abs(clModel));
}

export interface Band { readonly lo: number; readonly hi: number; readonly n: number }
export type Bands = Readonly<Record<Regime, Band>>;

/** Conformal bounds at the given coverage from scaled residuals; widest finite bound when n is small. */
export function conformalBand(residuals: readonly number[], coverage: number = NOMINAL): Band {
  if (!(coverage > 0 && coverage < 1)) throw new RangeError("coverage must be in (0, 1)");
  const r = residuals.filter(Number.isFinite).slice().sort((a, b) => a - b);
  const n = r.length;
  if (n === 0) return { lo: -1, hi: 1, n: 0 };
  const tail = (1 - coverage) / 2;
  const kLo = Math.max(0, Math.floor((n + 1) * tail) - 1);
  const kHi = Math.min(n - 1, Math.ceil((n + 1) * (1 - tail)) - 1);
  return { lo: Math.min(0, r[kLo] ?? 0), hi: Math.max(0, r[kHi] ?? 0), n };
}

/** Convert a scaled band into absolute CL bounds around an estimate. Extrapolation doubles the width. */
export function clBounds(clModel: number, band: Band, extrapolated: boolean): { lo: number; hi: number } {
  const k = (S0 + Math.abs(clModel)) * (extrapolated ? 2 : 1);
  return { lo: clModel + band.lo * k, hi: clModel + band.hi * k };
}

export function bandsFrom(samples: readonly { regime: Regime; s: number }[], coverage: number = NOMINAL): Bands {
  const pick = (g: Regime) => conformalBand(samples.filter((x) => x.regime === g).map((x) => x.s), coverage);
  return { attached: pick("attached"), bursting: pick("bursting"), burst: pick("burst") };
}
