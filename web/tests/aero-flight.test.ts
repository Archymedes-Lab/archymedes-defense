import { describe, expect, setDefaultTimeout, test } from "bun:test";
import fc from "fast-check";
import { aircraftById } from "../lib/aero/aircraft";
import { isa } from "../lib/aero/flight";
import { F106B_APPROACH_TRIM, F106B_FLIGHT, MACH_LIMIT } from "../lib/aero/flightdata";
import { KNOT_FTPS, dynamicPressure, impliedWeight, liftWithElevon, requiredLift, trimElevon, trimModel, trimmedLift, trimmedLiftBlend, vortexShare, wingLift } from "../lib/aero/trim";
import { deg, rad, toRad } from "../lib/aero/units";
import { incidenceLoad, solveVlm } from "../lib/aero/vlm";
import { vortexModel } from "../lib/aero/vortex";
import flight from "../lib/data/aero-flight.json";

setDefaultTimeout(120_000);
const ac = aircraftById("f106b");
if (!ac) throw new Error("f106b missing");
const v = solveVlm(ac.planform(), { nSpan: 16, nChord: 8 }), m = vortexModel(v), tm = trimModel(v, ac);
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe("incidence loads on the lattice (control surfaces)", () => {
  test("unit incidence on every panel reproduces the lift slope Kp and its centre of pressure", () => {
    const all = incidenceLoad(v, () => 1);
    expect(all.k).toBeCloseTo(v.kp, 10);
    expect(all.xCp).toBeCloseTo(v.xCpPotential, 9);
  });
  test("loads superpose: forward part + aft part = whole wing, for any split line", () => {
    fc.assert(fc.property(fc.double({ min: 2, max: 34, noNaN: true }), (x) => {
      const fwd = incidenceLoad(v, (p) => (p.cp.x < x ? 1 : 0)), aft = incidenceLoad(v, (p) => (p.cp.x >= x ? 1 : 0));
      expect(fwd.k + aft.k).toBeCloseTo(v.kp, 9);
    }), { numRuns: 25 });
  });
  test("the load is linear in the incidence", () => {
    const one = incidenceLoad(v, (p) => (p.cp.x > 30 ? 1 : 0)), three = incidenceLoad(v, (p) => (p.cp.x > 30 ? 3 : 0));
    expect(three.k).toBeCloseTo(3 * one.k, 10);
    expect(three.xCp).toBeCloseTo(one.xCp, 9);
  });
  test("the elevon lifts when deflected trailing edge down, less than the whole wing, and its load acts aft of the wing's", () => {
    expect(tm.elevon.k).toBeGreaterThan(0);
    expect(tm.elevon.k).toBeLessThan(v.kp);
    expect(tm.elevon.xCp).toBeGreaterThan(v.xCpPotential);
    expect(tm.elevon.xCp).toBeGreaterThan(tm.xCg);
  });
  test("a larger elevon gives more lift per degree", () => {
    const e = ac.elevon;
    if (!e) throw new Error("no elevon");
    const k = (extra: number) => incidenceLoad(v, (p) => (p.cp.y >= e.yInboard && p.cp.x >= e.hingeX(p.cp.y) - extra ? 1 : 0)).k;
    expect(k(2)).toBeGreaterThan(k(0));
    expect(k(4)).toBeGreaterThan(k(2));
  });
});

describe("trim", () => {
  test("at the trim elevon the pitching moment about the centre of gravity is zero, for both edge states", () => {
    for (const edge of ["sharp", "attached"] as const) for (const a of [4, 11.3, 18]) {
      const alpha = toRad(deg(a)), d = trimElevon(v, m, tm, alpha, edge), w = wingLift(v, m, alpha, edge);
      const moment = w.potential * (v.xCpPotential - tm.xCg) + w.vortex * (m.xVortex - tm.xCg) + tm.elevon.k * d * (tm.elevon.xCp - tm.xCg);
      expect(Math.abs(moment)).toBeLessThan(1e-12);
    }
  });
  test("a statically stable tailless wing trims with the elevon up, and more so at higher angle of attack", () => {
    expect(v.xCpPotential).toBeGreaterThan(tm.xCg);
    let prev = 0;
    for (const a of [4, 8, 12, 16]) { const d = trimElevon(v, m, tm, toRad(deg(a)), "attached"); expect(d).toBeLessThan(prev); prev = d; }
  });
  test("trimming costs lift: trimmed lift is below the bare wing's, in both states", () => {
    for (const edge of ["sharp", "attached"] as const) {
      const alpha = toRad(deg(12)), w = wingLift(v, m, alpha, edge);
      expect(trimmedLift(v, m, tm, alpha, edge).cl).toBeLessThan(w.potential + w.vortex);
    }
  });
  test("lift with the elevon is linear in the elevon angle", () => {
    const alpha = toRad(deg(10));
    const a = liftWithElevon(v, m, tm, alpha, rad(0), "attached"), b = liftWithElevon(v, m, tm, alpha, rad(0.05), "attached"), c = liftWithElevon(v, m, tm, alpha, rad(0.1), "attached");
    expect(c - b).toBeCloseTo(b - a, 12);
  });
});

describe("rounded leading edge: a blend between attached flow and full vortex lift", () => {
  test("the vortex share is in [0, 1], never falls as the angle rises, and its limits are the two states", () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 40, noNaN: true }), fc.double({ min: 0, max: 5, noNaN: true }), fc.double({ min: 0, max: 20, noNaN: true }), fc.double({ min: 0, max: 20, noNaN: true }), (a, da, on, width) => {
      const b = { onsetDeg: on, fullDeg: on + width };
      const s0 = vortexShare(a, b), s1 = vortexShare(a + da, b);
      expect(s0).toBeGreaterThanOrEqual(0); expect(s1).toBeLessThanOrEqual(1); expect(s1).toBeGreaterThanOrEqual(s0);
    }), { numRuns: 300 });
    expect(() => vortexShare(5, { onsetDeg: 10, fullDeg: 5 })).toThrow(RangeError);
  });
  test("onset 0 reproduces the sharp edge and a late onset the attached edge, exactly", () => {
    for (const a of [5, 12, 20]) {
      const alpha = toRad(deg(a));
      expect(trimmedLiftBlend(v, m, tm, alpha, { onsetDeg: 0, fullDeg: 0 }).cl).toBeCloseTo(trimmedLift(v, m, tm, alpha, "sharp").cl, 12);
      expect(trimmedLiftBlend(v, m, tm, alpha, { onsetDeg: 89, fullDeg: 90 }).cl).toBeCloseTo(trimmedLift(v, m, tm, alpha, "attached").cl, 12);
    }
  });
});

describe("steady-flight relations", () => {
  test("required lift and implied weight are inverses", () => {
    fc.assert(fc.property(fc.double({ min: 15000, max: 45000, noNaN: true }), fc.double({ min: 0.8, max: 4, noNaN: true }), fc.double({ min: 40, max: 500, noNaN: true }), (w, n, q) => {
      const cl = requiredLift({ weightLb: w, loadFactor: n, q, areaFt2: 697.83 });
      expect(rel(impliedWeight(cl, q, 697.83, n), w)).toBeLessThan(1e-12);
    }), { numRuns: 200 });
    expect(() => requiredLift({ weightLb: -1, loadFactor: 1, q: 100, areaFt2: 700 })).toThrow(RangeError);
  });
  test("dynamic pressure is ½ρV² = 0.7 p M² in the standard atmosphere", () => {
    for (const [mach, h] of [[0.3, 0], [0.42, 24600], [0.54, 35400], [0.5, 40000]] as const) {
      const air = isa(h), p = air.rho * 1716.49 * air.t;
      expect(rel(dynamicPressure(mach, h), 0.7 * p * mach * mach)).toBeLessThan(1e-4);
    }
  });
  test("knots to feet per second", () => { expect(180 * KNOT_FTPS).toBeCloseTo(303.81, 1); });
});

describe("published flight data are carried exactly (NASA TP-3374 Table I, TP-2747 Table III)", () => {
  test("34 rows in five groups, unique serials, spot values", () => {
    expect(F106B_FLIGHT.length).toBe(34);
    expect(new Set(F106B_FLIGHT.map((p) => p.serial)).size).toBe(34);
    expect(["I", "II", "III", "IV", "V"].map((g) => F106B_FLIGHT.filter((p) => p.group === g).length)).toEqual([9, 7, 9, 7, 2]);
    expect(F106B_FLIGHT[0]).toEqual({ group: "I", serial: "91-15/12", alphaDeg: 12.9, altitudeFt: 14900, loadFactor: 1.0, mach: 0.36, rnMillions: 39.1 });
    expect(F106B_FLIGHT.find((p) => p.serial === "91-16/07")).toMatchObject({ alphaDeg: 14.8, altitudeFt: 27200, loadFactor: 3.9, mach: 0.8 });
    expect(F106B_FLIGHT.filter((p) => p.mach < MACH_LIMIT).length).toBe(27);
    expect(F106B_FLIGHT.every((p) => p.group !== "IV" || p.mach >= MACH_LIMIT)).toBe(true);
  });
  test("trim table values", () => {
    expect(F106B_APPROACH_TRIM).toMatchObject({ velocityKnots: 180, gammaDeg: -3, alphaDeg: 11.3, elevonDeg: -4.13, thrustLb: 6410, weightLb: 27400, areaFt2: 695 });
  });
});

describe("flight validation report is what the code computes (no hand-edited numbers)", () => {
  const T = F106B_APPROACH_TRIM;
  test("the lift the trim point requires follows from the published table", () => {
    const q = 0.5 * isa(0).rho * (T.velocityKnots * KNOT_FTPS) ** 2;
    const cl = requiredLift({ weightLb: T.weightLb, loadFactor: 1, q, areaFt2: T.areaFt2, alpha: toRad(deg(T.alphaDeg)), gamma: toRad(deg(T.gammaDeg)), thrustLb: T.thrustLb });
    expect(flight.trim.clRequired).toBeCloseTo(cl, 3);
  });
  test("each stated error is the stored lift against the required lift, and the criteria follow from the stored values", () => {
    for (const r of flight.trim.rows) expect(r.error).toBeCloseTo(r.cl / flight.trim.clRequired - 1, 2);
    const fitted = flight.trim.rows[flight.trim.rows.length - 1];
    expect(flight.criteria.F1.pass).toBe(Math.abs(fitted?.error ?? 1) <= 0.05);
    expect(flight.criteria.F2.pass).toBe(Math.abs((fitted?.elevonDeg ?? 99) - T.elevonDeg) <= 1.0);
    expect(flight.criteria.F3.pass).toBe(flight.flight.heldOutCv <= 0.05);
    expect(flight.criteria.F3.value).toBe(flight.flight.heldOutCv);
  });
  test("only subsonic points are used, every flight was held out once, and variant means are the means of their points", () => {
    expect(flight.flight.pointsUsed).toBe(27);
    expect(flight.flight.heldOut.map((h) => h.flight).sort()).toEqual([...flight.flight.flights].sort());
    expect(flight.flight.heldOut.reduce((a, h) => a + h.n, 0)).toBe(27);
    for (const x of flight.flight.variants) {
      expect(x.points.length).toBe(27);
      expect(Math.abs(x.points.reduce((a, p) => a + p.weightLb, 0) / 27 - x.meanWeightLb)).toBeLessThan(2);
    }
  });
  test("the fitted model reproduces the stored implied weights from the published rows", () => {
    const fine = solveVlm(ac.planform(), { nSpan: 24, nChord: 12 }), fm = vortexModel(fine), ft = trimModel(fine, ac);
    const fitted = flight.flight.variants[2];
    for (const p of fitted?.points.slice(0, 6) ?? []) {
      const row = F106B_FLIGHT.find((r) => r.serial === p.serial);
      if (!row) throw new Error(p.serial);
      const cl = trimmedLiftBlend(fine, fm, ft, toRad(deg(row.alphaDeg)), flight.flight.blend).cl;
      expect(Math.abs(impliedWeight(cl, dynamicPressure(row.mach, row.altitudeFt), 697.83, row.loadFactor) - p.weightLb)).toBeLessThan(1);
    }
  });
});
