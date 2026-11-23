import data from "../data/f16-tp1538.json";

/**
 * F-16 whole-aircraft longitudinal aerodynamics measured in NASA Langley's wind tunnels: NASA TP-1538 (Nguyen et al.,
 * 1979), Table III, zero sideslip, assembled exactly as NASA's Appendix B buildup:
 *
 *   Cx,t = Cx(α,δh) + ΔCx,lef·(1 − δlef/25) + (q c̄ / 2V)·[Cxq(α) + ΔCxq,lef(α)·(1 − δlef/25)]
 *   Cz,t = Cz(α,δh) + ΔCz,lef·(1 − δlef/25) + (q c̄ / 2V)·[Czq(α) + ΔCzq,lef(α)·(1 − δlef/25)]
 *   Cm,t = Cm(α,δh)·η(δh) + Cz,t·(xcg,ref − xcg) + ΔCm,lef·(1 − δlef/25) + (q c̄ / 2V)·[Cmq + ΔCmq,lef·(1 − δlef/25)] + ΔCm(α)
 *
 * with ΔC,lef = C,lef(α) − C(α, δh = 0). Body axes: x forward, z down; Cx, Cz are force coefficients along them.
 * Not included (stated): the deep-stall increment ΔCm,ds, the speed brake (retracted), sideslip and lateral terms.
 * Tables are interpolated linearly and clamped at their edges (no extrapolation); the flap increments exist to 45°.
 * Machine-readable tables: isrlab/F16-Model-Matlab (MIT, © 2023 Raktim Bhattacharya), checked against the NASA scans.
 */
export const F16_TABLES = data;
export const F16_ALPHA_DEG: readonly number[] = data.alpha1_deg;
export const F16_ALPHA_LEF_DEG: readonly number[] = data.alpha2_deg;
export const F16_DH_DEG: readonly number[] = data.dh_deg;
/** NASA's reference centre of gravity for the tables, fraction of c̄ (TP-1538 Table I). */
export const F16_XCG_REF = 0.35;
export const F16_DH_LIMIT_DEG = 25;
export const F16_LEF_MAX_DEG = 25;

function bracket(xs: readonly number[], x: number): [number, number] {
  const n = xs.length, c = Math.min(xs[n - 1] ?? 0, Math.max(xs[0] ?? 0, x));
  for (let i = 0; i + 1 < n; i++) if (c <= (xs[i + 1] ?? 0)) return [i, (c - (xs[i] ?? 0)) / ((xs[i + 1] ?? 1) - (xs[i] ?? 0))];
  return [n - 2, 1];
}
/** Linear interpolation in a 1-D table, clamped. */
export function interp1(xs: readonly number[], ys: readonly number[], x: number): number {
  const [i, u] = bracket(xs, x);
  return (ys[i] ?? 0) + ((ys[i + 1] ?? 0) - (ys[i] ?? 0)) * u;
}
/** Bilinear interpolation in a [α][δh] table, clamped. */
export function interpAlphaDh(t: readonly (readonly number[])[], alphaDeg: number, dhDeg: number): number {
  const [i, u] = bracket(F16_ALPHA_DEG, alphaDeg), [j, v] = bracket(F16_DH_DEG, dhDeg);
  const a = t[i] ?? [], b = t[i + 1] ?? [];
  const lo = (a[j] ?? 0) + ((a[j + 1] ?? 0) - (a[j] ?? 0)) * v, hi = (b[j] ?? 0) + ((b[j + 1] ?? 0) - (b[j] ?? 0)) * v;
  return lo + (hi - lo) * u;
}

export interface F16Coefficients {
  readonly cx: number; readonly cz: number; readonly cm: number;
  /** Lift and drag coefficients in wind axes: CL = −Cz cos α + Cx sin α, CD = −Cx cos α − Cz sin α. */
  readonly cl: number; readonly cd: number;
}

/**
 * Whole-aircraft coefficients. alphaDeg angle of attack, dhDeg stabilator (positive trailing edge down), lefDeg
 * leading-edge flap (0–25°), qHat = q c̄ / (2V) with q the pitch rate (rad/s), xcg centre of gravity (fraction of c̄).
 */
export function f16Coefficients(alphaDeg: number, dhDeg: number, lefDeg: number, qHat: number, xcg = F16_XCG_REF): F16Coefficients {
  const T = F16_TABLES, dlef = 1 - Math.min(F16_LEF_MAX_DEG, Math.max(0, lefDeg)) / F16_LEF_MAX_DEG;
  const dh = Math.min(F16_DH_LIMIT_DEG, Math.max(-F16_DH_LIMIT_DEG, dhDeg));
  const a1 = (ys: readonly number[]) => interp1(F16_ALPHA_DEG, ys, alphaDeg), a2 = (ys: readonly number[]) => interp1(F16_ALPHA_LEF_DEG, ys, alphaDeg);
  const cx0 = interpAlphaDh(T.Cx, alphaDeg, 0), cz0 = interpAlphaDh(T.Cz, alphaDeg, 0), cm0 = interpAlphaDh(T.Cm, alphaDeg, 0);
  const cx = interpAlphaDh(T.Cx, alphaDeg, dh) + (a2(T.Cx_lef) - cx0) * dlef + qHat * (a1(T.Cxq) + a2(T.deltaCxq_lef) * dlef);
  const cz = interpAlphaDh(T.Cz, alphaDeg, dh) + (a2(T.Cz_lef) - cz0) * dlef + qHat * (a1(T.Czq) + a2(T.deltaCzq_lef) * dlef);
  const cm = interpAlphaDh(T.Cm, alphaDeg, dh) * interp1(F16_DH_DEG, T.eta_el, dh) + cz * (F16_XCG_REF - xcg)
    + (a2(T.Cm_lef) - cm0) * dlef + qHat * (a1(T.Cmq) + a2(T.deltaCmq_lef) * dlef) + a1(T.deltaCm);
  const a = (alphaDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  return { cx, cz, cm, cl: -cz * ca + cx * sa, cd: -cx * ca - cz * sa };
}

/**
 * Leading-edge flap schedule, NASA TP-1538 Appendix A: δlef = 1.38·[(2s + 7.25)/(s + 7.25)]·α − 9.05·q̄/ps + 1.45 (deg),
 * through a 0.136 s first-order actuator with a 25°/s rate limit, 0–25°. This function is the static part (the lead
 * filter at steady state is 1); the live simulation runs the filter and the actuator.
 */
export const LEF_FILTER_RAD_S = 7.25, LEF_TAU_S = 0.136, LEF_RATE_DEG_S = 25;
export function f16LefScheduleDeg(alphaDeg: number, qbar: number, ps: number): number {
  return Math.min(F16_LEF_MAX_DEG, Math.max(0, 1.38 * alphaDeg - (9.05 * qbar) / ps + 1.45));
}
