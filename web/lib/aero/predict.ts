import { type Bands, type Regime, clBounds, regimeOf } from "./error-model";
import type { Planform } from "./geometry";
import { type Deg, deg, toDeg, toRad } from "./units";
import { DEFAULT_MESH, type Mesh, type VlmResult, solveVlm } from "./vlm";
import { DEFAULT_RAMP, DEFAULT_RETAINED, SWEEP_VALIDATED, type PolarPoint, type VortexModel, polarPoint, vortexModel } from "./vortex";

export interface Prediction extends PolarPoint {
  readonly regime: Regime;
  readonly lo: number;
  readonly hi: number;
  readonly extrapolated: boolean;
}

export interface Analysis {
  readonly vlm: VlmResult;
  readonly vortex: VortexModel;
  readonly points: readonly Prediction[];
  readonly domain: { readonly ok: boolean; readonly reasons: readonly string[] };
}

export const ALPHA_VALIDATED_MAX: Deg = deg(50);

export interface AnalyseOptions {
  readonly alphas?: readonly Deg[];
  readonly mesh?: Mesh;
  readonly retained?: number;
  readonly ramp?: number;
  readonly bands?: Bands;
  readonly cd0?: number;
}

export function alphaSweep(from: Deg, to: Deg, step: Deg): Deg[] {
  if (!(step > 0) || !(to >= from) || (to - from) / step > 2000) throw new RangeError("bad alpha sweep");
  const out: Deg[] = [];
  for (let k = 0; from + k * step <= to + 1e-9; k++) out.push(deg(from + k * step));
  return out;
}

/** Physics estimate plus measured bands; every point outside the validated domain is labelled. */
export function analyse(p: Planform, o: AnalyseOptions = {}): Analysis {
  const vlm = solveVlm(p, o.mesh ?? DEFAULT_MESH);
  const vortex = vortexModel(vlm);
  const reasons: string[] = [];
  const shares = vortex.strips;
  const outside = shares.filter((s) => {
    const d = toDeg(s.sweep);
    return d < SWEEP_VALIDATED[0] - 0.5 || d > SWEEP_VALIDATED[1] + 0.5;
  }).reduce((a, s) => a + s.share, 0);
  if (outside > 0.02) reasons.push(`${Math.round(outside * 100)}% of the leading-edge suction is on edges swept outside ${SWEEP_VALIDATED[0]}–${SWEEP_VALIDATED[1]}°`);
  if (p.stations.length > 2) reasons.push("kinked planform: validated only on pointed delta wings");
  const alphas = o.alphas ?? alphaSweep(deg(0), deg(50), deg(1));
  const points = alphas.map((a) => {
    const q = polarPoint(vlm, vortex, toRad(a), o.cd0, o.retained ?? DEFAULT_RETAINED, o.ramp ?? DEFAULT_RAMP);
    const regime = regimeOf(q.lost);
    const extrapolated = reasons.length > 0 || a > ALPHA_VALIDATED_MAX;
    const band = o.bands?.[regime];
    const b = band === undefined ? { lo: q.cl, hi: q.cl } : clBounds(q.cl, band, extrapolated);
    return { ...q, regime, lo: b.lo, hi: b.hi, extrapolated };
  });
  if (alphas.some((a) => a > ALPHA_VALIDATED_MAX)) reasons.push(`angles above ${ALPHA_VALIDATED_MAX}° are beyond the validation data`);
  return { vlm, vortex, points, domain: { ok: reasons.length === 0, reasons } };
}
