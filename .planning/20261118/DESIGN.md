# Resume defense projects — 2026-11-18

Scope assumption after the optional selection question: original four alongside
Proofline. Build standalone local offline experiments; do not touch ARGUS runtime,
Compass live data, Proofline's published code or existing operational evidence.
Do not publish or contact customers automatically during prototype development.

Invariants before implementation:
- Explicit fixed schemas, bounded local regular-file reads, duplicate-key rejection,
  finite numbers, strict UTC times and safe errors without user values or paths.
- Output after complete parsing, never a partial successful result. No networking,
  automatic response, installation, credential collection or real target scanning.
- Unknown scope, missing/stale data and unavailable references cannot imply safety,
  absence of exposure, unchanged imagery or trusted navigation.
- Identity, sequence and caller-provided references stay distinct from authentication.
  No clear-health flag, guessed baseline or model opinion grants operational authority.
- No raw camera frames, browser histories, stolen databases or actual facility records.
  Small synthetic raster matrices are permitted only for the Groundwatch bench replay.
- Reports are advisory evidence with source limits; model advice cannot override tests.
- Each prototype gets successful and refusal/adversarial cases, real CLI checks and
  measured synthetic costs; no customer, live-sensor, compliance or damage claim.

Design choices:
1. Four stdlib Python modules/CLIs, each self-contained: selected for inspectability,
   reproducible offline runs and no hosted service or billing before buyer discovery.
2. A hosted dashboard/backend would add private data, persistence and authorization
   costs without confirming the user workflow. Defer.
3. A shared runtime package would couple four early experiments and require package
   release/version management. Instead vendor a small identical input helper, record
   its hashes and test its boundary in each project. Extract only if interfaces stabilize.

First concrete milestones:
- Sitewatch: expected-device heartbeat/status/maintenance replay; no real camera
  contents, gateway daemon, durable queue or camera-scene interpretation.
- Exposurewatch: exact-scope triage of licensed-source metadata; preserve duplicates,
  source freshness and excluded records. Never infer breach from a mention.
- Groundwatch: co-registered synthetic optical-raster comparison with cloud/no-data
  abstention; report numeric signal change for analyst review, never structural damage.
  No real Sentinel acquisition or processing/registration validation yet.
- PNTwatch: UTC-normalized position/time replay versus supplied references, preserving
  missing-reference uncertainty and receiver quality flags; no transmitter or control.

Licensing: new original source is PolyForm Noncommercial 1.0.0 plus separate commercial
permission, matching the user's recorded choice. Original dated AGPL research documents
are not relicensed or copied into these source trees. Names remain provisional.
