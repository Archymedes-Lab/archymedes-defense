import type { Aircraft } from "./aircraft";
import { isa } from "./flight";
import { type Rad, rad } from "./units";
import { type IncidenceLoad, type VlmResult, incidenceLoad } from "./vlm";
import { type VortexModel, polarPoint } from "./vortex";

/**
 * Trimmed lift of a tailless aircraft with elevons, and comparison with published flight conditions.
 *
 * Two leading-edge states bracket a real wing:
 *  - "sharp": the engine's assumption, all leading-edge suction becomes vortex lift (Polhamus);
 *  - "attached": the flow stays attached round a rounded, cambered leading edge and keeps its suction, so there is no
 *    vortex lift (potential lift only). A real rounded edge starts attached and moves toward "sharp" as angle rises.
 * The elevon is a trailing-edge control: its lift and centre of pressure come from the same vortex lattice with the
 * flow-tangency condition applied aft of the hinge line (linear, superposed on the angle-of-attack load).
 */
export type EdgeState = "sharp" | "attached";

export interface TrimModel {
  readonly elevon: IncidenceLoad;
  /** x of the centre of gravity. */
  readonly xCg: number;
}

export function trimModel(v: VlmResult, a: Aircraft): TrimModel {
  const e = a.elevon;
  if (e === undefined || a.cgFractionOfChord === undefined) throw new RangeError(`${a.id} has no elevon or centre of gravity defined`);
  const elevon = incidenceLoad(v, (p) => (p.cp.y >= e.yInboard && p.cp.y <= e.yOutboard && p.cp.x >= e.hingeX(p.cp.y) ? 1 : 0));
  return { elevon, xCg: v.props.xMacLe + a.cgFractionOfChord * v.props.cRef };
}

/** Wing lift at α (no elevon) in the given leading-edge state, split into potential and vortex parts. */
export function wingLift(v: VlmResult, m: VortexModel, alpha: Rad, edge: EdgeState): { potential: number; vortex: number } {
  const q = polarPoint(v, m, alpha);
  return { potential: q.clPotential, vortex: edge === "sharp" ? q.cl - q.clPotential : 0 };
}

/** Lift coefficient at α with the elevon at δ (radians, trailing edge down positive). */
export function liftWithElevon(v: VlmResult, m: VortexModel, t: TrimModel, alpha: Rad, delta: Rad, edge: EdgeState): number {
  const w = wingLift(v, m, alpha, edge);
  return w.potential + w.vortex + t.elevon.k * delta;
}

/** Elevon angle for zero pitching moment about the centre of gravity at α (thrust line through the cg assumed). */
export function trimElevon(v: VlmResult, m: VortexModel, t: TrimModel, alpha: Rad, edge: EdgeState): Rad {
  const w = wingLift(v, m, alpha, edge);
  const moment = w.potential * (v.xCpPotential - t.xCg) + w.vortex * (m.xVortex - t.xCg);
  return rad(-moment / (t.elevon.k * (t.elevon.xCp - t.xCg)));
}

/** Trimmed lift coefficient at α: the elevon is set for zero pitching moment. */
export function trimmedLift(v: VlmResult, m: VortexModel, t: TrimModel, alpha: Rad, edge: EdgeState): { cl: number; elevon: Rad } {
  const elevon = trimElevon(v, m, t, alpha, edge);
  return { cl: liftWithElevon(v, m, t, alpha, elevon, edge), elevon };
}

/** Dynamic pressure (lb/ft²) from Mach number and pressure altitude in the standard atmosphere. */
export function dynamicPressure(mach: number, hFt: number): number {
  const air = isa(hFt);
  return 0.5 * air.rho * (mach * air.a) ** 2;
}

/**
 * Lift coefficient a steady flight condition requires: n W = CL q S (+ the thrust component, if given).
 * `gammaRad` is the flight-path angle (0 for level flight), `thrustLb` acts along the body axis.
 */
export function requiredLift(c: { weightLb: number; loadFactor: number; q: number; areaFt2: number; alpha?: Rad; gamma?: Rad; thrustLb?: number }): number {
  if (!(c.weightLb > 0 && c.q > 0 && c.areaFt2 > 0 && c.loadFactor > 0)) throw new RangeError("weight, load factor, dynamic pressure and area must be positive");
  const lift = c.loadFactor * c.weightLb * Math.cos(c.gamma ?? 0) - (c.thrustLb ?? 0) * Math.sin(c.alpha ?? 0);
  return lift / (c.q * c.areaFt2);
}

/** Weight (lb) a model lift coefficient implies for a steady flight condition: W = CL q S / n. */
export function impliedWeight(cl: number, q: number, areaFt2: number, loadFactor: number): number {
  return (cl * q * areaFt2) / loadFactor;
}

export const KNOT_FTPS = 1.6878099;

/**
 * A rounded leading edge between the two states: the share of the sharp-edge vortex lift present rises smoothly from 0
 * at `onsetDeg` to 1 at `fullDeg` (smoothstep). onset = full = 0 is the sharp edge; a very large onset is attached flow.
 */
export interface EdgeBlend { readonly onsetDeg: number; readonly fullDeg: number }

export function vortexShare(alphaDeg: number, b: EdgeBlend): number {
  if (!(b.fullDeg >= b.onsetDeg)) throw new RangeError("fullDeg must be at least onsetDeg");
  const a = Math.abs(alphaDeg);
  if (b.fullDeg === b.onsetDeg) return a >= b.onsetDeg ? 1 : 0;
  const u = Math.min(1, Math.max(0, (a - b.onsetDeg) / (b.fullDeg - b.onsetDeg)));
  return u * u * (3 - 2 * u);
}

/** Trimmed lift with a blended leading edge: the elevon balances the blended wing load. */
export function trimmedLiftBlend(v: VlmResult, m: VortexModel, t: TrimModel, alpha: Rad, b: EdgeBlend): { cl: number; elevon: Rad; share: number } {
  const w = wingLift(v, m, alpha, "sharp"), share = vortexShare((alpha * 180) / Math.PI, b);
  const vortex = w.vortex * share;
  const moment = w.potential * (v.xCpPotential - t.xCg) + vortex * (m.xVortex - t.xCg);
  const elevon = rad(-moment / (t.elevon.k * (t.elevon.xCp - t.xCg)));
  return { cl: w.potential + vortex + t.elevon.k * elevon, elevon, share };
}
