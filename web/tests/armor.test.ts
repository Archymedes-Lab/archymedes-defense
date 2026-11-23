import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { cunniffRetention, gamma0, ppRetention, ppToCunniffRatio, psiMax } from "../lib/armor/models";
import { type BenchCell, Phi, bench, fitProbit, mulberry32, simulateTest } from "../lib/armor/planner";

setDefaultTimeout(60_000); // Monte Carlo claims run 2,000 trials per point: a time budget, not a weaker check

// Fixtures: NIST 2020, J. Res. NIST 125:026, Tables 1 and 2 (exact printed values, 2-3 significant figures).
const AP = 6.36e-5, MP = 0.008;
describe("NIST 2020 Table 1", () => {
  test("Γ0 for PPTA and PBO", () => {
    expect(gamma0(2.625, AP, MP)).toBeCloseTo(0.0209, 4);
    expect(gamma0(2.273, AP, MP)).toBeCloseTo(0.0181, 4);
  });
  test("ψmax grid", () => {
    const rows: [number, number, number][] = [[1.25, 3.98, 4.27], [1.5, 3.34, 3.58], [1.75, 2.88, 3.09], [2, 2.55, 2.72]];
    for (const [theta, ppta, pbo] of rows) {
      expect(Math.abs(psiMax(theta, 0.0209) - ppta)).toBeLessThan(0.011);
      expect(Math.abs(psiMax(theta, 0.0181) - pbo)).toBeLessThan(0.011);
    }
  });
});

describe("NIST 2020 Table 2 (Eq. 13, εnew = 0.03)", () => {
  const psis = [2.5, 3, 3.5, 4, 4.5];
  const table: [number, number[]][] = [
    [0.10, [1.33, 1.35, 1.36, 1.37, 1.37]], [0.05, [1.13, 1.14, 1.14, 1.14, 1.15]], [0.04, [1.07, 1.08, 1.08, 1.08, 1.08]],
    [0.03, [1, 1, 1, 1, 1]], [0.02, [0.9, 0.9, 0.9, 0.9, 0.9]], [0.01, [0.76, 0.75, 0.75, 0.74, 0.74]],
  ];
  test("every printed cell within rounding", () => {
    for (const [ea, row] of table) row.forEach((v, i) => expect(Math.abs(ppToCunniffRatio(ea, 0.03, psis[i]!) - v)).toBeLessThan(0.006));
  });
});

describe("retention invariants", () => {
  test("unchanged material keeps 100%", () => {
    expect(cunniffRetention(1, 1)).toBeCloseTo(100, 9);
    expect(ppRetention(1, 0.03, 0.03, 3)).toBeCloseTo(100, 9);
  });
  test("weaker fibre never retains more", () => {
    expect(cunniffRetention(0.8, 1)).toBeLessThan(cunniffRetention(0.9, 1));
  });
  test("lower strain: Phoenix-Porwal more conservative than Cunniff (paper statement)", () => {
    expect(ppRetention(0.9, 0.025, 0.03, 3)).toBeLessThan(cunniffRetention(0.9, 0.025 / 0.03));
  });
  test("invalid inputs refused", () => {
    expect(() => gamma0(-1, AP, MP)).toThrow();
    expect(() => psiMax(0.5, 0.02)).toThrow();
  });
});

// Benchmark: Johnson et al. 2014, IEEE Access 2:1442. Probit truth μT 2400, σT 75/150, ±10 ft/s set-point error, ≤ 50 shots,
// 1000 sims per cell over μG ∈ {μT−2σT, μT, μT+2σT} × σG/σT ∈ {1/3, 1/2, 1, 2, 3}. Their "V50 error" is |median signed
// error| per cell; the grand mean over all methods was ≈ 12.5 ft/s with ≈ 10.5 shots (break separation ≈ 8.7).
const GRID: BenchCell[] = [75, 150].flatMap((s) => [-2, 0, 2].flatMap((k) => [1 / 3, 0.5, 1, 2, 3].map((r) => ({ truth: { mu: 2400, sigma: s }, guess: { mu: 2400 + k * s, sigma: r * s } }))));

describe("3POD + probit + break separation reproduces the DoD benchmark", () => {
  test("median shots ≤ 12, mean |median V50 error| ≤ 12.5 ft/s, an estimate in > 98% of tests", () => {
    const r = bench("3pod", GRID, 1000, { maxShots: 50, setPointError: 10, stop: "break" }, 2014);
    expect(r.medianShots).toBeLessThanOrEqual(12);
    expect(r.meanAbsMedianBias).toBeLessThanOrEqual(12.5);
    expect(r.estimated).toBeGreaterThan(0.98);
  });
});

describe("NIJ 0101.07 §9.5 up-and-down follows the standard's steps", () => {
  test("first shot at the reference; −100 after a CP until the first reversal, then ±75, then ±50", () => {
    // Deterministic truth (σ tiny) at 2310: shots above perforate (CP), below stop (PP). Worked by hand from §9.5 Table 3:
    // 2400 CP → −100 → 2300 PP (1st reversal) → +75 → 2375 CP (2nd) → −50 → 2325 CP → −50 → 2275 PP → +50 → 2325.
    const r = simulateTest("nij", { mu: 2310, sigma: 1e-6 }, { mu: 2400, sigma: 100 }, mulberry32(1), { maxShots: 6, stop: "fixed", minShots: 6, setPointError: 0 });
    expect(r.history.map((s) => Math.round(s.v))).toEqual([2400, 2300, 2375, 2325, 2275, 2325]);
    expect(r.history.map((s) => s.perforated)).toEqual([true, false, true, true, false, true]);
  });
});

describe("probit estimation", () => {
  test("recovers known parameters from a large sample", () => {
    const rng = mulberry32(9), h = Array.from({ length: 4000 }, () => { const v = 2200 + rng() * 400; return { v, perforated: rng() < Phi((v - 2400) / 75) }; });
    const f = fitProbit(h, { mu: 2300, sigma: 50 });
    expect(Math.abs(f.mu - 2400)).toBeLessThan(6);
    expect(Math.abs(f.sigma - 75)).toBeLessThan(8);
  });
  test("refuses an estimate without overlapping responses and no prior", () => {
    expect(fitProbit([{ v: 2300, perforated: false }, { v: 2500, perforated: true }], { mu: 2400, sigma: 75 }).ok).toBe(false);
  });
  test("deterministic for a seed", () => {
    const a = simulateTest("bayes", { mu: 2400, sigma: 75 }, { mu: 2350, sigma: 75 }, mulberry32(5), { maxShots: 12, stop: "fixed", setPointError: 10 });
    const b = simulateTest("bayes", { mu: 2400, sigma: 75 }, { mu: 2350, sigma: 75 }, mulberry32(5), { maxShots: 12, stop: "fixed", setPointError: 10 });
    expect(a).toEqual(b);
  });
});

describe("physics-prior design: claims we make", () => {
  const cells = (s: number, off: number): BenchCell[] => [-1, 1].map((sg) => ({ truth: { mu: 2400, sigma: s }, guess: { mu: 2400 + sg * off * s, sigma: s }, prior: { mu: 2400 + sg * off * s, sd: s, sigma: s, sigmaLogSd: 0.7 } }));
  const fixed = (n: number) => ({ maxShots: n, minShots: n, stop: "fixed" as const, setPointError: 10 });
  test("an estimate after 6 shots in every test, where the NIJ up-and-down often has none", () => {
    for (const s of [75, 150]) {
      expect(bench("bayes", cells(s, 0), 800, fixed(6), 1).estimated).toBe(1);
      expect(bench("nij", cells(s, 0), 800, fixed(6), 1).estimated).toBeLessThan(0.8);
    }
  });
  test("with a correct prior, at least as accurate as 3POD for the same shots (2,000 tests per point)", () => {
    for (const s of [75, 150]) for (const n of [8, 10, 15]) {
      expect(bench("bayes", cells(s, 0), 2000, fixed(n), n).medianAbsError).toBeLessThanOrEqual(bench("3pod", cells(s, 0), 2000, fixed(n), n).medianAbsError);
    }
  });
  test("a grossly wrong prior (off by 10σ) is escaped: estimate in every test, bias ≤ 0.25σ by 20 shots", () => {
    for (const s of [75, 150]) {
      const r = bench("bayes", cells(s, 10), 800, fixed(20), 21);
      expect(r.estimated).toBe(1);
      expect(r.meanAbsMedianBias).toBeLessThanOrEqual(0.25 * s);
    }
  });
  test("a prior off by 2σ does not bias the answer once 20 shots are in (≤ 0.1σ)", () => {
    for (const s of [75, 150]) expect(bench("bayes", cells(s, 2), 800, fixed(20), 20).meanAbsMedianBias).toBeLessThanOrEqual(0.1 * s);
  });
});
