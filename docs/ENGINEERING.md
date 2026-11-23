# How the defense work is engineered

Archymedes Defense follows US Department of Defense engineering practice, tailored to a small open-source team
building a defensive, non-weapon simulation. Each practice below has a concrete home in this repository and is
checked by code where it can be.

| DoD practice | What it requires | Here |
|---|---|---|
| **M&S VV&A**, DoDI 5000.61 (2024) | A model is accredited for a stated intended use, with V&V effort set by the risk of that use | [Accreditation Plan](vva/ACCREDITATION-PLAN.md): intended use, exclusions, acceptability criteria AC-1 to AC-10 |
| **VV&A documentation**, MIL-STD-3022 | Four products: Accreditation Plan, V&V Plan, V&V Report, Accreditation Report | [vva/](vva/); the V&V Report is generated from tests and run outputs (`world/scripts/vv_report.py`) |
| **System safety**, MIL-STD-882E | Hazards tracked with severity (1-4) x probability (A-F); High and Serious risks not acceptable; mitigations verified | [safety/hazards.json](safety/hazards.json), enforced by `world/tests/test_hazards.py` |
| **Software Acquisition Pathway**, DoDI 5000.87 | MVCR, roadmap, backlog, iterative releases, yearly value assessment | [program/ROADMAP.md](program/ROADMAP.md) with a release gate |
| **DevSecOps**, DoD Enterprise DevSecOps Fundamentals v2.5; continuous authorization guide (2024) | Pipeline control gates: test, static analysis, SBOM and composition analysis, secret scanning | [.github/workflows/devsecops.yml](../.github/workflows/devsecops.yml) |
| **Test and evaluation**, DoDI 5000.89 / 5000.98 | Developmental test integrated from the start, evidence-based decisions | Tests written before code; invariant and property tests in `world/tests/`; independent assessment before major changes |
| **Open source**, DoD CIO memo (January 2022); modular open systems approach | Prefer open source; modular components with open interfaces | Apache-2.0 (sitewatch included); modules exchange plain JSON (world summary, sim, measures, coverage, ORION) |

## Scope rule (not negotiable)

Guards and machines observe, detect, report and respond by moving. No weapon effects, targeting or engagement; no
real military or sensitive sites; protected zones are notional; nothing that helps anyone avoid detection. DoD
Directive 3000.09 (autonomy in weapon systems) does not apply because no weapon function exists; hazard H-06 keeps it
that way.

## Working loop

1. A new feature starts with its hazard entries and its tests.
2. The code is written until the tests pass.
3. The pipeline gates and the V&V Report pass on the commit.
4. The owner records the accreditation decision for the release.
