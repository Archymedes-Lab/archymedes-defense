"""The MIL-STD-882E hazard log (docs/safety/hazards.json) is checked like code.

- Risk levels follow the 882E risk assessment matrix (severity 1-4 x probability A-F).
- Every mitigation points at something that exists: a test function, a CI gate job, or a document.
- No residual risk is High or Serious: those are not acceptable at release.
- A mitigation never raises risk: residual is no worse than initial.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOG = json.loads((ROOT / "docs/safety/hazards.json").read_text())

# MIL-STD-882E Table III. Rows: probability; columns: severity 1 (Catastrophic) to 4 (Negligible).
MATRIX = {
    "A": ("High", "High", "Serious", "Medium"),
    "B": ("High", "High", "Serious", "Medium"),
    "C": ("High", "Serious", "Medium", "Low"),
    "D": ("Serious", "Medium", "Medium", "Low"),
    "E": ("Medium", "Medium", "Medium", "Low"),
}
ORDER = ["Low", "Medium", "Serious", "High"]


def risk(r: dict) -> str:
    return "Eliminated" if r["probability"] == "F" else MATRIX[r["probability"]][r["severity"] - 1]


def test_log_is_well_formed():
    ids = [h["id"] for h in LOG["hazards"]]
    assert len(ids) == len(set(ids)) and all(re.fullmatch(r"H-\d{2}", i) for i in ids)
    for h in LOG["hazards"]:
        for k in ("initial", "residual"):
            assert h[k]["severity"] in (1, 2, 3, 4) and h[k]["probability"] in "ABCDEF"
        assert h["mitigations"] and h["title"] and h["cause"] and h["effect"]


def test_every_mitigation_points_at_something_real():
    for h in LOG["hazards"]:
        for m in h["mitigations"]:
            if m["kind"] == "test":
                path, name = m["ref"].split("::")
                assert re.search(rf"^def {name}\(", (ROOT / path).read_text(), re.M), f"{h['id']}: {m['ref']}"
            elif m["kind"] == "gate":
                path, job = m["ref"].split("#")
                assert re.search(rf"^  {job}:", (ROOT / path).read_text(), re.M), f"{h['id']}: {m['ref']}"
            else:
                assert m["kind"] == "doc" and (ROOT / m["ref"]).exists(), f"{h['id']}: {m['ref']}"


def test_no_residual_risk_is_high_or_serious():
    for h in LOG["hazards"]:
        assert risk(h["residual"]) not in ("High", "Serious"), f"{h['id']} residual {risk(h['residual'])}"


def test_mitigation_never_raises_risk():
    for h in LOG["hazards"]:
        r0, r1 = risk(h["initial"]), risk(h["residual"])
        if r1 != "Eliminated":
            assert ORDER.index(r1) <= ORDER.index(r0), h["id"]
        # neither more severe (lower number) nor more likely (earlier letter) than before mitigation
        assert h["residual"]["severity"] >= h["initial"]["severity"], h["id"]
        assert h["residual"]["probability"] >= h["initial"]["probability"], h["id"]


def test_matrix_matches_the_standard_at_its_corners():
    assert risk({"severity": 1, "probability": "A"}) == "High"
    assert risk({"severity": 4, "probability": "E"}) == "Low"
    assert risk({"severity": 2, "probability": "D"}) == "Medium"
    assert risk({"severity": 3, "probability": "B"}) == "Serious"
