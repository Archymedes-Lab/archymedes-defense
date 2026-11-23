/**
 * F-16 engine thrust used in NASA's simulation: NASA TP-1538 (Nguyen et al., 1979), Table VI(b), U.S. customary units,
 * copied exactly. Rows are Mach 0.2, 0.4, 0.6, 0.8, 1.0; columns altitude 0, 10,000 … 50,000 ft. Thrust in lbf.
 * Idle values can be negative: at speed an idling engine produces net drag.
 */
export const THRUST_MACH = [0.2, 0.4, 0.6, 0.8, 1.0] as const;
export const THRUST_ALT_FT = [0, 10000, 20000, 30000, 40000, 50000] as const;

/** [mach row][altitude column] */
export const THRUST_IDLE: readonly (readonly number[])[] = [
  [635, 425, 690, 1010, 1330, 1700],
  [60, 25, 345, 755, 1130, 1525],
  [-1020, -710, -300, 350, 910, 1360],
  [-2700, -1900, -1300, -247, 600, 1100],
  [-3600, -1400, -595, -342, -200, 700],
];
export const THRUST_MIL: readonly (readonly number[])[] = [
  [12680, 9150, 6313, 4040, 2470, 1400],
  [12610, 9312, 6610, 4290, 2600, 1560],
  [12640, 9839, 7090, 4660, 2840, 1660],
  [12390, 10176, 7750, 5320, 3250, 1930],
  [11680, 9848, 8050, 6100, 3800, 2310],
];
export const THRUST_MAX: readonly (readonly number[])[] = [
  [21420, 15700, 11225, 7323, 4435, 2600],
  [22700, 16860, 12250, 8154, 5000, 2835],
  [24240, 18910, 13760, 9285, 5700, 3215],
  [26070, 21075, 15975, 11115, 6860, 3950],
  [28886, 23319, 18300, 13484, 8642, 5057],
];

/** Table VI(a), SI units (N), first column (sea level), kept to check the transcription of (b): N = lbf × 4.44822. */
export const THRUST_SI_SEA_LEVEL = { idle: [2824, 267, -4537, -12010, -16013], mil: [56401, 56089, 56223, 55111, 51953], max: [95276, 100970, 107820, 115959, 128485] } as const;

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function bracket(xs: readonly number[], x: number): [number, number] {
  const c = Math.min(xs[xs.length - 1] ?? 0, Math.max(xs[0] ?? 0, x));
  for (let i = 0; i + 1 < xs.length; i++) if (c <= (xs[i + 1] ?? 0)) return [i, (c - (xs[i] ?? 0)) / ((xs[i + 1] ?? 1) - (xs[i] ?? 0))];
  return [xs.length - 2, 1];
}

/** Bilinear interpolation in a table, clamped to its edges (no extrapolation). */
export function tableAt(t: readonly (readonly number[])[], mach: number, altFt: number): number {
  const [i, u] = bracket(THRUST_MACH, mach), [j, v] = bracket(THRUST_ALT_FT, altFt);
  const a = t[i] ?? [], b = t[i + 1] ?? [];
  return lerp(lerp(a[j] ?? 0, a[j + 1] ?? 0, v), lerp(b[j] ?? 0, b[j + 1] ?? 0, v), u);
}

/**
 * Thrust for a power-lever setting p in [0, 1]: 0 idle, 0.5 military (full dry power), 1 maximum afterburner, linear
 * between. NASA's throttle gearing (TP-1538 Fig. 66) is not transcribed: this mapping is ours, the end points are NASA's.
 */
export function f16Thrust(power: number, mach: number, altFt: number): number {
  const p = Math.min(1, Math.max(0, power));
  const idle = tableAt(THRUST_IDLE, mach, altFt), mil = tableAt(THRUST_MIL, mach, altFt), max = tableAt(THRUST_MAX, mach, altFt);
  return p <= 0.5 ? lerp(idle, mil, p / 0.5) : lerp(mil, max, (p - 0.5) / 0.5);
}
