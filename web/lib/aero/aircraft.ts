import type { Planform, Station } from "./geometry";
import { HARV_MASS } from "./flight";
import { HARV_PUBLISHED, harvPlanform } from "./harv";

/**
 * The aircraft this engine models: real airframes only, each one a NASA research aircraft whose geometry NASA
 * published. Every number in `published` names the report it was read from; planforms are built from those numbers
 * alone. Anything traced from a drawing is listed under `traced` with its tolerance. There are no invented layouts.
 * (The delta wings in the validation corpus are NASA wind-tunnel test wings, used only to measure the error band.)
 */
export interface Source { readonly report: string; readonly title: string; readonly where: string; readonly url: string }
export interface Published { readonly value: number; readonly unit: string; readonly report: string }

export interface Aircraft {
  readonly id: string;
  readonly name: string;
  /** The specific airframe. */
  readonly airframe: string;
  /** The NASA programme it flew in. */
  readonly programme: string;
  readonly sources: readonly Source[];
  readonly published: Readonly<Record<string, Published>>;
  /** Values taken from a drawing, not a table. */
  readonly traced: readonly { readonly what: string; readonly value: number; readonly unit: string; readonly tolerance: number }[];
  /** Where the real aircraft differs from what the engine assumes (thin, flat, sharp-edged wing). */
  readonly caveats: readonly string[];
  /** Wing planform for the vortex-lattice solver, feet, x aft from the wing apex (or the nose for the HARV). */
  readonly planform: () => Planform;
  /** Trailing-edge control surface, if modelled: hinge line x at span station y (same axes as the planform). */
  readonly elevon?: { readonly hingeX: (y: number) => number; readonly yInboard: number; readonly yOutboard: number };
  /** Centre of gravity used for trim, as a fraction of the reference chord. */
  readonly cgFractionOfChord?: number;
  /** Corpus case with measured lift for this aircraft, if any. */
  readonly dataCaseId?: string;
}

const TM110216: Source = { report: "NASA TM-110216", title: "Simulation Model of the F/A-18 High Angle-of-Attack Research Vehicle Utilized for the Design of Advanced Control Laws (Messina et al., 1996)", where: "Table 2.3", url: "https://ntrs.nasa.gov/citations/19960027892" };
const TP206573: Source = { report: "NASA TP-1999-206573", title: "F/A-18 HARV flight-determined derivatives: three-view and reference geometry", where: "Fig. 2 and Table 3", url: "https://ntrs.nasa.gov/citations/19980007172" };
const TM112360: Source = { report: "NASA TM-112360", title: "HATP F/A-18 baseline wind-tunnel data (1996)", where: "Fig. 28", url: "https://ntrs.nasa.gov/citations/19970012895" };
const TP210629: Source = { report: "NASA TP-2001-210629", title: "Flight, Wind-Tunnel, and Computational Fluid Dynamics Comparison for Cranked Arrow Wing (F-16XL-1) at Subsonic and Transonic Speeds (Lamar, Obara, Fisher & Fisher, 2001)", where: "Table 3 and Fig. 2", url: "https://www.cs.odu.edu/~mln/ltrs-pdfs/NASA-2001-tp210629.pdf" };
const TP3374: Source = { report: "NASA TP-3374", title: "Leading-Edge Vortex-System Details Obtained on F-106B Aircraft Using a Rotating Vapor-Screen and Surface Techniques (Lamar et al., 1993)", where: "p. 3, Fig. 1 and Table I", url: "https://www.cs.odu.edu/~mln/ltrs-pdfs/tp3374.pdf" };
const TP2747: Source = { report: "NASA TP-2747", title: "Piloted-Simulation Study of Effects of Vortex Flaps on Low-Speed Handling Qualities of a Delta-Wing Airplane (1987)", where: "Table I and Table III", url: "https://ntrs.nasa.gov/citations/19870017489" };

const TP1538: Source = { report: "NASA TP-1538", title: "Simulator Study of Stall/Post-Stall Characteristics of a Fighter Airplane With Relaxed Longitudinal Static Stability (Nguyen et al., 1979)", where: "Table I and Fig. 2", url: "https://ntrs.nasa.gov/citations/19800005879" };

const pub = (value: number, unit: string, s: Source): Published => ({ value, unit, report: s.report });
const D = Math.PI / 180;

// ---------------------------------------------------------------- F-106B

const F106 = { rootChord: 35.63, theoreticalSpan: 39.16, span: 38.29, sweepLe: 60, area: 697.83, chord: 23.75 } as const;

/**
 * 60° delta-like wing. The published theoretical triangle (root chord 35.63 ft, span 39.16 ft) fixes the trailing
 * edge: with a 60° leading edge the theoretical tip lies at x = 19.58 tan 60° = 33.91 ft, ahead of the root trailing
 * edge at 35.63 ft, so the trailing edge sweeps forward about 5°. The actual tips are cropped at the published span.
 */
function f106Planform(): Planform {
  const semiT = F106.theoreticalSpan / 2, semi = F106.span / 2, t = Math.tan(F106.sweepLe * D);
  const xTe = (y: number) => F106.rootChord + (y / semiT) * (semiT * t - F106.rootChord);
  const stations: Station[] = [{ y: 0, xLe: 0, chord: F106.rootChord }, { y: semi, xLe: semi * t, chord: xTe(semi) - semi * t }];
  const yMac = semiT / 3; // mean aerodynamic chord of the theoretical triangle: ⅔ root chord at ⅓ semispan
  return { name: "F-106B wing", stations, sRef: F106.area, cRef: F106.chord, xRef: yMac * t + 0.275 * F106.chord };
}
/** Elevon hinge line: a constant-chord strip ahead of the trailing edge, traced from TP-3374 Fig. 1. */
const F106_ELEVON_CHORD = 2.75;
function f106HingeX(y: number): number {
  const semiT = F106.theoreticalSpan / 2, t = Math.tan(F106.sweepLe * D);
  return F106.rootChord + (y / semiT) * (semiT * t - F106.rootChord) - F106_ELEVON_CHORD;
}

// ---------------------------------------------------------------- F-16XL-1

const XL = { rootChord: 41.75, span: 32.4, crankY: 137.096 / 12, sweepIn: 70, sweepOut: 50, tipChord: 5.4 } as const;

/**
 * Cranked arrow from the published three-view: 70° leading edge from the theoretical apex to the crank at butt line
 * 137.096 in, 50° outboard to the tip; theoretical root chord 41.75 ft, tip chord 5.40 ft, straight trailing edge
 * between them. The S-blend at the apex and the trailing-edge details are not modelled.
 */
function f16xlPlanform(): Planform {
  const semi = XL.span / 2;
  const xCrank = XL.crankY * Math.tan(XL.sweepIn * D), xTip = xCrank + (semi - XL.crankY) * Math.tan(XL.sweepOut * D);
  const xTe = (y: number) => XL.rootChord + (y / semi) * (xTip + XL.tipChord - XL.rootChord);
  const stations: Station[] = [
    { y: 0, xLe: 0, chord: XL.rootChord }, { y: XL.crankY, xLe: xCrank, chord: xTe(XL.crankY) - xCrank }, { y: semi, xLe: xTip, chord: XL.tipChord },
  ];
  return { name: "F-16XL-1 wing", stations, sRef: 600, cRef: 24.7 }; // moment reference: quarter chord of the planform's own MAC
}

// ---------------------------------------------------------------- F-16

/**
 * F-16 wing as NASA's simulation reference wing: the trapezoid extended to the centreline. Area 300 ft², span 30 ft
 * and mean aerodynamic chord 11.32 ft are published (TP-1538 Table I); together they fix the taper exactly
 * (MAC = ⅔ c_r (1 + λ + λ²)/(1 + λ) with c_r = 2S / (b (1 + λ)) gives λ = 0.2275, c_r = 16.29 ft). The leading-edge
 * sweep is not in the report's text: it is fitted to both wings of the report's Fig. 2, with each axis scaled by its
 * published dimension (41.8° and 38.5°, mean 40.2°). The forebody strake is not modelled.
 */
export const F16_TRACED_SWEEP_DEG = 40.2;
function f16Taper(): number {
  const S = 300, b = 30, mac = 11.32;
  let lo = 0.01, hi = 0.99;
  for (let k = 0; k < 80; k++) {
    const l = (lo + hi) / 2, cr = (2 * S) / (b * (1 + l));
    if ((2 / 3) * cr * ((1 + l + l * l) / (1 + l)) > mac) lo = l; else hi = l;
  }
  return (lo + hi) / 2;
}
function f16Planform(): Planform {
  const S = 300, b = 30, l = f16Taper(), cr = (2 * S) / (b * (1 + l)), semi = b / 2, t = Math.tan(F16_TRACED_SWEEP_DEG * D);
  return { name: "F-16 wing", stations: [{ y: 0, xLe: 0, chord: cr }, { y: semi, xLe: semi * t, chord: cr * l }], sRef: S, cRef: 11.32 };
}

// ---------------------------------------------------------------- registry

export const AIRCRAFT: readonly Aircraft[] = [
  {
    id: "f16", name: "F-16", airframe: "F-16 configuration of NASA Langley's high-angle-of-attack simulation, from F-16 wind-tunnel tests",
    programme: "NASA Langley differential maneuvering simulator, stall/post-stall study, 1979", sources: [TP1538],
    published: {
      referenceAreaFt2: pub(300, "ft²", TP1538), referenceChordFt: pub(11.32, "ft", TP1538), spanFt: pub(30, "ft", TP1538),
      lengthFt: pub(15.09 / 0.3048, "ft", TP1538), heightFt: pub(5.01 / 0.3048, "ft", TP1538), spanWithLaunchersFt: pub(9.45 / 0.3048, "ft", TP1538),
      weightLb: pub(20500, "lb", TP1538), ixxSlugFt2: pub(9496, "slug·ft²", TP1538), iyySlugFt2: pub(55814, "slug·ft²", TP1538),
      izzSlugFt2: pub(63100, "slug·ft²", TP1538), cgFractionOfChord: pub(0.35, "", TP1538),
    },
    traced: [{ what: "wing leading-edge sweep, fitted to both wings of Fig. 2", value: F16_TRACED_SWEEP_DEG, unit: "°", tolerance: 2.5 }],
    caveats: ["The forebody strake (leading-edge extension) and the fuselage are not in the aerodynamic model: lift below the strake's vortex onset is the wing's, above it is underestimated.",
      "Wing sweep about 40° is below the vortex-breakdown map (55–80°): lift is an extrapolation.",
      "NASA's simulation weight (20,500 lb) is light for an F-16 in service; it is the report's value."],
    planform: f16Planform,
  },
  {
    id: "harv", name: "F/A-18 HARV", airframe: "NASA 840, the F/A-18 High Alpha Research Vehicle (unarmed, flown 1987–1996)",
    programme: "NASA High-Alpha Technology Program, Dryden", sources: [TP206573, TM110216, TM112360],
    published: {
      referenceAreaFt2: pub(HARV_PUBLISHED.wingAreaFt2, "ft²", TP206573), referenceChordFt: pub(HARV_PUBLISHED.macFt, "ft", TP206573),
      spanFt: pub(HARV_PUBLISHED.spanFt, "ft", TP206573), lengthFt: pub(HARV_PUBLISHED.lengthFt, "ft", TP206573),
      heightFt: pub(HARV_PUBLISHED.heightFt, "ft", TP206573), aspectRatio: pub(HARV_PUBLISHED.aspectRatio, "", TP206573),
      weightLb: pub(HARV_MASS.fighterEscort60pctFuel.weightLb, "lb", TM110216), iyySlugFt2: pub(HARV_MASS.fighterEscort60pctFuel.iyy, "slug·ft²", TM110216),
    },
    traced: [{ what: "fuselage, canopy, LEX and tail outlines", value: 0, unit: "ft", tolerance: 0.3 }],
    caveats: ["Wing sweep 26.7° is below the vortex-breakdown map (55–80°): lift is an extrapolation.", "Fuselage, tails, flaps and forebody vortices are not in the aerodynamic model."],
    planform: harvPlanform, dataCaseId: "fa18-hatp",
  },
  {
    id: "f16xl", name: "F-16XL-1", airframe: "F-16XL ship 1 (NASA 849), the single-seat cranked-arrow research aircraft",
    programme: "NASA Cranked-Arrow Wing Aerodynamics Project (CAWAP), Langley and Dryden", sources: [TP210629],
    published: {
      referenceAreaFt2: pub(600, "ft²", TP210629), wingAreaFt2: pub(646.37, "ft²", TP210629), referenceChordFt: pub(24.7, "ft", TP210629),
      spanFt: pub(32.4, "ft", TP210629), aspectRatio: pub(1.75, "", TP210629), theoreticalRootChordFt: pub(41.75, "ft", TP210629),
      crankButtLineIn: pub(137.096, "in", TP210629), tipChordFt: pub(5.4, "ft", TP210629), inboardSweepDeg: pub(70, "°", TP210629),
      outboardSweepDeg: pub(50, "°", TP210629), lengthFt: pub(54.155, "ft", TP210629), heightFt: pub(17.606, "ft", TP210629), weightLb: pub(35000, "lb", TP210629),
      maxThrustLb: pub(23830, "lbf", TP210629),
    },
    traced: [],
    caveats: ["The S-blend at the wing apex and the trailing-edge details are not modelled: the straight-edged planform is about 5% larger than the published wing area.",
      "The inboard 70° leading edge is blunt on the aircraft; the engine assumes sharp edges.",
      "A cranked planform is outside the validated domain (pointed delta wings): lift is an extrapolation."],
    planform: f16xlPlanform,
  },
  {
    id: "f106b", name: "F-106B", airframe: "F-106B Delta Dart, NASA 816 (two-seat), the vortex-flap research aircraft",
    programme: "NASA Langley vortex-flap and vapor-screen flight experiments, 1985–1991", sources: [TP3374, TP2747],
    published: {
      referenceAreaFt2: pub(697.83, "ft²", TP3374), referenceChordFt: pub(23.75, "ft", TP3374), theoreticalRootChordFt: pub(35.63, "ft", TP3374),
      theoreticalSpanFt: pub(39.16, "ft", TP3374), aspectRatio: pub(2.2, "", TP3374), leadingEdgeSweepDeg: pub(60, "°", TP3374),
      spanFt: pub(38.29, "ft", TP2747), lengthFt: pub(790.45 / 12, "ft", TP3374), heightFt: pub(202.11 / 12, "ft", TP3374),
      thicknessRootPct: pub(3.89, "%", TP3374), weightLb: pub(27400, "lb", TP2747),
      ixxSlugFt2: pub(15983, "slug·ft²", TP2747), iyySlugFt2: pub(174383, "slug·ft²", TP2747), izzSlugFt2: pub(184002, "slug·ft²", TP2747),
    },
    traced: [{ what: "elevon chord (constant, ahead of the trailing edge)", value: F106_ELEVON_CHORD, unit: "ft", tolerance: 0.4 }],
    caveats: ["The real wing has conical camber and a rounded leading edge (radius 0.13–0.17% of chord): the leading-edge vortex forms later and weaker than on the sharp flat plate the engine assumes.",
      "The fuselage, the area-ruled body and the fin are not in the aerodynamic model."],
    planform: f106Planform, elevon: { hingeX: f106HingeX, yInboard: 3.0, yOutboard: F106.span / 2 }, cgFractionOfChord: 0.28,
  },
];

export function aircraftById(id: string): Aircraft | undefined { return AIRCRAFT.find((a) => a.id === id); }
