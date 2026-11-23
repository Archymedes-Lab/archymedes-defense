import { describe, expect, test } from "bun:test";
import cal from "../lib/data/tr-calibration.json";
import data from "../lib/data/thermal-runaway.json";
import { PHYSICS, type CellType, drawCells, meanDraws, mulberry32, radiationCoeff, shapeFactor, simulate, tabConductance, viewFactor } from "../lib/battery-tr/model";

const cells = data.cells as unknown as CellType[];
const c26 = cells.find((c) => c.name === "Samsung 18650-26J")!, p28 = cells.find((c) => c.name === "MOLiCEL 18650-P28A")!;
const D = 0.018, L = 0.065;

// Lopez et al. 2015 Table III: two 18650 cells at 500 °C and 100 °C.
describe("heat paths reproduce Lopez 2015 Table III", () => {
  const rows: [number, number, number, number][] = [[1, 7.13, 4.98, 5.69], [2, 5.06, 4.63, 5.34], [4, 3.61, 4.05, 4.77]];
  test("air conduction k·S·ΔT within 3% (k_air 0.0292 W/m·K)", () => {
    for (const [g, air] of rows) expect(Math.abs(PHYSICS.kAir * shapeFactor(D, L, D + g / 1000) * 400 - air) / air).toBeLessThan(0.03);
  });
  test("radiation falls with spacing in the paper's proportion (within 5%)", () => {
    const r = (g: number) => radiationCoeff(D, L, D + g / 1000, PHYSICS.emissivity);
    expect(Math.abs(r(1) / r(4) - 4.98 / 4.05) / (4.98 / 4.05)).toBeLessThan(0.05);
    expect(Math.abs(r(2) / r(4) - 4.63 / 4.05) / (4.63 / 4.05)).toBeLessThan(0.05);
  });
  test("tab conduction within 2%", () => {
    for (const [g, , , tab] of rows) expect(Math.abs(tabConductance(PHYSICS, g / 1000) * 400 - tab) / tab).toBeLessThan(0.02);
  });
  test("view factor of touching-limit cylinders approaches 1/2 − 1/π and refuses overlap", () => {
    expect(viewFactor(D, D * 1.000001)).toBeCloseTo(0.5 - 1 / Math.PI, 3);
    expect(() => viewFactor(D, D * 0.9)).toThrow();
  });
});

describe("model invariants", () => {
  const p = { ...PHYSICS, onsetOverrideC: cal.criticalC, ejectaToNeighbours: cal.ejectaToNeighbours, contactG: cal.contactG };
  test("energy balance closes (released = stored + lost + ejected)", () => {
    const r = simulate(c26, { rows: 3, cols: 4, gapMm: 0, trigger: [0, 1] }, p, meanDraws(c26, 12));
    expect(r.energy.closure).toBeLessThan(1e-6);
  });
  test("no heat path, no propagation", () => {
    const iso = { ...p, kAir: 0, emissivity: 1e-9, contactG: 0, ejectaToNeighbours: 0 };
    expect(simulate(c26, { rows: 3, cols: 3, gapMm: 1, trigger: [1, 1] }, iso, meanDraws(c26, 9)).propagated).toBe(0);
  });
  test("wider spacing never raises the adjacent peak", () => {
    const adj = (g: number) => { const r = simulate(p28, { rows: 3, cols: 3, gapMm: g, trigger: [1, 1], tabs: true }, { ...p, ejectaToNeighbours: 0 }, meanDraws(p28, 9)); return Math.max(r.peakC[1]!, r.peakC[3]!); };
    expect(adj(1)).toBeGreaterThanOrEqual(adj(2)); expect(adj(2)).toBeGreaterThanOrEqual(adj(4));
  });
  test("deterministic for a seed; draws come from the measured rows", () => {
    const a = drawCells(c26, 12, mulberry32(7)), b = drawCells(c26, 12, mulberry32(7));
    expect(a).toEqual(b);
    for (const d of a) expect(c26.tests.some((t) => t[0] === d.totalKj && t[1] === d.bodyPct)).toBe(true);
  });
  test("invalid geometry refused", () => {
    expect(() => shapeFactor(D, L, D * 0.99)).toThrow();
    expect(() => simulate(c26, { rows: 2, cols: 2, gapMm: 1, trigger: [0, 0] }, p, meanDraws(c26, 3))).toThrow();
  });
});

describe("calibration regression (scripts/calibrate_tr.ts)", () => {
  const p = { ...PHYSICS, onsetOverrideC: cal.criticalC, ejectaToNeighbours: cal.ejectaToNeighbours, contactG: cal.contactG };
  test("parameters inside their literature bounds", () => {
    expect(cal.criticalC).toBeGreaterThanOrEqual(110); expect(cal.criticalC).toBeLessThanOrEqual(260);
    expect(cal.ejectaToNeighbours).toBeGreaterThanOrEqual(0); expect(cal.ejectaToNeighbours).toBeLessThanOrEqual(0.5);
  });
  test("Lee 2020 dense array: complete propagation within the paper's ±2σ speed band", () => {
    const r = simulate(c26, { rows: 4, cols: 3, gapMm: 0, trigger: [0, 1] }, p, meanDraws(c26, 12));
    const speed = 3 / (r.rowTimes[3]! - r.rowTimes[0]!);
    expect(r.propagated).toBe(11); expect(speed).toBeGreaterThanOrEqual(0.04); expect(speed).toBeLessThanOrEqual(0.114);
  });
  test("Lopez 2015 spaced modules: no propagation at 1, 2 and 4 mm", () => {
    for (const g of [1, 2, 4]) expect(simulate(p28, { rows: 3, cols: 3, gapMm: g, trigger: [1, 1], tabs: true }, p, meanDraws(p28, 9)).propagated).toBe(0);
  });
});
