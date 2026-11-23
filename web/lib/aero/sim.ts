import type { Aircraft } from "./aircraft";
import { type F16Mode, type F16State, MACH_DATA_LIMIT, advanceF16, bareAirframeModes, f16Telemetry, trimF16 } from "./f16live";
import { type LiveState, advance, liveAirframe, liveModel, telemetry, trimStart } from "./live";
import { solveVlm } from "./vlm";
import { vortexModel } from "./vortex";

/**
 * One interface over the two live models, so the app treats them alike:
 *  - "nasa": the F-16 flown on NASA's measured whole-aircraft data with a pitching-moment model (f16live.ts);
 *  - "estimate": the engine's wing-only lift estimate with angle of attack following the stick (live.ts), for
 *    aircraft without published whole-aircraft tables. Stated as such in the app.
 */
export type SimMode = F16Mode | "estimate";
export interface SimControls { readonly mode: SimMode; readonly stick: number; readonly power: number }
export interface SimView {
  readonly t: number; readonly v: number; readonly alpha: number; readonly gamma: number; readonly theta: number; readonly h: number; readonly x: number;
  readonly mach: number; readonly power: number; readonly status: string; readonly cl: number; readonly cd: number; readonly n: number; readonly thrust: number;
  /** Optional, per model: vortex lift kept (estimate), stabilator and flap (NASA), blackout progress (NASA). */
  readonly vortex: number | null; readonly dhDeg: number | null; readonly lefDeg: number | null; readonly grey: number | null;
  /** True where the model runs outside the data it rests on (NASA F-16 above Mach 0.6, the estimate above Mach 0.6). */
  readonly beyondData: boolean;
}
export interface LiveSim<S = unknown> {
  readonly kind: "nasa" | "estimate";
  readonly modes: readonly { value: SimMode; label: string; stick: { min: number; max: number; label: string; pullIsUp: boolean } }[];
  readonly start: { state: S; stick: Record<string, number>; power: number } | null;
  advance(s: S, c: SimControls, seconds: number, carry: number): { state: S; carry: number };
  view(s: S): SimView;
  /** Plain-language facts about where each part of the model comes from. */
  readonly notes: readonly string[];
  /** Modes of motion at a state, flap on its schedule and with it held (NASA model only). */
  stability?(s: S): { name: string; text: string; unstable: boolean }[];
}

export const START = { speed: 500, alt: 15000 } as const;

function nasaF16(): LiveSim<F16State> {
  const trim = trimF16(START.speed, START.alt);
  return {
    kind: "nasa",
    modes: [
      { value: "law", label: "Control law", stick: { min: -5, max: 25, label: "Stick · commanded angle of attack", pullIsUp: true } },
      { value: "direct", label: "Direct (no augmentation)", stick: { min: -25, max: 25, label: "Stick · stabilator (− is nose up)", pullIsUp: false } },
    ],
    start: trim ? { state: trim.state, stick: { law: trim.controls.alphaCmdDeg, direct: trim.controls.dhCmdDeg }, power: trim.controls.power } : null,
    advance: (s, c, seconds, carry) => advanceF16(s, { mode: c.mode === "direct" ? "direct" : "law", alphaCmdDeg: c.stick, dhCmdDeg: c.stick, power: c.power }, seconds, carry),
    view: (s) => { const t = f16Telemetry(s); return { ...t, vortex: null, dhDeg: t.dhDeg, lefDeg: t.lefDeg, grey: t.grey }; },
    notes: [
      "Forces and pitching moment: NASA TP-1538 Table III, whole-aircraft wind-tunnel data (machine-readable tables from isrlab/F16-Model-Matlab, MIT, checked against the scans). Drag and lift are measured, not estimated.",
      "Rigid-body pitch dynamics with the published weight (20,500 lb) and pitch inertia (55,814 slug·ft²) at NASA's reference centre of gravity (0.35 c̄), where the bare airframe is slightly unstable.",
      "Stabilator actuator (0.0495 s, 60°/s, ±25°), leading-edge-flap schedule and actuator, and the pilot blackout rule (grey-out above 5 g; 300 s at 5 g to 10 s at 9 g) as published in TP-1538. Recovery time below 5 g is assumed (10 s). Above 9 g (USAF fact sheet) the run ends as an over-stress.",
      "Engine: NASA Table VI thrust by Mach and altitude; throttle response a 1.2 s lag (assumed). Our control law (α command with pitch-rate damping) is not the F-16's; the direct mode has no augmentation at all.",
      `Above Mach ${MACH_DATA_LIMIT} the aircraft keeps flying, to Mach 3 and beyond, but it is an extrapolation: NASA states the low-speed data are valid only below about Mach 0.6, no compressibility or wave drag is modelled, and thrust is held at the table's Mach 1.0 values. The real F-16 tops out near Mach 2. Not modelled either: sideslip and lateral motion, landing gear, turbulence.`,
    ],
    stability: (s) => (["scheduled", "held"] as const).flatMap((flap) => bareAirframeModes(s, flap).modes.map((m) => ({
      name: `${flap === "held" ? "flap frozen: " : ""}${m.name}`, unstable: m.root.re > 0,
      text: m.periodS !== null ? `period ${m.periodS.toFixed(1)} s, damping ${m.zeta.toFixed(2)}` : m.root.re > 0 ? `doubles every ${m.doubleOrHalfS.toFixed(1)} s` : `halves every ${m.doubleOrHalfS.toFixed(2)} s`,
    }))),
  };
}

function estimate(a: Aircraft): LiveSim<LiveState> {
  const v = solveVlm(a.planform(), { nSpan: 16, nChord: 8 }), m = vortexModel(v), L = liveModel(v, m, liveAirframe(a)), trim = trimStart(L, START.speed, START.alt);
  return {
    kind: "estimate",
    modes: [{ value: "estimate", label: "Estimate (α follows the stick)", stick: { min: -5, max: 40, label: "Stick · commanded angle of attack", pullIsUp: true } }],
    start: trim ? { state: trim.state, stick: { estimate: trim.controls.alphaCmdDeg }, power: trim.controls.power } : null,
    advance: (s, c, seconds, carry) => advance(L, s, { alphaCmdDeg: c.stick, power: c.power }, seconds, carry),
    view: (s) => { const t = telemetry(L, s); return { ...t, theta: t.alpha + t.gamma, dhDeg: null, lefDeg: null, grey: null, beyondData: t.mach > 0.6 }; },
    notes: [
      `No whole-aircraft data are published for the ${a.name} in a form used here: lift is the engine's wing estimate with the vortex lag; drag: ${L.frame.cd0Source}.`,
      `Weight ${L.frame.weightLb.toLocaleString("en")} lb and wing reference ${L.frame.areaFt2} ft² as published. Thrust: ${L.frame.thrustSource}.`,
      "Angle of attack follows the stick with a 0.35 s lag and a 25°/s rate limit (assumed: no pitching-moment model). Treat this as an estimate, not a flight model.",
    ],
  };
}

/** The best available live model for an aircraft. */
export function liveSimFor(a: Aircraft): LiveSim {
  const sim: LiveSim = a.id === "f16" ? nasaF16() : estimate(a); // state type erased: each model only sees its own states
  return sim;
}

/**
 * Side-stick deflection d ∈ [−1, 1] (positive = pull) to the mode's command, around a trim reference: hands off
 * (d = 0) flies the trim; full pull reaches the nose-up end of the range, full push the nose-down end. In the direct
 * mode nose-up is a negative stabilator, so the direction flips.
 */
export function stickCommand(d: number, trim: number, range: { min: number; max: number; pullIsUp: boolean }): number {
  const k = Math.min(1, Math.max(-1, d)), t = Math.min(range.max, Math.max(range.min, trim));
  const up = range.pullIsUp ? range.max : range.min, down = range.pullIsUp ? range.min : range.max;
  return k >= 0 ? t + k * (up - t) : t + -k * (down - t);
}
