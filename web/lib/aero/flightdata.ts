/**
 * Published flight and trim conditions of the real aircraft, copied exactly from the NASA tables named below.
 * These are the measurements the model is compared with; nothing here is fitted or adjusted.
 */

/** NASA TP-3374, Table I, "Data Summary for Flight Vapor Screen" (serial-averaged nominal values), F-106B. */
export interface FlightPoint {
  readonly group: "I" | "II" | "III" | "IV" | "V";
  readonly serial: string;
  readonly alphaDeg: number;
  readonly altitudeFt: number;
  readonly loadFactor: number;
  readonly mach: number;
  /** Reynolds number, millions. */
  readonly rnMillions: number;
}

const row = (group: FlightPoint["group"], serial: string, alphaDeg: number, altitudeFt: number, loadFactor: number, mach: number, rnMillions: number): FlightPoint =>
  ({ group, serial, alphaDeg, altitudeFt, loadFactor, mach, rnMillions });

export const F106B_FLIGHT: readonly FlightPoint[] = [
  row("I", "91-15/12", 12.9, 14900, 1.0, 0.36, 39.1), row("I", "91-15/13", 13.9, 14800, 1.0, 0.34, 37.3), row("I", "91-15/17", 15.1, 14900, 1.0, 0.34, 37.0),
  row("I", "91-16/09", 15.8, 16200, 1.0, 0.33, 33.0), row("I", "91-16/10", 16.9, 15800, 1.0, 0.31, 31.4), row("I", "91-16/11", 17.8, 15800, 1.0, 0.29, 30.1),
  row("I", "91-17/07", 18.6, 16500, 1.0, 0.29, 30.0), row("I", "91-17/09", 20.2, 16200, 1.0, 0.27, 28.3), row("I", "91-17/10", 21.3, 15500, 1.0, 0.26, 27.5),
  row("II", "91-13/11", 13.9, 24600, 1.0, 0.42, 35.1), row("II", "91-13/05", 14.9, 24600, 1.0, 0.41, 34.6), row("II", "91-13/10", 16.1, 25500, 1.0, 0.39, 32.0),
  row("II", "91-13/06", 17.0, 24300, 1.0, 0.38, 32.0), row("II", "91-13/07", 18.8, 24000, 1.0, 0.35, 29.9), row("II", "91-13/08", 20.5, 25500, 1.0, 0.34, 27.8),
  row("II", "91-13/09", 22.5, 24700, 1.0, 0.32, 26.6),
  row("III", "91-15/06", 13.9, 35400, 1.0, 0.54, 30.8), row("III", "91-14/07", 14.8, 36900, 0.9, 0.53, 29.2), row("III", "91-15/08", 15.8, 36600, 0.9, 0.50, 27.6),
  row("III", "91-14/08", 16.8, 37100, 0.9, 0.49, 26.8), row("III", "91-14/09", 17.7, 37200, 1.0, 0.47, 25.8), row("III", "91-14/10", 18.7, 37300, 1.0, 0.45, 24.6),
  row("III", "91-14/11", 19.7, 37200, 1.0, 0.44, 23.8), row("III", "91-14/12", 20.5, 36300, 1.0, 0.42, 23.7), row("III", "91-15/10", 21.9, 36200, 1.0, 0.40, 22.6),
  row("IV", "91-17/05", 14.7, 37400, 1.6, 0.68, 35.5), row("IV", "91-15/11", 14.8, 33000, 2.5, 0.73, 45.7), row("IV", "91-16/07", 14.8, 27200, 3.9, 0.80, 57.3),
  row("IV", "91-16/05", 16.8, 34400, 2.9, 0.78, 44.6), row("IV", "91-16/08", 17.3, 33100, 3.8, 0.81, 48.4), row("IV", "91-17/06", 18.6, 36900, 2.3, 0.67, 35.6),
  row("IV", "91-16/06", 19.4, 29400, 3.4, 0.69, 46.6),
  row("V", "91-13/04", 8.5, 15200, 1.1, 0.50, 55.9), row("V", "91-15/09", 21.7, 35900, 1.0, 0.41, 23.1),
];

/**
 * NASA TP-2747, Table III, "Approach-to-Landing Flight Conditions", basic F-106B (no vortex flap):
 * landing gear down, speed brakes out, c.g. 28 percent of the mean chord, weight 27,400 lb. The table is the trim of
 * NASA's piloted-simulation model, itself built from wind-tunnel tests of a 0.15-scale F-106B. Area from Table I.
 */
export const F106B_APPROACH_TRIM = {
  velocityKnots: 180, gammaDeg: -3, alphaDeg: 11.3, elevonDeg: -4.13, thrustLb: 6410, weightLb: 27400, areaFt2: 695,
  cgFractionOfChord: 0.28, source: "NASA TP-2747, Tables I and III",
  /** Not stated in the table: an approach to landing is taken at sea-level standard density. */
  assumed: "sea-level standard density; velocity taken as true airspeed",
} as const;

/** The engine is validated below Mach 0.6 (no compressibility model). */
export const MACH_LIMIT = 0.6;
