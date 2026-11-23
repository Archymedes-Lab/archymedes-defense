import type { Aircraft } from "./aircraft";
import { f16Thrust } from "./f16data";
import { type Airframe, G0, isa } from "./flight";
import { type Rad, rad } from "./units";
import { GK_DELTA_ORDER, type GkParams, gkStep, staticState } from "./unsteady";
import type { VlmResult } from "./vlm";
import { DEFAULT_RETAINED, type VortexModel, polarPoint } from "./vortex";

/**
 * Live, pilot-in-the-loop longitudinal simulation for the app: the same point-mass equations as flight.ts
 * (speed, flight-path angle, height, distance, vortex state), advanced in real time at a FIXED step so the result
 * never depends on the screen's frame rate. The pilot commands angle of attack (stick) and power (throttle).
 *
 * Stated assumptions (shown in the app):
 *  - angle of attack follows the stick through a first-order lag (ALPHA_TAU_S) with a rate limit (ALPHA_RATE_DEG_S):
 *    there is no pitching-moment or control-law model, the aircraft is assumed trimmable at the commanded angle;
 *  - engine thrust follows the throttle through a first-order lag (ENGINE_TAU_S);
 *  - whole-aircraft zero-lift drag CD0 is an allowance, not a measurement (the engine models the wing only).
 */
export const FIXED_DT = 1 / 120;
export const ALPHA_TAU_S = 0.35;
export const ALPHA_RATE_DEG_S = 25;
export const ENGINE_TAU_S = 1.2;
/** Cap on steps per advance, so a long pause (background tab) cannot freeze the page. */
export const MAX_STEPS_PER_ADVANCE = 240;

export interface LiveAirframe extends Airframe {
  /** Thrust (lbf) at power setting p ∈ [0, 1], Mach number and altitude. */
  readonly thrust: (power: number, mach: number, altFt: number) => number;
  /** Where the thrust comes from, shown in the app. */
  readonly thrustSource: string;
  readonly cd0Source: string;
}

export interface LiveModel {
  readonly v: VlmResult;
  readonly m: VortexModel;
  readonly frame: LiveAirframe;
  readonly gk: GkParams;
  readonly retained: number;
}

export interface LiveState {
  readonly t: number; readonly v: number; readonly gamma: number; readonly h: number; readonly x: number;
  /** Angle of attack actually flown (rad), lagging the stick. */
  readonly alpha: number;
  /** Engine power actually delivered, lagging the throttle (0–1). */
  readonly power: number;
  readonly vortex: number;
  readonly status: "flying" | "ground" | "out of envelope";
}

export interface Controls { readonly alphaCmdDeg: number; readonly power: number }

export interface Telemetry extends LiveState {
  readonly mach: number; readonly cl: number; readonly cd: number; readonly lift: number; readonly drag: number; readonly thrust: number;
  /** Load factor L / W. */
  readonly n: number;
  readonly specificEnergy: number;
}

/** Whole-aircraft zero-lift drag allowance used when no measured value is available. */
export const CD0_ALLOWANCE = 0.02;

/** Airframe for the live sim from the registry: published weight and reference geometry; thrust per aircraft. */
export function liveAirframe(a: Aircraft): LiveAirframe {
  const pub = a.published;
  const weightLb = pub.weightLb?.value ?? 0, areaFt2 = pub.referenceAreaFt2?.value ?? 0, chordFt = pub.referenceChordFt?.value ?? 0;
  if (!(weightLb > 0 && areaFt2 > 0 && chordFt > 0)) throw new RangeError(`${a.id}: weight, area and chord must be published`);
  const cd0Source = `CD0 ${CD0_ALLOWANCE} assumed (typical clean fighter); the aerodynamic model covers the wing only`;
  if (a.id === "f16") return { weightLb, areaFt2, chordFt, cd0: CD0_ALLOWANCE, thrust: f16Thrust, thrustSource: "NASA TP-1538 Table VI (idle, military, maximum by Mach and altitude)", cd0Source };
  const max = pub.maxThrustLb?.value;
  if (max !== undefined) {
    return { weightLb, areaFt2, chordFt, cd0: CD0_ALLOWANCE, thrust: (p) => Math.min(1, Math.max(0, p)) * max,
      thrustSource: `published maximum thrust ${max.toLocaleString("en")} lbf, no lapse with speed or altitude`, cd0Source };
  }
  const t = 0.6 * weightLb; // no thrust published: a thrust-to-weight allowance, stated
  return { weightLb, areaFt2, chordFt, cd0: CD0_ALLOWANCE, thrust: (p) => Math.min(1, Math.max(0, p)) * t,
    thrustSource: `no thrust published: up to 0.6 × weight (${Math.round(t).toLocaleString("en")} lbf) assumed`, cd0Source };
}

export function liveModel(v: VlmResult, m: VortexModel, frame: LiveAirframe, gk: GkParams = GK_DELTA_ORDER, retained = DEFAULT_RETAINED): LiveModel {
  return { v, m, frame, gk, retained };
}

function coeffs(L: LiveModel, alpha: Rad, vortex: number): { cl: number; cd: number } {
  const q = polarPoint(L.v, L.m, alpha, L.frame.cd0, L.retained);
  const cl = q.clPotential + (q.clNoBreakdown - q.clPotential) * vortex;
  return { cl, cd: L.frame.cd0 + cl * Math.tan(alpha) };
}

/** Everything the app shows about a state. */
export function telemetry(L: LiveModel, s: LiveState): Telemetry {
  const air = isa(Math.min(65000, Math.max(-900, s.h))), qbar = 0.5 * air.rho * s.v * s.v, mach = s.v / air.a;
  const c = coeffs(L, rad(s.alpha), s.vortex), S = L.frame.areaFt2;
  const lift = qbar * S * c.cl, drag = qbar * S * c.cd;
  return { ...s, mach, cl: c.cl, cd: c.cd, lift, drag, thrust: L.frame.thrust(s.power, mach, s.h), n: lift / L.frame.weightLb, specificEnergy: s.h + (s.v * s.v) / (2 * G0) };
}

/** First-order lag toward a target with a rate limit (exact exponential step, then clamped). */
export function lagStep(x: number, target: number, dt: number, tau: number, rateMax = Number.POSITIVE_INFINITY): number {
  const ideal = tau === 0 ? target : target + (x - target) * Math.exp(-dt / tau);
  const lim = rateMax * dt;
  return x + Math.min(lim, Math.max(-lim, ideal - x));
}

/** One fixed step: lags on stick and throttle, then RK4 on (V, γ, h, x) with the vortex state stepped exactly. */
export function stepLive(L: LiveModel, s: LiveState, c: Controls, dt = FIXED_DT): LiveState {
  if (s.status !== "flying") return s;
  const D = Math.PI / 180;
  const a0 = s.alpha, a1 = lagStep(a0, c.alphaCmdDeg * D, dt, ALPHA_TAU_S, ALPHA_RATE_DEG_S * D);
  const p1 = lagStep(s.power, Math.min(1, Math.max(0, c.power)), dt, ENGINE_TAU_S);
  const alphaAt = (f: number) => a0 + (a1 - a0) * f; // linear across the step
  const mass = L.frame.weightLb / G0, S = L.frame.areaFt2, W = L.frame.weightLb;
  const tau = (L.gk.tau1 * L.frame.chordFt) / Math.max(1, s.v);
  const uMid = staticState(L.v, L.m, rad(alphaAt(0.5) - ((L.gk.tau2 * L.frame.chordFt) / Math.max(1, s.v)) * ((a1 - a0) / dt)), L.retained);
  const vortexAt = [s.vortex, gkStep(s.vortex, uMid, dt / 2, tau), gkStep(s.vortex, uMid, dt, tau)];
  const deriv = (f: number, y: readonly number[], vortex: number) => {
    const [vel = 0, gam = 0, h = 0] = y, alpha = alphaAt(f);
    const air = isa(Math.min(65000, Math.max(-900, h))), qbar = 0.5 * air.rho * vel * vel;
    const co = coeffs(L, rad(alpha), vortex), thrust = L.frame.thrust(p1, vel / air.a, h);
    return [(thrust * Math.cos(alpha) - qbar * S * co.cd - W * Math.sin(gam)) / mass,
      (thrust * Math.sin(alpha) + qbar * S * co.cl - W * Math.cos(gam)) / (mass * Math.max(1, vel)),
      vel * Math.sin(gam), vel * Math.cos(gam)];
  };
  const y0 = [s.v, s.gamma, s.h, s.x], add = (y: number[], k: number[], f: number) => y.map((v, i) => v + f * (k[i] ?? 0));
  const k1 = deriv(0, y0, vortexAt[0] ?? 1), k2 = deriv(0.5, add(y0, k1, dt / 2), vortexAt[1] ?? 1);
  const k3 = deriv(0.5, add(y0, k2, dt / 2), vortexAt[1] ?? 1), k4 = deriv(1, add(y0, k3, dt), vortexAt[2] ?? 1);
  const y = y0.map((v, i) => v + (dt / 6) * ((k1[i] ?? 0) + 2 * (k2[i] ?? 0) + 2 * (k3[i] ?? 0) + (k4[i] ?? 0)));
  const [v1 = 0, g1 = 0, h1 = 0, x1 = 0] = y;
  const status: LiveState["status"] = h1 <= 0 ? "ground" : !(v1 > 40 && h1 < 60000 && y.every(Number.isFinite)) ? "out of envelope" : "flying";
  return { t: s.t + dt, v: v1, gamma: g1, h: Math.max(0, h1), x: x1, alpha: a1, power: p1, vortex: vortexAt[2] ?? s.vortex, status };
}

/**
 * Advance by real (wall-clock × time-scale) seconds using fixed steps. Returns the new state and the time not yet
 * simulated (carried to the next frame), so any split of the same wall time into frames gives the same result.
 */
export function advance(L: LiveModel, s: LiveState, c: Controls, seconds: number, carry = 0): { state: LiveState; carry: number; steps: number } {
  let budget = carry + Math.max(0, seconds), state = s, steps = 0;
  while (budget >= FIXED_DT - 1e-12 && steps < MAX_STEPS_PER_ADVANCE && state.status === "flying") {
    state = stepLive(L, state, c); budget -= FIXED_DT; steps++;
  }
  return { state, carry: steps === MAX_STEPS_PER_ADVANCE ? 0 : Math.max(0, budget), steps };
}

/** Level, unaccelerated start: angle of attack and power for L + T sin α = W and T cos α = D, by bisection. */
export function trimStart(L: LiveModel, speed: number, hFt: number): { state: LiveState; controls: Controls } | null {
  const D = Math.PI / 180, air = isa(hFt), qbar = 0.5 * air.rho * speed * speed, S = L.frame.areaFt2, W = L.frame.weightLb;
  const x0 = (a: number) => staticState(L.v, L.m, rad(a), L.retained);
  const lift = (a: number) => { const c = coeffs(L, rad(a), x0(a)); return { cl: c.cl, cd: c.cd }; };
  const need = (a: number) => { const c = lift(a); return qbar * S * (c.cl + c.cd * Math.tan(a)) - W; };
  let lo = 0, hi = 25 * D;
  if (need(hi) < 0) return null;
  for (let k = 0; k < 70; k++) { const mid = (lo + hi) / 2; if (need(mid) < 0) lo = mid; else hi = mid; }
  const alpha = (lo + hi) / 2, c = lift(alpha), thrustNeeded = (qbar * S * c.cd) / Math.cos(alpha);
  const mach = speed / air.a;
  let plo = 0, phi = 1;
  if (L.frame.thrust(1, mach, hFt) < thrustNeeded) return null;
  for (let k = 0; k < 60; k++) { const mid = (plo + phi) / 2; if (L.frame.thrust(mid, mach, hFt) < thrustNeeded) plo = mid; else phi = mid; }
  const power = (plo + phi) / 2;
  return { state: { t: 0, v: speed, gamma: 0, h: hFt, x: 0, alpha, power, vortex: x0(alpha), status: "flying" }, controls: { alphaCmdDeg: alpha / D, power } };
}
