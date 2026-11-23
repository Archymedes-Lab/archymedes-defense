import { describe, expect, setDefaultTimeout, test } from "bun:test";
import fc from "fast-check";
import { aircraftById } from "../lib/aero/aircraft";
import { THRUST_ALT_FT, THRUST_IDLE, THRUST_MACH, THRUST_MAX, THRUST_MIL, THRUST_SI_SEA_LEVEL, f16Thrust, tableAt } from "../lib/aero/f16data";
import { simulateFlight } from "../lib/aero/flight";
import { ALPHA_RATE_DEG_S, ALPHA_TAU_S, CD0_ALLOWANCE, ENGINE_TAU_S, FIXED_DT, type LiveState, MAX_STEPS_PER_ADVANCE, advance, lagStep, liveAirframe, liveModel, stepLive, telemetry, trimStart } from "../lib/aero/live";
import { rad } from "../lib/aero/units";
import { solveVlm } from "../lib/aero/vlm";
import { vortexModel } from "../lib/aero/vortex";

setDefaultTimeout(120_000);
const f16 = aircraftById("f16");
if (!f16) throw new Error("f16 missing");
const v = solveVlm(f16.planform(), { nSpan: 16, nChord: 8 }), m = vortexModel(v);
const L = liveModel(v, m, liveAirframe(f16));

describe("F-16 thrust, NASA TP-1538 Table VI", () => {
  test("spot values are carried exactly", () => {
    expect(THRUST_MIL[0]?.[0]).toBe(12680); expect(THRUST_MAX[4]?.[0]).toBe(28886); expect(THRUST_IDLE[4]?.[0]).toBe(-3600);
    expect(THRUST_MAX[0]?.[5]).toBe(2600); expect(THRUST_MIL[3]?.[3]).toBe(5320);
    expect(THRUST_MACH).toEqual([0.2, 0.4, 0.6, 0.8, 1.0]); expect(THRUST_ALT_FT).toEqual([0, 10000, 20000, 30000, 40000, 50000]);
  });
  test("the U.S.-unit table agrees with the SI table NASA printed beside it (sea level, every Mach)", () => {
    const N = 4.44822;
    for (const [k, t] of [["idle", THRUST_IDLE], ["mil", THRUST_MIL], ["max", THRUST_MAX]] as const) {
      THRUST_SI_SEA_LEVEL[k].forEach((si, i) => expect(Math.abs(si / N - (t[i]?.[0] ?? 0))).toBeLessThan(2));
    }
  });
  test("maximum ≥ military ≥ idle everywhere except NASA's own corner (Mach 0.2, 50,000 ft), and dry thrust falls with altitude", () => {
    // NASA's table gives idle 1,700 lbf above military 1,400 lbf at Mach 0.2 and 50,000 ft; the SI half agrees
    // (7,562 N and 6,227 N). Kept as published.
    const exceptions: string[] = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 6; j++) {
      expect(THRUST_MAX[i]?.[j] ?? 0).toBeGreaterThanOrEqual(THRUST_MIL[i]?.[j] ?? 0);
      if ((THRUST_MIL[i]?.[j] ?? 0) <= (THRUST_IDLE[i]?.[j] ?? 0)) exceptions.push(`${THRUST_MACH[i]}@${THRUST_ALT_FT[j]}`);
      if (j > 0) expect(THRUST_MIL[i]?.[j] ?? 0).toBeLessThan(THRUST_MIL[i]?.[j - 1] ?? 0);
    }
    expect(exceptions).toEqual(["0.2@50000"]);
  });
  test("interpolation hits the table at its knots, stays inside each cell's range, and clamps outside", () => {
    THRUST_MACH.forEach((mach, i) => THRUST_ALT_FT.forEach((h, j) => expect(tableAt(THRUST_MAX, mach, h)).toBeCloseTo(THRUST_MAX[i]?.[j] ?? 0, 9)));
    fc.assert(fc.property(fc.double({ min: 0.2, max: 1, noNaN: true }), fc.double({ min: 0, max: 50000, noNaN: true }), (mach, h) => {
      const all = THRUST_MIL.flat(); const t = tableAt(THRUST_MIL, mach, h);
      expect(t).toBeGreaterThanOrEqual(Math.min(...all) - 1e-9); expect(t).toBeLessThanOrEqual(Math.max(...all) + 1e-9);
    }), { numRuns: 200 });
    expect(tableAt(THRUST_MAX, 0.05, -500)).toBe(THRUST_MAX[0]?.[0]);
  });
  test("power lever: 0 idle, 0.5 military, 1 maximum, monotone between", () => {
    expect(f16Thrust(0, 0.4, 10000)).toBeCloseTo(tableAt(THRUST_IDLE, 0.4, 10000), 9);
    expect(f16Thrust(0.5, 0.4, 10000)).toBeCloseTo(tableAt(THRUST_MIL, 0.4, 10000), 9);
    expect(f16Thrust(1, 0.4, 10000)).toBeCloseTo(tableAt(THRUST_MAX, 0.4, 10000), 9);
    let prev = -Infinity;
    for (let p = 0; p <= 1.0001; p += 0.01) { const t = f16Thrust(p, 0.6, 20000); expect(t).toBeGreaterThanOrEqual(prev); prev = t; }
  });
});

describe("live simulation core", () => {
  test("lags never overshoot and respect the rate limit", () => {
    fc.assert(fc.property(fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: 0.001, max: 0.5, noNaN: true }), (x, target, dt) => {
      const D = Math.PI / 180, y = lagStep(x, target, dt, ALPHA_TAU_S, ALPHA_RATE_DEG_S * D);
      expect(Math.abs(y - x)).toBeLessThanOrEqual(ALPHA_RATE_DEG_S * D * dt + 1e-12);
      expect(Math.min(x, target) - 1e-12).toBeLessThanOrEqual(y); expect(y).toBeLessThanOrEqual(Math.max(x, target) + 1e-12);
    }), { numRuns: 300 });
    let p = 0; for (let k = 0; k < 120 * 10; k++) p = lagStep(p, 1, FIXED_DT, ENGINE_TAU_S);
    expect(p).toBeGreaterThan(0.99);
  });

  test("frame-rate independent: the same wall time split into any frames gives the identical state", () => {
    const start = trimStart(L, 500, 15000);
    if (!start) throw new Error("no trim");
    const c = { alphaCmdDeg: 14, power: 0.9 };
    const run = (frames: number) => { let s = start.state, carry = 0; for (let k = 0; k < frames; k++) ({ state: s, carry } = advance(L, s, c, 5 / frames, carry)); return s; };
    const a = run(300), b = run(137), d = run(61);
    expect(b.t).toBeCloseTo(a.t, 9); expect(b.v).toBeCloseTo(a.v, 9); expect(b.h).toBeCloseTo(a.h, 9); expect(d.h).toBeCloseTo(a.h, 9);
  });

  test("trimmed start holds level flight with the controls left alone", () => {
    const start = trimStart(L, 500, 15000);
    if (!start) throw new Error("no trim");
    let s: LiveState = start.state, carry = 0;
    for (let k = 0; k < 600; k++) ({ state: s, carry } = advance(L, s, start.controls, 1 / 60, carry));
    expect(Math.abs(s.h - 15000)).toBeLessThan(1); expect(Math.abs(s.v - 500)).toBeLessThan(0.2); expect(s.status).toBe("flying");
    const tm = telemetry(L, s); // level flight: lift plus the thrust's upward component carries the weight
    expect(Math.abs((tm.lift + tm.thrust * Math.sin(tm.alpha)) / L.frame.weightLb - 1)).toBeLessThan(0.002);
  });

  test("with steady controls it matches the reference integrator (flight.ts) step for step", () => {
    const start = trimStart(L, 450, 10000);
    if (!start) throw new Error("no trim");
    const alpha = start.state.alpha, thrust = 6000;
    const fixed = { ...L, frame: { ...L.frame, thrust: () => thrust } };
    let s: LiveState = { ...start.state, power: 0.5 };
    for (let k = 0; k < 600; k++) s = stepLive(fixed, s, { alphaCmdDeg: (alpha * 180) / Math.PI, power: 0.5 });
    const ref = simulateFlight(v, m, { v: 450, gamma: 0, h: 10000, x: 0, vortex: start.state.vortex }, { alpha: () => rad(alpha), thrust: () => thrust }, 600 * FIXED_DT, FIXED_DT, L.frame);
    const r = ref[ref.length - 1];
    expect(s.v).toBeCloseTo(r?.v ?? 0, 6); expect(s.h).toBeCloseTo(r?.h ?? 0, 5); expect(s.gamma).toBeCloseTo(r?.gamma ?? 0, 8);
  });

  test("pulling up trades speed for height; the energy change matches the work of thrust minus drag", () => {
    const start = trimStart(L, 550, 12000);
    if (!start) throw new Error("no trim");
    let s: LiveState = start.state, work = 0;
    const c = { alphaCmdDeg: 12, power: start.controls.power };
    for (let k = 0; k < 120 * 6; k++) {
      const a = telemetry(L, s); s = stepLive(L, s, c); const b = telemetry(L, s);
      work += 0.5 * (((a.thrust * Math.cos(a.alpha) - a.drag) * a.v) / L.frame.weightLb + ((b.thrust * Math.cos(b.alpha) - b.drag) * b.v) / L.frame.weightLb) * FIXED_DT;
    }
    const e0 = telemetry(L, start.state).specificEnergy, e1 = telemetry(L, s).specificEnergy;
    expect(s.h).toBeGreaterThan(12000); expect(s.v).toBeLessThan(550);
    expect(Math.abs(e1 - e0 - work)).toBeLessThan(0.02 * Math.abs(work) + 2);
  });

  test("the run stops at the ground and caps work per advance", () => {
    const s0: LiveState = { t: 0, v: 300, gamma: -0.5, h: 50, x: 0, alpha: 0, power: 0, vortex: 1, status: "flying" };
    const r = advance(L, s0, { alphaCmdDeg: -5, power: 0 }, 10);
    expect(r.state.status).toBe("ground"); expect(stepLive(L, r.state, { alphaCmdDeg: 0, power: 0 })).toBe(r.state);
    expect(advance(L, trimStart(L, 500, 15000)?.state ?? s0, { alphaCmdDeg: 5, power: 0.5 }, 1000).steps).toBe(MAX_STEPS_PER_ADVANCE);
  });

  test("each aircraft's airframe uses its published weight and area, and says where its thrust comes from", () => {
    expect(L.frame.weightLb).toBe(20500); expect(L.frame.areaFt2).toBe(300); expect(L.frame.cd0).toBe(CD0_ALLOWANCE);
    expect(L.frame.thrustSource).toContain("TP-1538");
    const xl = liveAirframe(aircraftById("f16xl") ?? f16);
    expect(xl.thrust(1, 0.5, 10000)).toBe(23830); expect(xl.thrustSource).toContain("published");
    const harv = liveAirframe(aircraftById("harv") ?? f16);
    expect(harv.thrustSource).toContain("assumed");
  });
});
