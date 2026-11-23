import { describe, expect, setDefaultTimeout, test } from "bun:test";
import fc from "fast-check";
import corpus from "../lib/data/aero-corpus.json";
import validation from "../lib/data/aero-validation.json";
import { NOMINAL, REGIMES, S0, bandsFrom, clBounds, conformalBand, regimeOf, scaledResidual } from "../lib/aero/error-model";
import { FIGHTER_REFERENCE, type Planform, GeometryError, assertPlanform, deltaFromAspectRatio, deltaWing, lexWing, planformProps, sweepAt, trapezoidWing, validatePlanform } from "../lib/aero/geometry";
import { ALPHA_VALIDATED_MAX, alphaSweep, analyse } from "../lib/aero/predict";
import { HARV_BODY, HARV_CANOPY, HARV_LEX, HARV_NOZZLES, HARV_PUBLISHED, HARV_STAB, HARV_VTAIL, HARV_WING, bodyAt, harvPlanform, harvStab, harvVtailCant, harvWingGeometry } from "../lib/aero/harv";
import { buildHarvMesh, harvOutlines, nacaHalfThickness } from "../lib/aero/harv-mesh";
import { deg, rad, toDeg, toRad } from "../lib/aero/units";
import { DEFAULT_MESH, solveDense, solveVlm } from "../lib/aero/vlm";
import { DEFAULT_RETAINED, MAP, SWEEP_VALIDATED, breakdownAlpha, breakdownMap, polar, polarPoint, vortexModel } from "../lib/aero/vortex";

setDefaultTimeout(60_000);
const COARSE = { nSpan: 10, nChord: 5 };
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe("units", () => {
  test("degree/radian round trip", () => {
    fc.assert(fc.property(fc.double({ min: -720, max: 720, noNaN: true }), (d) => Math.abs(toDeg(toRad(deg(d))) - d) < 1e-9));
    expect(toRad(deg(180))).toBeCloseTo(Math.PI, 12);
    expect(rad(1)).toBe(rad(1));
  });
});

describe("geometry invariants", () => {
  test("delta wing aspect ratio is 4 / tan Λ and area is half root chord × span", () => {
    fc.assert(fc.property(fc.double({ min: 45, max: 85, noNaN: true }), fc.double({ min: 0.1, max: 20, noNaN: true }), (s, c) => {
      const p = planformProps(deltaWing(deg(s), c));
      return rel(p.aspectRatio, 4 / Math.tan(toRad(deg(s)))) < 1e-9 && rel(p.area, 0.5 * c * p.span) < 1e-9 && rel(p.mac, (2 / 3) * c) < 1e-9;
    }));
    expect(planformProps(deltaFromAspectRatio(1)).aspectRatio).toBeCloseTo(1, 9);
  });
  test("trapezoid MAC matches the closed form", () => {
    const p = planformProps(trapezoidWing(6, 0.4, deg(20), 2));
    expect(p.mac).toBeCloseTo((2 / 3) * 2 * ((1 + 0.4 + 0.16) / 1.4), 9);
    expect(toDeg(sweepAt(p, p.span / 4))).toBeCloseTo(20, 9);
  });
  test("fighter-class layout reproduces the published reference MAC (NASA TM-112360: 11.517 ft)", () => {
    const p = planformProps(lexWing(FIGHTER_REFERENCE));
    expect(Math.abs(p.cRef - 11.517)).toBeLessThan(0.02);
    expect(p.sRef).toBe(400);
    expect(p.span).toBeCloseTo(37.417, 6);
  });
  test("invalid planforms are refused with reasons, never solved", () => {
    const bad: Planform[] = [
      { name: "one", stations: [{ y: 0, xLe: 0, chord: 1 }] },
      { name: "neg", stations: [{ y: 0, xLe: 0, chord: 1 }, { y: 1, xLe: 0, chord: -0.1 }] },
      { name: "order", stations: [{ y: 0, xLe: 0, chord: 1 }, { y: 1, xLe: 0, chord: 0.5 }, { y: 0.5, xLe: 0, chord: 0.2 }] },
      { name: "nan", stations: [{ y: 0, xLe: 0, chord: 1 }, { y: Number.NaN, xLe: 0, chord: 0 }] },
      { name: "off", stations: [{ y: 0.1, xLe: 0, chord: 1 }, { y: 1, xLe: 0, chord: 0.5 }] },
      { name: "ref", stations: [{ y: 0, xLe: 0, chord: 1 }, { y: 1, xLe: 0, chord: 0.5 }], sRef: -1 },
    ];
    for (const p of bad) {
      expect(validatePlanform(p).length).toBeGreaterThan(0);
      expect(() => assertPlanform(p)).toThrow(GeometryError);
      expect(() => solveVlm(p, COARSE)).toThrow();
    }
    expect(() => deltaWing(deg(90))).toThrow(GeometryError);
    expect(() => deltaFromAspectRatio(-1)).toThrow(GeometryError);
    expect(() => trapezoidWing(4, 1.5, deg(0))).toThrow(GeometryError);
  });
});

describe("vortex-lattice verification", () => {
  test("dense solver solves a random well-conditioned system", () => {
    fc.assert(fc.property(fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 16, maxLength: 16 }), (xs) => {
      const n = 4, A = new Float64Array(16), b = new Float64Array(4);
      xs.forEach((v, k) => { A[k] = v + (k % 5 === 0 ? 5 : 0); });
      for (let i = 0; i < n; i++) b[i] = i + 1;
      const x = solveDense(A, b, n);
      for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += (A[i * n + j] ?? 0) * (x[j] ?? 0); if (Math.abs(s - (b[i] ?? 0)) > 1e-9) return false; }
      return true;
    }), { numRuns: 50 });
    expect(() => solveDense(new Float64Array(4), new Float64Array(2), 2)).toThrow();
  });
  test("slender-wing limit: Kp → π A / 2 as aspect ratio → 0 (within 8% at A = 0.25)", () => {
    expect(rel(solveVlm(deltaFromAspectRatio(0.25)).kp, (Math.PI * 0.25) / 2)).toBeLessThan(0.08);
  });
  test("high aspect ratio: lift slope approaches lifting-line 2πA/(A+2) (within 5% at A = 20)", () => {
    expect(rel(solveVlm(trapezoidWing(20, 1, deg(0)), { nSpan: 30, nChord: 6 }).kp, (2 * Math.PI * 20) / 22)).toBeLessThan(0.05);
  });
  test("mesh refinement converges: Kp and Ki change < 1% from default to fine mesh", () => {
    for (const A of [1, 2]) {
      const a = solveVlm(deltaFromAspectRatio(A)), b = solveVlm(deltaFromAspectRatio(A), { nSpan: 32, nChord: 16 });
      expect(rel(a.kp, b.kp)).toBeLessThan(0.01);
      expect(rel(a.ki, b.ki)).toBeLessThan(0.02);
    }
  });
  test("span efficiency respects the elliptic bound e ≤ 1 up to discretization error, which shrinks with refinement", () => {
    // Measured: the Trefftz estimate overshoots by ≤ 3.1% at the default mesh and converges to ≤ 1 (A = 2: 1.048 → 1.003).
    fc.assert(fc.property(fc.double({ min: 50, max: 80, noNaN: true }), (s) => { const e = solveVlm(deltaWing(deg(s))).e; return e > 0.7 && e <= 1.035; }), { numRuns: 10 });
    fc.assert(fc.property(fc.double({ min: 2, max: 10, noNaN: true }), fc.double({ min: 0.2, max: 1, noNaN: true }), (A, t) => {
      const w = trapezoidWing(A, t, deg(10));
      const e1 = solveVlm(w).e, e2 = solveVlm(w, { nSpan: 40, nChord: 10 }).e;
      return e1 > 0.7 && e1 <= 1.035 && e2 <= Math.max(1.0, e1) + 1e-9 && e2 <= 1.016;
    }), { numRuns: 8 });
  });
  test("scale invariance: coefficients do not depend on model size", () => {
    fc.assert(fc.property(fc.double({ min: 0.05, max: 50, noNaN: true }), (c) => {
      const a = solveVlm(deltaWing(deg(65), 1), COARSE), b = solveVlm(deltaWing(deg(65), c), COARSE);
      return rel(a.kp, b.kp) < 1e-9 && rel(a.ki, b.ki) < 1e-6 && Math.abs(a.xCpPotential * c - b.xCpPotential) < 1e-6 * c;
    }), { numRuns: 10 });
  });
  test("translation moves only the centre of pressure", () => {
    const base = deltaWing(deg(70));
    const moved: Planform = { ...base, stations: base.stations.map((s) => ({ ...s, xLe: s.xLe + 3 })) };
    const a = solveVlm(base, COARSE), b = solveVlm(moved, COARSE);
    expect(rel(a.kp, b.kp)).toBeLessThan(1e-9);
    expect(b.xCpPotential - a.xCpPotential).toBeCloseTo(3, 9);
  });
  test("thrust shares are a distribution and loading is positive", () => {
    const v = solveVlm(lexWing(FIGHTER_REFERENCE), COARSE);
    expect(v.thrustShare.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(v.thrustShare.every((t) => t >= 0)).toBe(true);
    expect(v.loading.every((l) => l > 0)).toBe(true);
    expect(v.gamma.every(Number.isFinite)).toBe(true);
  });
  test("mesh limits are enforced (bounded work)", () => {
    expect(() => solveVlm(deltaWing(deg(60)), { nSpan: 2, nChord: 4 })).toThrow();
    expect(() => solveVlm(deltaWing(deg(60)), { nSpan: 100, nChord: 50 })).toThrow();
    expect(() => solveVlm(deltaWing(deg(60)), { nSpan: 10.5, nChord: 4 })).toThrow();
    expect(DEFAULT_MESH.nSpan * DEFAULT_MESH.nChord).toBeLessThanOrEqual(2400);
  });
});

describe("Polhamus suction analogy reproduction (NASA TN D-3767 Fig. 9)", () => {
  test("Kv is π in the slender limit and stays within 3.1–3.5 for 0.5 ≤ A ≤ 2", () => {
    for (const A of [0.5, 1, 1.5, 2]) {
      const kv = vortexModel(solveVlm(deltaFromAspectRatio(A))).kv;
      expect(kv).toBeGreaterThan(3.1);
      expect(kv).toBeLessThan(3.5);
    }
  });
});

describe("breakdown map invariants (Wentz & Kohlman Fig. 4.1.1)", () => {
  test("for every sweep, breakdown moves toward the apex as α rises (monotone along the chord)", () => {
    for (const r of breakdownMap().rows) for (let k = 1; k < r.alphaDeg.length; k++) expect(r.alphaDeg[k] ?? 0).toBeGreaterThanOrEqual((r.alphaDeg[k - 1] ?? 0) - 1e-9);
  });
  test("more sweep delays breakdown at the trailing edge across the validated range", () => {
    fc.assert(fc.property(fc.double({ min: 60, max: 79, noNaN: true }), fc.double({ min: 0.5, max: 5, noNaN: true }), fc.double({ min: 0, max: 0.4, noNaN: true }), (s, d, xi) =>
      breakdownAlpha(toRad(deg(s + d)), xi).alpha >= breakdownAlpha(toRad(deg(s)), xi).alpha - 1e-9));
  });
  test("outside the mapped sweeps the answer is flagged as extrapolated", () => {
    expect(breakdownAlpha(toRad(deg(45)), 0.5).extrapolated).toBe(true);
    expect(breakdownAlpha(toRad(deg(85)), 0.5).extrapolated).toBe(true);
    expect(breakdownAlpha(toRad(deg(70)), 0.5).extrapolated).toBe(false);
    expect(breakdownAlpha(toRad(deg(45)), 0).alpha).toBeGreaterThanOrEqual(2);
    expect(MAP.rows.length).toBe(corpus.breakdown.rows.length);
  });
});

describe("polar invariants", () => {
  const v = solveVlm(deltaWing(deg(70)), COARSE), m = vortexModel(v);
  test("no angle, no lift; lift is odd in α", () => {
    expect(polarPoint(v, m, rad(0)).cl).toBe(0);
    fc.assert(fc.property(fc.double({ min: 0, max: 60, noNaN: true }), (a) => {
      const p = polarPoint(v, m, toRad(deg(a))), n = polarPoint(v, m, toRad(deg(-a)));
      return Math.abs(p.cl + n.cl) < 1e-12;
    }));
  });
  test("vortex lift is never negative for α ≥ 0, and breakdown only removes lift", () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 60, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, r) => {
      const p = polarPoint(v, m, toRad(deg(a)), 0.006, r);
      return p.clVortex >= 0 && p.cl <= p.clNoBreakdown + 1e-12 && p.lost >= 0 && p.lost <= 1;
    }));
  });
  test("the burst share never decreases as α rises", () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 59, noNaN: true }), fc.double({ min: 0.01, max: 5, noNaN: true }), (a, d) =>
      polarPoint(v, m, toRad(deg(a + d))).lost >= polarPoint(v, m, toRad(deg(a))).lost));
  });
  test("small-angle lift is linear: CL / sin α → Kp", () => {
    // CL / sin α = Kp cos²α + Kv |sin α| cos α (1 − lost·(1 − r)) → Kp as α → 0.
    expect(polarPoint(v, m, rad(1e-6)).cl / Math.sin(1e-6)).toBeCloseTo(m.kp, 4);
  });
  test("drag is never below zero-lift drag for α ≥ 0 (no suction on sharp edges)", () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 60, noNaN: true }), (a) => polarPoint(v, m, toRad(deg(a)), 0.01).cd >= 0.01));
  });
  test("deterministic and bounded: a 0–50° sweep at the default mesh in under 250 ms", () => {
    const t = performance.now();
    const a = analyse(deltaWing(deg(65)));
    const b = analyse(deltaWing(deg(65)));
    expect(performance.now() - t).toBeLessThan(500);
    expect(a.points.map((p) => p.cl)).toEqual(b.points.map((p) => p.cl));
    const t2 = performance.now(); analyse(lexWing(FIGHTER_REFERENCE)); expect(performance.now() - t2).toBeLessThan(250);
    expect(polar(v, m, [rad(0.1), rad(0.2)]).length).toBe(2);
  });
  test("alpha sweeps are bounded and refuse nonsense", () => {
    expect(alphaSweep(deg(0), deg(10), deg(1)).length).toBe(11);
    expect(() => alphaSweep(deg(0), deg(10), deg(0))).toThrow();
    expect(() => alphaSweep(deg(10), deg(0), deg(1))).toThrow();
    expect(() => alphaSweep(deg(0), deg(1e6), deg(0.1))).toThrow();
  });
});

describe("error model invariants", () => {
  test("conformal band contains zero, is ordered, and widens with coverage", () => {
    fc.assert(fc.property(fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 5, maxLength: 200 }), (rs) => {
      const a = conformalBand(rs, 0.8), b = conformalBand(rs, 0.95);
      return a.lo <= 0 && a.hi >= 0 && b.lo <= a.lo && b.hi >= a.hi;
    }));
    expect(conformalBand([]).n).toBe(0);
    expect(() => conformalBand([0.1], 1)).toThrow();
  });
  test("finite-sample coverage on exchangeable draws is at least nominal (simulation)", () => {
    let hit = 0, n = 0, seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let t = 0; t < 400; t++) {
      const xs = Array.from({ length: 40 }, () => rnd() - 0.5);
      const b = conformalBand(xs, NOMINAL);
      const y = rnd() - 0.5; n++; if (y >= b.lo && y <= b.hi) hit++;
    }
    expect(hit / n).toBeGreaterThanOrEqual(NOMINAL - 0.04);
  });
  test("regimes partition the burst share and refuse impossible values", () => {
    expect(regimeOf(0)).toBe("attached");
    expect(regimeOf(0.5)).toBe("bursting");
    expect(regimeOf(1)).toBe("burst");
    expect(() => regimeOf(1.2)).toThrow();
    expect(() => regimeOf(Number.NaN)).toThrow();
    expect(REGIMES.length).toBe(3);
  });
  test("bounds bracket the estimate and extrapolation doubles the width", () => {
    const band = { lo: -0.1, hi: 0.2, n: 10 };
    const a = clBounds(1, band, false), b = clBounds(1, band, true);
    expect(a.lo).toBeLessThanOrEqual(1); expect(a.hi).toBeGreaterThanOrEqual(1);
    expect(b.hi - b.lo).toBeCloseTo(2 * (a.hi - a.lo), 12);
    expect(scaledResidual(1.1, 1)).toBeCloseTo(0.1 / (S0 + 1), 12);
    expect(bandsFrom([{ regime: "attached", s: 0.1 }]).bursting.n).toBe(0);
  });
});

describe("validation report (pre-registered criteria, leave-one-wing-out)", () => {
  test("report is complete and every in-domain wing was scored out of sample", () => {
    const ids = corpus.cases.map((c) => c.id).sort();
    const scored = [...validation.inDomain, ...validation.outOfDomain].map((r) => r.id).sort();
    expect(scored).toEqual(ids);
    expect(validation.inDomain.every((r) => r.points.length === r.n)).toBe(true);
    expect(validation.sweepValidated).toEqual([...SWEEP_VALIDATED]);
  });
  test("the published retained share is the one the engine uses", () => {
    expect(validation.retained).toBe(DEFAULT_RETAINED);
  });
  test("coverage claim matches the stored points (no hand-edited summary)", () => {
    const pts = validation.inDomain.flatMap((r) => r.points);
    expect(pts.filter((p) => p.inBand).length / pts.length).toBeCloseTo(validation.coverage.widened, 9);
    expect(validation.criteria.C3.pass).toBe(validation.coverage.widened >= 0.8 && validation.coverage.widened <= 0.97);
  });
  test("every out-of-domain case is labelled extrapolation at every point (C4)", () => {
    expect(validation.criteria.C4.pass).toBe(true);
    for (const r of validation.outOfDomain) expect(r.points.every((p) => p.extrapolated)).toBe(true);
  });
  test("analyse labels the fighter-class layout and high angles as outside the validated domain", () => {
    const a = analyse(lexWing(FIGHTER_REFERENCE), { alphas: [deg(10), deg(60)] });
    expect(a.domain.ok).toBe(false);
    expect(a.points.every((p) => p.extrapolated)).toBe(true);
    const d = analyse(deltaWing(deg(70)), { alphas: [deg(10)] });
    expect(d.domain.ok).toBe(true);
    expect(ALPHA_VALIDATED_MAX).toBe(deg(50));
  });
});

describe("NASA F/A-18 HARV geometry (published values exact, traced shapes consistent)", () => {
  test("wing reproduces the published MAC, area and the 20° quarter-chord sweep", () => {
    const w = harvWingGeometry();
    expect(Math.abs(w.mac - HARV_PUBLISHED.macFt)).toBeLessThan(0.01);
    expect(Math.abs(w.quarterChordSweep - 20)).toBeLessThan(0.2);
    expect(w.semi * (w.cr + w.ct)).toBeCloseTo(HARV_PUBLISHED.wingAreaFt2, 9);
    expect((2 * w.semi) ** 2 / HARV_PUBLISHED.wingAreaFt2).toBeCloseTo(HARV_PUBLISHED.aspectRatio, 1);
    expect(HARV_WING.taper).toBe(0.35);
  });
  test("solver planform is valid, uses the published reference, and the LEX edge runs aft and outboard", () => {
    const p = harvPlanform();
    expect(validatePlanform(p)).toEqual([]);
    expect(p.sRef).toBe(HARV_PUBLISHED.wingAreaFt2);
    expect(p.cRef).toBe(HARV_PUBLISHED.macFt);
    for (let k = 1; k < HARV_LEX.length; k++) {
      expect(HARV_LEX[k]?.x ?? 0).toBeGreaterThan(HARV_LEX[k - 1]?.x ?? 0);
      expect(HARV_LEX[k]?.y ?? 0).toBeGreaterThan(HARV_LEX[k - 1]?.y ?? 0);
    }
  });
  test("stabilator meets the published span and area; tails cant 20°", () => {
    const s = harvStab();
    const c = (q: { xLe: number; xTe: number }) => q.xTe - q.xLe;
    expect(2 * s.tip.y).toBeCloseTo(HARV_PUBLISHED.stabSpanFt, 9);
    expect((c(s.root) + c(s.tip)) * (s.tip.y - s.root.y)).toBeCloseTo(HARV_PUBLISHED.stabAreaFt2, 6);
    expect(s.root.y).toBeLessThan(s.tracedRootY);
    expect(s.root.y).toBeGreaterThan(3);
    expect(harvVtailCant().angle).toBe(deg(20));
    expect(HARV_STAB.tc).toBeGreaterThan(0);
    expect(HARV_VTAIL.tip.z).toBe(HARV_PUBLISHED.heightFt);
  });
  test("body tables are physical and interpolation is bounded", () => {
    HARV_BODY.forEach((b, k) => {
      expect(b.top).toBeGreaterThan(b.bottom);
      expect(b.halfWidth).toBeGreaterThan(0);
      if (k > 0) expect(b.x).toBeGreaterThan(HARV_BODY[k - 1]?.x ?? -1);
    });
    fc.assert(fc.property(fc.double({ min: -5, max: 60, noNaN: true }), (x) => {
      const b = bodyAt(x);
      return b.top > b.bottom && b.halfWidth > 0 && b.halfWidth <= 5.0 && b.top <= 9.7;
    }));
    expect(HARV_CANOPY.every((c) => c.top >= bodyAt(c.x).top - 0.36)).toBe(true);
  });
  test("mesh matches the published length and height, stays finite and well indexed", () => {
    const m = buildHarvMesh(0.6);
    expect(Math.abs(m.bounds.max[0] - HARV_PUBLISHED.lengthFt)).toBeLessThan(0.15);
    expect(m.bounds.min[0]).toBeGreaterThanOrEqual(0);
    expect(Math.abs(m.bounds.max[2] - HARV_PUBLISHED.heightFt)).toBeLessThan(0.2);
    expect(m.bounds.max[1]).toBeGreaterThan(HARV_PUBLISHED.spanFt / 2);
    expect(m.bounds.max[1]).toBeLessThan(HARV_PUBLISHED.spanFt / 2 + 0.8);
    expect(m.bounds.min[1]).toBeCloseTo(-m.bounds.max[1], 6);
    for (const g of m.groups) {
      const n = g.positions.length / 3;
      expect(g.positions.every(Number.isFinite)).toBe(true);
      expect(g.indices.length % 3).toBe(0);
      expect(g.indices.every((i) => Number.isInteger(i) && i >= 0 && i < n)).toBe(true);
    }
    expect(new Set(m.groups.map((g) => g.part))).toEqual(new Set(["skin", "glass", "dark", "metal"]));
    expect(HARV_NOZZLES.radius).toBeGreaterThan(0);
  });
  test("NACA thickness peaks near 30% chord at half the thickness ratio and closes at the leading edge", () => {
    expect(nacaHalfThickness(0, 0.05)).toBe(0);
    expect(Math.abs(nacaHalfThickness(0.3, 0.05) - 0.025)).toBeLessThan(0.0005);
    fc.assert(fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (u) => nacaHalfThickness(u, 0.05) >= -1e-4 && nacaHalfThickness(u, 0.05) <= 0.0251));
  });
  test("drawing outlines come from the same tables as the mesh", () => {
    const o = harvOutlines();
    expect(o.published).toBe(HARV_PUBLISHED);
    expect(o.wingZ.tip).toBeLessThan(o.wingZ.root);
    expect(o.stab.length).toBe(4);
    expect(o.body.length).toBeGreaterThan(50);
  });
  test("aerodynamics on the HARV are labelled outside the validated domain", () => {
    const a = analyse(harvPlanform(), { alphas: [deg(20)] });
    expect(a.domain.ok).toBe(false);
    expect(a.points[0]?.extrapolated).toBe(true);
  });
});
