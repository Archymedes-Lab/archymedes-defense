/**
 * Calibrate the one free parameter (vortex lift retained aft of a burst) and measure the error bands, all by
 * leave-one-wing-out: every number reported for a wing comes from a fit that never saw that wing.
 * Writes lib/data/aero-validation.json. Run: bun scripts/validate_aero.ts
 *
 * Acceptance criteria were written before the first run (2026-11-20) and are not tuned afterwards:
 *   C1  attached-regime RMS(CL) ≤ 0.05 on every in-domain wing
 *   C2  |CLmax error| ≤ 0.15 and |α at CLmax error| ≤ 5° on every in-domain wing whose data pass CLmax
 *   C3  pooled leave-one-wing-out coverage of the 90% band within [0.80, 0.97]
 *   C4  out-of-domain cases are flagged as extrapolation at every point
 *
 * Result of the first run, kept as the baseline: pooled coverage 0.771 (C3 failed) because wings differ more from each
 * other than points within a wing. Change made afterwards and disclosed on the page: the band is widened by a factor k
 * chosen by NESTED leave-one-wing-out (k is fit without the held-out wing), so the reported coverage is still out of
 * sample. C1 and C2 are physics misses and are reported, not tuned.
 */
import { writeFileSync } from "node:fs";
import corpus from "../lib/data/aero-corpus.json";
import { NOMINAL, type Regime, bandsFrom, clBounds, regimeOf, scaledResidual } from "../lib/aero/error-model";
import { type Planform, deltaWing } from "../lib/aero/geometry";
import { harvPlanform } from "../lib/aero/harv";
import { analyse } from "../lib/aero/predict";
import { deg, toRad } from "../lib/aero/units";
import { solveVlm } from "../lib/aero/vlm";
import { SWEEP_VALIDATED, polarPoint, vortexModel } from "../lib/aero/vortex";

interface Pt { alphaDeg: number; cl: number; sigmaCl: number }
interface Case { id: string; kind: string; sweepDeg?: number; source: string; figure: string; points: Pt[] }
const cases = corpus.cases as unknown as Case[];
const planformOf = (c: Case): Planform => (c.kind === "delta" ? deltaWing(deg(c.sweepDeg ?? 60)) : harvPlanform());
const inDomain = (c: Case) => c.kind === "delta" && (c.sweepDeg ?? 0) >= SWEEP_VALIDATED[0] && (c.sweepDeg ?? 0) <= SWEEP_VALIDATED[1];

const solved = new Map(cases.map((c) => { const v = solveVlm(planformOf(c)); return [c.id, { v, m: vortexModel(v) }] as const; }));
// Breakdown ramp widths tried (degrees). Default: the original step model only. AERO_RAMPS="0,2,4" fits the ramp
// jointly with the retained share inside every leave-one-wing-out fit, so the comparison stays out of sample.
const RAMPS = (process.env.AERO_RAMPS ?? "0").split(",").map(Number);
type Fit = { r: number; w: number };
const evalCase = (c: Case, f: Fit) => {
  const s = solved.get(c.id);
  if (s === undefined) throw new Error(c.id);
  return c.points.map((p) => {
    const q = polarPoint(s.v, s.m, toRad(deg(p.alphaDeg)), 0.006, f.r, f.w);
    return { alphaDeg: p.alphaDeg, data: p.cl, model: q.cl, regime: regimeOf(q.lost), s: scaledResidual(p.cl, q.cl) };
  });
};
const GRID = Array.from({ length: 101 }, (_, k) => k / 100);
const fitRetained = (train: Case[]): Fit => {
  let best: Fit = { r: 0, w: 0 }, bv = Number.POSITIVE_INFINITY;
  for (const w of RAMPS) for (const r of GRID) {
    const v = train.reduce((acc, c) => acc + evalCase(c, { r, w }).reduce((a, x) => a + (x.data - x.model) ** 2, 0), 0);
    if (v < bv) { bv = v; best = { r, w }; }
  }
  return best;
};
const maxOf = (c: Case, f: Fit) => {
  const s = solved.get(c.id);
  if (s === undefined) throw new Error(c.id);
  let m = { a: 0, cl: -1 };
  for (let a = 0; a <= 60; a += 0.25) { const q = polarPoint(s.v, s.m, toRad(deg(a)), 0.006, f.r, f.w); if (q.cl > m.cl) m = { a, cl: q.cl }; }
  return m;
};
const rms = (xs: number[]) => (xs.length === 0 ? null : Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / xs.length));

const D = cases.filter(inDomain), OUT = cases.filter((c) => !inDomain(c));
const K_GRID = Array.from({ length: 61 }, (_, k) => 1 + k * 0.05);
/** Pooled leave-one-wing-out coverage of the band widened by k, over the given wings. */
const lowoCoverage = (wings: Case[], k: number) => {
  let cov = 0, tot = 0;
  for (const h of wings) {
    const train = wings.filter((c) => c.id !== h.id);
    const r = fitRetained(train);
    const b = bandsFrom(train.flatMap((c) => evalCase(c, r)));
    for (const x of evalCase(h, r)) { const lim = clBounds(x.model, { ...b[x.regime], lo: b[x.regime].lo * k, hi: b[x.regime].hi * k }, false); tot++; if (x.data >= lim.lo && x.data <= lim.hi) cov++; }
  }
  return cov / tot;
};
const widenFor = (wings: Case[]) => K_GRID.find((k) => lowoCoverage(wings, k) >= NOMINAL) ?? K_GRID[K_GRID.length - 1] ?? 4;
let coveredW = 0;
const rows = [];
let covered = 0, total = 0;
for (const h of D) {
  const train = D.filter((c) => c.id !== h.id);
  const r = fitRetained(train);
  const bands = bandsFrom(train.flatMap((c) => evalCase(c, r)));
  const kH = widenFor(train);
  const pts = evalCase(h, r).map((x) => {
    const b = clBounds(x.model, bands[x.regime], false);
    const w = clBounds(x.model, { ...bands[x.regime], lo: bands[x.regime].lo * kH, hi: bands[x.regime].hi * kH }, false);
    return { ...x, lo: w.lo, hi: w.hi, inBand: x.data >= w.lo && x.data <= w.hi, inBaseBand: x.data >= b.lo && x.data <= b.hi };
  });
  covered += pts.filter((p) => p.inBaseBand).length; coveredW += pts.filter((p) => p.inBand).length; total += pts.length;
  const dMax = h.points.reduce((a, b) => (b.cl > a.cl ? b : a));
  const last = h.points[h.points.length - 1];
  const passesMax = last !== undefined && last.alphaDeg > dMax.alphaDeg + 2; // the data show the peak, not just the end
  const mMax = maxOf(h, r);
  const att = pts.filter((p) => p.regime === "attached").map((p) => p.data - p.model);
  rows.push({
    id: h.id, sweepDeg: h.sweepDeg, source: h.source, figure: h.figure, retainedHeldOut: r.r, rampHeldOut: r.w, widenHeldOut: kH, n: pts.length,
    rmsAll: rms(pts.map((p) => p.data - p.model)), rmsAttached: rms(att),
    clMax: passesMax ? { data: dMax.cl, dataAlpha: dMax.alphaDeg, model: +mMax.cl.toFixed(4), modelAlpha: mMax.a } : null,
    coverage: pts.filter((p) => p.inBand).length / pts.length, coverageBase: pts.filter((p) => p.inBaseBand).length / pts.length,
    c1: att.length === 0 ? null : (rms(att) ?? 0) <= 0.05,
    c2: passesMax ? Math.abs(mMax.cl - dMax.cl) <= 0.15 && Math.abs(mMax.a - dMax.alphaDeg) <= 5 : null,
    points: pts.map((p) => ({ a: p.alphaDeg, data: p.data, model: +p.model.toFixed(4), lo: +p.lo.toFixed(4), hi: +p.hi.toFixed(4), regime: p.regime, inBand: p.inBand })),
  });
}
const pooledBase = covered / total, pooled = coveredW / total;

// Final model: every in-domain wing.
const finalFit = fitRetained(D);
const retained = finalFit.r, ramp = finalFit.w;
const finalSamples = D.flatMap((c) => evalCase(c, finalFit));
const widen = widenFor(D);
const base = bandsFrom(finalSamples);
const bands = Object.fromEntries(Object.entries(base).map(([g, b]) => [g, { ...b, lo: b.lo * widen, hi: b.hi * widen }])) as typeof base;
const outRows = OUT.map((c) => {
  const a = analyse(planformOf(c), { alphas: c.points.map((p) => deg(p.alphaDeg)), retained, ramp, bands });
  const pts = a.points.map((q, k) => { const p = c.points[k]; return { a: q.alpha, data: p?.cl ?? Number.NaN, model: +q.cl.toFixed(4), lo: +q.lo.toFixed(4), hi: +q.hi.toFixed(4), regime: q.regime as Regime, extrapolated: q.extrapolated, inBand: (p?.cl ?? 0) >= q.lo && (p?.cl ?? 0) <= q.hi }; });
  const flaggedEverywhere = pts.every((p) => p.extrapolated);
  return { id: c.id, sweepDeg: c.sweepDeg ?? null, kind: c.kind, source: c.source, figure: c.figure, reasons: a.domain.reasons, n: pts.length,
    rmsAll: rms(pts.map((p) => p.data - p.model)), coverage: pts.filter((p) => p.inBand).length / pts.length, c4: flaggedEverywhere, points: pts };
});
const c1 = rows.every((r) => r.c1 !== false), c2 = rows.every((r) => r.c2 !== false), c3 = pooled >= 0.8 && pooled <= 0.97, c4 = outRows.every((r) => r.c4);
const out = {
  generated: "scripts/validate_aero.ts", nominal: NOMINAL, sweepValidated: SWEEP_VALIDATED, retained, ramp, rampsTried: RAMPS, widen, bands, baseBands: base,
  coverage: { baseline: pooledBase, widened: pooled },
  regimeCounts: Object.fromEntries((["attached", "bursting", "burst"] as const).map((g) => [g, finalSamples.filter((x) => x.regime === g).length])),
  criteria: {
    C1: { text: "attached-regime RMS(CL) ≤ 0.05 on every in-domain wing", pass: c1, failing: rows.filter((r) => r.c1 === false).map((r) => r.id) },
    C2: { text: "|CLmax error| ≤ 0.15 and |α at CLmax error| ≤ 5° where the data pass CLmax", pass: c2, failing: rows.filter((r) => r.c2 === false).map((r) => r.id) },
    C3: { text: "pooled leave-one-wing-out coverage of the 90% band within [0.80, 0.97]", pass: c3, value: pooled, baselineValue: pooledBase, baselinePass: pooledBase >= 0.8 && pooledBase <= 0.97 },
    C4: { text: "out-of-domain cases flagged as extrapolation at every point", pass: c4, failing: outRows.filter((r) => !r.c4).map((r) => r.id) },
  },
  inDomain: rows, outOfDomain: outRows,
};
writeFileSync(process.env.AERO_OUT ?? new URL("../lib/data/aero-validation.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify({ retained, ramp, widen, baseline: +pooledBase.toFixed(3), pooledCoverage: +pooled.toFixed(3), bands, C1: out.criteria.C1, C2: out.criteria.C2, C3: out.criteria.C3.pass, C4: out.criteria.C4 }));
for (const r of rows) console.log(r.id.padEnd(9), "k", r.widenHeldOut.toFixed(2), "r", r.retainedHeldOut.toFixed(2), "rmsAtt", r.rmsAttached?.toFixed(3), "rmsAll", r.rmsAll?.toFixed(3), "cov", r.coverage.toFixed(2), "CLmax", r.clMax ? `${r.clMax.data}@${r.clMax.dataAlpha} vs ${r.clMax.model.toFixed(2)}@${r.clMax.modelAlpha}` : "-");
for (const r of outRows) console.log("OUT", r.id.padEnd(9), "rmsAll", r.rmsAll?.toFixed(3), "cov", r.coverage.toFixed(2), r.reasons.join(" | "));
