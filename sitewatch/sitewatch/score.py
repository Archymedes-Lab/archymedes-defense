"""Compare a diagnosis report with ground-truth episodes. The only module that reads truth."""
from __future__ import annotations

from statistics import median
from typing import Any

from .models import InputError, Inventory, decode

EXPECTED_CAUSE = {
    "outage_lost": "link_lost",
    "outage_buffered": "link_buffered",
    "power_loss": "power_loss_reboot",
    "flapping": "intermittent_loss",
    "clock_step": "clock_step",
    "stuck": "frozen_reading",
}
LEAD_HEARTBEATS = 2    # onset estimates may precede the labelled start by this much
GRACE_HEARTBEATS = 6   # silence bound plus recovery run


def parse_truth(raw: bytes) -> list[dict[str, Any]]:
    data = decode(raw)
    if not isinstance(data, dict) or not isinstance(data.get("episodes"), list):
        raise InputError("TRUTH_INVALID")
    episodes = []
    for e in data["episodes"]:
        if (not isinstance(e, dict) or e.get("kind") not in EXPECTED_CAUSE or not isinstance(e.get("device"), str)
                or not isinstance(e.get("start_ms"), int) or not isinstance(e.get("end_ms"), int)
                or e["end_ms"] < e["start_ms"]):
            raise InputError("TRUTH_EPISODE_INVALID")
        episodes.append(e)
    return episodes


def parse_report(raw: bytes) -> dict[str, Any]:
    data = decode(raw)
    if not isinstance(data, dict) or data.get("tool") != "sitewatch" or not isinstance(data.get("alarms"), list):
        raise InputError("REPORT_INVALID")
    return data


def score(inventory: Inventory, report: dict[str, Any], truth: list[dict[str, Any]]) -> dict[str, Any]:
    heartbeat = {d.id: d.heartbeat_ms for d in inventory.devices}
    as_of = int(report["as_of_ms"])
    alarms = report["alarms"]
    used: set[int] = set()
    rows = []
    for ep in sorted(truth, key=lambda e: (e["start_ms"], e["device"])):
        hb = heartbeat.get(ep["device"])
        if hb is None:
            raise InputError("TRUTH_DEVICE_UNKNOWN")
        low, high = ep["start_ms"] - LEAD_HEARTBEATS * hb, ep["end_ms"] + GRACE_HEARTBEATS * hb
        hits = [i for i, a in enumerate(alarms) if a["device"] == ep["device"]
                and a["onset_ms"] <= high and (a["cleared_ms"] if a["cleared_ms"] is not None else as_of) >= low]
        used.update(hits)
        expected = EXPECTED_CAUSE[ep["kind"]]
        row: dict[str, Any] = {"device": ep["device"], "kind": ep["kind"], "expected_cause": expected,
                               "alarm_overlap": bool(hits), "alarms_matched": len(hits)}
        if hits:
            first = min(hits, key=lambda i: alarms[i]["raised_ms"])
            right = [i for i in hits if alarms[i]["cause"] == expected]
            row["first_cause"] = alarms[first]["cause"]
            row["classified"] = bool(right)
            row["detect_latency_s"] = round((alarms[first]["raised_ms"] - ep["start_ms"]) / 1000, 1)
            cleared = [alarms[i]["cleared_ms"] for i in hits if alarms[i]["cleared_ms"] is not None]
            if ep["kind"] != "clock_step" and cleared and len(cleared) == len(hits):
                row["clear_latency_s"] = round((max(cleared) - ep["end_ms"]) / 1000, 1)
        else:
            row["classified"] = False
        rows.append(row)
    false = [a for i, a in enumerate(alarms) if i not in used]
    false_minutes = sum(((a["cleared_ms"] if a["cleared_ms"] is not None else as_of) - a["onset_ms"]) / 60_000
                        for a in false)
    overlapped = [r for r in rows if r["alarm_overlap"]]

    def med(key: str) -> float | None:
        values = [r[key] for r in rows if key in r]
        return round(median(values), 1) if values else None

    return {"engine": report.get("engine"), "episodes": len(rows), "classified": sum(r["classified"] for r in rows),
            "alarm_overlap": len(overlapped),
            "note": "headline is classified; alarm_overlap can include coincidental alarms",
            "duplicate_alarms": sum(max(0, r["alarms_matched"] - 1) for r in rows),
            "false_alarms": len(false), "false_alarm_minutes": round(false_minutes, 1),
            "false_alarm_causes": sorted({a["cause"] for a in false}),
            "median_detect_latency_s": med("detect_latency_s"), "median_clear_latency_s": med("clear_latency_s"),
            "per_episode": rows}
