# Product roadmap: archworld site simulation

Tailored from the DoD Software Acquisition Pathway (DoDI 5000.87): a Minimum Viable Capability Release (MVCR), then
short capability releases from a ranked backlog, each gated by evidence, with a value assessment at least yearly.

## Release gate (every release)

A release is cut only when all of these hold, on the release commit:

1. **DevSecOps gates green**: tests, lint, typecheck, static analysis, SBOM and dependency scan, secret scan
   (`.github/workflows/devsecops.yml`).
2. **V&V Report regenerated and passing**: `uv run python world/scripts/vv_report.py <site>` exits 0.
3. **Hazard log reviewed**: no residual High or Serious risk (`world/tests/test_hazards.py`); new features add
   hazards before code.
4. **Accreditation decision recorded** in [ACCREDITATION-REPORT.md](../vva/ACCREDITATION-REPORT.md) for the
   release's intended use.
5. **Tests before code**: each backlog item lands with the invariant tests written first.

## MVCR (release 1.0): relative comparison of site-security measures on a notional site

Done when the gate passes with: the measured world and compound; the protection timeline, alarms, gate and
evacuation operations; resolution-based fixed cameras; seeded intrusion times; exact intervals and ties; ORION
ranking on that evidence; the generated assessment report.

## Backlog (ranked; from the 2026-11-23 independent assessment)

| ID | Item | Why | Size |
|---|---|---|---|
| B-01 | Fixed cameras by pixel density (IEC 62676-4) | Coverage and the top recommendation rested on a 200 m camera | M, **done** |
| B-02 | Seen-before-fence fix; intrusion times across duty cycles | A published number was wrong; drills assumed equipment always up | S, **done** |
| B-03 | Exact intervals, paired tests, ties for ORION | Options could not be told apart | S, **done** |
| B-04 | Resolution-based models for drone, dog, vehicle and guard sensors | Same optimism as B-01 on mobile sensors (hazard H-02) | M |
| B-05 | Night and weather from MeteoSwiss / Open-Meteo; thermal cameras by Johnson criteria | Daylight-only results; drones grounded by wind | M-L |
| B-06 | Approaches sampled uniformly around the site, results per fence segment, sampler independent of sensor layout | One path per direction; keeps hazard H-05 closed | M |
| B-07 | Provenance tier for every parameter; one-at-a-time sensitivity sweep showing which assumptions flip the ranking | Placeholders drive results | M |
| B-08 | Imperfect assessment and an operator queue | Verification never fails today | M |
| B-09 | Per-zone fence sensors (Pd and nuisance rate per zone) | Single fence-wide Pd | S-M |
| B-10 | Guard shifts, breaks and dispatch delay | Guards are always ready | M |
| B-11 | Field-data validation with a partner site's logs | Required before any real-site use | L |

## Value assessment

Yearly, or when the intended use changes: which questions in the Accreditation Plan were asked by real users,
which recommendations were acted on, and what the field later showed. Recorded under `plans/`.
