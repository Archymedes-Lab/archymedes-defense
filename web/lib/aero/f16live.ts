import { aircraftById } from "./aircraft";
import { F16_DH_LIMIT_DEG, F16_LEF_MAX_DEG, F16_XCG_REF, LEF_FILTER_RAD_S, LEF_RATE_DEG_S, LEF_TAU_S, f16Coefficients, f16LefScheduleDeg } from "./f16aero";
import { f16Thrust } from "./f16data";
import { G0, isa } from "./flight";
import { ENGINE_TAU_S, FIXED_DT, MAX_STEPS_PER_ADVANCE, lagStep } from "./live";

/**
 * Live F-16 longitudinal flight with a real pitching-moment model: rigid-body equations in body axes
 * (u, w, q, θ, h, x) driven by NASA's measured whole-aircraft forces and moments (f16aero.ts, TP-1538 Table III),
 * NASA's engine table (Table VI) and the published mass and pitch inertia (Table I), at NASA's reference centre of
 * gravity (0.35 c̄), where NASA reports the airframe slightly unstable in pitch (static margin about −4%).
 *
 * From TP-1538 Appendix A, as published: stabilator actuator 0.0495 s first-order lag, 60°/s, ±25°; leading-edge flap
 * δlef = 1.38·(2s + 7.25)/(s + 7.25)·α − 9.05 q̄/ps + 1.45 through a 0.136 s lag, 25°/s, 0–25°.
 * From Appendix C, the pilot blackout model: above 5 g the pilot greys out; time to blackout is log-linear in load
 * factor through 300 s at 5 g and 10 s at 9 g. Recovery below 5 g is not quantified by NASA: we assume full recovery
 * in BLACKOUT_RECOVERY_S (stated).
 * Whinnery & Forster (2013, 888 centrifuge episodes) found rapid-onset G-LOC after 9.1 s on average and never before
 * 5 s, consistent with NASA's 10 s at 9 g. The aerodynamic data are low-speed: NASA says they are valid below about Mach 0.6, so the run stops there.
 *
 * Two pilot modes:
 *  - "law": the stick commands angle of attack through OUR control law (not the F-16's normal-acceleration command
 *    system, whose gains are in a figure not transcribed): δh,cmd = KA·(α − α_cmd) + KQ·q + KI·∫(α − α_cmd) dt
 *    (degrees), α_cmd limited to 25° as NASA's limiter achieves in 1 g flight; anti-windup while saturated.
 *  - "direct": no augmentation, the stick positions the stabilator. The bare airframe is unstable at this centre of
 *    gravity: it diverges unless flown actively, and it can fall into NASA's deep-stall trim near 60–66°.
 */
export const KA = 5, KQ = 1.5, KI = 4;
export const ALPHA_CMD_RANGE_DEG = [-5, 25] as const;
export const DH_RATE_DEG_S = 60;
export const DH_TAU_S = 0.0495;
export const MACH_DATA_LIMIT = 0.6;
export const BLACKOUT = { onsetG: 5, secondsAtOnset: 300, refG: 9, secondsAtRef: 10 } as const;
export const BLACKOUT_RECOVERY_S = 10;
/**
 * Structural limit: the USAF F-16 fact sheet says the aircraft "can withstand up to nine G's" with full internal fuel;
 * the run ends above it. No official negative limit was found, so none is applied (stated).
 */
export const LIMIT_LOAD_G = 9;

const F16 = aircraftById("f16");
if (!F16) throw new Error("f16 missing from the registry");
const P = F16.published;
export const F16_MASS = {
  weightLb: P.weightLb?.value ?? 20500, areaFt2: P.referenceAreaFt2?.value ?? 300, chordFt: P.referenceChordFt?.value ?? 11.32,
  iyy: P.iyySlugFt2?.value ?? 55814, xcg: P.cgFractionOfChord?.value ?? F16_XCG_REF,
};

export type F16Mode = "law" | "direct";
export type F16Status = "flying" | "ground" | "out of envelope" | "blackout" | "over-g";
export interface F16State {
  readonly t: number; readonly u: number; readonly w: number;
  /** Pitch rate (rad/s), pitch attitude (rad), height and distance (ft). */
  readonly q: number; readonly theta: number; readonly h: number; readonly x: number;
  /** Stabilator (deg), control-law integrator (deg·s), flap (deg), flap lead-filter state (deg). */
  readonly dh: number; readonly integ: number; readonly lef: number; readonly lefFilter: number;
  readonly power: number;
  /** Progress toward blackout, 0–1 (1 = blackout). */
  readonly grey: number;
  readonly status: F16Status;
}
export interface F16Controls { readonly mode: F16Mode; readonly alphaCmdDeg: number; readonly dhCmdDeg: number; readonly power: number }

const R_AIR = 1716.49, D = 180 / Math.PI;
function air(h: number) { const a = isa(Math.min(65000, Math.max(-900, h))); return { ...a, ps: a.rho * R_AIR * a.t }; }

/** Forces and moment at a state with stabilator dh and flap lef (deg) and engine power p. */
function loads(u: number, w: number, q: number, h: number, dh: number, lef: number, p: number) {
  const M = F16_MASS, A = air(h), V = Math.max(1, Math.hypot(u, w)), alpha = Math.atan2(w, u), aDeg = alpha * D;
  const qbar = 0.5 * A.rho * V * V;
  const c = f16Coefficients(aDeg, dh, lef, (q * M.chordFt) / (2 * V), M.xcg), thrust = f16Thrust(p, V / A.a, h);
  return { V, alpha, qbar, ps: A.ps, c, thrust, mach: V / A.a, X: qbar * M.areaFt2 * c.cx + thrust, Z: qbar * M.areaFt2 * c.cz, Mom: qbar * M.areaFt2 * M.chordFt * c.cm };
}

function deriv(y: readonly number[], dh: number, lef: number, p: number): number[] {
  const [u = 0, w = 0, q = 0, th = 0] = y, h = y[4] ?? 0, m = F16_MASS.weightLb / G0, f = loads(u, w, q, h, dh, lef, p);
  return [-q * w - G0 * Math.sin(th) + f.X / m, q * u + G0 * Math.cos(th) + f.Z / m, f.Mom / F16_MASS.iyy, q,
    u * Math.sin(th) - w * Math.cos(th), u * Math.cos(th) + w * Math.sin(th)];
}

/** Seconds to blackout at a sustained load factor n > 5 g (NASA's log-linear rule). */
export function secondsToBlackout(n: number): number {
  const B = BLACKOUT, p = Math.log(B.secondsAtRef / B.secondsAtOnset) / Math.log(B.refG / B.onsetG);
  return B.secondsAtOnset * (Math.max(n, B.onsetG) / B.onsetG) ** p;
}
/** Normal load factor an (g, positive along −Z body), NASA's definition: aerodynamic Z force over weight. */
const normalLoad = (Z: number) => -Z / F16_MASS.weightLb;

/** One fixed step: control law or direct stick (sampled), actuators, flap filter, engine lag, then RK4 with surfaces held. */
export function stepF16(s: F16State, c: F16Controls, dt = FIXED_DT): F16State {
  if (s.status !== "flying") return s;
  const alphaDeg = Math.atan2(s.w, s.u) * D;
  let dhCmd: number, integ = s.integ;
  if (c.mode === "law") {
    const cmd = Math.min(ALPHA_CMD_RANGE_DEG[1], Math.max(ALPHA_CMD_RANGE_DEG[0], c.alphaCmdDeg)), err = alphaDeg - cmd;
    const raw = KA * err + KQ * s.q * D + KI * s.integ;
    dhCmd = Math.min(F16_DH_LIMIT_DEG, Math.max(-F16_DH_LIMIT_DEG, raw));
    if (!(raw !== dhCmd && Math.sign(err) === Math.sign(raw))) integ = s.integ + err * dt;
  } else {
    dhCmd = Math.min(F16_DH_LIMIT_DEG, Math.max(-F16_DH_LIMIT_DEG, c.dhCmdDeg));
    integ = dhCmd / KI; // so switching back to the law starts from the current stabilator
  }
  const dh = lagStep(s.dh, dhCmd, dt, DH_TAU_S, DH_RATE_DEG_S);
  // Flap: (2s + a)/(s + a)·α = 2α − f with f' = a(α − f), exact step; then the static terms and the actuator.
  const lefFilter = alphaDeg + (s.lefFilter - alphaDeg) * Math.exp(-LEF_FILTER_RAD_S * dt);
  const f0 = loads(s.u, s.w, s.q, s.h, s.dh, s.lef, s.power);
  const lefCmd = Math.min(F16_LEF_MAX_DEG, Math.max(0, 1.38 * (2 * alphaDeg - lefFilter) - (9.05 * f0.qbar) / f0.ps + 1.45));
  const lef = lagStep(s.lef, lefCmd, dt, LEF_TAU_S, LEF_RATE_DEG_S);
  const power = lagStep(s.power, Math.min(1, Math.max(0, c.power)), dt, ENGINE_TAU_S);
  const y0 = [s.u, s.w, s.q, s.theta, s.h, s.x], add = (k: number[], f: number) => y0.map((v, i) => v + f * (k[i] ?? 0));
  const k1 = deriv(y0, dh, lef, power), k2 = deriv(add(k1, dt / 2), dh, lef, power), k3 = deriv(add(k2, dt / 2), dh, lef, power), k4 = deriv(add(k3, dt), dh, lef, power);
  const y = y0.map((v, i) => v + (dt / 6) * ((k1[i] ?? 0) + 2 * (k2[i] ?? 0) + 2 * (k3[i] ?? 0) + (k4[i] ?? 0)));
  const [u = 0, w = 0, q = 0, theta = 0, h = 0, x = 0] = y;
  const finite = y.every(Number.isFinite);
  const f1 = finite ? loads(u, w, q, Math.min(65000, Math.max(0, h)), dh, lef, power) : f0;
  const n = normalLoad(f1.Z);
  const grey = n > BLACKOUT.onsetG ? s.grey + dt / secondsToBlackout(n) : Math.max(0, s.grey - dt / BLACKOUT_RECOVERY_S);
  const a = f1.alpha * D;
  const status: F16Status = !finite ? "out of envelope" : h <= 0 ? "ground" : n > LIMIT_LOAD_G ? "over-g" : grey >= 1 ? "blackout"
    : !(f1.V > 100 && h < 65000 && a > -20 && a < 90) ? "out of envelope" : "flying";
  return { t: s.t + dt, u, w, q, theta, h: Math.max(0, h), x, dh, integ, lef, lefFilter, power, grey: Math.min(1, grey), status };
}

export function advanceF16(s: F16State, c: F16Controls, seconds: number, carry = 0): { state: F16State; carry: number; steps: number } {
  let budget = carry + Math.max(0, seconds), state = s, steps = 0;
  while (budget >= FIXED_DT - 1e-12 && steps < MAX_STEPS_PER_ADVANCE && state.status === "flying") { state = stepF16(state, c); budget -= FIXED_DT; steps++; }
  return { state, carry: steps === MAX_STEPS_PER_ADVANCE ? 0 : Math.max(0, budget), steps };
}

export interface F16Telemetry {
  readonly t: number; readonly v: number; readonly alpha: number; readonly gamma: number; readonly theta: number; readonly q: number;
  readonly h: number; readonly x: number; readonly mach: number; readonly power: number; readonly status: F16Status;
  readonly cl: number; readonly cd: number; readonly cm: number; readonly lift: number; readonly drag: number; readonly thrust: number;
  /** Normal load factor an (g), NASA's definition. */
  readonly n: number; readonly specificEnergy: number; readonly dhDeg: number; readonly lefDeg: number; readonly grey: number;
  /** Above Mach 0.6: NASA's low-speed data are being extrapolated. */
  readonly beyondData: boolean;
}

export function f16Telemetry(s: F16State): F16Telemetry {
  const f = loads(s.u, s.w, s.q, s.h, s.dh, s.lef, s.power), S = F16_MASS.areaFt2;
  return { t: s.t, v: f.V, alpha: f.alpha, gamma: s.theta - f.alpha, theta: s.theta, q: s.q, h: s.h, x: s.x, mach: f.mach, power: s.power, status: s.status,
    cl: f.c.cl, cd: f.c.cd, cm: f.c.cm, lift: f.qbar * S * f.c.cl, drag: f.qbar * S * f.c.cd, thrust: f.thrust, n: normalLoad(f.Z),
    specificEnergy: s.h + (f.V * f.V) / (2 * G0), dhDeg: s.dh, lefDeg: s.lef, grey: s.grey, beyondData: f.mach > MACH_DATA_LIMIT };
}

/**
 * Level, unaccelerated trim at speed (ft/s) and height (ft): α and stabilator so that the pitching moment is zero and
 * Z balances weight (flap on its steady schedule), then power so that X balances. Null where it cannot trim.
 */
export function trimF16(speed: number, hFt: number): { state: F16State; controls: F16Controls } | null {
  const W = F16_MASS.weightLb, A = air(hFt), qbar = 0.5 * A.rho * speed * speed;
  const lefAt = (a: number) => f16LefScheduleDeg(a * D, qbar, A.ps);
  const at = (a: number, dh: number, p = 0) => loads(speed * Math.cos(a), speed * Math.sin(a), 0, hFt, dh, lefAt(a), p);
  const dhFor = (a: number): number | null => {
    let lo = -F16_DH_LIMIT_DEG, hi = F16_DH_LIMIT_DEG;
    if (at(a, lo).c.cm < 0 || at(a, hi).c.cm > 0) return null;
    for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (at(a, mid).c.cm > 0) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  const zBal = (a: number) => { const dh = dhFor(a); return dh === null ? Number.NaN : at(a, dh).Z + W * Math.cos(a); };
  let lo = -2 / D, hi = 20 / D;
  if (!(zBal(lo) > 0 && zBal(hi) < 0)) return null;
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (zBal(mid) > 0) lo = mid; else hi = mid; }
  const alpha = (lo + hi) / 2, dh = dhFor(alpha) ?? 0, aero = at(alpha, dh, 0);
  const thrustNeeded = W * Math.sin(alpha) - (aero.X - aero.thrust);
  const T = (p: number) => f16Thrust(p, aero.mach, hFt);
  if (T(1) < thrustNeeded || T(0) > thrustNeeded) return null;
  let plo = 0, phi = 1;
  for (let k = 0; k < 60; k++) { const mid = (plo + phi) / 2; if (T(mid) < thrustNeeded) plo = mid; else phi = mid; }
  const power = (plo + phi) / 2;
  return {
    state: { t: 0, u: speed * Math.cos(alpha), w: speed * Math.sin(alpha), q: 0, theta: alpha, h: hFt, x: 0, dh, integ: dh / KI, lef: lefAt(alpha), lefFilter: alpha * D, power, grey: 0, status: "flying" },
    controls: { mode: "law", alphaCmdDeg: alpha * D, dhCmdDeg: dh, power },
  };
}

// ---------------------------------------------------------------- bare-airframe stability (linearised)

export interface Root { readonly re: number; readonly im: number }
/** Roots of a monic polynomial x^n + c[0] x^(n−1) + … + c[n−1] (Durand–Kerner). */
export function polyRoots(c: readonly number[]): Root[] {
  const n = c.length;
  let z: Root[] = Array.from({ length: n }, (_, k) => ({ re: 0.4 * Math.cos((2 * Math.PI * k) / n + 0.3), im: 0.9 * Math.sin((2 * Math.PI * k) / n + 0.3) }));
  const mul = (a: Root, b: Root): Root => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
  const div = (a: Root, b: Root): Root => { const d = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; };
  const evalP = (x: Root): Root => { let r: Root = { re: 1, im: 0 }; for (const ck of c) r = { re: mul(r, x).re + ck, im: mul(r, x).im }; return r; };
  for (let it = 0; it < 500; it++) {
    let moved = 0;
    z = z.map((zi, i) => {
      let den: Root = { re: 1, im: 0 };
      z.forEach((zj, j) => { if (j !== i) den = mul(den, { re: zi.re - zj.re, im: zi.im - zj.im }); });
      const d = div(evalP(zi), den); moved = Math.max(moved, Math.hypot(d.re, d.im));
      return { re: zi.re - d.re, im: zi.im - d.im };
    });
    if (moved < 1e-13) break;
  }
  return z.map((r) => ({ re: r.re, im: Math.abs(r.im) < 1e-9 ? 0 : r.im }));
}

/** Characteristic polynomial coefficients of a square matrix (Faddeev–LeVerrier), monic, highest power dropped. */
export function charPoly(A: readonly (readonly number[])[]): number[] {
  const n = A.length;
  const mm = (X: readonly (readonly number[])[], Y: readonly (readonly number[])[]): number[][] =>
    X.map((r) => Array.from({ length: n }, (_, j) => r.reduce((s, v, k) => s + v * (Y[k]?.[j] ?? 0), 0)));
  let M: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  const c: number[] = [];
  let prev = 1;
  for (let k = 1; k <= n; k++) {
    M = mm(A, M).map((r, i) => r.map((v, j) => v + (i === j ? prev : 0))); // M_k = A M_{k-1} + c_{k-1} I
    const tr = mm(A, M).reduce((s, r, i) => s + (r[i] ?? 0), 0);
    prev = -tr / k; c.push(prev);
  }
  return c;
}

export interface Mode { readonly name: string; readonly root: Root; readonly omegaN: number; readonly zeta: number; readonly periodS: number | null; readonly doubleOrHalfS: number }
/**
 * Modes at a state: the state matrix of (u, w, q, θ) by central differences of the same equations the simulation
 * integrates, stabilator and power held. `flap`: "scheduled" moves the leading-edge flap with α and q̄ on NASA's
 * steady schedule (what the pilot flies in either mode; the flap lag is ignored), "held" freezes it (airframe alone).
 * Unstable roots have positive real part.
 */
export function bareAirframeModes(s: F16State, flap: "scheduled" | "held" = "scheduled"): { A: number[][]; roots: Root[]; modes: Mode[] } {
  const y0 = [s.u, s.w, s.q, s.theta, s.h, s.x], steps = [0.5, 0.5, 0.002, 0.002];
  const cols = steps.map((e, j) => {
    const up = y0.map((v, k) => (k === j ? v + e : v)), dn = y0.map((v, k) => (k === j ? v - e : v));
    const lefOf = (y: readonly number[]) => {
      if (flap === "held") return s.lef;
      const [u = 0, w = 0] = y, A = air(s.h), V = Math.hypot(u, w);
      return f16LefScheduleDeg(Math.atan2(w, u) * D, 0.5 * A.rho * V * V, A.ps);
    };
    const fu = deriv(up, s.dh, lefOf(up), s.power), fd = deriv(dn, s.dh, lefOf(dn), s.power);
    return [0, 1, 2, 3].map((i) => ((fu[i] ?? 0) - (fd[i] ?? 0)) / (2 * e));
  });
  const A = [0, 1, 2, 3].map((i) => cols.map((col) => col[i] ?? 0));
  const roots = polyRoots(charPoly(A)).sort((a, b) => Math.hypot(b.re, b.im) - Math.hypot(a.re, a.im));
  const seen = new Set<number>(), modes: Mode[] = [];
  roots.forEach((r, i) => {
    if (seen.has(i)) return;
    const wn = Math.hypot(r.re, r.im), zeta = wn > 0 ? -r.re / wn : 0;
    if (r.im !== 0) {
      const j = roots.findIndex((o, k) => k !== i && !seen.has(k) && Math.abs(o.re - r.re) < 1e-6 && Math.abs(o.im + r.im) < 1e-6);
      if (j >= 0) seen.add(j);
    }
    seen.add(i);
    modes.push({ name: "", root: { re: r.re, im: Math.abs(r.im) }, omegaN: wn, zeta, periodS: r.im !== 0 ? (2 * Math.PI) / Math.abs(r.im) : null, doubleOrHalfS: Math.abs(Math.LN2 / (r.re || 1e-12)) });
  });
  const named = modes.map((m, k) => ({ ...m, name: m.periodS !== null ? (m.omegaN > 0.5 ? "short period" : "phugoid") : m.root.re > 0 ? (k === 0 ? "pitch divergence" : "slow divergence") : (k === 0 ? "pitch subsidence" : "speed subsidence") }));
  return { A, roots, modes: named };
}

/** Static margin −∂Cm/∂CL (fraction of c̄) at α (deg) with stabilator and flap held: positive is stable. */
export function staticMargin(alphaDeg: number, dhDeg: number, lefDeg: number, xcg = F16_MASS.xcg): number {
  const e = 0.5, a = f16Coefficients(alphaDeg + e, dhDeg, lefDeg, 0, xcg), b = f16Coefficients(alphaDeg - e, dhDeg, lefDeg, 0, xcg);
  return -(a.cm - b.cm) / (a.cl - b.cl);
}
