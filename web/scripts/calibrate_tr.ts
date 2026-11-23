/**
 * Two-parameter calibration of the propagation model, with calibration and validation data kept apart.
 *  Calibration targets: Lee et al. 2020 contact-array row speed 0.077 rows/s (N2, 18650 LCO 2.6 Ah → databank Samsung 26J proxy);
 *    Lopez et al. 2015 average adjacent-cell peak 111 / 96 / 91 °C at 1 / 2 / 4 mm (9P 18650 2.8 Ah → MOLiCEL P28A proxy),
 *    with "no propagation" at all three spacings as a hard constraint.
 *  Parameters and bounds: critical temperature Tc ∈ [110, 260] °C (Lopez Table II reaction onsets);
 *    ejecta share reaching neighbours f ∈ [0, 0.5] (Lee: at most 50 % of heat flow came from flaming ejecta, in air);
 *    contact conductance between touching cans Gc ∈ [0.02, 5] W/K (no published value found; wide bounds).
 * Writes lib/data/tr-calibration.json. Run: bun scripts/calibrate_tr.ts
 */
import { writeFileSync } from "node:fs";
import data from "../lib/data/thermal-runaway.json";
import { PHYSICS, type CellType, meanDraws, simulate } from "../lib/battery-tr/model";

const cells = data.cells as unknown as CellType[];
const lee = cells.find((c) => c.name === "Samsung 18650-26J")!, lopez = cells.find((c) => c.name === "MOLiCEL 18650-P28A")!;
const LOPEZ = [[1, 111], [2, 96], [4, 91]] as const, LEE_SPEED = 0.077;

function evaluate(Tc: number, f: number, Gc: number) {
  const p = { ...PHYSICS, onsetOverrideC: Tc, ejectaToNeighbours: f, contactG: Gc };
  const r = simulate(lee, { rows: 4, cols: 3, gapMm: 0, trigger: [0, 1] }, p, meanDraws(lee, 12));
  const t = r.rowTimes, speed = t.every((x) => x !== null) && t[3]! > t[0]! ? 3 / (t[3]! - t[0]!) : 0;
  let propagatedLopez = false, tempErr = 0;
  const temps: number[] = [];
  for (const [g, target] of LOPEZ) {
    const s = simulate(lopez, { rows: 3, cols: 3, gapMm: g, trigger: [1, 1], tabs: true }, p, meanDraws(lopez, 9));
    if (s.propagated > 0) propagatedLopez = true;
    const adj = [1, 3, 5, 7].reduce((a, i) => a + s.peakC[i]!, 0) / 4;
    temps.push(adj); tempErr += ((adj - target) / 15) ** 2;     // 15 °C scale: thermocouple-near-header vs lumped node
  }
  const speedErr = speed > 0 ? (Math.log(speed / LEE_SPEED) / Math.log(1.5)) ** 2 : 100;
  return { Tc, f, Gc, speed, temps, propagatedLopez, loss: propagatedLopez ? Infinity : speedErr + tempErr };
}

const GC = [0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5];
let best = evaluate(110, 0, 0.06);
for (let Tc = 110; Tc <= 260; Tc += 10) for (let f = 0; f <= 0.5001; f += 0.05) for (const Gc of GC) {
  const e = evaluate(Tc, +f.toFixed(3), Gc);
  if (e.loss < best.loss) best = e;
}
console.log(JSON.stringify(best));
writeFileSync(new URL("../lib/data/tr-calibration.json", import.meta.url), JSON.stringify({
  criticalC: best.Tc, ejectaToNeighbours: best.f, contactG: best.Gc,
  fit: { leeSpeed: +best.speed.toFixed(4), leeTarget: LEE_SPEED, lopezAdjacent: best.temps.map((x) => +x.toFixed(1)), lopezTarget: LOPEZ.map((x) => x[1]) },
  bounds: { criticalC: [110, 260], ejectaToNeighbours: [0, 0.5], contactG: [0.02, 5] }, grid: "Tc step 10 °C, f step 0.05, contact conductance log grid 0.02-5 W/K", built: "2026-11-19",
}, null, 1));
