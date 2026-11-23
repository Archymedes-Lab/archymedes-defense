/**
 * Monotone piecewise cubic Hermite interpolation (Fritsch & Carlson 1980, SIAM J. Numer. Anal. 17(2)).
 * Passes exactly through every knot, has a continuous first derivative, and never overshoots: between two knots the
 * curve stays between their values, so traced outlines are smoothed without inventing bulges. Clamped outside.
 */
export function pchip(xs: readonly number[], ys: readonly number[]): (x: number) => number {
  const n = xs.length;
  if (n !== ys.length || n < 2) throw new RangeError("pchip needs as many values as knots, at least two");
  for (let i = 1; i < n; i++) if (!((xs[i] ?? 0) > (xs[i - 1] ?? 0))) throw new RangeError("pchip knots must increase strictly");
  const h: number[] = [], d: number[] = [];
  for (let i = 0; i + 1 < n; i++) { const hi = (xs[i + 1] ?? 0) - (xs[i] ?? 0); h.push(hi); d.push(((ys[i + 1] ?? 0) - (ys[i] ?? 0)) / hi); }
  const m: number[] = new Array<number>(n).fill(0);
  for (let i = 1; i + 1 < n; i++) {
    const a = d[i - 1] ?? 0, b = d[i] ?? 0;
    if (a * b <= 0) { m[i] = 0; continue; }
    const w1 = 2 * (h[i] ?? 0) + (h[i - 1] ?? 0), w2 = (h[i] ?? 0) + 2 * (h[i - 1] ?? 0);
    m[i] = (w1 + w2) / (w1 / a + w2 / b); // weighted harmonic mean: keeps the slope inside the monotone region
  }
  // One-sided three-point end slopes, limited so the end intervals stay monotone (Moler, Numerical Computing with MATLAB).
  const end = (h0: number, h1: number, d0: number, d1: number) => {
    const s = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (Math.sign(s) !== Math.sign(d0)) return 0;
    if (Math.sign(d0) !== Math.sign(d1) && Math.abs(s) > Math.abs(3 * d0)) return 3 * d0;
    return s;
  };
  if (n === 2) { m[0] = d[0] ?? 0; m[1] = d[0] ?? 0; }
  else {
    m[0] = end(h[0] ?? 1, h[1] ?? 1, d[0] ?? 0, d[1] ?? 0);
    m[n - 1] = end(h[n - 2] ?? 1, h[n - 3] ?? 1, d[n - 2] ?? 0, d[n - 3] ?? 0);
  }
  return (x: number) => {
    if (x <= (xs[0] ?? 0)) return ys[0] ?? 0;
    if (x >= (xs[n - 1] ?? 0)) return ys[n - 1] ?? 0;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if ((xs[mid] ?? 0) <= x) lo = mid; else hi = mid; }
    const hk = h[lo] ?? 1, t = (x - (xs[lo] ?? 0)) / hk, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * (ys[lo] ?? 0) + (t3 - 2 * t2 + t) * hk * (m[lo] ?? 0)
      + (-2 * t3 + 3 * t2) * (ys[lo + 1] ?? 0) + (t3 - t2) * hk * (m[lo + 1] ?? 0);
  };
}
