"""Deterministic fault diagnosis from heartbeat telemetry. Never reads ground truth.

Freshness is judged on receive time. Device clocks, sequence numbers, boot ids and
readings are evidence about the cause. Alarms clear only after a contiguous run.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from statistics import median
from typing import Any

from .models import Device, Inventory, Receipt

SILENCE_HEARTBEATS = 3      # no receipt for this many heartbeats (plus jitter tolerance) -> silent
SILENCE_TOLERANCE = 0.5     # heartbeats; two natural drops plus late jitter must not trip it
RECOVER_RUN = 3             # contiguous receipts needed to clear
LOSS_WINDOW_HEARTBEATS = 30
LOSS_OPEN, LOSS_CLOSE = 0.20, 0.05
LOSS_MIN_EXPECTED = 10
CLOCK_TOLERANCE_MS = 120_000
CLOCK_CONFIRM = 3
CLOCK_HISTORY = 10
STUCK_RUN = 30              # identical readings in a row -> frozen


@dataclass
class Alarm:
    device: str
    cause: str
    onset_ms: int        # best estimate of when the fault began
    raised_ms: int       # when this diagnoser could first have raised it
    cleared_ms: int | None = None
    evidence: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {"device": self.device, "cause": self.cause, "onset_ms": self.onset_ms,
                "raised_ms": self.raised_ms, "cleared_ms": self.cleared_ms, "evidence": self.evidence}


def _by_device(inventory: Inventory, receipts: list[Receipt]) -> tuple[dict[str, list[Receipt]], int]:
    known = {d.id: [] for d in inventory.devices}  # type: dict[str, list[Receipt]]
    unknown = 0
    for r in receipts:
        if r.device in known and inventory.window_start_ms <= r.recv_ms <= inventory.window_end_ms:
            known[r.device].append(r)
        else:
            unknown += 1
    for rows in known.values():
        rows.sort(key=lambda r: (r.recv_ms, r.seq))
    return known, unknown


def diagnose(inventory: Inventory, receipts: list[Receipt], as_of_ms: int) -> dict[str, Any]:
    grouped, ignored = _by_device(inventory, receipts)
    alarms: list[Alarm] = []
    states: dict[str, str] = {}
    for device in inventory.devices:
        device_alarms, state = _diagnose_device(device, grouped[device.id], inventory.window_start_ms, as_of_ms)
        alarms.extend(device_alarms)
        states[device.id] = state
    alarms.sort(key=lambda a: (a.raised_ms, a.device, a.cause))
    return _report("sitewatch", inventory, alarms, states, ignored, as_of_ms)


def _report(engine: str, inventory: Inventory, alarms: list[Alarm], states: dict[str, str],
            ignored: int, as_of_ms: int) -> dict[str, Any]:
    status = "HEALTHY"
    if any(s != "HEALTHY" for s in states.values()):
        status = "UNKNOWN" if all(s == "UNKNOWN" for s in states.values()) else "ALARM"
    return {"schema_version": 1, "tool": "sitewatch", "engine": engine, "status": status,
            "as_of_ms": as_of_ms, "device_states": dict(sorted(states.items())),
            "alarms": [a.as_dict() for a in alarms], "receipts_outside_scope": ignored,
            "limits": "synthetic-validated rules; not field-calibrated"}


def _diagnose_device(device: Device, rows: list[Receipt], window_start: int,
                     as_of: int) -> tuple[list[Alarm], str]:
    hb = device.heartbeat_ms
    silence = int((SILENCE_HEARTBEATS + SILENCE_TOLERANCE) * hb)
    alarms: list[Alarm] = []
    if not rows:
        if as_of - window_start > silence:
            alarms.append(Alarm(device.id, "never_seen", window_start, window_start + silence))
        return alarms, "UNKNOWN"

    silent: Alarm | None = None          # open silence awaiting a recovery run
    silent_cause_pending: tuple[Receipt, Receipt] | None = None
    run = 0
    loss: Alarm | None = None
    seqs: deque[tuple[int, int]] = deque()   # (recv_ms, seq) in current boot
    offsets: deque[int] = deque(maxlen=CLOCK_HISTORY)
    clock_suspects: list[Receipt] = []
    stuck: Alarm | None = None
    same_run: list[Receipt] = []
    prev: Receipt | None = None

    for r in rows:
        if prev is not None:
            gap = r.recv_ms - prev.recv_ms
            contiguous = r.boot != prev.boot or r.seq == prev.seq + 1
            if gap > silence and loss is not None and silent is None and gap <= LOSS_WINDOW_HEARTBEATS * hb:
                # short gap inside an open intermittent-loss alarm: same fault, keep one alarm
                loss.evidence["silences"] = loss.evidence.get("silences", 0) + 1
                loss.evidence["longest_gap_ms"] = max(loss.evidence.get("longest_gap_ms", 0), gap)
            elif gap > silence:
                if silent is None:
                    silent = Alarm(device.id, "silent", prev.recv_ms + hb, prev.recv_ms + silence)
                    silent_cause_pending = (prev, r)
                else:  # silence again before recovery: one alarm, original onset kept
                    assert silent_cause_pending is not None
                    silent_cause_pending = (silent_cause_pending[0], r)
                run = 1
                if loss is not None:  # a long silence supersedes intermittent loss
                    loss.cleared_ms = prev.recv_ms
                    alarms.append(loss)
                    loss = None
            elif silent is not None:
                run = run + 1 if contiguous and gap <= 2 * hb else 1
            if silent is not None and run >= RECOVER_RUN:
                assert silent_cause_pending is not None
                _classify_silence(silent, *silent_cause_pending)
                silent.cleared_ms = r.recv_ms
                alarms.append(silent)
                silent, silent_cause_pending = None, None
            if r.boot != prev.boot:
                seqs.clear()
                offsets.clear()
                clock_suspects = []

        # intermittent loss: sequence holes inside the recent window (only while not silent)
        seqs.append((r.recv_ms, r.seq))
        while seqs and seqs[0][0] < r.recv_ms - LOSS_WINDOW_HEARTBEATS * hb:
            seqs.popleft()
        expected = seqs[-1][1] - seqs[0][1] + 1
        if silent is None and expected >= LOSS_MIN_EXPECTED:
            rate = 1 - len(seqs) / expected
            if loss is None and rate > LOSS_OPEN:
                loss = Alarm(device.id, "intermittent_loss", seqs[0][0], r.recv_ms,
                             evidence={"loss_rate_at_raise": round(rate, 3)})
            elif loss is not None and rate <= LOSS_CLOSE:
                loss.cleared_ms = r.recv_ms
                alarms.append(loss)
                loss = None

        # clock: compare device clock offset with recent history; skip burst deliveries
        paced = prev is None or r.recv_ms - prev.recv_ms >= hb // 2
        if paced:
            offset = r.dev_ms - r.recv_ms
            if len(offsets) >= 3 and abs(offset - median(offsets)) > CLOCK_TOLERANCE_MS:
                clock_suspects.append(r)
                if len(clock_suspects) >= CLOCK_CONFIRM:
                    first = clock_suspects[0]
                    step = (first.dev_ms - first.recv_ms) - int(median(offsets))
                    alarms.append(Alarm(device.id, "clock_step", first.recv_ms, r.recv_ms, r.recv_ms,
                                        {"step_ms": step}))
                    offsets.clear()
                    offsets.extend(s.dev_ms - s.recv_ms for s in clock_suspects)
                    clock_suspects = []
            else:
                clock_suspects = []
                offsets.append(offset)

        # frozen reading
        if device.value_varies:
            if same_run and r.value == same_run[0].value and r.boot == same_run[0].boot:
                same_run.append(r)
            else:
                if stuck is not None:
                    stuck.cleared_ms = r.recv_ms
                    stuck.evidence["identical_readings"] = len(same_run)
                    alarms.append(stuck)
                    stuck = None
                same_run = [r]
            if stuck is None and len(same_run) == STUCK_RUN:
                stuck = Alarm(device.id, "frozen_reading", same_run[0].recv_ms, r.recv_ms)
        prev = r

    assert prev is not None
    open_alarms = [a for a in (silent, loss, stuck) if a is not None]
    if as_of - prev.recv_ms > silence and silent is None:
        open_alarms.append(Alarm(device.id, "silent", prev.recv_ms + hb, prev.recv_ms + silence))
    for a in open_alarms:
        if a.raised_ms <= as_of:
            a.evidence["open"] = True
            alarms.append(a)
    return alarms, "HEALTHY" if not any(a.evidence.get("open") for a in alarms) else "ALARM"


def _classify_silence(alarm: Alarm, before: Receipt, after: Receipt) -> None:
    """Name the cause of a closed silence from what arrived after it."""
    if after.boot != before.boot:
        alarm.cause = "power_loss_reboot"
        alarm.evidence = {"boot_before": before.boot, "boot_after": after.boot, "seq_after": after.seq}
    elif after.seq == before.seq + 1:
        alarm.cause = "link_buffered"
        alarm.evidence = {"seq_gap": 0, "late_by_ms": after.recv_ms - after.dev_ms}
    else:
        alarm.cause = "link_lost"
        alarm.evidence = {"seq_gap": after.seq - before.seq - 1}


def baseline(inventory: Inventory, receipts: list[Receipt], as_of_ms: int,
             heartbeats: int = 2) -> dict[str, Any]:
    """Naive last-seen monitor: device timestamp vs an N-heartbeat threshold, no cause, no hysteresis."""
    grouped, ignored = _by_device(inventory, receipts)
    alarms: list[Alarm] = []
    states: dict[str, str] = {}
    for device in inventory.devices:
        rows = grouped[device.id]
        limit = heartbeats * device.heartbeat_ms
        if not rows:
            states[device.id] = "UNKNOWN"
            continue
        open_alarm: Alarm | None = None
        last_dev = rows[0].dev_ms
        for r in rows[1:]:
            # a last-seen dashboard: offline while now - newest device timestamp > limit
            if open_alarm is None and r.recv_ms - last_dev > limit:
                open_alarm = Alarm(device.id, "offline", last_dev, last_dev + limit)
            last_dev = max(last_dev, r.dev_ms)
            if open_alarm is not None and r.recv_ms - last_dev <= limit:
                open_alarm.cleared_ms = r.recv_ms
                alarms.append(open_alarm)
                open_alarm = None
        state = "HEALTHY"
        if open_alarm is None and as_of_ms - last_dev > limit:
            open_alarm = Alarm(device.id, "offline", last_dev, last_dev + limit)
        if open_alarm is not None:
            open_alarm.evidence["open"] = True
            alarms.append(open_alarm)
            state = "ALARM"
        states[device.id] = state
    alarms.sort(key=lambda a: (a.raised_ms, a.device))
    return _report(f"naive_last_seen_{heartbeats}hb", inventory, alarms, states, ignored, as_of_ms)
