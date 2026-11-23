# Selected by the user: the most defensible candidates

The user's selection supersedes the provisional original-four scope in DESIGN.md.
Build AI evaluation evidence (`evalevidence`) and dataset provenance (`datascope`).
Compass/Jev's first-pilot scores are approximately 1.38 and 1.40 / 4, respectively.
They are tied in practical terms and do not establish a strong existing moat.

## Invariants before implementation

- Separate local stdlib Python CLIs. No changes to ARGUS, Proofline or Compass data.
- Explicit bounded regular-file snapshots, no symlinks/special files, duplicate-key
  and nonfinite-number refusal, finite counts, strict UTC and safe error codes only.
- Fixed metadata schemas; no prompts, completions, credentials, raw source documents
  or real customer evidence. No network, model invocation or protected action at runtime.
- EvalEvidence: a caller-declared expected case manifest binds dataset, evaluator,
  policy, run and model versions. Missing/skipped/error results, changed scope,
  duplicates, stale evidence or invalid hashes cannot become a clean comparison.
  Hashes show self-consistency, not authenticated results or correctness of evaluation.
- DataScope: exact dataset version/digest and requested purpose bind the recorded
  permission. Check all transitive parents, source availability, review status and
  expiry; no grant laundering through a derived dataset. Cycles never recurse forever.
  Matching declared records is not legal clearance, proof of ownership or permission
  to handle any actual dataset. Missing evidence remains review-required.
- Input/output capped; all detected findings count even if displayed groups are capped.
  No retries or persistent runtime state. Interrupted reads never return success.
- Test real CLI and adversarial refusal paths with synthetic fixtures; record measured
  synthetic costs and unverified production/customer/operating-system behavior.

## Alternatives and selected design

Hosted evaluation runners would add customer content egress, execution, model spend,
credentials and authorization before the workflow is validated. Database registries
would require migration and multi-user authorization. Defer both. Use offline JSON
contracts and deterministic checking. Each project is self-contained with a small
identical vendored input helper, tested in both; extract a shared runtime only if the
contracts stabilize. No runtime dependency on ARGUS, Compass or each other.

Distribution: standard PolyForm Noncommercial 1.0.0, original new-source notices and
separate commercial permission. Existing AGPL research documents are not relicensed.
Names are provisional and not trademark-cleared. Create local repositories only in
this work session; publication/deployment is not part of the milestone.

Commercial hypothesis: defense software integrators pay for private evaluation
integration and repeatable evidence; defense analytics suppliers pay for supported
provenance/review workflows. Test with three interviews and one authorized synthetic/
lab workflow per track. Do not fabricate customers, pricing, eligibility or exclusivity.
