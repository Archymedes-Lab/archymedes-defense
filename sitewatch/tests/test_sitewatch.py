from __future__ import annotations

import ast
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from sitewatch import __main__ as cli
from sitewatch.diagnose import baseline, diagnose
from sitewatch.generate import EPOCH_MS, DeviceSpec, generate, write_jsonl
from sitewatch.models import InputError, parse_inventory, parse_telemetry
from sitewatch.score import EXPECTED_CAUSE, score

PACKAGE = Path(__file__).resolve().parents[1] / "sitewatch"
HB = 10_000


def run_case(seed: int, site: tuple[DeviceSpec, ...] | None = None, hours: int = 6):
    inventory, receipts, truth = generate(seed, hours, site)
    inv = parse_inventory(json.dumps(inventory).encode())
    rows = parse_telemetry(write_jsonl(receipts))
    return inv, rows, [e.as_dict() for e in truth]


def receipts(device: str, times: list[int], seqs: list[int] | None = None, boot: str = "b0",
             value=None, clock: int = 0):
    seqs = seqs if seqs is not None else list(range(len(times)))
    return parse_telemetry(write_jsonl([
        {"device": device, "recv_ms": EPOCH_MS + t, "seq": s, "boot": boot, "dev_ms": EPOCH_MS + t + clock,
         "value": (value if value is not None else 20.0 + (i % 7) * 0.1)} for i, (t, s) in enumerate(zip(times, seqs, strict=True))]))


def inventory(*ids: str, hours: int = 1, varies: bool = True):
    return parse_inventory(json.dumps({"window": {"start_ms": EPOCH_MS, "end_ms": EPOCH_MS + hours * 3_600_000},
                                       "devices": [{"id": i, "heartbeat_ms": HB, "value_varies": varies}
                                                   for i in ids]}).encode())


def call(argv: list[str]) -> tuple[int, dict]:
    out = io.StringIO()
    with redirect_stdout(out):
        code = cli.main(argv)
    return code, json.loads(out.getvalue())


class TruthIsolation(unittest.TestCase):
    def test_diagnoser_modules_never_import_truth_or_generator(self):
        for name in ("diagnose.py", "models.py"):
            tree = ast.parse((PACKAGE / name).read_text())
            imported = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
            self.assertFalse(imported & {"score", "generate"}, name)

    def test_diagnose_cli_refuses_a_truth_argument(self):
        code, out = call(["diagnose", "--inventory", "x", "--telemetry", "y", "--truth", "z"])
        self.assertEqual((code, out["error"]), (2, "ARGUMENTS_INVALID"))


class Classification(unittest.TestCase):
    def test_every_fault_kind_is_named_across_seeds(self):
        for seed in (1, 7, 42, 1234):
            inv, rows, truth = run_case(seed)
            result = score(inv, diagnose(inv, rows, inv.window_end_ms), truth)
            missed = [r for r in result["per_episode"] if not r["classified"]]
            self.assertEqual(missed, [], f"seed {seed}")
            self.assertEqual({r["kind"] for r in result["per_episode"]} - set(EXPECTED_CAUSE), set())

    def test_clean_control_raises_nothing_across_seeds(self):
        for seed in range(20):
            inv, rows, _ = run_case(seed)
            report = diagnose(inv, rows, inv.window_end_ms)
            self.assertEqual([a for a in report["alarms"] if a["device"] == "env-01"], [], f"seed {seed}")

    def test_hard_case_is_reported_not_hidden(self):
        inv, rows, truth = run_case(7)
        result = score(inv, diagnose(inv, rows, inv.window_end_ms), truth)
        self.assertGreater(result["false_alarms"], 0)
        self.assertEqual(result["false_alarm_causes"], ["frozen_reading"])

    def test_forward_clock_step_hides_outage_from_naive_but_not_sitewatch(self):
        inv, rows, truth = run_case(7)
        def env08_outage(report):
            result = score(inv, report, truth)
            return next(r for r in result["per_episode"] if r["device"] == "env-08" and r["kind"] == "outage_lost")
        self.assertTrue(env08_outage(diagnose(inv, rows, inv.window_end_ms))["classified"])
        self.assertFalse(env08_outage(baseline(inv, rows, inv.window_end_ms, 3))["alarm_overlap"])

    def test_buffered_burst_is_not_a_clock_step(self):
        inv, rows, _ = run_case(3)
        report = diagnose(inv, rows, inv.window_end_ms)
        self.assertNotIn("clock_step", {a["cause"] for a in report["alarms"] if a["device"] == "env-03"})


class SilenceAndRecovery(unittest.TestCase):
    def test_never_seen_device_is_unknown_not_healthy(self):
        report = diagnose(inventory("a", "b"), receipts("a", [i * HB for i in range(360)]), EPOCH_MS + 3_600_000)
        self.assertEqual(report["device_states"]["b"], "UNKNOWN")
        self.assertIn("never_seen", {a["cause"] for a in report["alarms"]})
        self.assertNotEqual(report["status"], "HEALTHY")

    def test_all_devices_unseen_is_unknown(self):
        report = diagnose(inventory("a"), [], EPOCH_MS + 3_600_000)
        self.assertEqual(report["status"], "UNKNOWN")

    def test_trailing_silence_is_an_open_alarm(self):
        report = diagnose(inventory("a"), receipts("a", [i * HB for i in range(100)]), EPOCH_MS + 3_600_000)
        self.assertEqual(report["device_states"]["a"], "ALARM")
        self.assertTrue(report["alarms"][-1]["evidence"]["open"])

    def test_one_packet_does_not_clear_a_silence(self):
        times = [i * HB for i in range(20)] + [600_000] + [1_200_000 + i * HB for i in range(2)]
        seqs = list(range(20)) + [60] + [120, 121]
        report = diagnose(inventory("a"), receipts("a", times, seqs), EPOCH_MS + 1_230_000)
        silent = [a for a in report["alarms"] if a["cause"] in ("silent", "link_lost")]
        self.assertEqual(len(silent), 1)
        self.assertIsNone(silent[0]["cleared_ms"])
        self.assertEqual(report["device_states"]["a"], "ALARM")

    def test_reboot_sequence_reset_is_power_loss_not_packet_loss(self):
        a = receipts("a", [i * HB for i in range(30)], boot="b0")
        b = receipts("a", [400_000 + i * HB for i in range(30)], boot="b1")
        report = diagnose(inventory("a"), a + b, EPOCH_MS + 700_000)
        self.assertEqual([x["cause"] for x in report["alarms"]], ["power_loss_reboot"])

    def test_backward_clock_step_does_not_fake_an_outage(self):
        a = receipts("a", [i * HB for i in range(30)])
        b = receipts("a", [300_000 + i * HB for i in range(30)], list(range(30, 60)), clock=-900_000)
        report = diagnose(inventory("a"), a + b, EPOCH_MS + 600_000)
        self.assertEqual([x["cause"] for x in report["alarms"]], ["clock_step"])
        naive = baseline(inventory("a"), a + b, EPOCH_MS + 600_000, 3)
        self.assertTrue(naive["alarms"], "naive monitor shows the device offline after a backward step")


class DeterminismAndInputs(unittest.TestCase):
    def test_same_seed_same_bytes_and_report(self):
        one, two = generate(9), generate(9)
        self.assertEqual(write_jsonl(one[1]), write_jsonl(two[1]))
        inv, rows, _ = run_case(9)
        self.assertEqual(json.dumps(diagnose(inv, rows, inv.window_end_ms), sort_keys=True),
                         json.dumps(diagnose(inv, list(reversed(rows)), inv.window_end_ms), sort_keys=True))

    def test_rejects_bad_values(self):
        bad = [b'{"device":"a","recv_ms":1,"seq":true,"boot":"b","dev_ms":1,"value":1}',
               b'{"device":"a","recv_ms":1,"seq":1,"boot":"b","dev_ms":1,"value":NaN}',
               b'{"device":"../x","recv_ms":1,"seq":1,"boot":"b","dev_ms":1,"value":1}',
               b'{"device":"a","recv_ms":-1,"seq":1,"boot":"b","dev_ms":1,"value":1}']
        for line in bad:
            with self.assertRaises(InputError) as ctx:
                parse_telemetry(b"\n" + line + b"\n")
            self.assertEqual(ctx.exception.line, 2)

    def test_cli_refuses_symlink_oversize_and_existing_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            code, _ = call(["generate", "--seed", "1", "--hours", "1", "--out", str(root / "run")])
            self.assertEqual(code, 0)
            code, out = call(["generate", "--seed", "1", "--hours", "1", "--out", str(root / "run")])
            self.assertEqual(out["error"], "OUTPUT_EXISTS")
            os.symlink(root / "run" / "telemetry.jsonl", root / "link.jsonl")
            code, out = call(["diagnose", "--inventory", str(root / "run" / "inventory.json"),
                              "--telemetry", str(root / "link.jsonl")])
            self.assertEqual((code, out["error"]), (2, "INPUT_NOT_REGULAR"))
            with mock.patch("sitewatch.__main__.MAX_TELEMETRY_BYTES", 10):
                code, out = call(["diagnose", "--inventory", str(root / "run" / "inventory.json"),
                                  "--telemetry", str(root / "run" / "telemetry.jsonl")])
            self.assertEqual(out["error"], "INPUT_BYTE_LIMIT")

    def test_cli_end_to_end_and_interrupt(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = Path(tmp) / "run"
            call(["generate", "--seed", "2", "--hours", "2", "--out", str(run)])
            report = Path(tmp) / "report.json"
            code, out = call(["diagnose", "--inventory", str(run / "inventory.json"),
                              "--telemetry", str(run / "telemetry.jsonl")])
            self.assertEqual((code, out["status"]), (1, "ALARM"))
            report.write_text(json.dumps(out))
            code, scored = call(["score", "--inventory", str(run / "inventory.json"), "--report", str(report),
                                 "--truth", str(run / "truth.json")])
            self.assertEqual(code, 0)
            self.assertEqual(scored["classified"], scored["episodes"])
            with mock.patch("sitewatch.__main__.run", side_effect=KeyboardInterrupt):
                code, out = call(["diagnose"])
            self.assertEqual((code, out["error"]), (130, "INTERRUPTED"))


if __name__ == "__main__":
    unittest.main()
