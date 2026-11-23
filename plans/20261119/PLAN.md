# Build plan: battery thermal-runaway simulation, then soft-armor screening (2026-11-19)

Owner request: build both chosen candidates step by step, starting with planning; ORION in the process; Exa for research;
academic papers. Both projects are defensive (protect people and equipment). No step here improves a weapon.

## Research inputs

- **Exa: blocked.** API answers `402 NO_MORE_CREDITS` ("top up at dashboard.exa.ai"). Owner action needed to use it.
- **OpenAlex** (open academic index) used instead: 12 queries, 71 papers with DOI, citations and open-access links,
  saved in `papers.json`. Anchor papers below.
- **NREL (Battery Failure Databank host) does not resolve from this machine.** Owner download or another network is needed
  for the raw databank; published distributions are the fallback.

### Battery anchors
| Paper | Why it matters |
|---|---|
| Feng et al. 2016, *Energy*, 10.1016/j.energy.2016.08.094 (494 cites) | 3D propagation model for a large-format module; reference physics |
| Lopez et al. 2015, *J. Electrochem. Soc.*, 10.1149/2.0921509jes (420) | Sandia module tests: propagation vs inter-cell spacing; validation target |
| Finegan/Walker et al. 2024, *J. Power Sources*, 10.1016/j.jpowsour.2024.234106 (86, OA) | Battery Failure Databank: heat and ejected-mass fractions from hundreds of abuse tests |
| 2024, *Nature Communications*, 10.1038/s41467-024-52653-3 (55, OA) | Heat-release variability from 139 calorimetry tests; variability is the point |
| 2020, *J. Electrochem. Soc.*, 10.1149/1945-7111/ab8978 (46, OA) | Dense 18650 arrays: gaps and barriers slow but do not stop propagation; ceramic board best |
| 2017, *Batteries*, 10.3390/batteries3020014 (195, OA) | ARC onset and stage temperatures for LMO, LFP, NMC 18650 cells |
| 2021, *Int. J. Heat Mass Transfer*, 10.1016/j.ijheatmasstransfer.2021.122024 (67) | Experimental "domino" (cell-to-cell) propagation model for 18650 modules |

### Armor anchors
| Paper | Why it matters |
|---|---|
| Phoenix & Porwal 2003, *Int. J. Solids Struct.*, 10.1016/s0020-7683(03)00329-9 (339) | Analytical membrane model of multi-ply fibrous armor and V50 |
| NIST 2020, *J. Res. NIST*, 10.6028/jres.125.026 (11, OA) | Links Cunniff and Phoenix-Porwal models to measured performance of aged armor; validation data |
| DoD 2014, *IEEE Access*, 10.1109/access.2014.2377633 (30, OA) | Sequential test designs: three-phase optimal design + probit is most accurate |
| 2020, *Defence Science Journal*, 10.14429/dsj.70.14122 (19, OA) | Survey of ballistic-limit estimation methods |
| 2017, *Composite Structures*, 10.1016/j.compstruct.2017.07.074 (68) | Analytical model for UHMWPE composites |
| 2006, *Int. J. Occup. Safety Ergon.*, 10.1080/10803548.2006.11076702 (87, OA) | Behind-armor blunt trauma risk criterion (50% AIS3+ at ~24.9 kN) |
| 2023 systematic review, 10.1080/10255842.2023.2281275 (13, OA) | FE methods for backface deformation; what analytical models miss |

## ORION ordering (Jev, 7 dims, Borda over RICE/ICE/WSJF/leverage/Eisenhower; W = 0.45)

1 battery validation targets · 2 battery model · 3 armor validation targets · 4 battery data (highest P first 0.23) ·
5 battery page · 6 armor model · 7 armor page · 8 armor test planner. Battery steps are "do now"; armor steps are "schedule".
Agreement is moderate, so the order below follows ORION's direction and fixes validation targets before code.

## Project 1: battery thermal-runaway propagation simulator

**Question it answers:** for a given pack layout (cell format, spacing, barrier material, cooling), what is the probability
that one cell in thermal runaway propagates, how many cells follow and how fast?

**Designs compared**
| Design | Cost | Fidelity | Verdict |
|---|---|---|---|
| A. Lumped cell network: one thermal node per cell, conductance between neighbours, convection, onset temperature, stochastic heat release | ms per run, browser or server | Captures cell-to-cell propagation and its variability; misses intra-cell gradients and venting jets | **Chosen.** Thousands of Monte Carlo runs give a probability, which is what designers need |
| B. 3D finite-volume conduction per cell (Feng 2016 style) | minutes per run | Better gradients and timing | Later, as a reference for one layout to bound A's error |
| C. ML surrogate trained on databank | needs much more data | Unknown | Rejected for now; 139-300 tests are too few for layouts |

Reconsider A if it cannot reproduce the published spacing/barrier trends within the agreed tolerance.

**Model (A)**: per cell i, `m_i c_p dT_i/dt = Σ_j G_ij (T_j − T_i) − h A_i (T_i − T_amb) + q_i(t)`. A cell enters runaway when
`T_i ≥ T_onset`; it then releases `Q_i` (drawn from the fitted heat-per-Ah distribution, retained fraction `1 − f_eject`)
over `τ` seconds. `G_ij` from contact/gap geometry and barrier conductivity. Outputs: propagated cells, times, P(propagation).

**Invariants (tests before code)**
- Energy balance closes to < 0.5% per run (heat in = stored + lost + ejected).
- No heat source, no runaway: a pack at ambient stays at ambient; one trigger with zero conductance never propagates.
- Monotonic: more spacing or lower barrier conductivity never raises P(propagation) for the same random draws.
- Deterministic for a seed; bounded runtime (≤ 2 s for 1,000 runs of a 50-cell pack on the server).
- Inputs bounded and validated; unknown chemistry refused rather than guessed.

**Validation targets (step 1 extracts exact numbers from the open-access full texts)**
- Lopez 2015: spacing effect on propagation in their module configurations.
- 2020 dense-18650 study: gaps and barriers slow but do not stop propagation; ceramic fibre board slows most.
- ARC 2017: onset temperatures per chemistry used as priors.

**Milestones**
1. Extract validation numbers and parameter priors from the open-access papers; write the failing tests. *(ORION 1, 4)*
2. Model + Monte Carlo engine with the invariant tests green. *(ORION 2)*
3. Calibrate heat release: databank if the owner can fetch it, else published distributions; record which. *(ORION 4)*
4. Validation report: model vs each target, with error and pass/fail. *(ORION 1)*
5. Page: pack-layout designer, P(propagation) and a 3D replay of one propagation. *(ORION 5)*

## Project 2: soft-armor screening and V50 test planning (after battery milestone 4)

**Question it answers:** for a soft-armor design (fibre, plies, areal density) and an NIJ threat level, what V50 should we
expect, and how few range shots does a lab need to confirm it?

**Designs compared**
| Design | Verdict |
|---|---|
| A. Cunniff + Phoenix-Porwal analytical V50 prior from fibre properties and areal density | **Chosen as prior**; NIST 2020 validates both on real armor |
| B. Finite-element impact model | Rejected: commercial solvers, heavy, and the 2023 review shows calibration burden |
| C. Purely statistical V50 estimation (probit, three-phase optimal design) | **Chosen as planner**; DoD 2014 benchmark gives the target |
| A + C | Physics prior feeds a Bayesian sequential design: fewer shots for the same V50 confidence. This is the product |

**Safety scope:** soft and personal protective armor against published NIJ threat levels; outputs are protection margins
and test plans. No projectile or penetration optimisation, no defeat-oriented outputs.

**Milestones**: 1 extract published V50/material data and DoD 2014 simulation targets *(ORION 3)* · 2 analytical prior with
tests *(ORION 6)* · 3 Bayesian planner reproducing DoD 2014's comparison in Monte Carlo *(ORION 8)* · 4 page *(ORION 7)*.

## Process per step

Invariants and failing tests first; Jev bounded review on design choices; build, test, screenshot (desktop + phone),
deploy behind the existing login; record sources and licences on the page. Owner sign-off between projects.

## Owner decisions needed

1. Top up Exa (dashboard.exa.ai) if you want Exa in the loop; OpenAlex covers academic papers meanwhile.
2. Fetch the Battery Failure Databank spreadsheet from nrel.gov (unreachable here), or approve the published-distribution fallback.
3. Approve starting Project 1, milestone 1.
