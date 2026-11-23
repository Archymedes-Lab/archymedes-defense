"""Aggregate scores over many seeds for every engine, and measure the real CLI's cost. Synthetic only."""
import json
import resource
import subprocess
import sys
import tempfile
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from sitewatch.diagnose import baseline, diagnose  # noqa: E402
from sitewatch.generate import generate, write_jsonl  # noqa: E402
from sitewatch.models import parse_inventory, parse_telemetry  # noqa: E402
from sitewatch.score import score  # noqa: E402

SEEDS = range(50)
ENGINES = {"sitewatch": lambda i, r: diagnose(i, r, i.window_end_ms),
           "naive_2hb": lambda i, r: baseline(i, r, i.window_end_ms, 2),
           "naive_3hb": lambda i, r: baseline(i, r, i.window_end_ms, 3)}


def accuracy():
    totals = {e: defaultdict(float) for e in ENGINES}
    by_kind = {e: defaultdict(lambda: [0, 0]) for e in ENGINES}
    detect = {e: [] for e in ENGINES}
    for seed in SEEDS:
        inv_doc, rows, truth = generate(seed)
        inv = parse_inventory(json.dumps(inv_doc).encode())
        receipts = parse_telemetry(write_jsonl(rows))
        for name, engine in ENGINES.items():
            s = score(inv, engine(inv, receipts), [e.as_dict() for e in truth])
            for key in ("episodes", "classified", "alarm_overlap", "false_alarms", "false_alarm_minutes",
                        "duplicate_alarms"):
                totals[name][key] += s[key]
            for r in s["per_episode"]:
                by_kind[name][r["kind"]][0] += r["classified"]
                by_kind[name][r["kind"]][1] += 1
                if "detect_latency_s" in r and r["classified"]:
                    detect[name].append(r["detect_latency_s"])
    out = {}
    for name in ENGINES:
        lat = sorted(detect[name])
        out[name] = {**{k: round(v, 1) for k, v in totals[name].items()},
                     "classified_by_kind": {k: f"{a}/{b}" for k, (a, b) in sorted(by_kind[name].items())},
                     "median_detect_s_classified": lat[len(lat) // 2] if lat else None}
    return out


def false_alarms_excluding_hard_case():
    counts = defaultdict(int)
    for seed in SEEDS:
        inv_doc, rows, truth = generate(seed)
        inv = parse_inventory(json.dumps(inv_doc).encode())
        receipts = parse_telemetry(write_jsonl(rows))
        for name, engine in ENGINES.items():
            report = engine(inv, receipts)
            s = score(inv, report, [e.as_dict() for e in truth])
            counts[name] += s["false_alarms"] - sum(
                1 for a in report["alarms"] if a["device"] == "hum-10" and a["cause"] == "frozen_reading")
    return dict(counts)


def cost():
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        for hours in (6, 48):
            run = Path(tmp) / f"h{hours}"
            subprocess.run([sys.executable, "-m", "sitewatch", "generate", "--seed", "1", "--hours", str(hours),
                            "--out", str(run)], check=True, capture_output=True, timeout=120)
            for _attempt in range(3):
                before = resource.getrusage(resource.RUSAGE_CHILDREN)
                start = time.perf_counter()
                subprocess.run([sys.executable, "-m", "sitewatch", "diagnose", "--inventory",
                                str(run / "inventory.json"), "--telemetry", str(run / "telemetry.jsonl")],
                               capture_output=True, timeout=120)
                wall = time.perf_counter() - start
                after = resource.getrusage(resource.RUSAGE_CHILDREN)
            rows.append({"hours": hours, "bytes": (run / "telemetry.jsonl").stat().st_size,
                         "wall_s": round(wall, 2), "cpu_s": round(after.ru_utime + after.ru_stime
                                                                   - before.ru_utime - before.ru_stime, 2),
                         "max_rss_mb_any_child": round(after.ru_maxrss / 1024, 1)})
    return rows


if __name__ == "__main__":
    print(json.dumps({"seeds": len(SEEDS), "accuracy": accuracy(),
                      "false_alarms_excluding_hum10_frozen": false_alarms_excluding_hard_case(),
                      "cost": cost()}, indent=1))
