# Armor milestone 1: equations, fixtures and validation targets

Scope: soft personal armor against published NIJ threat levels. Outputs are protection margins and test plans only.

## Key finding that shapes the product
NIST 2020 (10.6028/jres.125.026): Cunniff and Phoenix-Porwal predict V50 **relative** to a reference, "the purpose is not to
determine absolute values of V50". So screening is anchored to one tested reference design (same projectile and construction
family); predictions are ratios to it. Absolute V50 needs Cunniff's empirical Φ curve (not in open access) or a lab reference.

## Equations (NIST 2020, recovered from the PDF page images)
- Γ0 = Ad·Ap/mp  (Ad areal density kg/m², Ap projectile presented area m², mp projectile mass kg)      (1)
- Ω = (σε/2ρ)·√(E/ρ); with linear elastic fibre E = σ/ε                                              (3),(6)
- Cunniff: V50/Ω^(1/3) = Φ(Γ0) → retention rV50_C = (σa/σn)^(1/2)·(εa/εn)^(1/6)                       (4),(7)
- Phoenix-Porwal: V50 = Ω^(1/3)·2^(1/3)·ε^(1/12)·(1+θ²Γ0) / Kmax^(3/4)                               (8)
  Kmax = exp{−4θ²Γ0(ψ²−1)/(3(1+θ²Γ0))}·ψ^(1/2)·[√(ψ/ε)(ψ−1) / ln{1+√(ψ/ε)(ψ−1)}]^(2/3)                 (9)
  ψmax ≈ √((1+θ²Γ0)/(2θ²Γ0)),  θ ∈ [1, 2] (nose deformation, wrap-around)                           (10)
- rV50_PP / rV50_C = (εa/εn)^(1/3)·[ln{1+√(ψ/εa)(ψ−1)} / ln{1+√(ψ/εn)(ψ−1)}]^(1/2)                      (13)
  If εa < εn then PP retention < Cunniff retention (more conservative).

## Fixtures (exact paper tables, used as tests)
Table 1: Ad 2.625/2.273 kg/m², Ap 6.36e-5 m², mp 8.0 g → Γ0 0.0209 (PPTA), 0.0181 (PBO);
ψmax for θ = 1.25/1.5/1.75/2: PPTA 3.98/3.34/2.88/2.55, PBO 4.27/3.58/3.09/2.72.
Table 2 (εn = 0.03), Eq. 13 ratio for εa rows × ψ columns 2.5/3/3.5/4/4.5:
0.10: 1.33 1.35 1.36 1.37 1.37 · 0.05: 1.13 1.14 1.14 1.14 1.15 · 0.04: 1.07 1.08 1.08 1.08 1.08 ·
0.03: 1.00 ×5 · 0.02: 0.90 ×5 · 0.01: 0.76 0.75 0.75 0.74 0.74.
Hand checks: Γ0 PPTA 0.02087; ψ PBO θ=2 2.721; Eq.13 (0.10, 2.5) 1.333.

## Validation data
- NIST raw data: doi 10.18434/M32179 (data.nist.gov mds2-2179): extracted-yarn tensile and V50 per aged lot (A1-A4 PPTA,
  B1-B3 PBO). Server returned 502/503 on 2026-11-19; retry. Target: predicted vs measured V50 retention per lot.
- Paper statement: PBO aging reduced both strength and V50; PPTA showed little V50 change. Qualitative target if data stays down.

## Test-planner benchmark (Johnson et al. 2014, IEEE Access, 10.1109/access.2014.2377633)
Truth probit μT = 2400 ft/s, σT ∈ {75, 150}; initial guesses μG ∈ {μT−2σT, μT, μT+2σT}, σG/σT ∈ {1/3, 1/2, 1, 2, 3};
set-point error U(±10 ft/s); ≤ 50 shots; 1000 simulations per cell. Reported: ~10.5 shots on average to stop
(break-separation −1.8 vs 3-and-3 +1.8), median V50 error grand mean ≈ 12.5 ft/s; 3POD and Neyer reduce bias most,
3POD most robust. Our planner must match 3POD + probit + break separation on this grid, then show what an informative
physics prior buys (fewer shots at equal error) without being worse when the prior is wrong (μG = μT ± 2σT).

## Engine choice
TypeScript in web/lib/armor (runs in the browser and on Vercel; tests with bun). The maths is small; Monte Carlo of
1000 × ~10 shots per grid cell is cheap.
