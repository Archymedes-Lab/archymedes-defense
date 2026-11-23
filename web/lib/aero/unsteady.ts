import { type Rad, rad } from "./units";
import type { VlmResult } from "./vlm";
import { DEFAULT_RAMP, DEFAULT_RETAINED, type VortexModel, polarPoint } from "./vortex";

/**
 * Unsteady vortex lift by the Goman–Khrabrov state-space model (Goman & Khrabrov 1994, J. Aircraft 31(5);
 * Goman, Greenwell & Khrabrov, ICAS 2000 paper 223, eq. 2):
 *
 *   τ1 · dX/dt' + X = X0(α(t') − τ2 · dα/dt'),   t' = V t / c   (convective time, chord-normalised)
 *
 * X is the share of the full leading-edge vortex lift present (1 = no breakdown loss). Its static value X0 comes from
 * the existing breakdown model: X0 = 1 − lost · (1 − retained). Lift is CL = CL_potential + CL_vortex,full · X, so at
 * τ1 = τ2 = 0 the model is exactly the static polar. The vortex burst point moves slowly: Goman et al. report lags
 * "of the order of 15 times" the convective time for breakdown on 65–70° delta wings, which sets the default τ1.
 * τ2 (a pure delay on α) is 0 by default, as in their linear model; both are parameters to identify from dynamic data.
 */

export interface GkParams {
  /** Relaxation time of the vortex state, in chord-normalised convective time units (c / V). */
  readonly tau1: number;
  /** Delay on the angle of attack, same units. */
  readonly tau2: number;
}

/** Order of magnitude reported for vortex breakdown on 65–70° delta wings (ICAS 2000-223); not an identified fit. */
export const GK_DELTA_ORDER: GkParams = { tau1: 15, tau2: 0 };

export class UnsteadyError extends Error {}

function checkParams(p: GkParams): void {
  if (!(Number.isFinite(p.tau1) && p.tau1 >= 0 && Number.isFinite(p.tau2) && p.tau2 >= 0)) {
    throw new UnsteadyError("time constants must be finite and ≥ 0");
  }
}

/** Exact solution of τ dX/dt + X = u over a step dt with u held constant: unconditionally stable, never overshoots. */
export function gkStep(x: number, u: number, dt: number, tau: number): number {
  if (!(dt >= 0) || !Number.isFinite(dt)) throw new UnsteadyError("step must be finite and ≥ 0");
  if (tau === 0) return u;
  return u + (x - u) * Math.exp(-dt / tau);
}

/** Static vortex state X0 for a solved wing at angle α. */
export function staticState(v: VlmResult, m: VortexModel, alpha: Rad, retained = DEFAULT_RETAINED, ramp = DEFAULT_RAMP): number {
  return 1 - polarPoint(v, m, alpha, 0.006, retained, ramp).lost * (1 - retained);
}

export interface StateSample { readonly t: number; readonly alpha: number; readonly x: number; readonly x0: number }

/**
 * Integrate the state for a prescribed motion α(t') (radians, t' in convective units), with any static map X0(α).
 * The input is evaluated at the middle of each step (second order in dt); dα/dt' by a central difference.
 */
export function simulateState(x0: (alpha: Rad) => number, alphaOf: (t: number) => Rad, tEnd: number, dt: number,
  p: GkParams, xStart?: number): StateSample[] {
  checkParams(p);
  if (!(dt > 0) || !(tEnd >= 0) || tEnd / dt > 2_000_000) throw new UnsteadyError("bad time grid");
  const rate = (t: number) => (alphaOf(t + 1e-4) - alphaOf(t - 1e-4)) / 2e-4;
  const input = (t: number) => rad(alphaOf(t) - p.tau2 * rate(t));
  let x = xStart ?? x0(input(0));
  const out: StateSample[] = [{ t: 0, alpha: alphaOf(0), x, x0: x0(alphaOf(0)) }];
  const n = Math.round(tEnd / dt);
  for (let k = 1; k <= n; k++) {
    const t = k * dt;
    const u = x0(input(p.tau1 === 0 ? t : t - dt / 2));
    x = gkStep(x, u, dt, p.tau1);
    out.push({ t, alpha: alphaOf(t), x, x0: x0(alphaOf(t)) });
  }
  return out;
}

export interface DynamicPoint extends StateSample { readonly cl: number; readonly clStatic: number }

/** Unsteady lift of a solved wing for a prescribed motion. */
export function unsteadyPolar(v: VlmResult, m: VortexModel, alphaOf: (t: number) => Rad, tEnd: number, dt: number,
  p: GkParams = GK_DELTA_ORDER, retained = DEFAULT_RETAINED, ramp = DEFAULT_RAMP): DynamicPoint[] {
  const x0 = (a: Rad) => staticState(v, m, a, retained, ramp);
  return simulateState(x0, alphaOf, tEnd, dt, p).map((s) => {
    const q = polarPoint(v, m, rad(s.alpha), 0.006, retained, ramp);
    const full = q.clNoBreakdown - q.clPotential;
    return { ...s, cl: q.clPotential + full * s.x, clStatic: q.cl };
  });
}

/**
 * Loop integral ∮ CL dα over the samples (trapezoid). For a motion that rises then falls, it equals
 * ∫ (CL_up − CL_down) dα: positive when lift on the upstroke exceeds lift on the downstroke (the lag of breakdown).
 */
export function loopArea(points: readonly { readonly alpha: number; readonly cl: number }[]): number {
  let a = 0;
  for (let k = 1; k < points.length; k++) {
    const p = points[k - 1], q = points[k];
    if (p !== undefined && q !== undefined) a += 0.5 * (p.cl + q.cl) * (q.alpha - p.alpha);
  }
  return a;
}

/**
 * In-phase and quadrature response of the state to α = α0 + A sin(ω t'), from the last whole periods of a run:
 * returns the gain and phase lag of (X − mean) relative to (X0 − mean). Goman et al. eq. 4 predicts, for a linear X0,
 * gain 1/√(1 + τ1²ω²) and lag atan(τ1 ω).
 */
export function harmonicResponse(samples: readonly StateSample[], omega: number, periods: number): { gain: number; lag: number } {
  const T = (2 * Math.PI) / omega;
  const t1 = samples[samples.length - 1]?.t ?? 0, t0 = t1 - periods * T;
  const tail = samples.filter((s) => s.t > t0 - 1e-12);
  const proj = (f: (s: StateSample) => number) => {
    let c = 0, s_ = 0;
    for (let k = 1; k < tail.length; k++) {
      const a = tail[k - 1], b = tail[k];
      if (a === undefined || b === undefined) continue;
      const h = b.t - a.t;
      c += 0.5 * h * (f(a) * Math.cos(omega * a.t) + f(b) * Math.cos(omega * b.t));
      s_ += 0.5 * h * (f(a) * Math.sin(omega * a.t) + f(b) * Math.sin(omega * b.t));
    }
    return { c, s: s_ };
  };
  const inp = proj((s) => s.x0), out = proj((s) => s.x);
  const ampIn = Math.hypot(inp.c, inp.s), ampOut = Math.hypot(out.c, out.s);
  const phIn = Math.atan2(inp.c, inp.s), phOut = Math.atan2(out.c, out.s);
  let lag = phIn - phOut;
  while (lag < -Math.PI) lag += 2 * Math.PI;
  while (lag > Math.PI) lag -= 2 * Math.PI;
  return { gain: ampOut / ampIn, lag };
}
