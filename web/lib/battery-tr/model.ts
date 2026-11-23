/**
 * Thermal-runaway propagation in a rectangular array of cylindrical cells: one lumped thermal node per cell.
 *
 * Heat paths between neighbours (Lopez, Jeevarajan & Mukherjee 2015, J. Electrochem. Soc. 162:A1905, Eqs. 2-7 and Table III):
 *  - air conduction: k_air · S, S = 2πL / acosh((2w² − D²)/D²), w = centre distance            (Eq. 4)
 *  - radiation between grey cylinders, view factor of two long parallel cylinders               (Eqs. 5-7)
 *  - tab conduction for parallel-connected modules: G = kA / (L0 + gap), fitted to Table III      (Eq. 2)
 *  - a barrier in a gap replaces air conduction with conduction through the board and blocks radiation
 * Heat release (Battery Failure Databank v2): when a cell reaches its onset temperature it releases the measured
 * cell-body heat Q·body% with the measured time constant τ; the ejecta share leaves the array unless the user
 * deposits a fraction on neighbours (flaming in air, which the model does not otherwise represent).
 * Losses: convection to ambient from the lateral surface.
 *
 * Assumptions stated in the interface: specific heat 1.0 J/(g·K). Calibrated (scripts/calibrate_tr.ts): critical temperature,
 * ejecta share reaching neighbours and contact conductance between touching cans.
 */

export interface CellType { name: string; format: string; diameter: number; length: number; massG: number; ah: number | null; tests: [number, number, number, number | null][] }
export interface Barrier { k: number; thicknessMm: number; name: string }
export interface Layout {
  rows: number; cols: number; gapMm: number; trigger: [number, number];
  barrierAfterRows?: number[]; barrierAfterCols?: number[]; barrierGapMm?: number; barrier?: Barrier | null; tabs?: boolean;
}
export interface Physics {
  cp: number; hConv: number; emissivity: number; kAir: number; ambientC: number; contactGapMm: number; contactG: number; ejectaToNeighbours: number;
  tabKA: number; tabL0: number; onsetOverrideC: number | null; horizonS: number;
}
export const PHYSICS: Physics = {
  cp: 1.0, hConv: 10, emissivity: 0.8, kAir: 0.0292, ambientC: 25, contactGapMm: 0.1, contactG: 0.06, ejectaToNeighbours: 0,
  tabKA: 2.22e-4, tabL0: 0.0146, onsetOverrideC: null, horizonS: 1800,
};
const SIGMA = 5.670374419e-8;

/** Lopez Eq. 4 shape factor (m) for two parallel cylinders of diameter D at centre distance w. */
export function shapeFactor(D: number, L: number, w: number): number {
  const a = (2 * w * w - D * D) / (D * D);
  if (!(a > 1)) throw new RangeError("centre distance must exceed the diameter");
  return (2 * Math.PI * L) / Math.acosh(a);
}
/** View factor between two infinitely long parallel cylinders of equal diameter D at centre distance w. */
export function viewFactor(D: number, w: number): number {
  const X = w / D;
  if (!(X > 1)) throw new RangeError("centre distance must exceed the diameter");
  return (Math.sqrt(X * X - 1) + Math.asin(1 / X) - X) / Math.PI;
}
/** Net radiation (W) between two equal grey cylinders (Lopez Eq. 5) per unit (T1⁴ − T2⁴) in K⁴. */
export function radiationCoeff(D: number, L: number, w: number, eps: number): number {
  const A = Math.PI * D * L, F = viewFactor(D, w);
  return SIGMA / ((1 - eps) / (A * eps) + 1 / (A * F) + (1 - eps) / (A * eps));
}
export const tabConductance = (p: Physics, gapM: number) => p.tabKA / (p.tabL0 + gapM);

interface Link { a: number; b: number; g: number; rad: number }

export function buildLinks(cell: CellType, lay: Layout, p: Physics): Link[] {
  const D = cell.diameter, L = cell.length, links: Link[] = [];
  const id = (r: number, c: number) => r * lay.cols + c;
  const gap = (r1: number, c1: number, r2: number, c2: number) => {
    // gap between two orthogonal neighbours, possibly widened to hold a barrier
    const rowB = r1 !== r2 && (lay.barrierAfterRows ?? []).includes(Math.min(r1, r2));
    const colB = c1 !== c2 && (lay.barrierAfterCols ?? []).includes(Math.min(c1, c2));
    const wide = rowB || colB;
    return { gapM: (wide ? (lay.barrierGapMm ?? lay.gapMm) : lay.gapMm) / 1000, barrier: wide && !!lay.barrier };
  };
  for (let r = 0; r < lay.rows; r++) for (let c = 0; c < lay.cols; c++) {
    for (const [dr, dc] of [[0, 1], [1, 0]] as const) {
      const r2 = r + dr, c2 = c + dc;
      if (r2 >= lay.rows || c2 >= lay.cols) continue;
      const { gapM, barrier } = gap(r, c, r2, c2);
      const eff = Math.max(gapM, p.contactGapMm / 1000), w = D + eff;
      let g: number, rad: number;
      if (barrier && lay.barrier) {
        g = (lay.barrier.k * D * L) / (lay.barrier.thicknessMm / 1000);       // conduction through the board
        rad = 0;                                                             // opaque board blocks cell-to-cell radiation
      } else if (gapM <= 0) {
        g = p.contactG;                                                      // touching cans: calibrated contact conductance
        rad = radiationCoeff(D, L, w, p.emissivity);
      } else {
        g = p.kAir * shapeFactor(D, L, w);
        rad = radiationCoeff(D, L, w, p.emissivity);
      }
      if (lay.tabs && !barrier) g += tabConductance(p, gapM);
      links.push({ a: id(r, c), b: id(r2, c2), g, rad });
    }
    for (const dc of [-1, 1]) {   // diagonal neighbours: air conduction and radiation only
      const r2 = r + 1, c2 = c + dc;
      if (r2 >= lay.rows || c2 < 0 || c2 >= lay.cols) continue;
      const crosses = (lay.barrierAfterRows ?? []).includes(r) || (lay.barrierAfterCols ?? []).includes(Math.min(c, c2));
      if (crosses && lay.barrier) continue;
      const w = Math.SQRT2 * (D + Math.max(lay.gapMm / 1000, p.contactGapMm / 1000));
      links.push({ a: id(r, c), b: id(r2, c2), g: p.kAir * shapeFactor(D, L, w), rad: radiationCoeff(D, L, w, p.emissivity) });
    }
  }
  return links;
}

export interface Draw { totalKj: number; bodyPct: number; tau: number; onsetC: number }
export interface RunResult {
  failed: (number | null)[]; peakC: number[]; propagated: number; rowTimes: (number | null)[];
  energy: { released: number; stored: number; lost: number; ejected: number; closure: number };
  trace?: { t: number[]; T: Float32Array[] };
}

/** Deterministic simulation for given per-cell draws. */
export function simulate(cell: CellType, lay: Layout, p: Physics, draws: Draw[], opts: { trace?: boolean } = {}): RunResult {
  const n = lay.rows * lay.cols;
  if (draws.length !== n) throw new RangeError("one draw per cell");
  const C = cell.massG * p.cp;                                  // J/K
  const T = new Float64Array(n).fill(p.ambientC), t0 = new Array<number | null>(n).fill(null), peak = new Float64Array(n).fill(p.ambientC);
  const links = buildLinks(cell, lay, p), hA = p.hConv * Math.PI * cell.diameter * cell.length;
  const neighbours: number[][] = Array.from({ length: n }, () => []);
  for (const l of links) { neighbours[l.a]!.push(l.b); neighbours[l.b]!.push(l.a); }
  const trig = lay.trigger[0] * lay.cols + lay.trigger[1];
  let released = 0, lost = 0, ejected = 0, t = 0;
  const q = new Float64Array(n);
  const trace = opts.trace ? { t: [] as number[], T: [] as Float32Array[] } : undefined;
  const onset = (i: number) => p.onsetOverrideC ?? draws[i]!.onsetC;
  T[trig] = onset(trig);
  while (t < p.horizonS) {
    let active = false;
    for (let i = 0; i < n; i++) {
      if (t0[i] === null && T[i]! >= onset(i)) t0[i] = t;
      if (t0[i] !== null && t - t0[i]! < 12 * draws[i]!.tau) active = true;
    }
    const dt = active ? 0.02 : 0.5;
    q.fill(0);
    for (let i = 0; i < n; i++) {
      if (t0[i] === null) continue;
      const d = draws[i]!, age = t - t0[i]!;
      // exact integral of Q·e^(−age/τ)/τ over [age, age+dt]
      const frac = Math.exp(-age / d.tau) - Math.exp(-(age + dt) / d.tau);
      const Q = d.totalKj * 1000 * frac, body = Q * d.bodyPct / 100, ej = Q - body;
      released += Q;
      q[i]! += body;
      const nb = neighbours[i]!, dep = ej * p.ejectaToNeighbours;
      if (nb.length && dep > 0) for (const j of nb) q[j]! += dep / nb.length;
      ejected += ej - (nb.length ? dep : 0);
    }
    for (const l of links) {
      const Ta = T[l.a]! + 273.15, Tb = T[l.b]! + 273.15;
      const flow = (l.g * (Ta - Tb) + l.rad * (Ta ** 4 - Tb ** 4)) * dt;
      q[l.a]! -= flow; q[l.b]! += flow;
    }
    for (let i = 0; i < n; i++) {
      const loss = hA * (T[i]! - p.ambientC) * dt;
      lost += loss;
      T[i]! += (q[i]! - loss) / C;
      if (T[i]! > peak[i]!) peak[i] = T[i]!;
    }
    t += dt;
    if (trace && (trace.t.length === 0 || t - trace.t[trace.t.length - 1]! >= 2)) { trace.t.push(t); trace.T.push(Float32Array.from(T)); }
  }
  const stored = Array.from(T).reduce((s, x) => s + C * (x - p.ambientC), 0) - C * (onset(trig) - p.ambientC);
  const closure = released > 0 ? Math.abs(released - stored - lost - ejected) / released : 0;
  const rowTimes = Array.from({ length: lay.rows }, (_, r) => {
    const ts = Array.from({ length: lay.cols }, (_, c) => t0[r * lay.cols + c]).filter((x): x is number => x !== null);
    return ts.length ? Math.min(...ts) : null;
  });
  return { failed: t0, peakC: Array.from(peak), propagated: t0.filter((x) => x !== null).length - 1, rowTimes,
    energy: { released, stored, lost, ejected, closure }, trace };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Bootstrap one measured test per cell (heat, body share and τ stay paired); onset from the same model's heater tests. */
export function drawCells(cell: CellType, n: number, rng: () => number): Draw[] {
  const onsets = cell.tests.map((x) => x[3]).filter((x): x is number => x !== null);
  return Array.from({ length: n }, () => {
    const row = cell.tests[Math.floor(rng() * cell.tests.length)]!;
    const onset = row[3] ?? (onsets.length ? onsets[Math.floor(rng() * onsets.length)]! : 200);
    return { totalKj: row[0], bodyPct: row[1], tau: row[2], onsetC: onset };
  });
}

/** Mean draw for deterministic runs. */
export function meanDraws(cell: CellType, n: number): Draw[] {
  const m = (k: number) => cell.tests.reduce((s, x) => s + (x[k] as number), 0) / cell.tests.length;
  const on = cell.tests.map((x) => x[3]).filter((x): x is number => x !== null);
  const d = { totalKj: m(0), bodyPct: m(1), tau: m(2), onsetC: on.length ? on.reduce((a, b) => a + b, 0) / on.length : 200 };
  return Array.from({ length: n }, () => ({ ...d }));
}

export interface MonteCarlo { runs: number; pAny: number; meanFailed: number; failProb: number[]; medianRowTime: (number | null)[] }

export function monteCarlo(cell: CellType, lay: Layout, p: Physics, runs: number, seed: number): MonteCarlo {
  const rng = mulberry32(seed), n = lay.rows * lay.cols, fails = new Array<number>(n).fill(0), rowT: number[][] = Array.from({ length: lay.rows }, () => []);
  let any = 0, total = 0;
  for (let k = 0; k < runs; k++) {
    const r = simulate(cell, lay, p, drawCells(cell, n, rng));
    if (r.propagated > 0) any++;
    total += r.propagated;
    r.failed.forEach((x, i) => { if (x !== null) fails[i]!++; });
    r.rowTimes.forEach((x, i) => { if (x !== null) rowT[i]!.push(x); });
  }
  const med = (xs: number[]) => { if (xs.length < runs / 2) return null; const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]!; };
  return { runs, pAny: any / runs, meanFailed: total / runs, failProb: fails.map((f) => f / runs), medianRowTime: rowT.map(med) };
}
