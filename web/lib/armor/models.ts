/**
 * Soft-armor ballistic-limit models from NIST 2020 (J. Res. NIST 125:026), which restates Cunniff (1999) and
 * Phoenix & Porwal (2003). Equation numbers below are the NIST paper's.
 *
 * Use: relative screening only. NIST: "the purpose is not to determine absolute values of V50 ... but instead
 * relative V50 behavior in ratio form". Every prediction here is a ratio to a tested reference design, scaled by
 * that reference's measured V50.
 */

export interface Fiber { id: string; name: string; sigmaGPa: number; strain: number; modulusGPa: number; density: number }
export interface Projectile { massKg: number; diameterM: number }
export interface Design { fiber: Fiber; arealDensity: number }

function positive(name: string, v: number) {
  if (!Number.isFinite(v) || v <= 0) throw new RangeError(`${name} must be a positive finite number`);
}

/** Eq. (1): Γ0 = Ad·Ap/mp. */
export function gamma0(arealDensityKgM2: number, presentedAreaM2: number, projectileMassKg: number): number {
  positive("areal density", arealDensityKgM2); positive("presented area", presentedAreaM2); positive("projectile mass", projectileMassKg);
  return (arealDensityKgM2 * presentedAreaM2) / projectileMassKg;
}

/** Eq. (10): ψmax ≈ √((1+θ²Γ0)/(2θ²Γ0)); θ is bounded to the paper's 1-2 range. */
export function psiMax(theta: number, g0: number): number {
  if (!Number.isFinite(theta) || theta < 1 || theta > 2) throw new RangeError("θ must be between 1 and 2");
  positive("Γ0", g0);
  const t = theta * theta * g0;
  return Math.sqrt((1 + t) / (2 * t));
}

/** Eq. (3) with E = σ/ε for linear-elastic fibres: Ω = (σε/2ρ)·√(E/ρ), SI; Ω^(1/3) is a velocity (m/s). */
export function omega(f: Fiber): number {
  positive("strength", f.sigmaGPa); positive("strain", f.strain); positive("modulus", f.modulusGPa); positive("density", f.density);
  const s = f.sigmaGPa * 1e9, E = f.modulusGPa * 1e9;
  return ((s * f.strain) / (2 * f.density)) * Math.sqrt(E / f.density);
}

/** Eq. (7): Cunniff V50 retention in percent from strength and strain ratios (aged/new). */
export function cunniffRetention(sigmaRatio: number, strainRatio: number): number {
  positive("strength ratio", sigmaRatio); positive("strain ratio", strainRatio);
  return 100 * Math.sqrt(sigmaRatio) * Math.pow(strainRatio, 1 / 6);
}

const logTerm = (psi: number, eps: number) => Math.log(1 + Math.sqrt(psi / eps) * (psi - 1));

/** Eq. (13): Phoenix-Porwal retention divided by Cunniff retention. */
export function ppToCunniffRatio(strainAged: number, strainNew: number, psi: number): number {
  positive("aged strain", strainAged); positive("new strain", strainNew);
  if (!Number.isFinite(psi) || psi <= 1) throw new RangeError("ψmax must exceed 1");
  return Math.cbrt(strainAged / strainNew) * Math.sqrt(logTerm(psi, strainAged) / logTerm(psi, strainNew));
}

/** Eq. (12): Phoenix-Porwal V50 retention in percent. */
export function ppRetention(sigmaRatio: number, strainAged: number, strainNew: number, psi: number): number {
  return cunniffRetention(sigmaRatio, strainAged / strainNew) * ppToCunniffRatio(strainAged, strainNew, psi);
}

export const presentedArea = (p: Projectile) => (Math.PI * p.diameterM * p.diameterM) / 4;

/** Eqs. (8)-(10): Phoenix-Porwal V50 in m/s. Only meaningful through ratios to a reference (see header). */
export function ppV50(f: Fiber, arealDensity: number, p: Projectile, theta: number): number {
  const g0 = gamma0(arealDensity, presentedArea(p), p.massKg), psi = psiMax(theta, g0), eps = f.strain, t = theta * theta * g0;
  const a = Math.sqrt(psi / eps) * (psi - 1);
  const kmax = Math.exp((-4 * t * (psi * psi - 1)) / (3 * (1 + t))) * Math.sqrt(psi) * Math.pow(a / Math.log(1 + a), 2 / 3);
  return (Math.cbrt(omega(f)) * Math.cbrt(2) * Math.pow(eps, 1 / 12) * (1 + t)) / Math.pow(kmax, 3 / 4);
}

export interface Screen { ratio: number; low: number; high: number; v50: number | null; v50Low: number | null; v50High: number | null }
export const THETAS = [1, 1.25, 1.5, 1.75, 2] as const;

/**
 * Candidate V50 relative to a tested reference against the same projectile. The band spans θ over 1-2, the paper's
 * range for nose deformation and wrap-around: model spread, not a statistical confidence interval.
 */
export function screen(candidate: Design, reference: Design, p: Projectile, referenceV50?: number): Screen {
  const ratios = THETAS.map((th) => ppV50(candidate.fiber, candidate.arealDensity, p, th) / ppV50(reference.fiber, reference.arealDensity, p, th));
  const ratio = ratios[2]!, low = Math.min(...ratios), high = Math.max(...ratios);
  const v = referenceV50 !== undefined && Number.isFinite(referenceV50) && referenceV50 > 0 ? referenceV50 : null;
  return { ratio, low, high, v50: v === null ? null : v * ratio, v50Low: v === null ? null : v * low, v50High: v === null ? null : v * high };
}

/** Areal density at which the candidate matches a required V50 (bisection on the monotone PP ratio). */
export function arealDensityFor(targetV50: number, fiber: Fiber, reference: Design, p: Projectile, referenceV50: number): number | null {
  positive("target V50", targetV50); positive("reference V50", referenceV50);
  const at = (ad: number) => screen({ fiber, arealDensity: ad }, reference, p, referenceV50).v50!;
  let lo = 0.2, hi = 30;
  if (at(lo) > targetV50) return lo;
  if (at(hi) < targetV50) return null;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (at(mid) < targetV50) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
