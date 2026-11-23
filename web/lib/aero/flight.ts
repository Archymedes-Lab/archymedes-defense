import { HARV_PUBLISHED } from "./harv";
import { type Rad, rad, toDeg } from "./units";
import { GK_DELTA_ORDER, type GkParams, UnsteadyError, gkStep, staticState } from "./unsteady";
import type { VlmResult } from "./vlm";
import { DEFAULT_RAMP, DEFAULT_RETAINED, type VortexModel, polarPoint } from "./vortex";

/**
 * Longitudinal point-mass flight path (3 degrees of freedom: speed, flight-path angle, position) with the
 * unsteady vortex-lift state, flat Earth, still air, wind axes. Angle of attack and thrust are prescribed inputs:
 * this is an aerodynamics and energy check of a research configuration, not a pilot or a manoeuvre optimiser.
 *
 *   m dV/dt  = T cos α − D − W sin γ
 *   m V dγ/dt = T sin α + L − W cos γ
 *   dh/dt = V sin γ,   dx/dt = V cos γ
 *   dX/dt = (X0(α − τ2 (c/V) dα/dt) − X) / (τ1 c / V)
 *
 * Units: feet, slugs, seconds, pounds force. Integrator: classical fourth-order Runge–Kutta on (V, γ, h, x); the
 * vortex state X is advanced with its exact exponential step inside each stage, so it stays between its targets.
 */

/** NASA TM-110216 (Messina, Strickland, Hoffler, Carzoo, Bundick, Yeager, Beissner; May 1996), Table 2.3. */
export const HARV_MASS = {
  fighterEscort60pctFuel: { weightLb: 35764.6, cgFsIn: 456.3, cgWlIn: 105.4, ixx: 22632.6, iyy: 174246.3, izz: 189336.4, ixz: -2131.8 },
  light: { weightLb: 31617.7, cgFsIn: 460.89, cgWlIn: 103.36, ixx: 22163.0, iyy: 172237.5, izz: 186823.1, ixz: -2043.1 },
  heavy: { weightLb: 37618.7, cgFsIn: 456.31, cgWlIn: 105.91, ixx: 22938.3, iyy: 179130.1, izz: 194003.0, ixz: -2507.3 },
  empty: { weightLb: 29615.0, cgFsIn: 463.75, cgWlIn: 102.31, ixx: 21643.3, iyy: 171184.9, izz: 185408.8, ixz: -1967.4 },
  source: "NASA TM-110216, Table 2.3 (weights lb, c.g. inches, inertias slug-ft²)",
} as const;

export const G0 = 32.174; // ft/s²
const R_AIR = 1716.49; // ft·lbf/(slug·°R)
const T0 = 518.67, RHO0 = 0.0023769, LAPSE = 0.00356616, H_TROPO = 36089.24, GAMMA = 1.4;

/** 1976 US Standard Atmosphere to 65,617 ft: temperature (°R) and density (slug/ft³). */
export function isa(hFt: number): { t: number; rho: number; a: number } {
  if (!Number.isFinite(hFt) || hFt < -1000 || hFt > 65617) throw new UnsteadyError("altitude outside -1,000 to 65,617 ft");
  const n = G0 / (R_AIR * LAPSE);
  if (hFt <= H_TROPO) {
    const t = T0 - LAPSE * hFt;
    return { t, rho: RHO0 * (t / T0) ** (n - 1), a: Math.sqrt(GAMMA * R_AIR * t) };
  }
  const t11 = T0 - LAPSE * H_TROPO;
  const rho11 = RHO0 * (t11 / T0) ** (n - 1);
  return { t: t11, rho: rho11 * Math.exp(-(G0 / (R_AIR * t11)) * (hFt - H_TROPO)), a: Math.sqrt(GAMMA * R_AIR * t11) };
}

export interface Airframe {
  readonly weightLb: number;
  readonly areaFt2: number;
  readonly chordFt: number;
  readonly cd0: number;
}

export const HARV_AIRFRAME: Airframe = {
  weightLb: HARV_MASS.fighterEscort60pctFuel.weightLb, areaFt2: HARV_PUBLISHED.wingAreaFt2, chordFt: HARV_PUBLISHED.macFt,
  cd0: 0.006,
};

export interface FlightState { readonly t: number; readonly v: number; readonly gamma: number; readonly h: number; readonly x: number; readonly vortex: number }

export interface FlightInputs {
  /** Angle of attack (rad) at time t (s). */
  readonly alpha: (t: number) => Rad;
  /** Thrust (lbf) at time t, along the body axis taken as the zero-lift line. Default 0. */
  readonly thrust?: (t: number) => number;
}

export interface FlightOptions {
  readonly gk?: GkParams;
  readonly retained?: number;
  /** Breakdown ramp width, degrees (0 = step model). */
  readonly ramp?: number;
  /** Drop all drag (cd0 and induced): for the energy-conservation check only. */
  readonly dragFree?: boolean;
}

export interface FlightSample extends FlightState {
  readonly alpha: number; readonly cl: number; readonly cd: number; readonly lift: number; readonly drag: number;
  readonly thrust: number; readonly mach: number; readonly specificEnergy: number;
  readonly extrapolated: boolean;
}

export const MACH_MAX = 0.6;
export const ALPHA_MAX_DEG = 50;

/** Aerodynamic coefficients at angle α with vortex state X (same formulas as the static polar). */
export function coefficients(v: VlmResult, m: VortexModel, alpha: Rad, x: number, frame: Airframe, o: FlightOptions = {}) {
  const q = polarPoint(v, m, alpha, frame.cd0, o.retained ?? DEFAULT_RETAINED, o.ramp ?? DEFAULT_RAMP);
  const cl = q.clPotential + (q.clNoBreakdown - q.clPotential) * x;
  const cd = o.dragFree ? 0 : frame.cd0 + cl * Math.tan(alpha);
  return { cl, cd };
}

export function simulateFlight(v: VlmResult, m: VortexModel, start: Omit<FlightState, "vortex" | "t"> & { vortex?: number },
  inputs: FlightInputs, tEnd: number, dt: number, frame: Airframe = HARV_AIRFRAME, o: FlightOptions = {}): FlightSample[] {
  const gk = o.gk ?? GK_DELTA_ORDER, retained = o.retained ?? DEFAULT_RETAINED;
  if (!(frame.weightLb > 0 && frame.areaFt2 > 0 && frame.chordFt > 0 && frame.cd0 >= 0)) throw new UnsteadyError("bad airframe");
  if (!(dt > 0) || !(tEnd >= 0) || tEnd / dt > 1_000_000) throw new UnsteadyError("bad time grid");
  if (!(start.v > 0) || ![start.gamma, start.h, start.x].every(Number.isFinite)) throw new UnsteadyError("bad start state");
  const mass = frame.weightLb / G0;
  const thrustAt = inputs.thrust ?? (() => 0);
  const x0At = (alpha: Rad) => staticState(v, m, alpha, retained, o.ramp ?? DEFAULT_RAMP);
  const rateAt = (t: number) => (inputs.alpha(t + 1e-4) - inputs.alpha(t - 1e-4)) / 2e-4;

  // derivatives of (V, γ, h, x) for a given vortex state
  const deriv = (t: number, s: number[], vortex: number) => {
    const [vel = 0, gam = 0, h = 0] = s;
    const alpha = inputs.alpha(t), thrust = thrustAt(t);
    const air = isa(h), qbar = 0.5 * air.rho * vel * vel;
    const c = coefficients(v, m, alpha, vortex, frame, o);
    const lift = qbar * frame.areaFt2 * c.cl, drag = qbar * frame.areaFt2 * c.cd;
    return [
      (thrust * Math.cos(alpha) - drag - frame.weightLb * Math.sin(gam)) / mass,
      (thrust * Math.sin(alpha) + lift - frame.weightLb * Math.cos(gam)) / (mass * vel),
      vel * Math.sin(gam),
      vel * Math.cos(gam),
    ];
  };
  const sample = (t: number, s: number[], vortex: number): FlightSample => {
    const [vel = 0, gam = 0, h = 0, x = 0] = s;
    const alpha = inputs.alpha(t), thrust = thrustAt(t);
    const air = isa(h), qbar = 0.5 * air.rho * vel * vel;
    const c = coefficients(v, m, alpha, vortex, frame, o);
    const mach = vel / air.a;
    return { t, v: vel, gamma: gam, h, x, vortex, alpha, cl: c.cl, cd: c.cd, lift: qbar * frame.areaFt2 * c.cl,
      drag: qbar * frame.areaFt2 * c.cd, thrust, mach, specificEnergy: h + (vel * vel) / (2 * G0),
      extrapolated: mach > MACH_MAX || Math.abs(toDeg(rad(alpha))) > ALPHA_MAX_DEG };
  };

  let s = [start.v, start.gamma, start.h, start.x];
  let vortex = start.vortex ?? x0At(inputs.alpha(0));
  const out: FlightSample[] = [sample(0, s, vortex)];
  const n = Math.round(tEnd / dt);
  for (let k = 0; k < n; k++) {
    const t = k * dt;
    // vortex state over the step: exact exponential with the input at mid-step and τ = τ1 c / V
    const tau = (gk.tau1 * frame.chordFt) / Math.max(1e-9, s[0] ?? 1);
    const uMid = x0At(rad(inputs.alpha(t + dt / 2) - (gk.tau2 * frame.chordFt / Math.max(1e-9, s[0] ?? 1)) * rateAt(t + dt / 2)));
    const vMid = gkStep(vortex, uMid, dt / 2, tau), vEnd = gkStep(vortex, uMid, dt, tau);
    const add = (a: number[], b: number[], f: number) => a.map((y, i) => y + f * (b[i] ?? 0));
    const k1 = deriv(t, s, vortex);
    const k2 = deriv(t + dt / 2, add(s, k1, dt / 2), vMid);
    const k3 = deriv(t + dt / 2, add(s, k2, dt / 2), vMid);
    const k4 = deriv(t + dt, add(s, k3, dt), vEnd);
    s = s.map((y, i) => y + (dt / 6) * ((k1[i] ?? 0) + 2 * (k2[i] ?? 0) + 2 * (k3[i] ?? 0) + (k4[i] ?? 0)));
    vortex = vEnd;
    if (!(s[0] !== undefined && s[0] > 0) || !s.every(Number.isFinite)) throw new UnsteadyError(`state left the valid region at t = ${t.toFixed(3)} s`);
    out.push(sample((k + 1) * dt, s, vortex));
  }
  return out;
}

/** Angle of attack and thrust for steady level flight at speed V and altitude h (static vortex state). */
export function trimLevel(v: VlmResult, m: VortexModel, speed: number, hFt: number, frame: Airframe = HARV_AIRFRAME,
  o: FlightOptions = {}): { alpha: Rad; thrust: number; cl: number } {
  const qbar = 0.5 * isa(hFt).rho * speed * speed;
  // Level flight: T cos α = D and L + T sin α = W, so T = D / cos α and L + D tan α = W.
  const co = (a: Rad) => coefficients(v, m, a, staticState(v, m, a, o.retained ?? DEFAULT_RETAINED, o.ramp ?? DEFAULT_RAMP), frame, o);
  const excess = (a: Rad) => { const c = co(a); return qbar * frame.areaFt2 * (c.cl + c.cd * Math.tan(a)) - frame.weightLb; };
  let lo = 0, hi = (30 * Math.PI) / 180;
  if (excess(rad(hi)) < 0) throw new UnsteadyError("no level-flight trim below 30° at this speed and altitude");
  for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (excess(rad(mid)) < 0) lo = mid; else hi = mid; }
  const alpha = rad((lo + hi) / 2);
  const c = co(alpha);
  return { alpha, thrust: (qbar * frame.areaFt2 * c.cd) / Math.cos(alpha), cl: c.cl };
}
