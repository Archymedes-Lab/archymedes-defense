# V&V Report: archworld site simulation

MIL-STD-3022 product 3 of 4 (tailored). **Generated** by `world/scripts/vv_report.py`; do not edit by hand.
Commit `6cc232c` with uncommitted changes, generated 2026-11-23 19:19 UTC, site `ch-lauterbrunnen`.

**Result: all acceptability criteria met** for the intended use in the [Accreditation Plan](ACCREDITATION-PLAN.md).

## 1. Acceptability criteria

| ID | Criterion | Met | Evidence |
|---|---|---|---|
| AC-1 | Ground truth geometry | yes | world/tests/test_invariants.py |
| AC-2 | Reproducibility | yes | determinism tests |
| AC-3 | Scope | yes | scope tests |
| AC-4 | Fixed-camera detection (IEC 62676-4) | yes | world/tests/test_realism.py |
| AC-5 | Line of sight | yes | world/tests/test_sim.py |
| AC-6 | Equipment availability | yes | seeded intrusion tests |
| AC-7 | Statistics | yes | intervals on 6 measures and 3 timeline cases |
| AC-8 | Face validity | yes | door delay 45 s: 32/40, 90 s: 32/40, 180 s: 33/40; 4K coverage 63% >= 1080p 32% of the fence |
| AC-9 | Hazards | yes | 9 hazards, world/tests/test_hazards.py |
| AC-10 | Transparency | yes | report lists assumptions |

## 2. Verification: test results

| Suite | Passed | Failed | Skipped |
|---|---:|---:|---:|
| `test_hazards` | 5 | 0 | 0 |
| `test_invariants` | 31 | 0 | 0 |
| `test_ops` | 21 | 0 | 0 |
| `test_realism` | 19 | 0 | 0 |
| `test_sim` | 30 | 0 | 0 |

Web tests, typecheck, static analysis, the SBOM and dependency scan, and the secret scan run in the DevSecOps pipeline (`.github/workflows/devsecops.yml`).

## 3. Validation results

- **Conceptual model:** Sandia probability of interruption; IEC 62676-4 detect density for fixed cameras; exact binomial intervals and paired tests over 120 seeds for the measures.
- **Hard case baseline:** met in time 97/120 (95% interval 73% to 87%).
- 4K cameras on the four corner masts, aimed along the fence: 119/120 (95% to 100%); differs from now: yes (p = 0.000); tied with: mid-masts.
- Camera masts at the middle of both long sides: 114/120 (89% to 98%); differs from now: yes (p = 0.000); tied with: 4k-masts.
- Re-aim the four corner cameras along the fence: 97/120 (73% to 87%); differs from now: no (p = 1.000); tied with: baseline.
- A second drone on the same circuit: 111/120 (86% to 97%); differs from now: yes (p = 0.003); tied with: second-guard.
- A second guard on foot patrol: 113/120 (88% to 98%); differs from now: yes (p = 0.002); tied with: second-drone.
- **Field data:** none. Results are relative comparisons on a notional site, not predictions for a real one.

## 4. Hazards (MIL-STD-882E)

| ID | Hazard | Initial | Residual | Status |
|---|---|---|---|---|
| H-01 | Notional results treated as a real site's security level | 2C Serious | 2D Medium | open: monitored |
| H-02 | Optimistic sensor model drives the recommendation | 2B High | 2D Medium | open: drone, dog, vehicle and guard sensors still use the simpler range model (backlog B-04) |
| H-03 | Ranking options the runs cannot tell apart | 3B Serious | 3D Medium | open: monitored |
| H-04 | Drills that ignore equipment availability | 3A Serious | 3D Medium | closed |
| H-05 | Use of the tool to plan an intrusion | 2D Medium | 2E Medium | open: monitored |
| H-06 | Scope creep into weapons, targeting or engagement | 1E Medium | 1E Medium | open: monitored |
| H-07 | Geometry error corrupts line of sight | 3C Medium | 3E Medium | open: monitored |
| H-08 | Results that cannot be reproduced | 3C Medium | 3E Medium | closed |
| H-09 | Secrets or personal data published with the open-source code | 2C Serious | 2E Medium | open: monitored |

## 5. Limitations carried into accreditation

- No validation against field data (sensor logs, patrol records, alarm histories).
- Mobile sensors (drone, robot dog, vehicle, guards) use a range-based detection model, not resolution-based.
- Daylight only; no weather; thermal cameras do not change detection.
- Assessment of an alarm by camera or machine never fails; no operator workload model.
- Equipment figures, barrier delays and gate catch rates are class assumptions, listed in the report.
