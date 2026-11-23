# V&V Plan: archworld site simulation

MIL-STD-3022 product 2 of 4 (tailored). What is verified (built right) and validated (right for the intended use
in the [Accreditation Plan](ACCREDITATION-PLAN.md)), how, and by whom.

## 1. Verification: is the code the model we wrote down?

Automated and run on every push by the DevSecOps pipeline ([.github/workflows/devsecops.yml](../../.github/workflows/devsecops.yml)).

| Area | Method | Where |
|---|---|---|
| World build: frames, geoid, mesh, tiles, buildings, provenance | Property and adversarial tests, determinism digests | `world/tests/test_invariants.py` |
| Simulation engine: routing, slopes, line of sight, energy, determinism | Property tests on a synthetic site | `world/tests/test_sim.py` |
| Operations: timeline, alarms, gate, evacuation, coverage, measures | Property tests on a compound placed by rule | `world/tests/test_ops.py` |
| Sensor model, scoring, intrusion timing, statistics | Tests written before the code (2026-11-23 assessment) | `world/tests/test_realism.py` |
| Hazard log | Structure, matrix, mitigation references | `world/tests/test_hazards.py` |
| Viewer data contracts | Typecheck and tests | `web/` (`bun test`, `tsc`) |

## 2. Validation: is it right enough for the intended use?

| Level | Method | Status |
|---|---|---|
| Conceptual model | Protection timeline follows Sandia's probability-of-interruption method (detect, delay, respond); camera detection follows IEC 62676-4 pixel densities; statistics follow Sandia's trials-and-failures practice (exact binomial confidence) | Done; documented in the report's sources |
| Data | Terrain, imagery, buildings and canopy from swisstopo (measured), ways from OSM (tagged); each feature carries a provenance tier; equipment figures are class assumptions, listed | Done for geometry; equipment figures not validated (backlog B-07) |
| Results: face validity | Directional checks on outputs (AC-8), computed in the V&V Report | Automated |
| Results: sensitivity | Door delay sweep; resolution comparison; approach directions | Automated; parameter-wide sensitivity is backlog B-07 |
| Results: field data | Compare against a real site's sensor and patrol logs | **Not done.** Required before any real-site use; out of the current intended use |

## 3. Roles

V&V agent: the developers, with independent review of design calls by ORION/CDM and Jev (recorded under
`plans/`). Accreditation authority: the program owner.

## 4. Products

The V&V Report is generated, not written: `uv run python world/scripts/vv_report.py ch-lauterbrunnen` runs the
test suites, reads the run outputs and writes [VV-REPORT.md](VV-REPORT.md).
