import { type Planform, type PlanformProps, planformProps } from "./geometry";

/**
 * Planar vortex-lattice method (horseshoe vortices, flat wake along +x) for a symmetric planform.
 * Unit freestream along +x; the solution is linear in sin α, so one solve gives the potential-flow lift slope Kp,
 * the induced-drag factor Ki (Trefftz plane), the centre of pressure, and the leading-edge thrust distribution
 * used by the suction analogy. References: Katz & Plotkin, Low-Speed Aerodynamics (2001); NASA SP-405 (1976).
 */

export interface Mesh { readonly nSpan: number; readonly nChord: number }
export const DEFAULT_MESH: Mesh = { nSpan: 20, nChord: 10 };

export interface Panel {
  readonly j: number;              // spanwise strip
  readonly i: number;              // chordwise row (0 = leading)
  readonly corners: readonly [P2, P2, P2, P2]; // le-in, le-out, te-out, te-in
  readonly a: P2; readonly b: P2;  // bound vortex endpoints (quarter chord), a inboard
  readonly cp: P2;                 // control point (three-quarter chord, mid strip)
  readonly chord: number;          // panel chord at mid strip
}
export interface P2 { readonly x: number; readonly y: number }

export interface Strip { readonly y0: number; readonly y1: number; readonly xLe: number; readonly chord: number; readonly sweepLe: number }

export interface VlmResult {
  readonly props: PlanformProps;
  readonly panels: readonly Panel[];
  readonly strips: readonly Strip[];
  /** Panel circulation for unit freestream and sin α = 1, right half (mirror is symmetric). */
  readonly gamma: readonly number[];
  /** Potential lift slope: CL = Kp sin α (small-angle, planar). */
  readonly kp: number;
  /** Induced drag factor with full leading-edge suction: CDi = Ki CL². */
  readonly ki: number;
  /** Oswald span efficiency 1 / (π AR Ki). */
  readonly e: number;
  /** x of the centre of pressure of the potential load. */
  readonly xCpPotential: number;
  /** Leading-edge thrust share per strip (sums to 1). */
  readonly thrustShare: readonly number[];
  /** Spanwise loading c·cl / cRef per strip at sin α = 1. */
  readonly loading: readonly number[];
}

const FOUR_PI = 4 * Math.PI;

/** z-velocity at (x, y, 0) induced by a straight unit vortex segment p1→p2 in the plane z = 0. */
function segW(x: number, y: number, x1: number, y1: number, x2: number, y2: number): number {
  const r1x = x - x1, r1y = y - y1, r2x = x - x2, r2y = y - y2;
  const cz = r1x * r2y - r1y * r2x; // (r1 × r2)_z, other components vanish in the plane
  const c2 = cz * cz;
  const r1 = Math.hypot(r1x, r1y), r2 = Math.hypot(r2x, r2y);
  const r0x = x2 - x1, r0y = y2 - y1;
  // Scale-relative core cutoff (both sides ~ length⁴) so results do not depend on model size.
  if (c2 <= 1e-12 * (r0x * r0x + r0y * r0y) * (r1 * r1 + r2 * r2)) return 0;
  const k = (r0x * (r1x / r1 - r2x / r2) + r0y * (r1y / r1 - r2y / r2)) / (FOUR_PI * c2);
  return k * cz;
}

/** z-velocity from a semi-infinite unit vortex running from (xq, yq) to x = +∞. */
function legW(x: number, y: number, xq: number, yq: number): number {
  const rx = x - xq, ry = y - yq;
  const r = Math.hypot(rx, ry);
  if (ry * ry <= 1e-12 * r * r) return 0; // on the filament line (scale-relative)
  // d = (1,0,0): (d × r)_z = ry ... sign: d×r = (0*0-0*ry, 0*rx-1*0, 1*ry-0*rx) = (0, 0, ry)
  return (ry / (ry * ry)) * (1 + rx / r) / FOUR_PI;
}

/** Downwash at (x, y) from the horseshoe ∞ → a → b → ∞. */
function horseshoeW(x: number, y: number, a: P2, b: P2): number {
  return -legW(x, y, a.x, a.y) + segW(x, y, a.x, a.y, b.x, b.y) + legW(x, y, b.x, b.y);
}

function cosineSpacing(n: number): number[] {
  return Array.from({ length: n + 1 }, (_, k) => 0.5 * (1 - Math.cos((Math.PI * k) / n)));
}

/** Spanwise edges: half-cosine on each segment so kinks (LEX junctions) are panel edges. */
function spanEdges(props: PlanformProps, nSpan: number): number[] {
  const total = props.span / 2;
  const edges: number[] = [0];
  for (const g of props.segments) {
    const n = Math.max(2, Math.round((nSpan * (g.y1 - g.y0)) / total));
    for (let k = 1; k <= n; k++) {
      const t = 1 - Math.cos((Math.PI / 2) * (k / n)); // denser toward the segment's outboard end
      const last = props.segments[props.segments.length - 1];
      const u = g === last ? t : k / n;
      edges.push(g.y0 + u * (g.y1 - g.y0));
    }
  }
  return edges;
}

function interp(p: Planform, y: number): { xLe: number; chord: number } {
  const s = p.stations;
  for (let k = 0; k + 1 < s.length; k++) {
    const a = s[k], b = s[k + 1];
    if (a === undefined || b === undefined) continue;
    if (y <= b.y + 1e-12) {
      const t = (y - a.y) / (b.y - a.y);
      return { xLe: a.xLe + t * (b.xLe - a.xLe), chord: a.chord + t * (b.chord - a.chord) };
    }
  }
  const z = s[s.length - 1];
  return { xLe: z?.xLe ?? 0, chord: z?.chord ?? 0 };
}

/** Solve the dense system A x = rhs by Gaussian elimination with partial pivoting. */
export function solveDense(A: Float64Array, rhs: Float64Array, n: number): Float64Array {
  const M = A.slice(), x = rhs.slice();
  for (let c = 0; c < n; c++) {
    let p = c, best = Math.abs(M[c * n + c] ?? 0);
    for (let r = c + 1; r < n; r++) { const v = Math.abs(M[r * n + c] ?? 0); if (v > best) { best = v; p = r; } }
    if (best < 1e-14) throw new Error("singular influence matrix");
    if (p !== c) {
      for (let k = 0; k < n; k++) { const t = M[c * n + k] ?? 0; M[c * n + k] = M[p * n + k] ?? 0; M[p * n + k] = t; }
      const t = x[c] ?? 0; x[c] = x[p] ?? 0; x[p] = t;
    }
    const d = M[c * n + c] ?? 1;
    for (let r = c + 1; r < n; r++) {
      const f = (M[r * n + c] ?? 0) / d;
      if (f === 0) continue;
      for (let k = c; k < n; k++) M[r * n + k] = (M[r * n + k] ?? 0) - f * (M[c * n + k] ?? 0);
      x[r] = (x[r] ?? 0) - f * (x[c] ?? 0);
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r] ?? 0;
    for (let k = r + 1; k < n; k++) s -= (M[r * n + k] ?? 0) * (x[k] ?? 0);
    x[r] = s / (M[r * n + r] ?? 1);
  }
  return x;
}

/** Symmetric influence matrix: downwash at each control point from each right-half horseshoe and its mirror image. */
function influence(panels: readonly Panel[]): Float64Array {
  const n = panels.length, A = new Float64Array(n * n);
  for (let r = 0; r < n; r++) {
    const pr = panels[r];
    if (pr === undefined) continue;
    for (let c = 0; c < n; c++) {
      const pc = panels[c];
      if (pc === undefined) continue;
      A[r * n + c] = horseshoeW(pr.cp.x, pr.cp.y, pc.a, pc.b) + horseshoeW(pr.cp.x, pr.cp.y, { x: pc.b.x, y: -pc.b.y }, { x: pc.a.x, y: -pc.a.y });
    }
  }
  return A;
}

export interface IncidenceLoad {
  /** Lift coefficient per unit sine of the incidence applied (on the reference area). */
  readonly k: number;
  /** x of the centre of pressure of that load. */
  readonly xCp: number;
}

/**
 * Potential-flow load from a local incidence distribution on an already solved lattice: `share(panel)` is the part of
 * a unit incidence each panel sees (1 everywhere reproduces Kp; 1 aft of a hinge line and 0 ahead of it is a
 * trailing-edge control deflected trailing edge down). Linear, so loads superpose with the angle-of-attack load.
 */
export function incidenceLoad(v: VlmResult, share: (panel: Panel) => number): IncidenceLoad {
  const n = v.panels.length;
  const rhs = new Float64Array(n);
  v.panels.forEach((pn, k) => { rhs[k] = -share(pn); });
  const g = solveDense(influence(v.panels), rhs, n);
  let lift = 0, moment = 0;
  v.panels.forEach((pn, k) => { const dl = (g[k] ?? 0) * (pn.b.y - pn.a.y); lift += dl; moment += dl * 0.5 * (pn.a.x + pn.b.x); });
  return { k: (4 * lift) / v.props.sRef, xCp: Math.abs(lift) > 1e-14 ? moment / lift : 0 };
}

export function solveVlm(p: Planform, mesh: Mesh = DEFAULT_MESH): VlmResult {
  if (!(Number.isInteger(mesh.nSpan) && Number.isInteger(mesh.nChord) && mesh.nSpan >= 4 && mesh.nChord >= 2 && mesh.nSpan * mesh.nChord <= 2400)) {
    throw new Error("mesh must have 4 ≤ nSpan, 2 ≤ nChord and at most 2400 panels per half");
  }
  const props = planformProps(p);
  const ys = spanEdges(props, mesh.nSpan);
  const xs = cosineSpacing(mesh.nChord);
  const panels: Panel[] = [], strips: Strip[] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    const y0 = ys[j] ?? 0, y1 = ys[j + 1] ?? 0, ym = 0.5 * (y0 + y1);
    const L = interp(p, y0), R = interp(p, y1), M = interp(p, ym);
    strips.push({ y0, y1, xLe: M.xLe, chord: M.chord, sweepLe: Math.atan2(R.xLe - L.xLe, y1 - y0) });
    for (let i = 0; i < mesh.nChord; i++) {
      const f0 = xs[i] ?? 0, f1 = xs[i + 1] ?? 1;
      const at = (s: { xLe: number; chord: number }, f: number, y: number): P2 => ({ x: s.xLe + f * s.chord, y });
      const q = f0 + 0.25 * (f1 - f0), c = f0 + 0.75 * (f1 - f0);
      panels.push({
        j, i,
        corners: [at(L, f0, y0), at(R, f0, y1), at(R, f1, y1), at(L, f1, y0)],
        a: at(L, q, y0), b: at(R, q, y1), cp: at(M, c, ym), chord: (f1 - f0) * M.chord,
      });
    }
  }
  const n = panels.length;
  const A = influence(panels), rhs = new Float64Array(n).fill(-1); // flow tangency: w_induced + U sin α = 0, U sin α = 1
  const gamma = Array.from(solveDense(A, rhs, n));

  // Lift (Kutta-Joukowski on bound vortices): CL = 2 Σ_half Γ Δy · 2 / S for unit U, sin α.
  let lift = 0, moment = 0;
  panels.forEach((pn, k) => {
    const dl = (gamma[k] ?? 0) * (pn.b.y - pn.a.y);
    lift += dl;
    moment += dl * 0.5 * (pn.a.x + pn.b.x);
  });
  const kp = (4 * lift) / props.sRef;
  const xCpPotential = moment / lift;

  // Strip circulation and Trefftz-plane induced drag (full span by symmetry).
  const G = strips.map((_, j) => panels.reduce((s, pn, k) => (pn.j === j ? s + (gamma[k] ?? 0) : s), 0));
  const fullEdges = [...ys.slice(1).map((y) => -y).reverse(), ...ys];
  const fullG = [...[...G].reverse(), ...G];
  const shed = fullEdges.map((_, k) => (k > 0 ? (fullG[k - 1] ?? 0) : 0) - (k < fullG.length ? (fullG[k] ?? 0) : 0));
  let drag = 0;
  for (let m = 0; m < fullG.length; m++) {
    const ya = fullEdges[m] ?? 0, yb = fullEdges[m + 1] ?? 0, ymid = 0.5 * (ya + yb);
    let w = 0;
    // Trailing filament along +x of strength g at y_k: w(y) = g / (2π (y − y_k)).
    shed.forEach((g, k) => { w += g / (2 * Math.PI * (ymid - (fullEdges[k] ?? 0))); });
    drag += -0.5 * (fullG[m] ?? 0) * w * (yb - ya);
  }
  const cdi = (2 * drag) / props.sRef; // D / (½ ρ U² S) with ρ = U = 1
  const ki = cdi / (kp * kp);
  const e = 1 / (Math.PI * ((props.span * props.span) / props.sRef) * ki); // aspect ratio on the reference area Ki uses

  // Leading-edge thrust distribution: leading-panel singularity strength A ∝ Γ₁/√Δc, thrust per strip ∝ A²·Δy.
  const thrustRaw = strips.map((s, j) => {
    const k = j * mesh.nChord;
    const pn = panels[k];
    const g = gamma[k] ?? 0;
    return pn === undefined ? 0 : ((g * g) / Math.max(pn.chord, 1e-12)) * (s.y1 - s.y0);
  });
  const tSum = thrustRaw.reduce((a, b) => a + b, 0);
  const thrustShare = thrustRaw.map((t) => t / tSum);
  const loading = G.map((g) => (2 * g) / props.cRef);
  return { props, panels, strips, gamma, kp, ki, e, xCpPotential, thrustShare, loading };
}
