"""python3 -m sitewatch {generate,diagnose,score,demo}. Offline; no network, retries or interventions."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, NoReturn

from . import generate as gen
from .diagnose import baseline, diagnose
from .models import (
    MAX_INVENTORY_BYTES,
    MAX_REPORT_BYTES,
    MAX_TELEMETRY_BYTES,
    MAX_TRUTH_BYTES,
    InputError,
    parse_inventory,
    parse_telemetry,
    read_snapshot,
)
from .score import parse_report, parse_truth, score


class SafeParser(argparse.ArgumentParser):
    def error(self, message: str) -> NoReturn:
        raise InputError("ARGUMENTS_INVALID")


def _parser() -> SafeParser:
    parser = SafeParser(prog="sitewatch", description="Diagnose site sensor faults from heartbeat telemetry.")
    sub = parser.add_subparsers(dest="command", required=True, parser_class=SafeParser)
    g = sub.add_parser("generate", help="Write a synthetic site trace and separate ground truth")
    g.add_argument("--seed", type=int, required=True)
    g.add_argument("--hours", type=int, default=6, choices=range(1, 49), metavar="1-48")
    g.add_argument("--out", type=Path, required=True, help="New directory (refused if it exists)")
    d = sub.add_parser("diagnose", help="Diagnose telemetry; never reads ground truth")
    d.add_argument("--inventory", type=Path, required=True)
    d.add_argument("--telemetry", type=Path, required=True)
    d.add_argument("--engine", choices=("sitewatch", "naive"), default="sitewatch")
    d.add_argument("--naive-heartbeats", type=int, default=2, choices=range(1, 11), metavar="1-10")
    d.add_argument("--at-ms", type=int, help="Evaluation time (epoch ms); default: inventory window end")
    s = sub.add_parser("score", help="Score a report against ground truth")
    s.add_argument("--inventory", type=Path, required=True)
    s.add_argument("--report", type=Path, required=True)
    s.add_argument("--truth", type=Path, required=True)
    return parser


def _write_new_dir(out: Path, files: dict[str, bytes]) -> None:
    try:
        out.mkdir(parents=False, exist_ok=False)
        for name, data in files.items():
            with open(out / name, "xb") as handle:
                handle.write(data)
    except FileExistsError as exc:
        raise InputError("OUTPUT_EXISTS") from exc
    except OSError as exc:
        raise InputError("OUTPUT_UNWRITABLE") from exc


def run(argv: list[str] | None) -> tuple[dict[str, Any], int]:
    args = _parser().parse_args(argv)
    if args.command == "generate":
        inventory_doc, rows, episodes = gen.generate(args.seed, args.hours)
        dump = json.dumps
        _write_new_dir(args.out, {
            "inventory.json": (dump(inventory_doc, sort_keys=True, indent=1) + "\n").encode(),
            "telemetry.jsonl": gen.write_jsonl(rows),
            "truth.json": (dump({"synthetic": True, "seed": args.seed,
                                 "episodes": [e.as_dict() for e in episodes]}, sort_keys=True, indent=1) + "\n").encode(),
        })
        return {"tool": "sitewatch", "generated": str(args.out), "receipts": len(rows),
                "episodes": len(episodes), "synthetic": True}, 0
    inventory = parse_inventory(read_snapshot(args.inventory, MAX_INVENTORY_BYTES))
    if args.command == "diagnose":
        receipts = parse_telemetry(read_snapshot(args.telemetry, MAX_TELEMETRY_BYTES))
        as_of = args.at_ms if args.at_ms is not None else inventory.window_end_ms
        if args.engine == "sitewatch":
            report = diagnose(inventory, receipts, as_of)
        else:
            report = baseline(inventory, receipts, as_of, args.naive_heartbeats)
        return report, 0 if report["status"] == "HEALTHY" else 1
    report = parse_report(read_snapshot(args.report, MAX_REPORT_BYTES))
    truth = parse_truth(read_snapshot(args.truth, MAX_TRUTH_BYTES))
    return score(inventory, report, truth), 0


def main(argv: list[str] | None = None) -> int:
    try:
        result, code = run(argv)
    except InputError as exc:
        result = {"tool": "sitewatch", "status": "UNKNOWN", "input_complete": False, "error": exc.code}
        if exc.line is not None:
            result["line"] = exc.line
        code = 2
    except KeyboardInterrupt:
        result = {"tool": "sitewatch", "status": "UNKNOWN", "input_complete": False, "error": "INTERRUPTED"}
        code = 130
    try:
        sys.stdout.write(json.dumps(result, sort_keys=True, allow_nan=False) + "\n")
    except BrokenPipeError:
        return 2
    return code


if __name__ == "__main__":
    raise SystemExit(main())
