"""Run the real Sitewatch engine for the web app and print one JSON document.

Modes:
  --seed N --hours H                 synthetic site (ground truth included, scored)
  --inventory P --telemetry P        caller's own files (no ground truth, not scored)
Bounded: hours 1..24, files read through sitewatch's regular-file snapshot reader with its byte limits.
Exit 0 with {"ok": true, ...}; exit 2 with {"ok": false, "error": CODE}. No network, no writes.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'sitewatch'))
from sitewatch.diagnose import baseline, diagnose  # noqa: E402
from sitewatch.generate import generate, write_jsonl  # noqa: E402
from sitewatch.models import (  # noqa: E402
    MAX_INVENTORY_BYTES,
    MAX_TELEMETRY_BYTES,
    InputError,
    Inventory,
    Receipt,
    parse_inventory,
    parse_telemetry,
    read_snapshot,
)
from sitewatch.score import score  # noqa: E402

MAX_MINUTES = 24 * 60


def timeline(inv: Inventory, receipts: list[Receipt]) -> dict:
    start = inv.window_start_ms
    minutes = min(MAX_MINUTES * 2, max(1, -(-(inv.window_end_ms - start) // 60_000)))
    ids = [d.id for d in inv.devices]
    sums = {d: [0.0] * minutes for d in ids}
    count = {d: [0] * minutes for d in ids}
    for r in receipts:
        m = (r.recv_ms - start) // 60_000
        if r.device in sums and 0 <= m < minutes:
            sums[r.device][m] += r.value
            count[r.device][m] += 1
    return {'minutes': minutes, 'devices': ids,
            'heartbeatS': {d.id: d.heartbeat_ms / 1000 for d in inv.devices},
            'value': {d: [round(sums[d][m] / count[d][m], 3) if count[d][m] else None for m in range(minutes)]
                      for d in ids},
            'count': {d: count[d] for d in ids}}


def relative(report: dict, start: int) -> list[dict]:
    def rel(ms):
        return None if ms is None else round((ms - start) / 60_000, 3)
    return [{'device': a['device'], 'cause': a['cause'], 'onset': rel(a['onset_ms']), 'raised': rel(a['raised_ms']),
             'cleared': rel(a['cleared_ms']), 'evidence': a['evidence']} for a in report['alarms']]


def run(args: argparse.Namespace) -> dict:
    if args.seed is not None:
        if not 0 <= args.seed < 2**31 or not 1 <= args.hours <= 24:
            raise InputError('ARGUMENTS_INVALID')
        inv_doc, rows, truth = generate(args.seed, args.hours)
        inv = parse_inventory(json.dumps(inv_doc).encode())
        receipts = parse_telemetry(write_jsonl(rows))
        truth_rows = [e.as_dict() for e in truth]
    else:
        inv = parse_inventory(read_snapshot(Path(args.inventory), MAX_INVENTORY_BYTES))
        receipts = parse_telemetry(read_snapshot(Path(args.telemetry), MAX_TELEMETRY_BYTES))
        if (inv.window_end_ms - inv.window_start_ms) > MAX_MINUTES * 2 * 60_000:
            raise InputError('WINDOW_TOO_LONG')
        truth_rows = None
    start = inv.window_start_ms
    site = diagnose(inv, receipts, inv.window_end_ms)
    naive = baseline(inv, receipts, inv.window_end_ms, 3)
    out = {'ok': True, 'mode': 'synthetic' if truth_rows is not None else 'uploaded', 'seed': args.seed,
           'receipts': len(receipts), 'status': {'sitewatch': site['status'], 'naive': naive['status']},
           'deviceStates': site['device_states'], 'outsideScope': site['receipts_outside_scope'],
           'timeline': timeline(inv, receipts), 'sitewatch': relative(site, start), 'naive': relative(naive, start)}
    if truth_rows is not None:
        out['truth'] = [{'device': e['device'], 'kind': e['kind'], 'start': (e['start_ms'] - start) / 60_000,
                         'end': (e['end_ms'] - start) / 60_000} for e in truth_rows]
        out['score'] = {name: {k: v for k, v in score(inv, rep, truth_rows).items() if k != 'per_episode'}
                        for name, rep in (('sitewatch', site), ('naive', naive))}
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--seed', type=int)
    parser.add_argument('--hours', type=int, default=6)
    parser.add_argument('--inventory')
    parser.add_argument('--telemetry')
    try:
        args = parser.parse_args()
        if (args.seed is None) == (args.inventory is None or args.telemetry is None):
            raise InputError('ARGUMENTS_INVALID')
        result, code = run(args), 0
    except InputError as exc:
        result, code = {'ok': False, 'error': exc.code, 'line': exc.line}, 2
    except SystemExit:
        result, code = {'ok': False, 'error': 'ARGUMENTS_INVALID'}, 2
    sys.stdout.write(json.dumps(result, separators=(',', ':'), allow_nan=False))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
