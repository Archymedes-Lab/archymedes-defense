"""Invariants of the further site operations (ops.py): protection timeline, alarms, gate, evacuation.

Same synthetic fixture as test_sim.py, with the small compound placed in it.
"""

from __future__ import annotations

import numpy as np
import pytest
from test_sim import BUILDINGS, ROADS, W, _samples

from archworld.sim import compound, scope
from archworld.sim.drill import SCORERS, score, summarise
from archworld.sim.engine import Sim
from archworld.sim.ops import ASSESS_MS, OpsSim


@pytest.fixture(scope="module")
def site():
    world, lay, _ = compound.with_compound(W, BUILDINGS, ROADS, w=120.0, h=90.0, margin=100.0, step=5.0)
    ops = {d["id"]: d for d in compound.operations(world, lay, appear_ms=30_000, start_m=140.0)}
    return world, lay, compound.staff(world, lay), compound.workers(lay), ops


def _with(drill: dict, **changes) -> dict:
    return {**drill, **changes}


def _types(r, *names):
    return [e for e in r.log if e["type"] in names]


# ---------------------------------------------------------------- scope

def test_new_kinds_and_events_stay_in_scope(site):
    world, lay, staff, workers, ops = site
    assert scope.KINDS["worker"].sensor is None and scope.KINDS["truck"].sensor is None
    assert not scope.KINDS["worker"].responder and not scope.KINDS["truck"].responder
    appear = ops["fence-to-door"]["events"][0]
    bad_step = _with(ops["fence-to-door"], events=[{**appear, "then": [{"do": "shoot"}]}])
    with pytest.raises(scope.ScopeError):
        OpsSim(world, [], seed=1, drill=bad_step).run(2_000_000)
    truck = {"t_ms": 0, "type": "arrive_vehicle", "from": lay["link"][0], "booking": "valid",
             "agent": {"id": "t1", "kind": "truck", "role": "staff"}}
    with pytest.raises(scope.ScopeError):
        OpsSim(world, staff, seed=1, drill=_with(ops["gate-two-hours"], events=[truck])).run(10_000)
    with pytest.raises(scope.ScopeError):
        OpsSim(world, staff, seed=1, drill=_with(ops["evacuation"], events=[{"t_ms": 0, "type": "detonate"}])).run(10)


def test_the_operations_layer_changes_nothing_in_the_earlier_drills(site):
    world, lay, staff, _, _ = site
    d = compound.drills(world, lay, appear_ms=60_000, start_m=140.0)[0]
    a = Sim(world, staff, seed=4, drill=d).run(900_000)
    b = OpsSim(world, staff, seed=4, drill=d).run(900_000)
    assert a.digest == b.digest


# ---------------------------------------------------------------- protection timeline

def test_unopposed_subject_completes_the_task_after_both_delays(site):
    world, lay, _, _, ops = site
    d = _with(ops["fence-to-door"], fence={"pd": 1.0})
    r = OpsSim(world, [], seed=1, drill=d).run(3_600_000)
    s = SCORERS["timeline"](r, d)
    assert s["task_completed"] and not s["interrupted"] and s["fence_alarm"]
    barrier = _types(r, "at_barrier")[0]["t"]
    door = _types(r, "at_door")[0]["t"]
    done = _types(r, "task_complete")[0]["t"]
    assert door - barrier >= compound.FENCE_DELAY_MS and done - door == compound.DOOR_DELAY_MS
    assert _types(r, "alarm")[0]["t"] == barrier and _types(r, "alarm")[0]["cause"] == "person"
    ts, p = _samples(r, "subject-1", 250)
    step = np.linalg.norm(np.diff(p[:, :2], axis=0), axis=1)
    assert (step <= scope.KINDS["person"].vmax * 0.25 + 1e-6).all()  # the fence is crossed slowly, not jumped
    assert (p[:, 2] >= world.ground(p[:, 0], p[:, 1]) - 1e-6).all()
    assert not world.inside_building(p[:, 0], p[:, 1]).any()
    assert world.side_of(p[0, :2]) == -1 and world.side_of(p[-1, :2]) == 0  # outside before, inside after


def test_fence_sensor_alarm_follows_its_detection_probability(site):
    world, lay, _, _, ops = site
    quiet = OpsSim(world, [], seed=1, drill=_with(ops["fence-to-door"], fence={"pd": 0.0})).run(3_600_000)
    assert not _types(quiet, "alarm") and SCORERS["timeline"](quiet, ops["fence-to-door"])["fence_alarm"] is False
    hits = sum(bool(_types(OpsSim(world, [], seed=k, drill=_with(ops["fence-to-door"], fence={"pd": 0.5})).run(
        3_600_000), "alarm")) for k in range(40))
    assert 10 <= hits <= 30  # about half of 40 seeds


def test_a_camera_that_covers_the_alarm_point_assesses_it(site):
    world, lay, _, _, ops = site
    d = _with(ops["fence-to-door"], fence={"pd": 1.0})
    at = d["events"][0]["goto"]  # where the subject reaches the fence
    looking_at_it = {"id": "mast-x", "kind": "mast", "home": [at[0] - 30.0, at[1]], "facing_deg": 90.0}
    looking_away = {**looking_at_it, "facing_deg": 270.0}
    r = OpsSim(world, [looking_at_it], seed=1, drill=d).run(3_600_000)
    alarm = _types(r, "alarm")[0]
    # 20 s after the alarm the operator has looked: a report from that camera, whoever saw the person first
    assert any(e["by"] == "mast-x" and e["t"] == alarm["t"] + ASSESS_MS for e in _types(r, "report"))
    assert _types(r, "detected") and _types(r, "detected")[0]["t"] <= alarm["t"] + ASSESS_MS
    blind = OpsSim(world, [looking_away], seed=1, drill=d).run(3_600_000)
    assert not any(e["t"] == _types(blind, "alarm")[0]["t"] + ASSESS_MS for e in _types(blind, "report"))


def test_response_meets_the_subject_before_the_task_is_done(site):
    world, lay, staff, _, ops = site
    d = ops["fence-to-door"]
    runs = [OpsSim(world, staff, seed=k, drill=d, detect="sure").run(3_600_000) for k in range(6)]
    rows = [SCORERS["timeline"](r, d) for r in runs]
    assert all(r["interrupted"] and not r["task_completed"] for r in rows)
    assert summarise(rows)["interrupted"] == 6


# ---------------------------------------------------------------- alarms

def test_a_verified_nuisance_alarm_does_not_move_the_guards(site):
    world, lay, staff, _, ops = site
    d = ops["nuisance-alarm-verify-first"]
    r = OpsSim(world, staff, seed=2, drill=d).run(1_500_000)
    base = OpsSim(world, staff, seed=2).run(1_500_000)
    for g in ("guard-1", "guard-2"):
        assert [e for e in r.log if e.get("agent") == g] == [e for e in base.log if e.get("agent") == g]
    s = SCORERS["alarm"](r, d)
    assert s["cleared_by"] in ("drone-1", "dog-1") and s["cleared_after_s"] > 0 and s["guards_sent"] == 0
    sent = _types(r, "verify_sent")[0]
    assert sent["t"] == _types(r, "alarm")[0]["t"] and _types(r, "alarm")[0]["cause"] == "nuisance"
    # the verifier goes back to its patrol afterwards
    assert any(e["type"] == "leg" and e["agent"] == sent["agent"] and e["purpose"] == "patrol"
               and e["t"] > _types(r, "cleared")[0]["t"] for e in r.log)


def test_without_verification_people_are_sent_to_every_alarm(site):
    world, lay, staff, _, ops = site
    d = ops["nuisance-alarm-all-respond"]
    r = OpsSim(world, staff, seed=2, drill=d).run(1_500_000)
    disp = _types(r, "dispatch")
    assert disp and any(r.agents[a]["kind"] == "guard" for a in disp[0]["agents"])
    assert not _types(r, "verify_sent")


def test_alarm_workload_over_days_is_lower_with_verification(site):
    world, lay, staff, _, _ = site
    out = {}
    for policy in ("verify_first", "all_respond"):
        d = compound.alarm_drill(lay, policy, seed=1, days=2.0, per_day=6.0)
        r = OpsSim(world, staff, seed=1, drill=d, keep_legs=False).run(2 * 86_400_000)
        out[policy] = SCORERS["alarms"](r, d)
        assert out[policy]["alarms"] == d["info"]["alarms"] > 5
    assert out["verify_first"]["guard_dispatches"] == 0 < out["all_respond"]["guard_dispatches"]
    assert out["verify_first"]["guard_hours_on_alarms"] < out["all_respond"]["guard_hours_on_alarms"]


# ---------------------------------------------------------------- gate

def _gate(site, procedure="paper", catch=None, seed=5, hours=3.0):
    world, lay, staff, _, _ = site
    d = compound.gate_drill(world, lay, procedure, seed=seed, hours=hours)
    if catch is not None:
        d = _with(d, gate={**d["gate"], "p_catch": {"paper": catch, "callback": catch}})
    return world, d, OpsSim(world, staff, seed=seed, drill=d).run(int(hours * 3_600_000))


def test_gate_checks_one_truck_at_a_time_in_arrival_order(site):
    world, d, r = _gate(site)
    queued = [e["agent"] for e in _types(r, "queued")]
    checks = _types(r, "gate_check")
    ends = _types(r, "admitted", "refused")
    assert len(checks) == len(ends) == d["info"]["trucks"] >= 4
    assert [e["agent"] for e in checks] == queued  # first come, first served
    for (c0, e0), c1 in zip(zip(checks, ends, strict=True), checks[1:], strict=False):
        assert c0["agent"] == e0["agent"] and e0["t"] <= c1["t"]  # the next check starts after this one ends
    assert all(e["waited_s"] >= 0 for e in checks)
    lo, hi = d["gate"]["check_ms"]
    assert all(lo / 1000 <= e["check_s"] <= hi / 1000 for e in ends)


def test_no_truck_is_inside_the_fence_before_it_is_admitted(site):
    world, d, r = _gate(site)
    admitted = {e["agent"]: e["t"] for e in _types(r, "admitted")}
    for e in _types(r, "truck_inbound"):
        ts, p = _samples(r, e["agent"], 1000)
        inside = np.array([world.side_of(q[:2]) == 0 for q in p])
        assert not inside[ts < admitted.get(e["agent"], 1 << 62)].any(), e["agent"]
        step = np.linalg.norm(np.diff(p[:, :2], axis=0), axis=1)
        assert (step <= scope.KINDS["truck"].vmax * 1.0 + 1e-6).all()


def test_a_fictitious_booking_is_stopped_or_counted_as_a_loss_never_dropped(site):
    for catch, want in ((1.0, "stopped"), (0.0, "lost")):
        world, d, r = _gate(site, catch=catch)
        s = SCORERS["gate"](r, d)
        fake = f"truck-{d['info']['fictitious']}"
        assert s["fictitious"] == want
        loaded = {e["agent"] for e in _types(r, "loaded")}
        assert (fake in loaded) == (want == "lost")
        assert len(_types(r, "departed")) == d["info"]["trucks"]  # every truck leaves again, whatever happened
    # all valid trucks are admitted under either procedure
    assert len(_types(r, "admitted")) == d["info"]["trucks"]


def test_call_back_checks_take_longer_and_lengthen_the_queue(site):
    _, dp, rp = _gate(site, "paper", seed=6, hours=5.0)
    _, dc, rc = _gate(site, "callback", seed=6, hours=5.0)
    paper, callback = SCORERS["gate"](rp, dp), SCORERS["gate"](rc, dc)
    assert paper["trucks"] == callback["trucks"]  # the same arrivals: only the procedure differs
    assert callback["mean_wait_s"] >= paper["mean_wait_s"]


# ---------------------------------------------------------------- evacuation

def test_everyone_reaches_the_muster_point_and_nobody_moves_early(site):
    world, lay, staff, workers, ops = site
    d = ops["evacuation"]
    r = OpsSim(world, staff + workers, seed=7, drill=d).run(1_500_000)
    s = SCORERS["evacuation"](r, d)
    assert s["all_mustered"] and s["mustered"] == 12 and s["last_s"] >= s["median_s"] > 0
    t0 = _types(r, "evacuation_start")[0]["t"]
    out = {e["agent"]: e["t"] for e in _types(r, "moving_out")}
    back = {e["agent"]: e["t"] for e in _types(r, "mustered")}
    muster = np.array(d["events"][0]["muster"])
    for wk in workers:
        aid = wk["id"]
        assert t0 < out[aid] < back[aid]
        assert np.array_equal(r.position(aid, t0), r.position(aid, 0))  # still at work until the alarm
        assert np.linalg.norm(r.position(aid, r.until)[:2] - muster) < 7.0
        _, p = _samples(r, aid, 500)
        assert not world.inside_building(p[:, 0], p[:, 1]).any() and world.side_of(p[-1, :2]) == 0
    indoor = [out[f"worker-{i}"] for i in range(7, 13)]
    outdoor = [out[f"worker-{i}"] for i in range(1, 7)]
    assert min(indoor) - t0 >= 10_000 and len(outdoor) == 6  # people indoors need at least the way out


def test_operations_replay_identically(site):
    world, lay, staff, workers, ops = site
    for did in ("fence-to-door-drone-down", "gate-two-hours", "evacuation"):
        a = OpsSim(world, staff + workers, seed=9, drill=ops[did]).run(2_400_000)
        b = OpsSim(world, staff + workers, seed=9, drill=ops[did]).run(2_400_000)
        assert a.digest == b.digest, did
    assert score  # the earlier scorer is still exported


def test_an_alarm_elsewhere_slows_the_response_only_when_people_are_sent_to_it(site):
    world, lay, staff, _, _ = site
    res = {}
    for policy in ("verify_first", "all_respond"):
        d = compound.timeline_drill(world, lay, "x", "x", faulted="drone-1", alarm_policy=policy, appear_ms=30_000,
                                    start_m=140.0)
        assert [e["type"] for e in d["events"]] == ["sensor_fault", "appear", "alarm"]
        r = OpsSim(world, staff, seed=3, drill=d, detect="sure").run(3_600_000)
        nuisance = [e for e in _types(r, "alarm") if e["cause"] == "nuisance"]
        assert len(nuisance) == 1
        res[policy] = r
    # a faulted drone is never chosen to look at an alarm
    assert all(e["agent"] != "drone-1" for e in _types(res["verify_first"], "verify_sent"))
    to_alarm = [e for e in _types(res["all_respond"], "dispatch") if e["subject"].startswith("alarm-")]
    sent_all = [a for e in to_alarm for a in e["agents"]]
    assert sent_all and not any(e["subject"].startswith("alarm-") for e in _types(res["verify_first"], "dispatch"))


def test_approach_bearing_can_be_fixed_and_an_unwalkable_one_is_refused(site):
    world, lay, _, _, _ = site
    seen = set()
    for brg in range(0, 360, 45):
        try:
            d = compound.timeline_drill(world, lay, "x", "x", bearing=brg, appear_ms=30_000, start_m=140.0)
        except RuntimeError:
            continue
        at = np.array(d["events"][-1]["at"]) - np.array(lay["centre"])
        assert abs((np.degrees(np.arctan2(at[0], at[1])) - brg + 180) % 360 - 180) < 1e-6
        seen.add(brg)
    assert len(seen) >= 2


def test_a_fence_alarm_is_checked_from_inside_the_yard(site):
    world, lay, staff, _, ops = site
    r = OpsSim(world, staff, seed=2, drill=ops["nuisance-alarm-verify-first"]).run(1_500_000)
    who = _types(r, "verify_sent")[0]["agent"]
    arrived = _types(r, "verify_arrived")[0]["t"]
    if scope.KINDS[r.agents[who]["kind"]].ground:
        assert world.side_of(r.position(who, arrived)[:2]) == 0
    _, p = _samples(r, "dog-1", 500)
    _, g = _samples(r, "guard-1", 500)
    for track in (p, g):  # nobody on foot leaves the yard for a fence alarm
        assert all(world.side_of(q[:2]) == 0 or float(world.enclosures[0].exterior.distance(
            compound.shapely.Point(q[:2]))) < 9.0 for q in track)
    sim = OpsSim(world, staff, seed=2, drill=ops["nuisance-alarm-verify-first"])
    at = ops["nuisance-alarm-verify-first"]["events"][0]["at"]
    inside = sim._check_point(tuple(at))
    assert world.side_of(inside) == 0
    assert np.hypot(inside[0] - at[0], inside[1] - at[1]) == pytest.approx(10.0, abs=0.01)
    far = (at[0] + 200.0, at[1] + 200.0)
    assert sim._check_point(far) == far  # not a fence alarm: checked where it is


# ---------------------------------------------------------------- camera coverage and measured improvements

def test_camera_coverage_counts_only_what_a_camera_can_see(site):
    import json

    from archworld.sim import coverage, measures
    world, lay, staff, _, _ = site
    v = measures.variants(lay, staff)
    masts = lambda vid: [a for a in v[vid]["staff"] if a["kind"] == "mast"]  # noqa: E731
    none = coverage.analyse(world, lay, [])
    assert none["fence"]["seen_share"] == 0 and none["yard"]["seen_share"] == 0
    assert none["fence"]["blind_m"] == pytest.approx(none["fence"]["length_m"], abs=0.5)
    out = coverage.analyse(world, lay, masts("baseline"))
    along = coverage.analyse(world, lay, masts("re-aimed-masts"))
    assert along["fence"]["seen_share"] > out["fence"]["seen_share"] + 0.2  # looking along the fence sees the fence
    # but no camera sees fence beyond its detect range: at most 2R of fence lies within R of each of the 4 masts
    reach = scope.camera_range_m(scope.sensor_for("mast", ["camera"]))
    assert along["fence"]["seen_share"] * along["fence"]["length_m"] <= 4 * 2 * reach + 1.0
    assert along["yard"]["seen_share"] > out["yard"]["seen_share"]
    for res in (out, along):
        assert sum(g["length_m"] for g in res["fence"]["gaps"]) == pytest.approx(res["fence"]["blind_m"], abs=0.5)
        assert 0 <= res["fence"]["seen_by_two_share"] <= res["fence"]["seen_share"] <= 1
        json.dumps({k: val for k, val in res.items() if k != "_draw"})  # plain numbers only
    # a camera does not see through the warehouse: a point right behind it, from a camera on the other side
    wh = np.array(lay["warehouse"]["ring"])
    mid_s, mid_n = wh[:2].mean(0), wh[2:].mean(0)
    cam = [{"id": "c", "kind": "mast", "home": [mid_s[0], mid_s[1] - 25.0], "facing_deg": 0.0}]
    seen = coverage._seen(world, cam, np.array([[mid_n[0], mid_n[1] + 6.0], [mid_s[0], mid_s[1] - 10.0]]))
    assert seen.tolist() == [0, 1]
    fx, fy = lay["fence"][0]
    png = coverage.render(world, lay, masts("baseline"), out, np.zeros((360, 480, 3), np.uint8),
                          (fx - 30, fy - 30, fx + 130, fy + 90), "test")
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_each_measure_is_the_baseline_plus_one_change_and_has_a_cost(site):
    from archworld.sim import measures
    world, lay, staff, _, _ = site
    v = measures.variants(lay, staff)
    assert set(v) == set(measures.COSTS) and v["baseline"]["staff"] == [scope.validate_agent(a) for a in staff]
    ids = lambda vid: sorted(a["id"] for a in v[vid]["staff"])  # noqa: E731
    assert ids("re-aimed-masts") == ids("baseline")  # the same cameras, only turned
    turned = {a["id"]: a["facing_deg"] for a in v["re-aimed-masts"]["staff"] if a["kind"] == "mast"}
    before = {a["id"]: a["facing_deg"] for a in staff if a["kind"] == "mast"}
    assert all(turned[k] != before[k] for k in before)
    for vid, extra in (("mid-masts", 2), ("second-drone", 1), ("second-guard", 1)):
        assert len(v[vid]["staff"]) == len(staff) + extra
    for c in measures.COSTS.values():
        assert c["basis"] and c["one_off_usd"][0] <= c["one_off_usd"][1]
        assert c["per_year_usd"][0] <= c["per_year_usd"][1]


def test_nobody_stays_on_an_alarm_for_ever(site):
    world, lay, staff, _, _ = site
    d = compound.alarm_drill(lay, "all_respond", seed=3, days=1.0, per_day=12.0)
    r = OpsSim(world, staff, seed=3, drill=d, keep_legs=False).run(86_400_000)
    assert len(_types(r, "alarm")) > 6
    for aid, a in r.agents.items():
        if a["kind"] in ("guard", "dog"):
            on_alarms = sum(a["task_ms"].get(k, 0) for k in ("respond", "verify", "hold"))
            assert on_alarms < 0.5 * 86_400_000, aid  # a dozen alarms cannot take half the day
    last = max(e["t"] for e in _types(r, "alarm"))
    assert any(e["type"] == "leg" and e["purpose"] == "patrol" and e["t"] > last + 600_000 for e in r.log)
