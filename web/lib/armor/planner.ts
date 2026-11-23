/**
 * Sequential V50 test planning. Truth and estimates use the probit model P(perforation | v) = Φ((v − μ)/σ), as in
 * Johnson et al. 2014 (IEEE Access 2:1442), the benchmark this module reproduces.
 *
 * Methods
 *  - "nij": NIJ 0101.07 §9.5 up-and-down: first shot at the reference, ±100 ft/s until the first reversal, ±75 until the
 *    second, ±50 after (in the units of the test; the standard's steps are ft/s). Estimator: probit MLE.
 *  - "3pod": three-phase optimal design after Wu & Tian (2014), phases I-II as used by the DoD study: bracket search
 *    within μG ± 4σG until responses overlap, then D-optimal shots at μ̂ ± 1.138σ̂. Estimator: probit MLE.
 *  - "bayes": D-optimal shots from the first round around the posterior given a physics prior μ ~ N(μP, sdP) (e.g. the
 *    Phoenix-Porwal screen) and a weak log-normal prior on σ. The prior only steers placement; the reported V50 is the
 *    probit MLE once responses overlap, so a wrong prior costs shots, not bias.
 * Stop rules: "break" (DoD break separation: lowest perforation velocity below highest stop) or "precision"
 * (standard error of μ̂ at or below a target, from the observed information).
 */

export interface Truth { mu: number; sigma: number }
export interface Guess { mu: number; sigma: number }
export interface Shot { v: number; perforated: boolean }
export type Method = "nij" | "3pod" | "bayes";
export interface Prior { mu: number; sd: number; sigma: number; sigmaLogSd: number }
export interface Options {
  maxShots?: number; setPointError?: number; stop?: "break" | "precision" | "fixed"; targetSd?: number; minShots?: number;
  prior?: Prior; nijSteps?: [number, number, number];
}
export interface Fit { mu: number; sigma: number; sdMu: number; ok: boolean }
export interface TrialResult { shots: number; v50: number | null; sdMu: number | null; history: Shot[] }

// ---------------------------------------------------------------- normal distribution

/** Complementary error function, Numerical Recipes erfcc: fractional error < 1.2e-7 everywhere. */
function erfc(x: number): number {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
export const Phi = (z: number) => 0.5 * erfc(-z / Math.SQRT2);
export const phi = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
/** D-optimal design points for the probit (μ, σ) are μ ± 1.138σ. */
export const D_OPT = 1.1381;

// ---------------------------------------------------------------- estimation

export const overlap = (h: Shot[]) => {
  let minP = Infinity, maxN = -Infinity;
  for (const s of h) { if (s.perforated) minP = Math.min(minP, s.v); else maxN = Math.max(maxN, s.v); }
  return minP < maxN;
};

function logLik(h: Shot[], mu: number, s: number, prior?: Prior): number {
  let L = 0;
  for (const x of h) {
    const P = Math.min(1 - 1e-15, Math.max(1e-15, Phi((x.v - mu) / s)));
    L += x.perforated ? Math.log(P) : Math.log(1 - P);
  }
  if (prior) {
    L -= ((mu - prior.mu) ** 2) / (2 * prior.sd ** 2);
    L -= (Math.log(s / prior.sigma) ** 2) / (2 * prior.sigmaLogSd ** 2) + Math.log(s);
  }
  return L;
}

/**
 * Probit maximum likelihood (or posterior mode with a prior) by Fisher scoring with step halving.
 * Without a prior the MLE exists only once responses overlap; ok=false otherwise.
 */
export function fitProbit(h: Shot[], start: Guess, prior?: Prior, sigmaFloor = 1): Fit {
  if (!prior && !overlap(h)) return { mu: start.mu, sigma: start.sigma, sdMu: Infinity, ok: false };
  let mu = start.mu, s = Math.max(start.sigma, sigmaFloor), L = logLik(h, mu, s, prior);
  let Imm = 0, Ims = 0, Iss = 0;
  for (let it = 0; it < 100; it++) {
    let gm = 0, gs = 0; Imm = 0; Ims = 0; Iss = 0;
    for (const x of h) {
      const z = (x.v - mu) / s, P = Math.min(1 - 1e-12, Math.max(1e-12, Phi(z))), f = phi(z);
      const g = x.perforated ? f / P : -f / (1 - P), w = (f * f) / (P * (1 - P));
      gm += -g / s; gs += (-g * z) / s;
      Imm += w / (s * s); Ims += (w * z) / (s * s); Iss += (w * z * z) / (s * s);
    }
    if (prior) {
      gm -= (mu - prior.mu) / prior.sd ** 2; Imm += 1 / prior.sd ** 2;
      const ls = Math.log(s / prior.sigma);
      gs += -ls / (prior.sigmaLogSd ** 2 * s) - 1 / s; Iss += 1 / (prior.sigmaLogSd ** 2 * s * s);
    }
    const det = Imm * Iss - Ims * Ims;
    if (!(det > 0)) break;
    let dm = (Iss * gm - Ims * gs) / det, ds = (Imm * gs - Ims * gm) / det, step = 1, moved = false;
    for (let k = 0; k < 30; k++) {
      const m2 = mu + step * dm, s2 = Math.max(sigmaFloor, s + step * ds), L2 = logLik(h, m2, s2, prior);
      if (L2 >= L - 1e-12) { mu = m2; s = s2; moved = Math.abs(step * dm) > 1e-6 || Math.abs(step * ds) > 1e-6; L = L2; break; }
      step /= 2;
    }
    if (!moved) break;
    dm = 0; ds = 0;
  }
  const det = Imm * Iss - Ims * Ims;
  const sdMu = det > 0 ? Math.sqrt(Iss / det) : Infinity;
  return { mu, sigma: s, sdMu, ok: Number.isFinite(mu) && Number.isFinite(sdMu) };
}

// ---------------------------------------------------------------- shot selection

function nextNij(h: Shot[], g: Guess, steps: [number, number, number]): number {
  if (h.length === 0) return g.mu;
  let reversals = 0;
  for (let i = 1; i < h.length; i++) if (h[i]!.perforated !== h[i - 1]!.perforated) reversals++;
  const step = reversals === 0 ? steps[0] : reversals === 1 ? steps[1] : steps[2];
  const last = h[h.length - 1]!;
  return last.v + (last.perforated ? -step : step);
}

function next3pod(h: Shot[], g: Guess, intended: number[]): number {
  if (h.length === 0) return g.mu;
  const P = h.filter((s) => s.perforated), N = h.filter((s) => !s.perforated);
  // Phase I-1: one response type only. Step outward from the guess, doubling while the response repeats, so a wrong
  // μG or a too-small σG cannot trap the search inside a fixed window.
  if (!P.length || !N.length) return (P.length ? Math.min(...intended) : Math.max(...intended)) + (P.length ? -1 : 1) * 1.5 * g.sigma * 2 ** (h.length - 1);
  const minP = Math.min(...P.map((s) => s.v)), maxN = Math.max(...N.map((s) => s.v));
  if (minP >= maxN) return (minP + maxN) / 2;                                          // phase I-2: split the gap until overlap
  const f = fitProbit(h, { mu: (minP + maxN) / 2, sigma: g.sigma });                   // phase II: D-optimal around the MLE
  const lo = Math.min(...intended), hi = Math.max(...intended);
  const sig = Math.min(Math.max(f.sigma, (hi - lo) / 20), hi - lo);
  const side = h.length % 2 === 0 ? -1 : 1;
  return Math.min(hi + sig, Math.max(lo - sig, f.mu + side * D_OPT * sig));
}

function nextBayes(h: Shot[], prior: Prior): number {
  if (h.length === 0) return prior.mu;
  // Guard against a badly wrong prior: while every shot gives the same outcome, step outward with doubling steps
  // (as 3POD phase I-1) instead of letting the prior hold placement near its own mean.
  const P = h.filter((s) => s.perforated).length;
  if (h.length >= 2 && (P === 0 || P === h.length)) {
    const ext = P ? Math.min(...h.map((s) => s.v)) : Math.max(...h.map((s) => s.v));
    return ext + (P ? -1 : 1) * 1.5 * prior.sigma * 2 ** (h.length - 2);
  }
  // Both outcomes seen but not yet overlapping: let the data bracket V50 first (split the gap), so a prior that
  // disagrees with the data cannot hold shots on the wrong side.
  if (h.length >= 2 && !overlap(h)) {
    const minP = Math.min(...h.filter((s) => s.perforated).map((s) => s.v)), maxN = Math.max(...h.filter((s) => !s.perforated).map((s) => s.v));
    if (Number.isFinite(minP) && Number.isFinite(maxN)) return (minP + maxN) / 2;
  }
  const f = fitProbit(h, { mu: prior.mu, sigma: prior.sigma }, prior);
  const side = h.length % 2 === 0 ? -1 : 1;
  return f.mu + side * D_OPT * f.sigma;
}

// ---------------------------------------------------------------- simulation

/** One simulated test: a Bernoulli draw from the true probit at the actual (set-point-perturbed) velocity per shot. */
export function simulateTest(method: Method, truth: Truth, guess: Guess, rng: () => number, opts: Options = {}): TrialResult {
  const max = opts.maxShots ?? 50, err = opts.setPointError ?? 0, stop = opts.stop ?? (method === "nij" ? "fixed" : "break");
  const prior = opts.prior ?? { mu: guess.mu, sd: guess.sigma, sigma: guess.sigma, sigmaLogSd: 0.7 };
  const minShots = opts.minShots ?? 2, target = opts.targetSd ?? truth.sigma / 2;
  const h: Shot[] = [], intended: number[] = [];
  // The prior steers where to shoot; the reported V50 is the plain MLE once responses overlap, so a wrong prior cannot
  // pull the answer. Before overlap the bayes method falls back to the posterior mode and says so via sdMu.
  const estimate = (): Fit => {
    const mle = fitProbit(h, { mu: guess.mu, sigma: guess.sigma });
    return mle.ok || method !== "bayes" ? mle : fitProbit(h, { mu: prior.mu, sigma: prior.sigma }, prior);
  };
  while (h.length < max) {
    const x = method === "nij" ? nextNij(h, guess, opts.nijSteps ?? [100, 75, 50]) : method === "3pod" ? next3pod(h, guess, intended) : nextBayes(h, prior);
    intended.push(x);
    const v = x + (rng() * 2 - 1) * err;
    h.push({ v, perforated: rng() < Phi((v - truth.mu) / truth.sigma) });
    if (h.length < minShots) continue;
    if (stop === "break" && overlap(h)) break;
    if (stop === "precision") {
      const f = estimate();
      if (f.ok && f.sdMu <= target && overlap(h)) break;
    }
  }
  const f = estimate();
  return { shots: h.length, v50: f.ok ? f.mu : null, sdMu: f.ok ? f.sdMu : null, history: h };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface BenchCell { truth: Truth; guess: Guess; prior?: Prior }
export interface BenchResult { medianShots: number; meanShots: number; meanAbsMedianBias: number; medianAbsError: number; p90AbsError: number; estimated: number; runs: number }

const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : NaN; };

/** Monte Carlo over cells; "meanAbsMedianBias" is the DoD metric: |median signed V50 error| per cell, averaged. */
export function bench(method: Method, cells: BenchCell[], sims: number, opts: Options, seed: number): BenchResult {
  const rng = mulberry32(seed), shots: number[] = [], abs: number[] = [], biases: number[] = [];
  let estimated = 0;
  for (const c of cells) {
    const errs: number[] = [];
    for (let i = 0; i < sims; i++) {
      const r = simulateTest(method, c.truth, c.guess, rng, { ...opts, prior: c.prior ?? opts.prior });
      shots.push(r.shots);
      if (r.v50 !== null) { estimated++; errs.push(r.v50 - c.truth.mu); abs.push(Math.abs(r.v50 - c.truth.mu)); }
    }
    if (errs.length) biases.push(Math.abs(quantile(errs, 0.5)));
  }
  return { medianShots: quantile(shots, 0.5), meanShots: shots.reduce((a, b) => a + b, 0) / shots.length,
    meanAbsMedianBias: biases.reduce((a, b) => a + b, 0) / Math.max(1, biases.length), medianAbsError: quantile(abs, 0.5),
    p90AbsError: quantile(abs, 0.9), estimated: estimated / shots.length, runs: shots.length };
}
