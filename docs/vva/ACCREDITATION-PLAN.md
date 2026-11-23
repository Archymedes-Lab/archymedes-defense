# Accreditation Plan: archworld site simulation

MIL-STD-3022 product 1 of 4 (tailored). Policy basis: DoDI 5000.61 (2024): a model or simulation is accredited
for a stated intended use, with V&V effort set by the risk of that use. Companion documents: [V&V Plan](VV-PLAN.md),
[V&V Report](VV-REPORT.md) (generated), [Accreditation Report](ACCREDITATION-REPORT.md).

## 1. Intended use

Compare candidate physical-security measures for a **notional** site, relative to each other and under stated
assumptions, to decide which ones are worth testing on the ground next.

The questions it answers:

1. Which fence line and yard areas can the fixed cameras detect a person in, for a given layout and resolution?
2. In a protection timeline (fence, then door), how often is an intruder met before the task is done, with which
   sensors out of service, at random times across equipment duty cycles?
3. Which candidate measure changes that rate, by how much, with what confidence, and at what rough cost?
4. What workload do nuisance alarms put on guards and machines under two alarm procedures?

**Not intended for**, and not accredited for:

- certifying, rating or describing the security of a real facility;
- predicting absolute probabilities for any real site;
- operational planning, tasking or any live use;
- weapons, targeting or engagement, in any form;
- finding where detection is weakest in order to avoid it: there is no least-detected route planner, and any
  approach sampler must not depend on where sensors are placed.

## 2. Risk of use

Hazard log: [docs/safety/hazards.json](../safety/hazards.json) (MIL-STD-882E, checked by
`world/tests/test_hazards.py`). The worst credible outcome of a wrong answer is a real site left less protected
than its owner believes (hazard H-01, severity Critical). This sets the V&V effort at **moderate**: every model
element that drives a recommendation needs a verification test, a stated source, and a sensitivity check; full
results validation against field data is required before any use on a real site.

## 3. M&S requirements and acceptability criteria

| ID | Requirement | Acceptability criterion | Evidence |
|---|---|---|---|
| AC-1 | Ground truth geometry | Frame round trip < 1 mm; no building lost, floating or open; every feature carries provenance | `world/tests/test_invariants.py` |
| AC-2 | Reproducibility | Same seed gives the same run (digest); world build is deterministic | `test_sim.py`, `test_ops.py`, `test_invariants.py` |
| AC-3 | Scope | Weapons, unknown kinds, keys and payloads refused; zones notional | `test_sim.py`, `test_ops.py`, `test_realism.py` |
| AC-4 | Fixed-camera detection | No detection below 25 px/m (IEC 62676-4 detect); chance never rises with distance; coverage monotone in resolution | `test_realism.py` |
| AC-5 | Line of sight | Blocked by terrain, buildings and canopy | `test_sim.py` |
| AC-6 | Equipment availability | Intrusions sampled across duty cycles; runs meet equipment in every state | `test_realism.py` |
| AC-7 | Statistics | Every reported rate has an exact 95% interval; options the paired runs cannot separate are labelled tied | `test_realism.py`, measures output |
| AC-8 | Face validity | Longer door delay never lowers the interruption rate beyond sampling noise; better resolution never lowers coverage | V&V Report, section 3 |
| AC-9 | Hazards | No residual High or Serious risk; every mitigation exists | `test_hazards.py` |
| AC-10 | Transparency | Every assumption listed in the report with its basis | report "Assumptions and limits" |

## 4. Accreditation authority and decision

Accreditation authority: the program owner (Archymedes). The authority accepts, accepts with limitations, or
rejects the simulation for the intended use above, based on the V&V Report, and records the decision and its
limitations in the Accreditation Report. Any change to the intended use requires a new decision.

## 5. Schedule

Re-assessed at every capability release (see [docs/program/ROADMAP.md](../program/ROADMAP.md)): the V&V Report is
regenerated from the tests and the run outputs, and the accreditation decision is reviewed against it.
