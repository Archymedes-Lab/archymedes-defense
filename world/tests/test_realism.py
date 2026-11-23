"""Realism and statistics fixes from the 2026-11-23 assessment, written before the code.

1. Cameras: detection depends on pixel density (IEC 62676-4), not on a fixed 200 m range.
2. Scoring: "seen before the fence" is true when the person was detected and never reached the fence first.
   Intrusions start at a seeded time across equipment duty cycles, the same for every variant of a seed.
3. Statistics: exact intervals, a paired test, and ties stated when options cannot be told apart.
"""
from __future__ import annotations

import math
from types import SimpleNamespace

import numpy as np
import pytest
from test_ops import site  # noqa: F401  (module fixture)

from archworld.sim import compound, drill, scope, stats
from archworld.sim.drill import SCORERS
from archworld.sim.ops import OpsSim

# ---------------------------------------------------------------- 1. camera model


def test_pixel_density_falls_with_distance_and_matches_the_formula():
    sen = scope.sensor_for("mast", ["camera"])
    assert sen.camera is not None and sen.camera.h_px == 1920 and sen.fov_deg == 90.0
    prev = math.inf
    for r in (1.0, 5.0, 20.0, 38.0, 80.0, 200.0):
        q = scope.ppm(sen, r)
        assert q < prev
        prev = q
        assert q == pytest.approx(1920 / (2 * r * math.tan(math.radians(45))))


def test_no_detection_below_the_iec_detect_density():
    for payloads in (["camera"], ["camera_4k"]):
        sen = scope.sensor_for("mast", payloads)
        edge = scope.camera_range_m(sen)
        assert scope.ppm(sen, edge) == pytest.approx(scope.DETECT_PPM)
        assert sen.range_m == pytest.approx(edge, abs=0.1)
        assert scope.p_notice(sen, edge * 1.01) == 0.0
        assert scope.p_notice(sen, edge * 0.5) > 0.0
        assert scope.p_notice(sen, 1.0) == pytest.approx(sen.p0)


def test_a_1080p_camera_cannot_detect_a_person_at_200_m_and_4k_doubles_the_range():
    hd, uhd = scope.sensor_for("mast", ["camera"]), scope.sensor_for("mast", ["camera_4k"])
    assert scope.p_notice(hd, 200.0) == 0.0
    assert scope.camera_range_m(hd) == pytest.approx(38.4, abs=0.1)
    assert scope.camera_range_m(uhd) == pytest.approx(2 * scope.camera_range_m(hd))
    for r in (5.0, 20.0, 35.0, 60.0):
        assert scope.p_notice(uhd, r) >= scope.p_notice(hd, r)


def test_chance_of_noticing_never_rises_with_distance():
    for payloads in (["camera"], ["camera_4k"]):
        sen = scope.sensor_for("mast", payloads)
        ps = [scope.p_notice(sen, r) for r in np.linspace(0.5, 120, 400)]
        assert all(a >= b for a, b in zip(ps, ps[1:], strict=False))


def test_other_sensors_keep_their_declared_model():
    for k in ("guard", "dog", "vehicle", "drone"):
        sen = scope.sensor_for(k, ["camera"])
        assert sen is scope.KINDS[k].sensor and sen.camera is None
        assert scope.p_notice(sen, sen.range_m / 2) == pytest.approx(sen.p0 * 0.75)


def test_4k_is_an_allowed_payload_and_unknown_ones_are_still_refused():
    scope.validate_agent({"id": "m", "kind": "mast", "home": [0, 0], "payloads": ["camera_4k"]})
    with pytest.raises(scope.ScopeError):
        scope.validate_agent({"id": "m", "kind": "mast", "home": [0, 0], "payloads": ["laser_designator"]})


def test_coverage_never_rises_when_resolution_drops(site):  # noqa: F811
    from archworld.sim.coverage import analyse
    world, lay, _, _, _ = site
    masts = [a for a in compound.staff(world, lay) if a["kind"] == "mast"]
    hd = analyse(world, lay, masts)
    uhd = analyse(world, lay, [{**m, "payloads": ["camera_4k"]} for m in masts])
    assert uhd["fence"]["seen_share"] >= hd["fence"]["seen_share"]
    assert uhd["yard"]["seen_share"] >= hd["yard"]["seen_share"]


def test_every_mast_detection_is_within_the_cameras_detect_range(site):  # noqa: F811
    world, lay, crew, workers, ops = site
    d = ops["fence-to-door-drone-down"]
    for seed in range(6):
        r = OpsSim(world, crew + workers, seed=seed, drill=d).run(d["events"][-1]["t_ms"] + 900_000)
        for e in r.log:
            if e["type"] == "detected" and e["cause"]["observer"].startswith("mast"):
                assert e["cause"]["range_m"] <= scope.camera_range_m(scope.sensor_for("mast", ["camera"])) + 0.1


# ---------------------------------------------------------------- 2. scoring and intrusion time


def _log(**events):
    return SimpleNamespace(log=[{"type": k, "t": t, **extra} for k, (t, extra) in events.items()])


DRILL = {"events": [{"type": "appear", "agent": {"id": "s"}}]}


def test_met_before_the_fence_counts_as_seen_before_the_fence():
    r = _log(appear=(0, {"agent": "s"}), detected=(68_000, {"subject": "s"}), contact=(200_000, {"subject": "s"}))
    assert SCORERS["timeline"](r, DRILL)["detected_before_fence"] is True


def test_detection_after_the_fence_is_not_seen_before_it():
    r = _log(appear=(0, {"agent": "s"}), at_barrier=(300_000, {"agent": "s"}), detected=(320_000, {"subject": "s"}))
    assert SCORERS["timeline"](r, DRILL)["detected_before_fence"] is False


def test_never_detected_is_never_seen_before_the_fence():
    r = _log(appear=(0, {"agent": "s"}), at_barrier=(300_000, {"agent": "s"}))
    assert SCORERS["timeline"](r, DRILL)["detected_before_fence"] is False


def test_the_flag_agrees_with_detection_and_fence_times_in_real_runs(site):  # noqa: F811
    world, lay, crew, workers, ops = site
    d = ops["fence-to-door"]
    for seed in range(8):
        r = OpsSim(world, crew + workers, seed=seed, drill=d).run(d["events"][-1]["t_ms"] + 900_000)
        s = SCORERS["timeline"](r, d)
        det = next((e["t"] for e in r.log if e["type"] == "detected"), None)
        fence = next((e["t"] for e in r.log if e["type"] == "at_barrier"), None)
        assert s["detected_before_fence"] == (det is not None and (fence is None or det < fence))


def test_intrusion_time_is_seeded_inside_the_window_and_spread_out():
    lo, hi = drill.WARMUP_MS, drill.WARMUP_MS + drill.WINDOW_MS
    ts = [drill.intrusion_ms(k) for k in range(200)]
    assert ts == [drill.intrusion_ms(k) for k in range(200)]
    assert all(lo <= t < hi for t in ts)
    assert drill.WINDOW_MS >= 8 * 3_600_000  # covers the vehicle's ~7.7 h duty cycle
    deciles = np.histogram(ts, bins=10, range=(lo, hi))[0]
    assert deciles.min() >= 8  # roughly uniform, no empty stretch


def test_moving_an_intrusion_keeps_faults_and_shifts_what_follows_it(site):  # noqa: F811
    world, lay, *_ = site
    d = compound.timeline_drill(world, lay, "x", "x", faulted="drone-1", alarm_policy="all_respond",
                                appear_ms=30_000, start_m=140.0)
    t = 5 * 3_600_000
    m = drill.at_time(d, t)
    old = {e["type"]: e["t_ms"] for e in d["events"]}
    new = {e["type"]: e["t_ms"] for e in m["events"]}
    assert new["sensor_fault"] == old["sensor_fault"] == 0
    assert new["appear"] == t
    assert new["alarm"] - new["appear"] == old["alarm"] - old["appear"]
    assert [e["t_ms"] for e in m["events"]] == sorted(e["t_ms"] for e in m["events"])
    assert d["events"][-1]["t_ms"] != t  # the original drill is not changed


def test_late_intrusions_meet_equipment_in_every_state(site):  # noqa: F811
    """Across seeded start times the drone is sometimes on its charger: drills no longer assume it is flying."""
    world, lay, crew, workers, ops = site
    d = ops["fence-to-door"]
    charging = []
    for seed in range(12):
        t = drill.intrusion_ms(seed)
        r = OpsSim(world, crew + workers, seed=seed, drill=drill.at_time(d, t)).run(t + 60_000)
        on = [e for e in r.log if e["type"] in ("charge_start", "charge_done") and e.get("agent") == "drone-1"
              and e["t"] <= t]
        charging.append(bool(on) and on[-1]["type"] == "charge_start")
    assert 0 < sum(charging) < len(charging)


# ---------------------------------------------------------------- 3. statistics


def test_clopper_pearson_known_values():
    lo, hi = stats.clopper_pearson(40, 40)
    assert hi == 1.0 and lo == pytest.approx(0.025 ** (1 / 40), abs=1e-6)
    lo, hi = stats.clopper_pearson(0, 10)
    assert lo == 0.0 and hi == pytest.approx(1 - 0.025 ** (1 / 10), abs=1e-6)
    lo, hi = stats.clopper_pearson(31, 40)
    assert 0.60 < lo < 0.63 and 0.88 < hi < 0.90


def test_interval_always_contains_the_point_estimate():
    for n in (1, 7, 40, 200):
        for k in range(n + 1):
            lo, hi = stats.clopper_pearson(k, n)
            assert 0.0 <= lo <= k / n <= hi <= 1.0


def test_exact_mcnemar():
    a = [True] * 31 + [False] * 9
    b = [True] * 40
    assert stats.mcnemar(a, b) == pytest.approx(2 * 0.5 ** 9)
    assert stats.mcnemar(b, b) == 1.0
    with pytest.raises(ValueError):
        stats.mcnemar(a, b[:-1])  # paired runs only


def test_options_that_cannot_be_told_apart_are_labelled_tied():
    runs = {"a": [True] * 40, "b": [True] * 39 + [False], "c": [True] * 25 + [False] * 15}
    groups = stats.tie_groups(runs)
    assert groups["a"] == groups["b"]
    assert groups["c"] != groups["a"]
