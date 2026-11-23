# Sitewatch — fault/recovery diagnosis prototype (design)

Date: 2026-11-18. Status: research prototype, synthetic traces only.

## Question this answers

Given heartbeat telemetry from site sensors (receive time, sequence number, boot id,
device clock, reading), can a deterministic diagnoser tell an operator *what kind*
of failure happened (lost link, buffered link, power loss/reboot, intermittent loss,
device clock step, frozen reading) faster and with fewer false alarms than a naive
"last seen" monitor — and does it say so honestly when it cannot?

## Invariants

1. **Ground truth isolation.** The diagnoser never reads fault labels. Truth is a
   separate file consumed only by the scorer. A test enforces the CLI cannot take it.
2. **Silence is never health.** No receipt for longer than the silence bound is an
   alarm; an unobserved device is UNKNOWN, never HEALTHY.
3. **Freshness uses receive time.** Device clocks are evidence to check, not a clock
   to trust; a stepped device clock cannot hide or fabricate an outage.
4. **Recovery needs evidence.** An alarm clears only after a run of contiguous,
   normal-cadence receipts (hysteresis), not after one packet.
5. **Determinism.** Same seed and parameters produce byte-identical traces; same
   inputs produce byte-identical reports.
6. **Bounded resources.** Byte, line and record limits; single pass per device;
   regular-file snapshot reads (no symlinks/devices), no network, no retries.
7. **Honest scoring.** Detection, classification, false alarms, duplicate alarms and
   recovery latency are reported separately; hard cases that produce false alarms
   stay in the demo set.

## Alternatives compared

| Design | Pros | Cons | Verdict |
|---|---|---|---|
| A. Rule-based state machine on receive time + sequence + boot id + value runs | Explainable evidence per alarm; no training data; deterministic | Thresholds need site calibration; synthetic validation is partly circular | **Selected** |
| B. Naive last-seen threshold on device time | Simple; what a basic dashboard shows | No cause; clock steps hide/fake outages; flaps on single packets | Kept as the **baseline** |
| C. Learned anomaly detector | Could adapt to real sites | No labelled real data; training on our own synthetic faults is circular | Rejected until real confirmed outcomes exist |

Reconsider A if real device traces show causes that sequence/boot/value evidence
cannot separate, or thresholds cannot be calibrated per device family.

## Known limits

- Synthetic traces from our own generator: the diagnoser and generator share an
  author's model of failures. Results show internal consistency, not field accuracy.
- Frozen-reading detection cannot distinguish a legitimately stable reading from a
  stuck sensor without per-device configuration (demo includes this hard case).
- No real device adapter yet; Axis/Milesight access is unconfirmed.
