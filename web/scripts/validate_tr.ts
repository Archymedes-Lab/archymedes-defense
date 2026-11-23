/**
 * Calibration and held-out validation report for the propagation model. Writes lib/data/tr-validation.json.
 * Run after scripts/calibrate_tr.ts. Every row says whether it was used to fit (calibration) or held out (validation).
 */
import { writeFileSync } from "node:fs";
import cal from "../lib/data/tr-calibration.json";
import data from "../lib/data/thermal-runaway.json";
import { PHYSICS, type CellType, meanDraws, monteCarlo, simulate } from "../lib/battery-tr/model";

const cells = data.cells as unknown as CellType[];
const lee = cells.find((c) => c.name === "Samsung 18650-26J")!, lopez = cells.find((c) => c.name === "MOLiCEL 18650-P28A")!;
const p = { ...PHYSICS, onsetOverrideC: cal.criticalC, ejectaToNeighbours: cal.ejectaToNeighbours, contactG: cal.contactG };
const rows: { id: string; kind: "calibration" | "validation"; source: string; measured: string; model: string; verdict: "match" | "partial" | "miss" }[] = [];

const contact = simulate(lee, { rows: 4, cols: 3, gapMm: 0, trigger: [0, 1] }, p, meanDraws(lee, 12));
const speed = 3 / (contact.rowTimes[3]! - contact.rowTimes[0]!);
rows.push({ id: "lee-contact", kind: "calibration", source: "Lee et al. 2020, dense 3×4 18650 array, N2", measured: "complete propagation, 0.077 ± 0.037 rows/s",
  model: `${contact.propagated + 1}/12 cells, ${speed.toFixed(3)} rows/s`, verdict: contact.propagated === 11 && speed >= 0.04 && speed <= 0.114 ? "match" : "miss" });
const lopezT = [1, 2, 4].map((g) => { const s = simulate(lopez, { rows: 3, cols: 3, gapMm: g, trigger: [1, 1], tabs: true }, p, meanDraws(lopez, 9)); return { g, prop: s.propagated, adj: [1, 3, 5, 7].reduce((a, i) => a + s.peakC[i]!, 0) / 4 }; });
rows.push({ id: "lopez-spacing", kind: "calibration", source: "Lopez et al. 2015, 9P 18650 module, 1 / 2 / 4 mm", measured: "no propagation; adjacent 111 / 96 / 91 °C",
  model: `${lopezT.every((x) => x.prop === 0) ? "no propagation" : "propagation"}; adjacent ${lopezT.map((x) => x.adj.toFixed(0)).join(" / ")} °C`,
  verdict: lopezT.every((x) => x.prop === 0) ? (Math.abs(lopezT[2]!.adj - 91) < 15 && Math.abs(lopezT[0]!.adj - 111) < 15 ? "match" : "partial") : "miss" });
const block = (r: ReturnType<typeof simulate>) => Math.max(...[0, 1, 2, 4, 5, 6, 8, 9, 10].map((i) => r.failed[i]).filter((x): x is number => x !== null));
const firstBeyond = (r: ReturnType<typeof simulate>) => { const v = [3, 7, 11, 12, 13, 14].map((i) => r.failed[i]).filter((x): x is number => x !== null); return v.length ? Math.min(...v) : null; };
const base = { rows: 4, cols: 4, gapMm: 0, trigger: [0, 1] as [number, number], barrierAfterRows: [2], barrierAfterCols: [2], barrierGapMm: 5 };
const gapRun = simulate(lee, { ...base, barrier: null }, p, meanDraws(lee, 16));
const gb = firstBeyond(gapRun);
rows.push({ id: "lee-gap", kind: "validation", source: "Lee et al. 2020, 5 mm gaps without barrier", measured: "propagation continues; overall delay only about 20 s",
  model: gb === null ? "propagation stopped at the gap" : `crosses the gap ${(gb - block(gapRun)).toFixed(0)} s after the block finishes`, verdict: gb === null ? "miss" : "partial" });
const barRun = simulate(lee, { ...base, barrier: { k: 0.049, thicknessMm: 3.2, name: "ceramic fibre board" } }, p, meanDraws(lee, 16));
const bb = firstBeyond(barRun);
rows.push({ id: "lee-barrier", kind: "validation", source: "Lee et al. 2020, 3.2 mm ceramic fibre board in 5 mm gaps", measured: "slowed by more than 30×, never stopped",
  model: bb === null ? `stopped: ${barRun.propagated + 1}/16 cells fail` : `crosses after ${(bb - block(barRun)).toFixed(0)} s`, verdict: bb === null ? "miss" : "match" });
const mcC = monteCarlo(lee, { rows: 4, cols: 3, gapMm: 0, trigger: [0, 1] }, p, 200, 3);
rows.push({ id: "lee-variability", kind: "validation", source: "Lee et al. 2020, repeat tests of dense arrays", measured: "complete propagation in every test",
  model: `propagation in ${(mcC.pAny * 100).toFixed(0)}% of 200 runs with databank heat draws`, verdict: mcC.pAny > 0.95 ? "match" : "miss" });
const mcL = monteCarlo(lopez, { rows: 3, cols: 3, gapMm: 1, trigger: [1, 1], tabs: true }, p, 200, 4);
rows.push({ id: "lopez-variability", kind: "validation", source: "Lopez et al. 2015, 1 mm spacing", measured: "no propagation (one test per spacing)",
  model: `propagation in ${(mcL.pAny * 100).toFixed(0)}% of 200 runs`, verdict: mcL.pAny < 0.05 ? "match" : "partial" });
writeFileSync(new URL("../lib/data/tr-validation.json", import.meta.url), JSON.stringify({ built: "2026-11-19", calibration: cal, rows }, null, 1));
for (const r of rows) console.log(r.kind.padEnd(11), r.verdict.padEnd(7), r.id.padEnd(16), "|", r.measured, "|", r.model);
