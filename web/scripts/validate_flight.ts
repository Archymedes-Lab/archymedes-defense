/**
 * Compare the F-106B model with NASA's published flight and trim conditions, and fit the one thing the flat-plate
 * engine cannot know about a real wing: where a rounded, cambered leading edge starts shedding a vortex.
 * Writes lib/data/aero-flight.json. Run: bun scripts/validate_flight.ts
 *
 * What is compared
 *  A. Trim point (NASA TP-2747 Table III, absolute): weight, speed, flight-path angle, thrust and elevon are
 *     published, so the lift coefficient the aircraft needs is known. Model variants: bare wing (the engine as it
 *     was), and trimmed with the elevon, with a sharp or an attached leading edge.
 *  B. Flight table (NASA TP-3374 Table I, 27 subsonic points on five flights): angle of attack, altitude, Mach and
 *     load factor are published; the weight is not. In steady flight n W = CL q S, so each point gives the weight the
 *     model implies. A correct lift curve gives the same weight for every point of a flight (fuel burn aside), so the
 *     spread of implied weight tests the SHAPE of the lift curve without knowing the weight.
 *
 * The fit
 *  The rounded-edge blend (onset and full-vortex angles) is chosen to make implied weight most nearly constant within
 *  each flight. It is scored by leave-one-flight-out: the blend is fitted on four flights and the spread measured on
 *  the fifth. The trim point (a different report, a different method, absolute) is never used in the fit: it is the
 *  independent check of the fitted model's LEVEL.
 *
 * Criteria (written 2026-11-23 after the first comparison of the unfitted variants, before the blend was fitted):
 *   F1  trim point: |CL model − CL required| / CL required ≤ 0.05 for the fitted model
 *   F2  trim point: |elevon predicted − published| ≤ 1.0°
 *   F3  held-out spread of implied weight within a flight ≤ 5% (coefficient of variation), pooled
 *   F4  mean implied weight inside the published weight envelope [empty-ish simulation weight 27,400 lb, +40%]
 */
import { writeFileSync } from "node:fs";
import { aircraftById } from "../lib/aero/aircraft";
import { F106B_APPROACH_TRIM as T, F106B_FLIGHT, MACH_LIMIT } from "../lib/aero/flightdata";
import { type EdgeBlend, KNOT_FTPS, dynamicPressure, impliedWeight, liftWithElevon, requiredLift, trimElevon, trimModel, trimmedLiftBlend, wingLift } from "../lib/aero/trim";
import { deg, rad, toDeg, toRad } from "../lib/aero/units";
import { solveVlm } from "../lib/aero/vlm";
import { vortexModel } from "../lib/aero/vortex";

const ac = aircraftById("f106b");
if (!ac) throw new Error("f106b missing");
const v = solveVlm(ac.planform(), { nSpan: 24, nChord: 12 }), m = vortexModel(v), tm = trimModel(v, ac);
const S = ac.published.referenceAreaFt2?.value ?? 0;
const SHARP: EdgeBlend = { onsetDeg: 0, fullDeg: 0 }, ATTACHED: EdgeBlend = { onsetDeg: 89, fullDeg: 90 };
const r3 = (x: number) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------- A. trim point
const aT = toRad(deg(T.alphaDeg)), dT = toRad(deg(T.elevonDeg));
const qT = dynamicPressure((T.velocityKnots * KNOT_FTPS) / 1116.45, 0); // sea level: a = 1116.45 ft/s
const clRequired = requiredLift({ weightLb: T.weightLb, loadFactor: 1, q: qT, areaFt2: T.areaFt2, alpha: aT, gamma: toRad(deg(T.gammaDeg)), thrustLb: T.thrustLb });
const bare = wingLift(v, m, aT, "sharp");
const trimRow = (label: string, cl: number, elevonDeg: number | null) => ({ label, cl: r3(cl), error: r3(cl / clRequired - 1), elevonDeg: elevonDeg === null ? null : r3(elevonDeg) });

// ---------------------------------------------------------------- B. flight table
const pts = F106B_FLIGHT.filter((p) => p.mach < MACH_LIMIT).map((p) => ({ ...p, flight: p.serial.split("/")[0] ?? "", q: dynamicPressure(p.mach, p.altitudeFt) }));
const flights = [...new Set(pts.map((p) => p.flight))].sort();
const weights = (b: EdgeBlend, sel = pts) => sel.map((p) => impliedWeight(trimmedLiftBlend(v, m, tm, toRad(deg(p.alphaDeg)), b).cl, p.q, S, p.loadFactor));
const mean = (xs: number[]) => xs.reduce((a, c) => a + c, 0) / xs.length;
/** Pooled within-flight coefficient of variation of implied weight (each flight about its own mean). */
const spread = (b: EdgeBlend, sel = pts) => {
  let ss = 0, n = 0;
  for (const f of new Set(sel.map((p) => p.flight))) {
    const w = weights(b, sel.filter((p) => p.flight === f)), mu = mean(w);
    for (const x of w) { ss += (x / mu - 1) ** 2; n++; }
  }
  return Math.sqrt(ss / n);
};
const GRID: EdgeBlend[] = [];
for (let on = 0; on <= 20; on += 1) for (let full = on + 2; full <= 45; full += 1) GRID.push({ onsetDeg: on, fullDeg: full });
const fit = (sel: typeof pts) => GRID.reduce((best, b) => (spread(b, sel) < spread(best, sel) ? b : best), GRID[0] ?? SHARP);

// leave-one-flight-out
const held = flights.map((f) => {
  const b = fit(pts.filter((p) => p.flight !== f)), out = pts.filter((p) => p.flight === f);
  const w = weights(b, out), mu = mean(w);
  return { flight: f, n: out.length, blend: b, cv: r3(Math.sqrt(mean(w.map((x) => (x / mu - 1) ** 2)))), meanWeightLb: Math.round(mu), sq: w.map((x) => (x / mu - 1) ** 2) };
});
const heldCv = Math.sqrt(mean(held.flatMap((h) => h.sq)));
const blend = fit(pts);

const variant = (label: string, b: EdgeBlend) => {
  const w = weights(b);
  return { label, blend: b, withinFlightCv: r3(spread(b)), meanWeightLb: Math.round(mean(w)), minWeightLb: Math.round(Math.min(...w)), maxWeightLb: Math.round(Math.max(...w)),
    points: pts.map((p, k) => ({ serial: p.serial, flight: p.flight, group: p.group, alphaDeg: p.alphaDeg, mach: p.mach, weightLb: Math.round(w[k] ?? 0) })) };
};
const fitted = trimmedLiftBlend(v, m, tm, aT, blend);
const trim = {
  source: T.source, assumed: T.assumed, alphaDeg: T.alphaDeg, publishedElevonDeg: T.elevonDeg, clRequired: r3(clRequired),
  rows: [
    trimRow("Bare wing, sharp edge (the engine before this work)", bare.potential + bare.vortex, null),
    trimRow("With the elevon at its published angle, sharp edge", liftWithElevon(v, m, tm, aT, dT, "sharp"), T.elevonDeg),
    trimRow("With the elevon at its published angle, attached edge", liftWithElevon(v, m, tm, aT, dT, "attached"), T.elevonDeg),
    trimRow("Trimmed by the model, rounded edge fitted to the flight table", fitted.cl, toDeg(fitted.elevon)),
  ],
  predictedElevonDeg: { attached: r3(toDeg(trimElevon(v, m, tm, aT, "attached"))), sharp: r3(toDeg(trimElevon(v, m, tm, aT, "sharp"))), fitted: r3(toDeg(fitted.elevon)) },
};
const fittedVariant = variant("Rounded edge, fitted", blend);
const f1 = Math.abs(fitted.cl / clRequired - 1), f2 = Math.abs(toDeg(fitted.elevon) - T.elevonDeg);
const envelope: [number, number] = [T.weightLb, Math.round(T.weightLb * 1.4)];
const out = {
  generated: "scripts/validate_flight.ts", aircraft: ac.id,
  lattice: { kp: r3(v.kp), kv: r3(m.kv), elevonLiftPerRad: r3(tm.elevon.k), elevonXcp: r3(tm.elevon.xCp), xCg: r3(tm.xCg) },
  trim,
  flight: {
    source: "NASA TP-3374, Table I", pointsUsed: pts.length, pointsExcluded: F106B_FLIGHT.length - pts.length, excludedWhy: `Mach ≥ ${MACH_LIMIT} (no compressibility model)`,
    flights, variants: [variant("Sharp edge (the engine's assumption)", SHARP), variant("Attached edge (no vortex lift)", ATTACHED), fittedVariant],
    blend, heldOut: held.map(({ sq: _sq, ...h }) => h), heldOutCv: r3(heldCv),
    curve: Array.from({ length: 27 }, (_, k) => k).map((a) => ({ alphaDeg: a, sharp: r3(trimmedLiftBlend(v, m, tm, toRad(deg(a)), SHARP).cl), attached: r3(trimmedLiftBlend(v, m, tm, toRad(deg(a)), ATTACHED).cl), fitted: r3(trimmedLiftBlend(v, m, tm, toRad(deg(a)), blend).cl), share: r3(trimmedLiftBlend(v, m, tm, rad((a * Math.PI) / 180), blend).share) })),
  },
  criteria: {
    F1: { text: "Trim point: fitted model's lift within 5% of the lift the published condition requires", pass: f1 <= 0.05, value: r3(f1) },
    F2: { text: "Trim point: predicted elevon within 1.0° of the published angle", pass: f2 <= 1.0, value: r3(f2) },
    F3: { text: "Flight table: held-out spread of implied weight within a flight at most 5%", pass: heldCv <= 0.05, value: r3(heldCv) },
    F4: { text: `Flight table: mean implied weight between ${envelope[0].toLocaleString("en")} lb (NASA's simulation weight) and ${envelope[1].toLocaleString("en")} lb`, pass: fittedVariant.meanWeightLb >= envelope[0] && fittedVariant.meanWeightLb <= envelope[1], value: fittedVariant.meanWeightLb },
  },
  limits: ["The flight weight of each run is not published: the flight table tests the shape of the lift curve and gives only a plausibility check on its level.",
    "Fuel burned between runs of one flight lowers the true weight by an unknown amount, which the within-flight spread includes.",
    "The trim point is NASA's simulation model (from 0.15-scale wind-tunnel tests), gear down and speed brakes out; density is assumed sea-level standard.",
    "The centre of gravity in flight is taken as the 28% of the simulation report.", "No fuselage, fin, camber or compressibility in the model."],
};
writeFileSync(new URL("../lib/data/aero-flight.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify({ clRequired: out.trim.clRequired, trim: out.trim.rows.map((r) => [r.label.slice(0, 34), r.cl, r.error, r.elevonDeg]), blend, heldOutCv: out.flight.heldOutCv,
  variants: out.flight.variants.map((x) => [x.label.slice(0, 20), x.withinFlightCv, x.meanWeightLb]), held: out.flight.heldOut.map((h) => [h.flight, h.n, h.blend.onsetDeg, h.blend.fullDeg, h.cv, h.meanWeightLb]),
  criteria: Object.fromEntries(Object.entries(out.criteria).map(([k, c]) => [k, [c.pass, c.value]])) }));
