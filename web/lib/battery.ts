import "server-only";
import data from "./data/battery.json";

export interface Cell { id: string; group: number; release: number; t: number[]; q: number[]; q0: number; retention: number; weeks: number; weeksTo80: number | null }
export interface Condition { group: number; chargeC: number; dischargeC: number; dod: number }
export interface ConditionSummary extends Condition { cells: string[]; medianTo80: number | null }
export interface BatteryData {
  source: { title: string; doi: string; url: string; license: string; licenseUrl: string; authors: string[]; ratedAh: number; timeUnit: string; modified: string };
  conditions: Condition[]; cells: Cell[];
}

export const battery = data as unknown as BatteryData;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function summarize(d: BatteryData): ConditionSummary[] {
  return d.conditions.map((c) => {
    const cells = d.cells.filter((x) => x.group === c.group);
    return { ...c, cells: cells.map((x) => x.id), medianTo80: median(cells.flatMap((x) => (x.weeksTo80 === null ? [] : [x.weeksTo80]))) };
  });
}

function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    for (let k = i; k <= j; k++) r[idx[k]![1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

/** Spearman rank correlation: association in this dataset, not a causal model. */
export function spearman(a: number[], b: number[]): number {
  const ra = ranks(a), rb = ranks(b), n = a.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i]! - ma) * (rb[i]! - mb); da += (ra[i]! - ma) ** 2; db += (rb[i]! - mb) ** 2; }
  return num / Math.sqrt(da * db);
}

export { RAMP, rampColor } from "./format";
