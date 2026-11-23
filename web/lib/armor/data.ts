import type { Fiber, Projectile } from "./models";

/**
 * Fibre presets: typical manufacturer datasheet values, not measured by Archymedes. NIST 2020 shows extracted-yarn
 * tests are what matter for a real panel; the interface lets every value be replaced.
 */
export const FIBERS: Fiber[] = [
  { id: "ppta", name: "Para-aramid (PPTA), standard modulus", sigmaGPa: 2.92, strain: 0.036, modulusGPa: 70.5, density: 1440 },
  { id: "ppta-hm", name: "Para-aramid (PPTA), high tenacity", sigmaGPa: 3.4, strain: 0.0355, modulusGPa: 82.6, density: 1440 },
  { id: "uhmwpe", name: "UHMWPE fibre", sigmaGPa: 3.6, strain: 0.038, modulusGPa: 116, density: 975 },
  { id: "pbo", name: "PBO fibre", sigmaGPa: 5.8, strain: 0.035, modulusGPa: 180, density: 1540 },
];

const GRAIN = 6.479891e-5; // kg
/** NIJ Standard 0123.00 Table 1 (soft armor): test threats and reference velocities. Diameters are nominal bullet diameters. */
export interface Threat { id: string; level: "HG1" | "HG2"; name: string; grains: number; refMs: number; refFts: number; projectile: Projectile }
export const THREATS: Threat[] = [
  { id: "hg1-9", level: "HG1", name: "9mm Luger FMJ RN, 124 gr", grains: 124, refMs: 398, refFts: 1305, projectile: { massKg: 124 * GRAIN, diameterM: 9.02e-3 } },
  { id: "hg1-357", level: "HG1", name: ".357 Mag JSP, 158 gr", grains: 158, refMs: 436, refFts: 1430, projectile: { massKg: 158 * GRAIN, diameterM: 9.07e-3 } },
  { id: "hg2-9", level: "HG2", name: "9mm Luger FMJ RN, 124 gr", grains: 124, refMs: 448, refFts: 1470, projectile: { massKg: 124 * GRAIN, diameterM: 9.02e-3 } },
  { id: "hg2-44", level: "HG2", name: ".44 Mag JHP, 240 gr", grains: 240, refMs: 436, refFts: 1430, projectile: { massKg: 240 * GRAIN, diameterM: 10.9e-3 } },
];

/** Reference construction from NIST 2020 §3.1.1 (PPTA armor, designed to NIJ 0101.04 Level II, Table 1 areal density). */
export const NIST_REFERENCE = { fiberId: "ppta", plies: 25, arealDensity: 2.625, denier: 500, yarnsPerMm: 0.945, quiltCm: 3.18 };

/** NIJ 0101.07 §9.5 Table 3 velocity steps in m/s (the standard states 30, 23, 15 m/s alongside 100, 75, 50 ft/s). */
export const NIJ_STEPS_MS: [number, number, number] = [30, 23, 15];
export const NIJ_MIN_SHOTS = { pp: 60, cp: 30 };

/** Fabric packing assumed only for the drawing's thickness estimate (ply thickness = ply areal density / (ρ·Vf)). */
export const FIBER_VOLUME_FRACTION = 0.6;
