"""Deterministic synthetic site telemetry with labelled fault episodes.

Ground truth goes to a separate file. The diagnoser never reads it.
Synthetic: these traces encode our own model of failures and are not field data.
"""
from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass
from typing import Any

FAULT_KINDS = ("outage_lost", "outage_buffered", "power_loss", "flapping", "clock_step", "stuck")
MINUTE = 60_000
EPOCH_MS = 1_795_000_000_000  # fixed origin (2026-11-18) so traces are reproducible


@dataclass(frozen=True)
class Episode:
    device: str
    kind: str
    start_ms: int
    end_ms: int
    detail: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return {"device": self.device, "kind": self.kind, "start_ms": self.start_ms,
                "end_ms": self.end_ms, "detail": self.detail}


@dataclass(frozen=True)
class DeviceSpec:
    id: str
    heartbeat_ms: int
    value_varies: bool
    quantum: float  # reading resolution; coarse quantum makes legitimately flat runs
    faults: tuple[tuple[str, int, int, dict[str, Any]], ...]  # (kind, start_min, duration_min, params)


def default_site() -> tuple[DeviceSpec, ...]:
    """One small site. Includes clean controls and one hard case (coarse quantization)."""
    return (
        DeviceSpec("env-01", 10_000, True, 0.01, ()),
        DeviceSpec("env-02", 10_000, True, 0.01, (("outage_lost", 40, 12, {}),)),
        DeviceSpec("env-03", 10_000, True, 0.01, (("outage_buffered", 70, 15, {}),)),
        DeviceSpec("env-04", 10_000, True, 0.01, (("power_loss", 100, 8, {}),)),
        DeviceSpec("env-05", 10_000, True, 0.01, (("flapping", 130, 20, {"drop": 0.4}),)),
        DeviceSpec("env-06", 10_000, True, 0.01, (("clock_step", 160, 0, {"step_ms": -15 * MINUTE}),)),
        DeviceSpec("env-07", 10_000, True, 0.01, (("stuck", 190, 25, {}),)),
        DeviceSpec("env-08", 10_000, True, 0.01, (("clock_step", 60, 0, {"step_ms": 20 * MINUTE}),
                                                  ("outage_lost", 120, 10, {}))),
        DeviceSpec("door-09", 30_000, False, 1.0, (("power_loss", 200, 5, {}),)),
        DeviceSpec("hum-10", 10_000, True, 1.0, ()),  # hard case: integer humidity, flat runs are normal
    )


def generate(seed: int, hours: int = 6,
             site: tuple[DeviceSpec, ...] | None = None) -> tuple[dict[str, Any], list[dict[str, Any]], list[Episode]]:
    """Return (inventory, receipts sorted by receive time, truth episodes)."""
    rng = random.Random(seed)
    site = site if site is not None else default_site()
    start, end = EPOCH_MS, EPOCH_MS + hours * 60 * MINUTE
    receipts: list[dict[str, Any]] = []
    truth: list[Episode] = []
    for spec in site:
        rows, episodes = _device_trace(spec, start, end, random.Random(rng.getrandbits(64)))
        receipts.extend(rows)
        truth.extend(episodes)
    receipts.sort(key=lambda r: (r["recv_ms"], r["device"], r["seq"]))
    inventory = {"window": {"start_ms": start, "end_ms": end},
                 "devices": [{"id": s.id, "heartbeat_ms": s.heartbeat_ms, "value_varies": s.value_varies}
                             for s in site]}
    return inventory, receipts, truth


def _device_trace(spec: DeviceSpec, start: int, end: int,
                  rng: random.Random) -> tuple[list[dict[str, Any]], list[Episode]]:
    hb = spec.heartbeat_ms
    # faults that would start after the trace ends are not part of it; one still running at the end is clipped
    windows = [(kind, start + a * MINUTE, min(end, start + (a + d) * MINUTE), p) for kind, a, d, p in spec.faults
               if start + a * MINUTE < end]
    truth = [Episode(spec.id, kind, s, e, dict(p)) for kind, s, e, p in windows]
    rows: list[dict[str, Any]] = []
    boot_index, seq, clock_offset = 0, 0, rng.randint(-2_000, 2_000)
    buffered: list[dict[str, Any]] = []
    stuck_value: float | None = None
    t = start + rng.randint(0, hb)
    phase = rng.random() * math.tau
    while t < end:
        active = {kind: (s, e, p) for kind, s, e, p in windows if s <= t < e or (kind == "clock_step" and t >= s)}
        if "power_loss" in active:
            s, e, _ = active["power_loss"]
            t = e + rng.randint(5_000, 20_000)  # boots after power returns
            boot_index, seq = boot_index + 1, 0
            continue
        if "clock_step" in active:
            step = int(active["clock_step"][2]["step_ms"])
        else:
            step = 0
        dev_ms = t + clock_offset + step
        reading = 20.0 + 3.0 * math.sin(phase + (t - start) / (90 * MINUTE)) + rng.gauss(0, 0.15)
        if not spec.value_varies:
            reading = 1.0
        reading = round(round(reading / spec.quantum) * spec.quantum, 4)
        if "stuck" in active:
            stuck_value = reading if stuck_value is None else stuck_value
            reading = stuck_value
        else:
            stuck_value = None
        recv_ms = t + rng.randint(50, 300)
        row: dict[str, Any] = {"device": spec.id, "seq": seq, "boot": f"{spec.id}-b{boot_index}", "dev_ms": dev_ms,
               "value": reading, "recv_ms": recv_ms}
        seq += 1
        natural_loss = rng.random() < 0.005
        if "outage_buffered" in active:
            buffered.append(row)
        elif buffered:
            flush_at, held_count = recv_ms, len(buffered)
            for i, held in enumerate(buffered):
                held["recv_ms"] = flush_at + i * 20  # store-and-forward burst, original device times kept
            rows.extend(buffered)
            buffered = []
            rows.append(dict(row, recv_ms=flush_at + held_count * 20 + 50))
        elif "outage_lost" in active:
            pass
        elif "flapping" in active and rng.random() < float(active["flapping"][2]["drop"]):
            pass
        elif not natural_loss:
            rows.append(row)
        t += hb + rng.randint(-hb // 50, hb // 50)
    return rows, truth


def write_jsonl(rows: list[dict[str, Any]]) -> bytes:
    return b"".join(json.dumps(r, sort_keys=True, separators=(",", ":")).encode() + b"\n" for r in rows)
