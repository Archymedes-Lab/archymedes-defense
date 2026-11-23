"""Generate the V&V Report (MIL-STD-3022 product 3, tailored) from evidence: test results, the hazard log and the
run outputs. Nothing in it is typed by hand; rerun it after every change.

  uv run python scripts/vv_report.py ch-lauterbrunnen
Writes ../docs/vva/VV-REPORT.md. Exit status 1 if any acceptability criterion fails.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

site = sys.argv[1]
HERE = Path(__file__).resolve().parent.parent
ROOT = HERE.parent
DATA = ROOT / "web" / "lib" / "data"

# ---------------------------------------------------------------- verification: run the suites
with tempfile.TemporaryDirectory() as tmp:
    junit = Path(tmp) / "junit.xml"
    subprocess.run(["uv", "run", "pytest", "-q", f"--junitxml={junit}"], cwd=HERE, capture_output=True)
    cases = ET.parse(junit).getroot().iter("testcase")
    results: dict[str, Counter] = {}
    failed: list[str] = []
    for c in cases:
        f = c.get("classname", "").split(".")[-1]
        outcome = "failed" if c.find("failure") is not None or c.find("error") is not None else \
            "skipped" if c.find("skipped") is not None else "passed"
        results.setdefault(f, Counter())[outcome] += 1
        if outcome == "failed":
            failed.append(f"{f}::{c.get('name')}")
commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True,
                        text=True).stdout.strip()
dirty = bool(subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True).stdout.strip())

load = lambda name: json.loads((DATA / f"world-{name}-{site}.json").read_text())  # noqa: E731
sim, ms, cov = load("sim"), load("measures"), load("coverage")["variants"]
hz = json.loads((ROOT / "docs/safety/hazards.json").read_text())
ops, m = sim["operations"], ms["measures"]

# ---------------------------------------------------------------- acceptability criteria
suite_ok = lambda *names: all(results.get(n) and not results[n]["failed"] for n in names)  # noqa: E731
sens = ops["sensitivity"]
# AC-8a: a longer door delay never lowers interruption beyond noise: each step stays within the lower interval
sens_ok = all(b["interrupted"] >= a["interrupted"] - 6 for a, b in zip(sens, sens[1:], strict=False))
cov_ok = (cov["4k-masts"]["fence"]["seen_share"] >= cov["re-aimed-masts"]["fence"]["seen_share"]
          and cov["4k-masts"]["yard"]["seen_share"] >= cov["re-aimed-masts"]["yard"]["seen_share"])
rates_ok = all("met_in_time_ci" in x and "tied_with" in x for x in m.values())
tl_ok = all("interrupted_ci" in t for t in ops["timeline"])
criteria = [
    ("AC-1", "Ground truth geometry", suite_ok("test_invariants"), "world/tests/test_invariants.py"),
    ("AC-2", "Reproducibility", suite_ok("test_sim", "test_ops", "test_invariants"), "determinism tests"),
    ("AC-3", "Scope", suite_ok("test_sim", "test_ops", "test_realism"), "scope tests"),
    ("AC-4", "Fixed-camera detection (IEC 62676-4)", suite_ok("test_realism"), "world/tests/test_realism.py"),
    ("AC-5", "Line of sight", suite_ok("test_sim"), "world/tests/test_sim.py"),
    ("AC-6", "Equipment availability", suite_ok("test_realism"), "seeded intrusion tests"),
    ("AC-7", "Statistics", suite_ok("test_realism") and rates_ok and tl_ok,
     f"intervals on {len(m)} measures and {len(ops['timeline'])} timeline cases"),
    ("AC-8", "Face validity", sens_ok and cov_ok,
     "door delay " + ", ".join(f"{s['door_delay_s']:.0f} s: {s['interrupted']}/{s['runs']}" for s in sens)
     + f"; 4K coverage {cov['4k-masts']['fence']['seen_share']:.0%} >= 1080p "
       f"{cov['re-aimed-masts']['fence']['seen_share']:.0%} of the fence"),
    ("AC-9", "Hazards", suite_ok("test_hazards"), f"{len(hz['hazards'])} hazards, world/tests/test_hazards.py"),
    ("AC-10", "Transparency", (ROOT / "reports" / f"{site}-site-assessment.md").exists(), "report lists assumptions"),
]
ok = all(c[2] for c in criteria)

MATRIX = {"A": ("High", "High", "Serious", "Medium"), "B": ("High", "High", "Serious", "Medium"),
          "C": ("High", "Serious", "Medium", "Low"), "D": ("Serious", "Medium", "Medium", "Low"),
          "E": ("Medium", "Medium", "Medium", "Low")}
risk = lambda r: "Eliminated" if r["probability"] == "F" else MATRIX[r["probability"]][r["severity"] - 1]  # noqa: E731

L: list[str] = []
w = L.append
w("# V&V Report: archworld site simulation")
w("")
w("MIL-STD-3022 product 3 of 4 (tailored). **Generated** by `world/scripts/vv_report.py`; do not edit by hand.")
w(f"Commit `{commit}`{' with uncommitted changes' if dirty else ''}, generated "
  f"{datetime.now(UTC).strftime('%Y-%m-%d %H:%M')} UTC, site `{site}`.")
w("")
w(f"**Result: {'all acceptability criteria met' if ok else 'NOT all acceptability criteria met'}** "
  "for the intended use in the [Accreditation Plan](ACCREDITATION-PLAN.md).")
w("")
w("## 1. Acceptability criteria")
w("")
w("| ID | Criterion | Met | Evidence |")
w("|---|---|---|---|")
for cid, name, good, ev in criteria:
    w(f"| {cid} | {name} | {'yes' if good else '**no**'} | {ev} |")
w("")
w("## 2. Verification: test results")
w("")
w("| Suite | Passed | Failed | Skipped |")
w("|---|---:|---:|---:|")
for f, c in sorted(results.items()):
    w(f"| `{f}` | {c['passed']} | {c['failed']} | {c['skipped']} |")
w("")
if failed:
    w("Failed: " + ", ".join(f"`{x}`" for x in failed))
    w("")
w("Web tests, typecheck, static analysis, the SBOM and dependency scan, and the secret scan run in the DevSecOps "
  "pipeline (`.github/workflows/devsecops.yml`).")
w("")
w("## 3. Validation results")
w("")
w(f"- **Conceptual model:** Sandia probability of interruption; IEC 62676-4 detect density for fixed cameras; exact "
  f"binomial intervals and paired tests over {ms['seeds']} seeds for the measures.")
w(f"- **Hard case baseline:** met in time {m['baseline']['met_in_time']}/{m['baseline']['runs']} (95% interval "
  f"{m['baseline']['met_in_time_ci']['lo']:.0%} to {m['baseline']['met_in_time_ci']['hi']:.0%}).")
for vid, x in m.items():
    if vid != "baseline":
        w(f"- {x['label']}: {x['met_in_time']}/{x['runs']} ({x['met_in_time_ci']['lo']:.0%} to "
          f"{x['met_in_time_ci']['hi']:.0%}); differs from now: {'yes' if x['vs_baseline_p'] < 0.05 else 'no'} "
          f"(p = {x['vs_baseline_p']:.3f}); tied with: {', '.join(x['tied_with']) or 'none'}.")
w("- **Field data:** none. Results are relative comparisons on a notional site, not predictions for a real one.")
w("")
w("## 4. Hazards (MIL-STD-882E)")
w("")
w("| ID | Hazard | Initial | Residual | Status |")
w("|---|---|---|---|---|")
for h in hz["hazards"]:
    i, r = h["initial"], h["residual"]
    w(f"| {h['id']} | {h['title']} | {i['severity']}{i['probability']} {risk(i)} | {r['severity']}{r['probability']} "
      f"{risk(r)} | {h['status']} |")
w("")
w("## 5. Limitations carried into accreditation")
w("")
for item in (
        "No validation against field data (sensor logs, patrol records, alarm histories).",
        "Mobile sensors (drone, robot dog, vehicle, guards) use a range-based detection model, not resolution-based.",
        "Daylight only; no weather; thermal cameras do not change detection.",
        "Assessment of an alarm by camera or machine never fails; no operator workload model.",
        "Equipment figures, barrier delays and gate catch rates are class assumptions, listed in the report."):
    w(f"- {item}")
(ROOT / "docs" / "vva" / "VV-REPORT.md").write_text("\n".join(L) + "\n")
print(f"VV-REPORT.md: {'PASS' if ok else 'FAIL'}; {sum(c['passed'] for c in results.values())} tests passed, "
      f"{len(failed)} failed")
sys.exit(0 if ok else 1)
