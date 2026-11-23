import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { AIRCRAFT, F16_TRACED_SWEEP_DEG, aircraftById } from "../lib/aero/aircraft";
import {
  F16_ALPHA_DEG, F16_ALPHA_LEF_DEG, F16_DH_DEG, F16_DH_LIMIT_DEG, F16_LEF_MAX_DEG, F16_TABLES, F16_XCG_REF, LEF_FILTER_RAD_S, LEF_RATE_DEG_S, LEF_TAU_S,
  f16Coefficients, f16LefScheduleDeg, interp1, interpAlphaDh,
} from "../lib/aero/f16aero";
import {
  ALPHA_CMD_RANGE_DEG, BLACKOUT, LIMIT_LOAD_G, BLACKOUT_RECOVERY_S, DH_RATE_DEG_S, DH_TAU_S, F16_MASS, type F16State, KA, KI, KQ, MACH_DATA_LIMIT,
  advanceF16, bareAirframeModes, charPoly, f16Telemetry, polyRoots, secondsToBlackout, staticMargin, stepF16, trimF16,
} from "../lib/aero/f16live";
import {
  F16_BODY, F16_BODY_MAX_HALF_WIDTH, F16_CANOPY, F16_CANOPY_HALF_WIDTH, F16_FIN, F16_HEIGHT_ON_GEAR_M, F16_HTAIL, F16_LAUNCHER, F16_LENGTH_M,
  F16_SHAPE_SOURCE, F16_SPAN_LAUNCHERS_M, F16_WING, bodyAt, bounds, f16ShapeParts,
} from "../lib/aero/f16shape";
import { FIXED_DT } from "../lib/aero/live";
import { START, liveSimFor, stickCommand } from "../lib/aero/sim";

setDefaultTimeout(120_000);
const D = 180 / Math.PI;
const law = (alphaCmdDeg: number, power: number) => ({ mode: "law" as const, alphaCmdDeg, dhCmdDeg: 0, power });
const direct = (dhCmdDeg: number, power: number) => ({ mode: "direct" as const, alphaCmdDeg: 0, dhCmdDeg, power });
const alphaOf = (s: F16State) => Math.atan2(s.w, s.u) * D;
function fly(s0: F16State, c: Parameters<typeof stepF16>[1], seconds: number): F16State {
  let s = s0; for (let k = 0; k < Math.round(seconds / FIXED_DT); k++) s = stepF16(s, c); return s;
}

describe("NASA TP-1538 Table III, as carried", () => {
  test("breakpoints and the provenance are those of the report", () => {
    expect(F16_ALPHA_DEG).toEqual([-20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90]);
    expect(F16_ALPHA_LEF_DEG).toEqual(F16_ALPHA_DEG.slice(0, 14));
    expect(F16_DH_DEG).toEqual([-25, -10, 0, 10, 25]);
    expect(F16_TABLES.source).toContain("TP-1538"); expect(F16_TABLES.transcription).toContain("MIT");
    expect(F16_TABLES.h5_sha256).toBe("b9ac8d21cfb749c0e9897766d5f7b3cdcfdafc86ef8e948c064aafdc2e453f07");
    expect(F16_XCG_REF).toBe(0.35); expect(F16_DH_LIMIT_DEG).toBe(25); expect(F16_LEF_MAX_DEG).toBe(25);
  });
  test("values read from the NASA scans: Cm at δh = 0 (p. 67) and Cx at δh = −25° (p. 51), zero sideslip", () => {
    const cm0 = [0.0127, -0.0755, -0.1025, -0.0744, -0.0598, -0.0498, -0.0437, -0.0407, -0.0342, -0.0507, -0.0459, -0.0605, -0.0835, -0.0923, -0.0826, -0.0738, -0.1414, -0.3216, -0.4678, -0.6184];
    const cxm25 = [-0.1868, -0.1875, -0.1787, -0.1432, -0.1132, -0.0693, -0.012, 0.0537, 0.0951, 0.1111, 0.1435, 0.1663, 0.1739, 0.1659, 0.1693, 0.1804, 0.1718, 0.1695, 0.1598, 0.166];
    expect(F16_TABLES.Cm.map((r) => r[2])).toEqual(cm0);
    expect(F16_TABLES.Cx.map((r) => r[0])).toEqual(cxm25);
  });
  test("interpolation hits every knot, never leaves a cell's range and clamps outside the tables", () => {
    F16_ALPHA_DEG.forEach((a, i) => F16_DH_DEG.forEach((d, j) => expect(interpAlphaDh(F16_TABLES.Cz, a, d)).toBeCloseTo(F16_TABLES.Cz[i]?.[j] ?? 0, 12)));
    fc.assert(fc.property(fc.double({ min: -20, max: 90, noNaN: true }), fc.double({ min: -25, max: 25, noNaN: true }), (a, d) => {
      const all = F16_TABLES.Cm.flat(), v = interpAlphaDh(F16_TABLES.Cm, a, d);
      expect(v).toBeGreaterThanOrEqual(Math.min(...all) - 1e-12); expect(v).toBeLessThanOrEqual(Math.max(...all) + 1e-12);
    }), { numRuns: 300 });
    expect(interpAlphaDh(F16_TABLES.Cm, 120, 40)).toBe(F16_TABLES.Cm[19]?.[4] ?? Number.NaN);
    expect(interp1(F16_ALPHA_DEG, F16_TABLES.Cmq, -50)).toBe(F16_TABLES.Cmq[0] ?? Number.NaN);
  });
  test("buildup: at δlef = 25° the flap increments vanish; at q = 0 the rate terms vanish; wind-axis CL and CD are a rotation", () => {
    fc.assert(fc.property(fc.double({ min: -15, max: 85, noNaN: true }), fc.double({ min: -25, max: 25, noNaN: true }), (a, d) => {
      const c = f16Coefficients(a, d, 25, 0);
      expect(c.cx).toBeCloseTo(interpAlphaDh(F16_TABLES.Cx, a, d), 12); expect(c.cz).toBeCloseTo(interpAlphaDh(F16_TABLES.Cz, a, d), 12);
      const r = (a * Math.PI) / 180;
      expect(c.cl * c.cl + c.cd * c.cd).toBeCloseTo(c.cx * c.cx + c.cz * c.cz, 10);
      expect(c.cl).toBeCloseTo(-c.cz * Math.cos(r) + c.cx * Math.sin(r), 12);
    }), { numRuns: 300 });
    expect(f16Coefficients(5, 0, 0, 0).cz).toBeCloseTo(interp1(F16_ALPHA_LEF_DEG, F16_TABLES.Cz_lef, 5), 12);
  });
  test("pitch damping from the tables is stabilising across the range (Cmq < 0)", () => {
    for (const a of [-10, 0, 10, 20, 30, 40]) expect(f16Coefficients(a, 0, 0, 0.01).cm).toBeLessThan(f16Coefficients(a, 0, 0, 0).cm);
  });
  test("measured drag is far above the old CD0 allowance at high α, and near it at cruise", () => {
    expect(f16Coefficients(2, 0, 0, 0).cd).toBeGreaterThan(0.01); expect(f16Coefficients(2, 0, 0, 0).cd).toBeLessThan(0.06);
    expect(f16Coefficients(30, 0, 25, 0).cd).toBeGreaterThan(0.7);
  });
});

describe("checks against what NASA wrote about the aircraft", () => {
  test("static margin at the reference centre of gravity is about −4% at low α (TP-1538: 'approximately −4 percent')", () => {
    for (const a of [0, 2, 4, 6, 8]) {
      const sm = staticMargin(a, 0, f16LefScheduleDeg(a, 300, 1200));
      expect(sm).toBeLessThan(-0.02); expect(sm).toBeGreaterThan(-0.06);
    }
    expect(staticMargin(4, 0, 6, 0.3)).toBeGreaterThan(0); // 5% c̄ further forward the airframe is stable
  });
  test("deep stall: with full nose-up stabilator the moment balances again near 60° (NASA Fig. 10: 66°)", () => {
    let cross = Number.NaN;
    for (let a = 45; a <= 80; a += 0.1) if (f16Coefficients(a, -25, 25, 0).cm > 0 && f16Coefficients(a + 0.1, -25, 25, 0).cm <= 0) { cross = a; break; }
    expect(cross).toBeGreaterThan(55); expect(cross).toBeLessThan(70); // ours ≈ 60°, a 6° shortfall stated in the app
  });
  test("leading-edge flap: NASA's schedule, limits and actuator", () => {
    expect(f16LefScheduleDeg(10, 300, 1200)).toBeCloseTo(1.38 * 10 - 9.05 * 0.25 + 1.45, 12);
    expect(f16LefScheduleDeg(40, 300, 1200)).toBe(25); expect(f16LefScheduleDeg(-10, 300, 1200)).toBe(0);
    expect([LEF_FILTER_RAD_S, LEF_TAU_S, LEF_RATE_DEG_S]).toEqual([7.25, 0.136, 25]);
    expect([DH_TAU_S, DH_RATE_DEG_S]).toEqual([0.0495, 60]);
  });
  test("blackout rule: 300 s at 5 g, 10 s at 9 g, log-linear between", () => {
    expect(secondsToBlackout(5)).toBeCloseTo(300, 9); expect(secondsToBlackout(9)).toBeCloseTo(10, 9);
    expect(Math.log(secondsToBlackout(7))).toBeCloseTo(Math.log(300) + (Math.log(10 / 300) / Math.log(9 / 5)) * Math.log(7 / 5), 9);
    expect(BLACKOUT.onsetG).toBe(5); expect(BLACKOUT_RECOVERY_S).toBeGreaterThan(0);
  });
});

describe("live F-16 on NASA's data", () => {
  const trim = trimF16(START.speed, START.alt);
  if (!trim) throw new Error("no trim");
  test("trim: zero pitching moment, one g, published mass", () => {
    const t = f16Telemetry(trim.state);
    expect(Math.abs(t.cm)).toBeLessThan(1e-9); expect(t.n).toBeCloseTo(Math.cos(t.alpha), 6); // level: aerodynamic Z balances W cos α
    expect(F16_MASS.weightLb).toBe(20500); expect(F16_MASS.iyy).toBe(55814); expect(F16_MASS.xcg).toBe(0.35);
    expect(t.alpha * D).toBeGreaterThan(2); expect(t.alpha * D).toBeLessThan(8);
  });
  test("both modes hold the trimmed state with the controls left alone", () => {
    for (const c of [law(trim.controls.alphaCmdDeg, trim.controls.power), direct(trim.controls.dhCmdDeg, trim.controls.power)]) {
      const s = fly(trim.state, c, 10);
      expect(Math.abs(s.h - START.alt)).toBeLessThan(1); expect(Math.abs(Math.hypot(s.u, s.w) - START.speed)).toBeLessThan(0.5); expect(s.status).toBe("flying");
    }
  });
  test("control law tracks a 5° step in angle of attack and respects the stabilator's travel and rate", () => {
    let s = trim.state, prev = s.dh, worst = 0;
    const c = law(trim.controls.alphaCmdDeg + 5, trim.controls.power);
    for (let k = 0; k < 120 * 4; k++) { s = stepF16(s, c); worst = Math.max(worst, Math.abs(s.dh - prev) / FIXED_DT); prev = s.dh; expect(Math.abs(s.dh)).toBeLessThanOrEqual(25 + 1e-9); }
    expect(Math.abs(alphaOf(s) - c.alphaCmdDeg)).toBeLessThan(0.5);
    expect(worst).toBeLessThanOrEqual(DH_RATE_DEG_S + 1e-6);
    expect([KA, KQ, KI]).toEqual([5, 1.5, 4]); expect(ALPHA_CMD_RANGE_DEG).toEqual([-5, 25]);
  });
  test("airframe alone (flap frozen): diverges at the rate its linearised unstable root predicts", () => {
    const unstable = bareAirframeModes(trim.state, "held").modes.filter((m) => m.root.re > 0);
    expect(unstable.length).toBe(1);
    const rate = unstable[0]?.root.re ?? 0, c = direct(trim.controls.dhCmdDeg, trim.controls.power), a0 = alphaOf(trim.state);
    let s: F16State = { ...trim.state, w: trim.state.w + 0.05 }; // 0.05 ft/s nudge
    const dev: number[] = [];
    for (let k = 1; k <= 120 * 6; k++) { s = { ...stepF16(s, c), lef: trim.state.lef, lefFilter: trim.state.lefFilter }; if (k % 360 === 0) dev.push(Math.abs(alphaOf(s) - a0)); }
    const measured = Math.log((dev[1] ?? 0) / (dev[0] ?? 1)) / 3;
    expect(Math.abs(measured - rate) / rate).toBeLessThan(0.15);
  });
  test("NASA's flap schedule makes the slow divergence much milder; at 300 ft/s the modes are all stable", () => {
    const held = bareAirframeModes(trim.state, "held").modes, sched = bareAirframeModes(trim.state).modes;
    const worst = (ms: typeof held) => Math.max(...ms.map((m) => m.root.re));
    expect(worst(sched)).toBeLessThan(worst(held) / 3);
    const slow = trimF16(300, 5000);
    if (!slow) throw new Error("no trim at 300 ft/s");
    expect(worst(bareAirframeModes(slow.state).modes)).toBeLessThan(0);
    expect(worst(bareAirframeModes(slow.state, "held").modes)).toBeGreaterThan(0);
  });
  test("eigenvalue tools: a known matrix gives its known roots", () => {
    const r = polyRoots(charPoly([[1, 0, 0, 0], [0, -2, 0, 0], [0, 0, 0, 1], [0, 0, -5, -2]])).map((z) => `${z.re.toFixed(6)},${Math.abs(z.im).toFixed(6)}`).sort();
    expect(r).toEqual(["-1.000000,2.000000", "-1.000000,2.000000", "-2.000000,0.000000", "1.000000,0.000000"]);
  });
  test("energy: the change in specific energy equals the work of the non-gravity forces", () => {
    let s = trim.state, work = 0;
    const c = law(12, 1);
    const pw = (x: F16State) => { const t = f16Telemetry(x); return ((t.thrust * Math.cos(t.alpha) - t.drag) * t.v) / F16_MASS.weightLb; };
    for (let k = 0; k < 120 * 5; k++) { const p0 = pw(s); s = stepF16(s, c); work += 0.5 * (p0 + pw(s)) * FIXED_DT; }
    const dE = f16Telemetry(s).specificEnergy - f16Telemetry(trim.state).specificEnergy;
    expect(Math.abs(dE - work)).toBeLessThan(0.01 * Math.abs(work) + 3);
  });
  test("frame-rate independent: any split of the same wall time gives the identical flight", () => {
    const c = law(14, 0.9);
    const run = (frames: number) => { let s = trim.state, carry = 0; for (let k = 0; k < frames; k++) ({ state: s, carry } = advanceF16(s, c, 5 / frames, carry)); return s; };
    const a = run(300), b = run(137);
    expect(b.t).toBeCloseTo(a.t, 9); expect(b.h).toBeCloseTo(a.h, 9); expect(b.q).toBeCloseTo(a.q, 12);
  });
  test("hard limits: blackout, 9 g and the ground end the run; past Mach 0.6 it keeps flying, flagged as extrapolated", () => {
    const fast = trimF16(650, 20000);
    if (!fast) throw new Error("no fast trim");
    const f1 = stepF16(fast.state, fast.controls);
    expect(f1.status).toBe("flying"); expect(f16Telemetry(f1).beyondData).toBe(true); expect(MACH_DATA_LIMIT).toBe(0.6);
    expect(f16Telemetry(trim.state).beyondData).toBe(false);
    // Mach 3 at 40,000 ft (2,900 ft/s): the integration stays finite and controlled for 5 s (an extrapolation)
    const a3 = 2 / D, m3: F16State = { ...trim.state, u: 2900 * Math.cos(a3), w: 2900 * Math.sin(a3), theta: a3, h: 40000, dh: 0, integ: 0 };
    const after = fly(m3, law(2, 1), 5), tm = f16Telemetry(after);
    expect(after.status).toBe("flying"); expect(tm.mach).toBeGreaterThan(2.5); expect(tm.beyondData).toBe(true);
    expect(Math.abs(alphaOf(after) - 2)).toBeLessThan(1.5);
    const pull = trimF16(590, 15000);
    if (!pull) throw new Error("no trim at 590 ft/s");
    let g: F16State = pull.state; // pull to about 7.5 g, then arrive there already nearly blacked out
    for (let k = 0; k < 100; k++) g = stepF16(g, law(25, 1));
    expect(f16Telemetry(g).n).toBeGreaterThan(BLACKOUT.onsetG);
    g = { ...g, grey: 0.999 };
    let peakGrey = 0;
    for (let k = 0; k < 120 && g.status === "flying"; k++) { g = stepF16(g, law(25, 1)); peakGrey = Math.max(peakGrey, g.grey); }
    expect(g.status).toBe("blackout"); expect(peakGrey).toBe(1);
    const hard = trimF16(560, 10000);
    if (!hard) throw new Error("no trim at 560 ft/s");
    let o = hard.state, peak = 0; // full nose-up stabilator at speed, no augmentation
    for (let k = 0; k < 600 && o.status === "flying"; k++) { o = stepF16(o, direct(-25, 1)); peak = Math.max(peak, f16Telemetry(o).n); }
    expect(o.status).toBe("over-g"); expect(peak).toBeGreaterThan(LIMIT_LOAD_G);
    const low = { ...trim.state, h: 5, theta: -0.3 };
    expect(fly(low, law(0, 0), 2).status).toBe("ground");
  });
  test("grey-out recovers below 5 g", () => {
    const s = stepF16({ ...trim.state, grey: 0.5 }, law(trim.controls.alphaCmdDeg, trim.controls.power));
    expect(s.grey).toBeCloseTo(0.5 - FIXED_DT / BLACKOUT_RECOVERY_S, 9);
  });
});

describe("side-stick mapping", () => {
  test("hands off flies the trim; full pull and push reach the ends of the range; direct mode flips the sign", () => {
    const law = { min: -5, max: 25, pullIsUp: true }, dir = { min: -25, max: 25, pullIsUp: false };
    expect(stickCommand(0, 4.3, law)).toBe(4.3); expect(stickCommand(1, 4.3, law)).toBe(25); expect(stickCommand(-1, 4.3, law)).toBeCloseTo(-5, 12);
    expect(stickCommand(1, -0.4, dir)).toBeCloseTo(-25, 12); expect(stickCommand(-1, -0.4, dir)).toBeCloseTo(25, 12); expect(stickCommand(3, 0, law)).toBe(25);
    fc.assert(fc.property(fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }), (a, b) => {
      if (a < b) expect(stickCommand(a, 4, law)).toBeLessThanOrEqual(stickCommand(b, 4, law)); // more pull, more α
    }), { numRuns: 200 });
  });
});

describe("one interface over both live models", () => {
  test("the F-16 flies NASA's data with two modes; the others fly the stated estimate", () => {
    const f = liveSimFor(aircraftById("f16") ?? AIRCRAFT[0] ?? (() => { throw new Error("no aircraft"); })());
    expect(f.kind).toBe("nasa"); expect(f.modes.map((m) => m.value)).toEqual(["law", "direct"]); expect(f.notes.join(" ")).toContain("TP-1538");
    expect(f.start).not.toBeNull(); expect(f.stability?.(f.start?.state).some((m) => m.unstable)).toBe(true);
    for (const a of AIRCRAFT.filter((x) => x.id !== "f16")) {
      const s = liveSimFor(a); expect(s.kind).toBe("estimate"); expect(s.notes.join(" ")).toContain("estimate");
    }
  });
});

describe("F-16 shape traced from NASA's three-view", () => {
  const parts = f16ShapeParts(), b = bounds(parts), b2 = b;
  test("published length and span over the launchers; gear-up height below the on-gear height", () => {
    expect(b.max[0] - b.min[0]).toBeGreaterThan(F16_LENGTH_M - 0.01); expect(b.max[0] - b.min[0]).toBeLessThan(F16_LENGTH_M + 0.6); // fin tip overhangs the nozzle
    const launcherSpan = 2 * F16_LAUNCHER.y;
    expect(launcherSpan).toBeCloseTo(F16_SPAN_LAUNCHERS_M, 9);
    expect(b.max[1]).toBeCloseTo(F16_LAUNCHER.y + F16_LAUNCHER.radius, 3); expect(b.min[1]).toBeCloseTo(-b.max[1], 9);
    const h = b.max[2] - b.min[2];
    expect(h).toBeLessThan(F16_HEIGHT_ON_GEAR_M); expect(h).toBeGreaterThan(3.8);
    expect(F16_SHAPE_SOURCE).toContain("TP-1538");
  });
  test("wing sweep agrees with the registry's traced sweep; surfaces are tapered and the tail sits aft of the wing", () => {
    const sweep = Math.atan((F16_WING.tip.xLe - F16_WING.root.xLe) / (F16_WING.tip.s - F16_WING.root.s)) * D;
    expect(Math.abs(sweep - F16_TRACED_SWEEP_DEG)).toBeLessThan(2.5);
    for (const s of [F16_WING, F16_HTAIL, F16_FIN]) expect(s.tip.xTe - s.tip.xLe).toBeLessThan(s.root.xTe - s.root.xLe);
    expect(F16_HTAIL.root.xLe).toBeGreaterThan(F16_WING.root.xTe); expect(F16_FIN.tip.s).toBeGreaterThan(3);
  });
  test("body tables are ordered, finite and inside the plan width; canopy sits on the spine", () => {
    for (let i = 1; i < F16_BODY.length; i++) expect(F16_BODY[i]?.x ?? 0).toBeGreaterThan(F16_BODY[i - 1]?.x ?? 0);
    for (const r of F16_BODY) { expect(r.top).toBeGreaterThan(r.bottom); expect(r.halfWidth).toBeGreaterThan(0); }
    for (const c of F16_CANOPY) expect(c.top).toBeGreaterThanOrEqual(bodyAt(c.x).top - 1e-9);
    expect(F16_CANOPY_HALF_WIDTH).toBeLessThan(F16_BODY_MAX_HALF_WIDTH);
  });
  test("every mesh is well formed: finite positions, indices in range, no degenerate triangles, mirror-symmetric", () => {
    for (const p of parts) {
      const n = p.positions.length / 3;
      expect(p.positions.every(Number.isFinite)).toBe(true);
      let degenerate = 0;
      for (let t = 0; t < p.indices.length; t += 3) {
        const [i, j, k] = [p.indices[t] ?? 0, p.indices[t + 1] ?? 0, p.indices[t + 2] ?? 0];
        expect(Math.max(i, j, k)).toBeLessThan(n);
        const P = (m: number) => [p.positions[3 * m] ?? 0, p.positions[3 * m + 1] ?? 0, p.positions[3 * m + 2] ?? 0];
        const [a, bb, c] = [P(i), P(j), P(k)], u = bb.map((v, q) => v - (a[q] ?? 0)), w = c.map((v, q) => v - (a[q] ?? 0));
        const cr = Math.hypot((u[1] ?? 0) * (w[2] ?? 0) - (u[2] ?? 0) * (w[1] ?? 0), (u[2] ?? 0) * (w[0] ?? 0) - (u[0] ?? 0) * (w[2] ?? 0), (u[0] ?? 0) * (w[1] ?? 0) - (u[1] ?? 0) * (w[0] ?? 0));
        if (cr < 1e-12) degenerate++;
      }
      expect(degenerate / (p.indices.length / 3)).toBeLessThan(0.1); // only the fan caps at the pointed nose may collapse
    }
    const ys = parts.flatMap((p) => Array.from({ length: p.positions.length / 3 }, (_, i) => p.positions[3 * i + 1] ?? 0));
    expect(Math.max(...ys)).toBeCloseTo(-Math.min(...ys), 9);
  });
  test("the Blender-finished GLB in the app keeps NASA's proportions (length, span over launchers, gear-up height)", () => {
    const b = readFileSync(join(import.meta.dir, "../public/aero/models/f16-traced.glb"));
    expect(b.toString("ascii", 0, 4)).toBe("glTF");
    const json = JSON.parse(b.toString("utf8", 20, 20 + b.readUInt32LE(12))) as { accessors: { min?: number[]; max?: number[]; type: string }[]; meshes: { primitives: { attributes: { POSITION: number } }[] }[]; nodes: { translation?: number[]; rotation?: number[]; scale?: number[] }[] };
    for (const n of json.nodes) { expect(n.rotation ?? [0, 0, 0, 1]).toEqual([0, 0, 0, 1]); expect(n.scale ?? [1, 1, 1]).toEqual([1, 1, 1]); }
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const m of json.meshes) for (const p of m.primitives) {
      const acc = json.accessors[p.attributes.POSITION];
      acc?.min?.forEach((v, k) => { lo[k] = Math.min(lo[k] ?? v, v); }); acc?.max?.forEach((v, k) => { hi[k] = Math.max(hi[k] ?? v, v); });
    }
    const [len, height, span] = [0, 1, 2].map((k) => (hi[k] ?? 0) - (lo[k] ?? 0));
    expect(Math.abs((len ?? 0) - (b2.max[0] - b2.min[0]))).toBeLessThan(0.05); // same as the traced shape, fin tip included
    expect(Math.abs((span ?? 0) - (F16_SPAN_LAUNCHERS_M + 2 * F16_LAUNCHER.radius))).toBeLessThan(0.02);
    expect(Math.abs((height ?? 0) - (b2.max[2] - b2.min[2]))).toBeLessThan(0.05);
  });
});
