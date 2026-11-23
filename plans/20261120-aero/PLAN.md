# Plan: aircraft aerodynamics with measured error bars (2026-11-20)

Owner request: aircraft aerodynamics, fighter jet as the example, same approach as the battery and armor work
(research, ORION/CDM, invariant tests, validation against published data, Next.js page with drawings and 3D).

**Scope rule.** Analysis, education and validation of high-angle-of-attack and delta-wing aerodynamics, using public NASA
research data. Fighter-class layouts are the reference cases because NASA published them. Nothing that improves combat
capability: no stealth or radar signature, no weapons carriage or release, no air-combat manoeuvre optimisation,
no export-controlled data. The same physics serves trainers, drones and civil delta-wing aircraft.

## Research inputs

- **Exa** (new key, works): 15 searches, $0.105, `exa-results.json`.
- **NASA NTRS** (public reports, full text): `papers.json`, downloaded to `sources/`.
- **OpenAlex** is rate-limited for today (retry-after about 10 h); Crossref relevance search was unusable.

| Source | Use |
|---|---|
| Polhamus 1966, NASA TN D-3767; TN D-4739 | Vortex-lift (suction analogy) theory and delta-wing lift data for several aspect ratios |
| NASA SP-405 (1976), Vortex-Lattice Utilization | Vortex-lattice method reference and verification cases |
| NASA CR-165923 (1982), 60° delta wing | Balance and pressure data with leading-edge devices |
| NASA TM-112360 (1996), F/A-18 HATP baseline | High-alpha lift, drag and moment curves of a fighter-class layout to about 90° |
| CAWAPI F-16XL (NASA, 2007-2016) | Cranked-arrow wing flight and CFD comparisons (civil research programme) |
| NACA R-1208 (via VSPAERO validation 2024) | Attached-flow wings: the easy end of the corpus |
| Bayesian latent GP for aero UQ (arXiv 2606.28871, 2026); ProForMA (AIAA 2023-0653) | Calibrating low-fidelity aero against data |

Most NASA force data is in plotted figures, not tables. Step 1 digitizes them and records the digitizing error as part
of the measurement uncertainty.

## What the market already has

Vortex-lattice solvers are free and mature (OpenVSP/VSPAERO, AVL, XFLR5). VSPAERO 3.45 asks users to redo their own
validation. Research on calibrated uncertainty for low-fidelity aero is active, but we found no tool that ships an
estimate together with an error bar measured against a public validation corpus. That gap is the product.

## Decision engines

| Engine | Result |
|---|---|
| ORION (Jev, Borda over RICE/ICE/WSJF/leverage/Eisenhower; W = 0.46, moderate) | 1 multi-fidelity · 2 calibrated error bars · 3 drone flight-log ID · 4 vortex-lift estimator · 5 tunnel planner. Top two "schedule", "big bet", two-way door |
| CDM (moat 0.30, usefulness 0.30, feasibility 0.20, demand 0.20; hard veto on combat capability) | Commit **calibrated error bars** (0.521), innovation bet **multi-fidelity** (0.517), tunnel planner 0.508, vortex-lift 0.453, drone ID 0.449, status quo 0.362. EVPI 0.118. Combat-capability violation ≤ 0.11 for every option |

Both engines say the same thing: a vortex-lift solver on its own is a commodity. It is the necessary engine, not the
product. **Moat estimate: moderate** (CDM moat mostly "takes some effort"). It grows with every validation case and
partner test added to the corpus.

## Design

| Design | Verdict |
|---|---|
| A. Vortex-lattice + Polhamus suction analogy (+ Lamar augmented vortex lift for strakes/LEX) + empirical vortex-breakdown limit | **Chosen engine**: ms per solve, runs in the browser, physics fits delta wings and LEX layouts |
| B. 3D panel method | Later, for thickness and fuselage effects |
| C. RANS CFD (SU2) | Reference only, a few runs for multi-fidelity; heavy, not run while the machine is loaded |
| D. ML surrogate on public data | Rejected: too few public cases |
| **Error model on top of A** | Per regime (attached, vortex, post-breakdown): bias and spread of A against the corpus, reported as a band on every curve. **This is the product** |
| Multi-fidelity (A + few CFD runs, GP fusion) | Milestone 6, after the error model works on wind-tunnel data alone |

Reconsider A if it misses the attached-flow lift slope by more than 5% on NACA R-1208 wings, or if vortex-lift predictions
miss Polhamus' own data by more than his reported agreement.

## Invariants (tests before code)

- Verification: a flat rectangular wing tends to the lifting-line and slender-wing limits; refining the lattice converges.
- Symmetry: a symmetric wing at zero sideslip gives zero side force, roll and yaw; mirrored input gives mirrored output.
- Linearity where it must hold: at small angles, lift is linear in angle; vortex lift is zero at zero angle and ≥ 0 after.
- Units and bounds: inputs validated (sweep, aspect ratio, Mach < 0.6 for this engine); outside the corpus the error
  band widens and is labelled "extrapolation", never hidden.
- Honest bands: in leave-one-case-out validation, the 90% band covers about 90% of the held-out points (coverage
  measured and published, like the battery misses).
- Deterministic and bounded: same input, same output; a full sweep (0-40° in 1°) under 200 ms in the browser.

## Milestones

1. Corpus: digitize the force curves from TN D-3767, CR-165923, TM-112360 and R-1208 with source, figure and digitizing
   error; write the failing validation tests.
2. Engine: vortex-lattice solver + suction analogy, verification tests green.
3. Vortex breakdown and LEX: empirical breakdown limit from published data; check the F/A-18 lift curve shape.
4. Error model: per-regime bias and spread, leave-one-case-out coverage report (pass/fail per case).
5. Page: planform designer, lift/drag/moment curves with bands, engineering drawing, 3D view of the vortex sheets.
6. Multi-fidelity: a few SU2 runs on one geometry, GP fusion, check whether the band narrows honestly.

## Owner decisions

1. Confirm the scope rule above (fighter-class layouts as public reference cases; no combat-capability work).
2. Approve starting milestone 1.

## Status 2026-11-20 (milestones 1-5 built, deployed at /aero)

- Corpus: 200 digitized points, 13 cases (Polhamus TN D-3767 Fig. 12; Wentz & Kohlman CR-98737 lift curves 50-80° and
  breakdown map Fig. 4.1.1; F/A-18 HATP TM-112360 Fig. 28), ring-template marker detection on calibrated renders,
  per-point digitizing sigma. `web/scripts/build_aero_corpus.py`.
- Engine `web/lib/aero`: vortex lattice + Polhamus + breakdown loss; one parameter (retained 0.37), bands by
  conformal residuals, widened ×1.35 by nested leave-one-wing-out. `web/scripts/validate_aero.ts`.
- Criteria (pre-registered): C1 miss (wk-60 0.053, wk-65 0.058, wk-80 0.135), C2 miss (CLmax late post-burst),
  C3 met 89.8% (first version 77.1%, disclosed), C4 met.
- Checks: 34 tests (fast-check invariants), `scripts/aero_static.ts` 7 rules, 6 compile-time unit proofs (mutation-checked).
- Jev (advisory): next step "more independent wind-tunnel data" 0.78; honesty of coverage claim 0.82.
- Next: more independent cases (e.g. NASA CR-165923 60° delta, Earnshaw & Lawford), post-burst lift model, rounded edges, CFD fusion.

## Dynamics and the HARV flight path (2026-11-23)

Owner request: simulate the fighter better, mathematically, with the latest research, invariants only. Scope rule
unchanged (no combat capability, no manoeuvre optimisation).

- **Unsteady vortex lift** (`lib/aero/unsteady.ts`): Goman-Khrabrov state-space model (Goman & Khrabrov 1994;
  Goman, Greenwell & Khrabrov, ICAS 2000-223, eq. 2): one state, the share of vortex lift present, relaxing to its
  static value with τ1 ≈ 15 c/V (the order the paper reports for breakdown on 65-70° deltas; not identified for these
  wings). Exact exponential step (cannot overshoot). At τ = 0 it is exactly the static polar.
- **Flight path** (`lib/aero/flight.ts`): longitudinal point mass (V, γ, h, x) plus the vortex state, RK4, 1976
  standard atmosphere, HARV mass from NASA TM-110216 Table 2.3 (fighter escort, 35,764.6 lb; read from the scanned
  report). Angle of attack and thrust are prescribed inputs.
- **Invariants** (`tests/aero-dynamics.test.ts`, 27): exact relaxation for any step; no overshoot (property-based);
  quasi-static limit equals the polar; settles onto the polar at fixed α; Goman et al. eq. 4 (gain and lag) and
  eq. 5 (in-phase/quadrature relation) to 3 decimals; τ2 is a pure delay; pitch-cycle loop area positive and
  vanishing as motion slows; ISA density and continuity at the tropopause; energy conserved to 1e-7 without drag or
  thrust; energy theorem ΔE = ∫(T−D)V/W dt; trimmed flight stays level; RK4 fourth order where the aerodynamics are
  smooth; dimensional time constant τ1 c/V; determinism and domain labels; refusals.
- **Found by the tests:** on the HARV the static breakdown model is a staircase (edges swept below the map get the 2°
  floor), which breaks fourth-order convergence; recorded in a test.
- **Gradual breakdown** (smoothstep ramp of the burst share, `vortex.burstFraction`): scored out of sample on the
  pre-registered criteria (`breakdown-ramp-comparison.json`). Error falls (pooled RMS 0.121 → 0.104; C1 misses 3 → 1;
  C2 misses 4 → 3), but the fitted width runs to the edge of every grid (12°, then 30°): not identified, so **not
  adopted**; the step model stays the default. Next: fit a shift of the breakdown angles directly, and add new
  independent wind-tunnel cases.
- **Finding on the HARV pitch-up** (450 ft/s, 15,000 ft, to 35° and back): the vortex lag changes lift by under 0.01
  in this model, because few HARV edges reach their breakdown angle below 35°; the 70° delta shows clear loops.

## Geometry rebuilt with solid-modelling practice (2026-11-23)

Owner request: a better fighter model, with proper geometric practice. `lib/aero/harv-mesh.ts` rebuilt, checked by
`tests/aero-geometry.test.ts` (21) with `lib/aero/mesh-check.ts`:

- Fuselage and canopy follow monotone cubic Hermite curves (Fritsch & Carlson 1980, `lib/aero/curves.ts`) through
  the traced stations: exact at every station, continuous slope, no overshoot (property tests). Before: straight
  segments with kinks at every station.
- Every component is a closed, consistently oriented 2-manifold: each edge in exactly two triangles, once in each
  direction; Euler characteristic 2; positive enclosed volume (outward normals); welded vertices; no degenerate
  triangles. Before: open lofts, single-sided LEX, canopy and inlet plates, duplicated cap vertices, and a nose made
  of a 0.02 ft ring (sliver triangles). Now a single pole vertex closes the nose.
- Left side is the exact mirror of the right (tested vertex by vertex).
- Fuselage volume converges under refinement to the integral of the exact superellipse sections
  (4ab Γ(1+1/n)²/Γ(1+2/n), Lanczos Γ); the wing's upward-facing area matches the analytic trapezoid within 0.5%.
- LEX is a solid strake (thick at the body, sharp at the edge) that now meets the wing leading edge at the traced
  junction; the intake is a D-shaped duct under the LEX blending into the body; nozzles have exit faces.
- The mesh checker is itself tested on a tetrahedron and a cube, and on deliberately broken meshes (missing face,
  flipped face, inside-out solid).
- Viewer: crease-angle normals (35°) keep curved skin smooth and trailing edges, caps and corners sharp; the floor
  grid moved below the tail at high angle of attack (it used to cut through the stabilator and fins).

## Real aircraft only, flight validation, and a standing value review (2026-11-23, late)

Owner requests: only real fighter models; accuracy against real, tangible results; review continuously whether the
work is valuable (ORION, aftermath, moat score) and say why in the interface.

- **Real aircraft only** (`lib/aero/aircraft.ts`): F/A-18 HARV, F-16XL-1 (NASA TP-2001-210629, Table 3 and Fig. 2)
  and F-106B (NASA TP-3374; TP-2747). Every published number names its report; planforms are built from those
  numbers. The generic delta presets and the custom slider left the workbench; the NASA wind-tunnel wings remain
  only as the validation corpus. F-106B's published area, chord and aspect ratio follow from its triangle within
  0.1%; the straight-edged F-16XL planform is 5% larger than the published wing area (stated).
- **Elevon and trim** (`vlm.incidenceLoad`, `lib/aero/trim.ts`): control-surface lift and centre of pressure from
  the same lattice; trim for zero pitching moment; a rounded-edge blend between attached flow and full vortex lift.
- **Flight validation** (`scripts/validate_flight.ts`, `lib/data/aero-flight.json`), F-106B:
  - NASA trim point (TP-2747 Table III; lift required 0.342 at α 11.3°): bare sharp-edge wing +63%; with the
    published elevon, sharp edge +40%, attached edge +6%; fitted rounded edge, trimmed by the model, **+3%**, elevon
    predicted −4.60° against −4.13° published. The trim point is never used in the fit.
  - NASA flight table (TP-3374 Table I, 27 subsonic points, five flights; weight not published): within-flight spread
    of implied weight 11% (sharp), 11% (attached), **4%** with vortex onset 14°, full by 21°; leave-one-flight-out
    **5.8%** (criterion 5%: missed, shown). Mean implied weight 30,545 lb.
  - Criteria: F1 met, F2 met, F3 missed, F4 met. The seven Mach 0.67–0.81 points are excluded (no compressibility).
- **Value review** (`plans/20261120-aero/value_review.ts` → `web/lib/data/aero-value.json`, shown on /aero):
  Compass judge (moat = defensibility, quality, impact), ORION ranking, ORION aftermath; verdict by a fixed rule
  (useful ≥ 2, moat ≥ 2, proven). Result: 0 valuable, 3 useful but easy to copy (flight validation first, real-aircraft
  registry, error bands), 4 low value (unsteady lift, next-data, solid geometry, flight path), 1 rejected on evidence.
  A test fails if any module in `lib/aero` is not covered by a reviewed item, so the review must be rerun with new work.
  Reading: the solver is a commodity; what could become a moat is the validation record against real aircraft. The
  next work should add measured data for all three aircraft, not more model features.

## One criterion: high value only (owner, 2026-11-23, night)

The value review now has a single rule: an item is high value when its impact score is at least 2.5 of 4. Each item
is judged three times and averaged (scores repeat within ±0.04). Work a high-value item cannot run without is kept
as a prerequisite; everything else is cut from the page (code stays in the repository).

- High value: measured lift curves for all three aircraft (2.53; a next step, not built).
- Kept as prerequisites: F-106B flight validation (2.44), error-band engine (2.29), real-aircraft registry (2.06).
- Cut: validation report (2.37 once built and judged on its real evidence; 2.51 as a promise), unsteady lift (1.56),
  solid HARV geometry (1.39), HARV flight path (0.99). Their sections left /aero; the workbench shows every aircraft as
  its published planform.
- Rejected on evidence: gradual breakdown model.
- Candidates below the bar: compressibility and the faster F-106B runs (1.67), F-16XL-1 flight comparison (1.75),
  identifying the unsteady time constant (1.72).

The validation report (`web/scripts/make_aero_report.ts` → `reports/aero-validation-report.md`, v1.0) was built
because it ranked first as a candidate; it is kept in the repository and tested against the data digests, but is not
linked from the page.
