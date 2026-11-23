# Archymedes Sitewatch

Offline diagnosis of site-sensor faults from heartbeat telemetry. Given receive
time, sequence number, boot id, device clock and reading per message, Sitewatch
names what went wrong — link lost, link buffered (store-and-forward), power loss
and reboot, intermittent loss, device clock step, frozen reading — with the evidence,
and says when a device is silent or was never seen.

**Status: research prototype, v0.1.0a1 (2026-11-18). Synthetic validation only.**
The traces come from our own generator, written by the same author as the
diagnoser, so these results show internal consistency, not field accuracy. No real
device, vendor API or customer site has been used. Design and invariants: DESIGN.md.

## Run

Python 3.12+, no third-party dependencies. From this directory:

```bash
python3 -m sitewatch generate --seed 7 --out /path/to/new-dir          # inventory, telemetry, separate truth
python3 -m sitewatch diagnose --inventory DIR/inventory.json --telemetry DIR/telemetry.jsonl > report.json
python3 -m sitewatch diagnose ... --engine naive --naive-heartbeats 3   # baseline for comparison
python3 -m sitewatch score --inventory DIR/inventory.json --report report.json --truth DIR/truth.json
```

`diagnose` exits 0 when all devices are healthy, 1 on any alarm or unknown device, 2 on
invalid/unreadable input (with `input_complete: false`), and 130 if interrupted.
It never reads ground truth, and refuses a `--truth` argument.
`generate` refuses to write into an existing directory.

## Measured results (scripts/dev/evaluation.json, 50 seeds × 9 labelled faults)

| Engine | Cause named correctly | Any overlapping alarm | False alarms | False alarms excluding hard case |
|---|---:|---:|---:|---:|
| Sitewatch | 450/450 | 450/450 | 550 | 0 |
| Naive last-seen, 2 heartbeats | 0/450 | 314/450 | 2,215 | 2,215 |
| Naive last-seen, 3 heartbeats | 0/450 | 300/450 | 10 | 10 |

- The naive monitor cannot name causes; a forward-stepped device clock hides real
  outages from it, and a backward step shows a healthy device as offline.
- **Hard case kept in the set:** an integer-resolution humidity sensor is legitimately
  flat for minutes, so the frozen-reading rule fires about 11 times per 6-hour run. Per-device
  calibration (or `value_varies: false`, which also disables the check) is required.
- Sitewatch clears alarms only after three contiguous receipts, so it reports recovery
  about 20 s later than the naive monitor; frozen readings take 30 readings (5 min at 10 s).
- Cost of the real CLI: 6 h / 10 devices / 2.2 MB in 0.55 s CPU, 49 MB RSS;
  48 h / 17.8 MB in 1.7 s CPU, 147 MB RSS (whole file in memory; stream it before larger inputs).

Validation: `python3 -m unittest discover -s tests` (17 tests: truth isolation,
silence/unknown states, recovery hysteresis, reboot, clock steps both ways, buffered
bursts, 20-seed clean control, determinism, input refusal, interruption) and
`scripts/dev/static_gate.sh` (ruff, strict mypy).

## Not yet true

- No real device traces. The next step is to replay one real device family with logged faults.
- No vendor adapter (Axis/Milesight access is unconfirmed; no API formats are assumed).
- Thresholds are fixed constants, not calibrated per device family.
- Hashes and fields are caller-supplied; this is not tamper-evident telemetry.
