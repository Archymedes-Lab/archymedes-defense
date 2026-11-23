import { describe, expect, setDefaultTimeout, test } from "bun:test";
import fc from "fast-check";
import { ALPHA_MAX_DEG, G0, HARV_AIRFRAME, HARV_MASS, MACH_MAX, isa, simulateFlight, trimLevel } from "../lib/aero/flight";
import { deltaWing } from "../lib/aero/geometry";
import { harvPlanform } from "../lib/aero/harv";
import { deg, rad, toRad } from "../lib/aero/units";
import { GK_DELTA_ORDER, UnsteadyError, gkStep, harmonicResponse, loopArea, simulateState, staticState, unsteadyPolar } from "../lib/aero/unsteady";
import { DEFAULT_MESH, solveVlm } from "../lib/aero/vlm";
import { DEFAULT_RAMP, burstFraction, polarPoint, vortexModel } from "../lib/aero/vortex";

setDefaultTimeout(120_000);
const D = Math.PI / 180;
const delta70 = (() => { const v = solveVlm(deltaWing(deg(70)), DEFAULT_MESH); return { v, m: vortexModel(v) }; })();
const harv = (() => { const v = solveVlm(harvPlanform(), DEFAULT_MESH); return { v, m: vortexModel(v) }; })();

// ---------------------------------------------------------------- Goman–Khrabrov state (unsteady vortex lift)

describe("vortex state: exact first-order dynamics (Goman & Khrabrov)", () => {
  test("a held input relaxes exactly as X0 + (X − X0) e^(−t/τ1), for any step size", () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }),
      fc.double({ min: 0.5, max: 40, noNaN: true }), fc.integer({ min: 1, max: 50 }), (x, u, tau, n) => {
        let y = x;
        const dt = 7 / n;
        for (let k = 0; k < n; k++) y = gkStep(y, u, dt, tau);
        expect(y).toBeCloseTo(u + (x - u) * Math.exp(-7 / tau), 12);
      }), { numRuns: 200 });
  });

  test("the state never leaves the range spanned by its start and its targets (no overshoot, any step)", () => {
    fc.assert(fc.property(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 60 }),
      fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 30, noNaN: true }), fc.double({ min: 0.01, max: 50, noNaN: true }),
      (us, x0, tau, dt) => {
        let x = x0, lo = x0, hi = x0;
        for (const u of us) { lo = Math.min(lo, u); hi = Math.max(hi, u); x = gkStep(x, u, dt, tau); expect(x).toBeGreaterThanOrEqual(lo - 1e-15); expect(x).toBeLessThanOrEqual(hi + 1e-15); }
      }), { numRuns: 300 });
  });

  test("with τ1 = τ2 = 0 the unsteady lift is exactly the static polar at every instant", () => {
    const motion = (t: number) => (25 + 20 * Math.sin(0.05 * t)) * D;
    const pts = unsteadyPolar(delta70.v, delta70.m, motion, 200, 0.5, { tau1: 0, tau2: 0 });
    for (const p of pts) expect(p.cl).toBeCloseTo(p.clStatic, 12);
  });

  test("held at a constant angle, the unsteady lift settles onto the static polar", () => {
    for (const a of [10, 30, 40]) {
      const pts = unsteadyPolar(delta70.v, delta70.m, () => a * D, 15 * 20, 0.5, GK_DELTA_ORDER);
      const last = pts[pts.length - 1];
      expect(last?.cl).toBeCloseTo(polarPoint(delta70.v, delta70.m, toRad(deg(a))).cl, 6);
    }
  });

  test("linear frequency response matches Goman et al. eq. 4: gain 1/√(1+τ1²ω²), lag atan(τ1ω)", () => {
    const tau1 = 15;
    for (const omega of [0.005, 0.02, 0.067, 0.2]) {
      const periods = 4, T = (2 * Math.PI) / omega;
      const s = simulateState((a) => 0.6 + 0.8 * a, (t) => 0.1 * Math.sin(omega * t), 6 * tau1 + (periods + 2) * T, T / 2000, { tau1, tau2: 0 });
      const r = harmonicResponse(s, omega, periods);
      expect(r.gain).toBeCloseTo(1 / Math.sqrt(1 + tau1 * tau1 * omega * omega), 3);
      expect(r.lag).toBeCloseTo(Math.atan(tau1 * omega), 3);
    }
  });

  test("the in-phase and quadrature parts obey Goman et al. eq. 5: quadrature = −τ1 × (in-phase − attached)", () => {
    const tau1 = 12;
    for (const omega of [0.01, 0.05, 0.1]) {
      const T = (2 * Math.PI) / omega;
      const s = simulateState((a) => a, (t) => Math.sin(omega * t), 6 * tau1 + 6 * T, T / 2000, { tau1, tau2: 0 });
      const r = harmonicResponse(s, omega, 4);
      const inPhase = r.gain * Math.cos(r.lag), quadrature = -r.gain * Math.sin(r.lag) / omega; // per unit α-rate
      expect(quadrature).toBeCloseTo(-tau1 * inPhase, 2);
    }
  });

  test("τ2 delays the input: a ramp is followed exactly τ2 behind when τ1 = 0", () => {
    const s = simulateState((a) => a, (t) => 0.01 * t, 100, 0.1, { tau1: 0, tau2: 7 });
    for (const p of s.slice(100)) expect(p.x).toBeCloseTo(0.01 * (p.t - 7), 9);
  });

  test("breakdown lags on a pitch cycle: more lift going up than coming down (positive loop), vanishing as motion slows", () => {
    const cycle = (k: number) => {
      const T = (2 * Math.PI) / k;
      const motion = (t: number) => (30 - 15 * Math.cos(k * t)) * D; // 15° → 45° → 15°
      const pts = unsteadyPolar(delta70.v, delta70.m, motion, 3 * T, T / 3000, GK_DELTA_ORDER);
      return loopArea(pts.filter((p) => p.t >= 2 * T - 1e-9));
    };
    const fast = cycle(0.05), slow = cycle(0.0005);
    expect(fast).toBeGreaterThan(0);
    expect(slow).toBeGreaterThanOrEqual(0);
    expect(slow).toBeLessThan(fast / 5);
  });

  test("nonsense is refused", () => {
    expect(() => gkStep(0.5, 0.5, -1, 1)).toThrow(UnsteadyError);
    expect(() => simulateState((a) => a, () => 0, 10, 0, GK_DELTA_ORDER)).toThrow(UnsteadyError);
    expect(() => simulateState((a) => a, () => 0, 10, 1, { tau1: -1, tau2: 0 })).toThrow(UnsteadyError);
    expect(() => simulateState((a) => a, () => 0, 10, 1, { tau1: Number.NaN, tau2: 0 })).toThrow(UnsteadyError);
  });

  test("the static state is a share of the vortex lift: within [retained, 1] and 1 before any breakdown", () => {
    for (let a = 0; a <= 60; a += 2.5) {
      const x = staticState(delta70.v, delta70.m, toRad(deg(a)));
      expect(x).toBeGreaterThanOrEqual(0.37 - 1e-12);
      expect(x).toBeLessThanOrEqual(1);
    }
    expect(staticState(delta70.v, delta70.m, toRad(deg(5)))).toBe(1);
  });
});

// ---------------------------------------------------------------- flight path of the HARV (point mass, longitudinal)

describe("standard atmosphere", () => {
  test("sea level density is 0.0023769 slug/ft³ and the speed of sound 1116.4 ft/s", () => {
    expect(isa(0).rho).toBeCloseTo(0.0023769, 7);
    expect(isa(0).a).toBeCloseTo(1116.45, 0);
  });
  test("density falls with height and is continuous at the tropopause", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let h = 0; h <= 60000; h += 500) { const r = isa(h).rho; expect(r).toBeLessThan(prev); prev = r; }
    const below = isa(36089.24 - 1e-6).rho, above = isa(36089.24 + 1e-6).rho;
    expect(Math.abs(below - above) / below).toBeLessThan(1e-8);
  });
  test("outside its range it refuses rather than extrapolates", () => {
    expect(() => isa(80000)).toThrow(UnsteadyError);
    expect(() => isa(Number.NaN)).toThrow(UnsteadyError);
  });
});

const start0 = { v: 450, gamma: 0, h: 15000, x: 0 };

describe("HARV flight path invariants", () => {
  const start = start0;

  test("published mass properties are carried exactly (NASA TM-110216 Table 2.3)", () => {
    expect(HARV_AIRFRAME.weightLb).toBe(35764.6);
    expect(HARV_MASS.fighterEscort60pctFuel.iyy).toBe(174246.3);
    const w = [HARV_MASS.empty, HARV_MASS.light, HARV_MASS.fighterEscort60pctFuel, HARV_MASS.heavy].map((c) => c.weightLb);
    expect(w).toEqual([...w].sort((a, b) => a - b)); // empty < light < escort < heavy
  });

  test("without drag or thrust, total energy h + V²/2g is conserved (RK4, 30 s)", () => {
    const pts = simulateFlight(harv.v, harv.m, start, { alpha: () => 8 * D }, 30, 0.01, HARV_AIRFRAME, { dragFree: true });
    const e0 = pts[0]?.specificEnergy ?? 0;
    for (const p of pts) expect(Math.abs(p.specificEnergy - e0) / e0).toBeLessThan(1e-7);
  });

  test("energy theorem: the change in h + V²/2g equals ∫ (T − D) V / W dt", () => {
    const pts = simulateFlight(harv.v, harv.m, start, { alpha: (t) => (6 + 10 * Math.sin(0.3 * t)) * D, thrust: () => 12000 }, 20, 0.005);
    let work = 0;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      if (a === undefined || b === undefined) continue;
      const pa = ((a.thrust * Math.cos(a.alpha) - a.drag) * a.v) / HARV_AIRFRAME.weightLb, pb = ((b.thrust * Math.cos(b.alpha) - b.drag) * b.v) / HARV_AIRFRAME.weightLb;
      work += 0.5 * (pa + pb) * (b.t - a.t);
    }
    const de = (pts[pts.length - 1]?.specificEnergy ?? 0) - (pts[0]?.specificEnergy ?? 0);
    expect(Math.abs(de - work)).toBeLessThan(1e-3 * Math.max(1, Math.abs(de)) + 0.5);
  });

  test("trimmed level flight stays level: lift + thrust balance weight and drag (10 s)", () => {
    const trim = trimLevel(harv.v, harv.m, 450, 15000);
    const pts = simulateFlight(harv.v, harv.m, start, { alpha: () => trim.alpha, thrust: () => trim.thrust }, 10, 0.01);
    const last = pts[pts.length - 1];
    expect(Math.abs((last?.h ?? 0) - 15000)).toBeLessThan(0.5);
    expect(Math.abs((last?.v ?? 0) - 450)).toBeLessThan(0.05);
    expect(Math.abs(last?.gamma ?? 1)).toBeLessThan(1e-4);
  });

  test("the integrator converges at fourth order where the aerodynamics are smooth (70° delta, below breakdown)", () => {
    const run = (dt: number) => {
      const p = simulateFlight(delta70.v, delta70.m, start, { alpha: (t) => (6 + 3 * Math.sin(0.5 * t)) * D, thrust: () => 8000 }, 8, dt, HARV_AIRFRAME, { gk: { tau1: 0, tau2: 0 } });
      return p[p.length - 1]?.h ?? 0;
    };
    const ref = run(0.0025), e1 = Math.abs(run(0.04) - ref), e2 = Math.abs(run(0.02) - ref);
    expect(e1 / e2).toBeGreaterThan(11);
    expect(e1 / e2).toBeLessThan(22);
  });

  test("known limit, kept visible: on the HARV the static breakdown model is a staircase (sweep 26.7° is below the map)", () => {
    // Strips swept below the mapped 55–80° get the extrapolation floor (2°): their vortex lift drops in one step there,
    // so CL(α) is discontinuous at ±2°. The vortex state smooths this in time, but at τ1 = 0 the jump reaches the flight
    // path and fourth-order convergence is lost across it. Recorded, not hidden.
    const floor = harv.m.strips.filter((s) => s.alphaBd === 2);
    expect(floor.reduce((a, s) => a + s.share, 0)).toBeGreaterThan(0.05);
    const below = polarPoint(harv.v, harv.m, toRad(deg(2 - 1e-7))).cl, above = polarPoint(harv.v, harv.m, toRad(deg(2 + 1e-7))).cl;
    expect(below - above).toBeGreaterThan(1e-4); // a jump, not a slope (a slope would move CL by ~1e-8 here)
    expect(harv.m.extrapolatedSweep).toBe(true);
  });

  test("the vortex state relaxes with the dimensional time constant τ1 c / V", () => {
    const tau = (GK_DELTA_ORDER.tau1 * HARV_AIRFRAME.chordFt) / 450;
    const pts = simulateFlight(harv.v, harv.m, { ...start, vortex: 1 }, { alpha: () => 40 * D }, 0.05, 0.0005, HARV_AIRFRAME, { dragFree: true });
    const target = staticState(harv.v, harv.m, toRad(deg(40)));
    const last = pts[pts.length - 1];
    // over 0.05 s the speed barely changes, so the state follows the constant-τ solution closely
    expect(last?.vortex).toBeCloseTo(target + (1 - target) * Math.exp(-0.05 / tau), 3);
  });

  test("deterministic, finite, and honest about its domain", () => {
    const run = () => simulateFlight(harv.v, harv.m, start, { alpha: (t) => (5 + 50 * Math.min(1, t / 5)) * D }, 6, 0.01);
    const a = run(), b = run();
    expect(a).toEqual(b);
    for (const p of a) expect([p.v, p.gamma, p.h, p.cl, p.cd].every(Number.isFinite)).toBe(true);
    expect(a.some((p) => p.extrapolated)).toBe(true); // passes 50°
    for (const p of a) expect(p.extrapolated).toBe(p.mach > MACH_MAX || Math.abs(p.alpha / D) > ALPHA_MAX_DEG);
  });

  test("bad inputs are refused", () => {
    expect(() => simulateFlight(harv.v, harv.m, { ...start, v: 0 }, { alpha: () => 0 }, 1, 0.01)).toThrow(UnsteadyError);
    expect(() => simulateFlight(harv.v, harv.m, start, { alpha: () => 0 }, 1, 0)).toThrow(UnsteadyError);
    expect(() => simulateFlight(harv.v, harv.m, start, { alpha: () => 0 }, 1, 0.01, { ...HARV_AIRFRAME, weightLb: -1 })).toThrow(UnsteadyError);
    expect(() => trimLevel(harv.v, harv.m, 60, 30000)).toThrow(UnsteadyError); // too slow to hold level below 30°
  });

  test("g is the standard value used for mass from weight", () => {
    expect(G0).toBeCloseTo(32.174, 3);
    expect(rad(0)).toBe(0);
  });
});

// ---------------------------------------------------------------- gradual vortex breakdown

describe("gradual breakdown: the burst share ramps instead of stepping", () => {
  test("ramp 0 is exactly the original step model, and the default", () => {
    expect(DEFAULT_RAMP).toBe(0);
    fc.assert(fc.property(fc.double({ min: 0, max: 90, noNaN: true }), fc.double({ min: 2, max: 60, noNaN: true }), (a, bd) => {
      expect(burstFraction(a, bd, 0)).toBe(a >= bd ? 1 : 0);
    }), { numRuns: 300 });
  });

  test("the burst share is in [0, 1], never falls as α rises, is ½ at the breakdown angle, and is Lipschitz (no jumps)", () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 80, noNaN: true }), fc.double({ min: 0, max: 5, noNaN: true }),
      fc.double({ min: 2, max: 60, noNaN: true }), fc.double({ min: 0.5, max: 15, noNaN: true }), (a, da, bd, w) => {
        const f0 = burstFraction(a, bd, w), f1 = burstFraction(a + da, bd, w);
        expect(f0).toBeGreaterThanOrEqual(0); expect(f1).toBeLessThanOrEqual(1);
        expect(f1).toBeGreaterThanOrEqual(f0 - 1e-15);
        expect(f1 - f0).toBeLessThanOrEqual((1.5 / w) * da + 1e-12);
        expect(burstFraction(bd, bd, w)).toBeCloseTo(0.5, 12);
      }), { numRuns: 400 });
    expect(() => burstFraction(10, 20, -1)).toThrow(RangeError);
  });

  test("with a ramp the HARV lift curve has no jumps, and the flight path converges where the step model did not", () => {
    // The smoothstep has a continuous slope but its curvature jumps at the ramp ends (and |α| kinks at 0), so RK4 is
    // reduced to low order there; the claim tested is convergence (the error at least halves), not fourth order.
    const below = polarPoint(harv.v, harv.m, toRad(deg(2 - 1e-7)), 0.006, 0.37, 4).cl;
    const above = polarPoint(harv.v, harv.m, toRad(deg(2 + 1e-7)), 0.006, 0.37, 4).cl;
    expect(Math.abs(below - above)).toBeLessThan(1e-6);
    const run = (dt: number) => {
      const p = simulateFlight(harv.v, harv.m, start0, { alpha: (t) => rad((5 + 6 * Math.sin(0.5 * t)) * D), thrust: () => 8000 }, 8, dt, HARV_AIRFRAME, { gk: { tau1: 0, tau2: 0 }, ramp: 4 });
      return p[p.length - 1]?.h ?? 0;
    };
    const ref = run(0.00125), errs = [0.04, 0.02, 0.01].map((dt) => Math.abs(run(dt) - ref));
    expect((errs[0] ?? 0) / (errs[1] ?? 1)).toBeGreaterThan(1.8);
    expect((errs[1] ?? 0) / (errs[2] ?? 1)).toBeGreaterThan(1.8);
  });

  test("a ramp only moves lift between neighbours of the breakdown angle: far from every breakdown angle nothing changes", () => {
    const m = delta70.m, far = (a: number) => m.strips.every((s) => Math.abs(a - s.alphaBd) > 3);
    for (let a = 0; a <= 60; a += 0.5) {
      if (!far(a)) continue;
      expect(polarPoint(delta70.v, m, toRad(deg(a)), 0.006, 0.37, 6).cl).toBeCloseTo(polarPoint(delta70.v, m, toRad(deg(a))).cl, 12);
    }
  });
});
