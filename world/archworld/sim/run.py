"""Run the site sim for a built site: drill batches over seeds, one replay per drill, and a long-horizon run."""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

from ..frames import Frame
from . import compound as cp
from . import scope, stats
from .compound import (
    alarm_drill,
    drills,
    gate_drill,
    load_world,
    operations,
    staff,
    timeline_drill,
    viewer_site,
    workers,
)
from .drill import SCORERS, at_time, batch, intrusion_ms, replay, summarise
from .engine import Sim
from .ops import OpsSim
from .simworld import LOS_STEP, VEG_PATH_LIMIT, XC_FACTOR, XC_FOREST

DRILL_TAIL_MS = 40 * 60_000
GATE_HOURS = 10.0


def _operations(world, lay, frame, agents, seeds: int, days: int, files: dict, log, t0: float) -> dict:
    """Protection timeline, alarm handling, gate shifts and evacuation: batches over seeds plus one replay each."""
    crew = agents + workers(lay)
    scripted = {d["id"]: d for d in operations(world, lay)}
    replays = []

    def seeded(d: dict, seed: int, until: int) -> tuple[dict, int]:
        """Timeline drills start at the seed's intrusion time (drill.intrusion_ms); others run as scripted."""
        if d.get("kind") != "timeline":
            return d, until
        t0 = next(e["t_ms"] for e in d["events"] if e["type"] == "appear")
        t = intrusion_ms(seed)
        return at_time(d, t), until - t0 + t

    def save(d: dict, seed: int, until: int) -> None:
        d, until = seeded(d, seed, until)
        r = OpsSim(world, crew, seed=seed, drill=d).run(until)
        rep = replay(r, d, frame, world, scorer=SCORERS[d["kind"]])
        if d.get("kind") == "timeline":  # crop hours of warm-up patrols: start a minute before the intruder
            since = next(e["t_ms"] for e in d["events"] if e["type"] == "appear") - 60_000
            rep["tracks"] = {a: [q for q in v if q[0] * 1000 >= since] for a, v in rep["tracks"].items()}
            rep["events"] = [e for e in rep["events"] if e["t"] >= since]
            rep["start_s"] = since / 1000
        files[f"replay-{d['id']}.json"] = json.dumps(rep, sort_keys=True).encode()
        replays.append({"id": d["id"], "title": d["title"]})

    def run_batch(d_for, until: int, key: str | None = None):
        rows = []
        for k in range(seeds):
            d, u = seeded(d_for(k), k, until)
            rows.append({"seed": k, **SCORERS[d["kind"]](OpsSim(world, crew, seed=k, drill=d).run(u), d)})
        best = None
        if key:  # the replay shown is the median run on `key`, not the best one
            ok = sorted((r[key], r["seed"]) for r in rows if r[key] is not None)
            best = ok[len(ok) // 2][1] if ok else 0
        summary = summarise([{k_: v for k_, v in r.items() if k_ != "seed"} for r in rows])
        if "interrupted" in rows[0]:
            summary["interrupted_ci"] = stats.rate([r["interrupted"] for r in rows])
        return summary, best

    out: dict = {"timeline": [], "gate": [], "alarms": [], "coupled": [], "sweep": [], "sensitivity": []}
    tl_until = scripted["fence-to-door"]["events"][-1]["t_ms"] + DRILL_TAIL_MS
    # the same intrusion while a nuisance alarm on the far side is being handled, under each alarm procedure
    for policy in ("verify_first", "all_respond"):
        d = timeline_drill(world, lay, "fence-to-door-during-alarm", scripted["fence-to-door-during-alarm"]["title"],
                           faulted="drone-1", alarm_policy=policy)
        summary, seed = run_batch(lambda k, d=d: d, tl_until, "contact_s")
        out["coupled"].append({"policy": policy, **summary})
        if policy == "all_respond":
            save(d, seed, tl_until)
        log(f"coupled {policy}: {summary['interrupted']}/{summary['runs']} interrupted, {time.time() - t0:.0f} s")
    # weakest side: the same timeline from eight directions, in the hard case (drone camera and fence sensor out)
    for brg in range(0, 360, 45):
        try:
            d = timeline_drill(world, lay, f"sweep-{brg}", f"From {brg} degrees", faulted="drone-1", bearing=brg,
                               fence_pd=0.0)
        except RuntimeError:
            out["sweep"].append({"bearing_deg": brg, "walkable": False})
            continue
        summary, _ = run_batch(lambda k, d=d: d, tl_until)
        out["sweep"].append({"bearing_deg": brg, "walkable": True, "runs": summary["runs"],
                             "interrupted": summary["interrupted"], "task_completed": summary["task_completed"],
                             "detected_before_fence": summary["detected_before_fence"],
                             "time_to_detect_s": summary["time_to_detect_s"]})
    log(f"sweep: {[(r['bearing_deg'], r.get('interrupted')) for r in out['sweep']]}, {time.time() - t0:.0f} s")
    # how much the result leans on the assumed door delay
    for delay in (cp.DOOR_DELAY_MS // 2, cp.DOOR_DELAY_MS, cp.DOOR_DELAY_MS * 2):
        d = timeline_drill(world, lay, f"door-{delay}", "", faulted="drone-1", door_delay_ms=delay, fence_pd=0.0)
        summary, _ = run_batch(lambda k, d=d: d, tl_until)
        out["sensitivity"].append({"door_delay_s": delay / 1000, "runs": summary["runs"],
                                   "interrupted": summary["interrupted"]})
    d2 = timeline_drill(world, lay, "fence-to-door-two-faults",
                        "Protection timeline, drone camera and fence sensor out", faulted="drone-1", fence_pd=0.0)
    scripted[d2["id"]] = d2
    for did in ("fence-to-door", "fence-to-door-drone-down", "fence-to-door-two-faults"):
        d = scripted[did]
        until = d["events"][-1]["t_ms"] + DRILL_TAIL_MS
        summary, seed = run_batch(lambda k, d=d: d, until, "contact_s")
        out["timeline"].append({"id": did, "title": d["title"], "info": d["info"], **summary})
        save(d, seed, until)
        log(f"timeline {did}: {summary['interrupted']}/{summary['runs']} interrupted, {time.time() - t0:.0f} s")
    for did in ("nuisance-alarm-verify-first", "nuisance-alarm-all-respond"):
        save(scripted[did], 1, 25 * 60_000)
    for policy in ("verify_first", "all_respond"):
        d = alarm_drill(lay, policy, seed=0, days=days)
        r = OpsSim(world, crew, seed=0, drill=d, keep_legs=False).run(days * 86_400_000)
        out["alarms"].append({"policy": policy, "title": d["title"], "days": days, "per_day": cp.NUISANCE_PER_DAY,
                              **SCORERS["alarms"](r, d)})
        log(f"alarms {policy}: {d['info']['alarms']} alarms, {time.time() - t0:.0f} s")
    for procedure in ("paper", "callback"):
        summary, _ = run_batch(lambda k, p=procedure: gate_drill(world, lay, p, seed=k, hours=GATE_HOURS),
                               int(GATE_HOURS * 3_600_000))
        out["gate"].append({"procedure": procedure, "hours": GATE_HOURS, **summary})
        log(f"gate {procedure}: stopped {summary['stopped']}/{summary['runs']}, {time.time() - t0:.0f} s")
    save(scripted["gate-two-hours"], 3, int(2.4 * 3_600_000))
    d = scripted["evacuation"]
    summary, seed = run_batch(lambda k, d=d: d, 20 * 60_000, "last_s")
    out["evacuation"] = {"title": d["title"], "info": d["info"], **summary}
    save(d, seed, 20 * 60_000)
    blocked, _ = run_batch(lambda k: scripted["evacuation-exit-blocked"], 20 * 60_000)
    out["evacuation_blocked"] = {"title": scripted["evacuation-exit-blocked"]["title"], **blocked}
    log(f"evacuation: {summary['all_mustered']}/{summary['runs']} complete, {time.time() - t0:.0f} s")
    out["replays"] = replays
    out["assumptions"] = {
        "fence_pd": cp.FENCE_PD, "fence_delay_s": cp.FENCE_DELAY_MS / 1000, "door_delay_s": cp.DOOR_DELAY_MS / 1000,
        "check_s": [cp.CHECK_MS[0] / 1000, (cp.CHECK_MS[1] - 1) / 1000],
        "callback_s": [cp.CALLBACK_MS[0] / 1000, (cp.CALLBACK_MS[1] - 1) / 1000], "p_catch": cp.P_CATCH,
        "trucks_per_hour": cp.TRUCKS_PER_HOUR, "nuisance_per_day": cp.NUISANCE_PER_DAY,
        "premovement": "lognormal, median 30 s, sigma 0.6; indoors +10 to 60 s", "workers": 12,
    }
    return out


def run_site(out: Path, seeds: int = 40, days: int = 30, log=print) -> dict:
    out = Path(out)
    t0 = time.time()
    world, lay, _ = load_world(out)
    frame = Frame(world.site)
    agents = staff(world, lay)
    dest = out / "simruns"
    dest.mkdir(exist_ok=True)
    files: dict[str, bytes] = {"site.json": json.dumps(viewer_site(world, lay, frame), sort_keys=True).encode()}
    results = []
    for d in drills(world, lay):
        until = d["events"][-1]["t_ms"] + DRILL_TAIL_MS
        b = batch(world, agents, d, range(seeds), until)
        # the replay shown is the run whose detection time is the median of the batch, not the best one
        det = sorted((r["time_to_detect_s"], r["seed"]) for r in b["rows"] if r["time_to_detect_s"] is not None)
        seed = det[len(det) // 2][1] if det else 0
        r = Sim(world, agents, seed=seed, drill=d).run(until)
        files[f"replay-{d['id']}.json"] = json.dumps(replay(r, d, frame, world), sort_keys=True).encode()
        results.append({"id": d["id"], "title": d["title"], "info": d["info"], "replay_seed": seed,
                        "replay_digest": r.digest, **{k: v for k, v in b.items() if k != "drill"}})
        log(f"drill {d['id']}: {b['detected']}/{b['runs']} detected, {time.time() - t0:.0f} s")
    ops = _operations(world, lay, frame, agents, seeds, days, files, log, t0)
    h = Sim(world, agents, seed=0, keep_legs=False).run(days * 86_400_000)
    log(f"horizon {days} d: {h.events_processed} events, {time.time() - t0:.0f} s")
    kinds = {k.name: {"vmax_ms": k.vmax, "battery_wh": k.capacity_mwh / 1000, "move_w": k.p_move_mw / 1000,
                      "sensor": None if k.sensor is None else {"range_m": k.sensor.range_m, "fov_deg": k.sensor.fov_deg,
                                                               "p0": k.sensor.p0}}
             for k in scope.KINDS.values()}
    summary = {
        "site": world.site.id, "compound": {"centre": lay["centre"], "relief_m": lay["relief_m"], "size": lay["size"],
                                            "gate_side": lay["gate"]["side"], "provenance": lay["provenance"]},
        "graph": world.graph_report(), "frame_distortion_ppm": world.frame_distortion_ppm(frame),
        "agents": [{"id": a["id"], "kind": a["kind"], "label": a["label"], "payloads": a["payloads"]} for a in agents],
        "drills": results,
        "operations": ops,
        "replays": [{"id": d["id"], "title": d["title"]} for d in results] + ops["replays"],
        "horizon": {"days": days, "events": h.events_processed, "digest": h.digest,
                    "agents": {k: v for k, v in h.agents.items() if v["kind"] != "mast"}},
        "assumptions": {"kinds": kinds, "fade_per_cycle": scope.FADE_PER_CYCLE, "los_step_m": LOS_STEP,
                        "foliage_path_limit_m": VEG_PATH_LIMIT, "off_path_speed_factor": XC_FACTOR,
                        "forest_speed_factor": XC_FOREST, "method": "default",
                        "note": "Equipment and detection figures are round class numbers, not validated models."},
        "seconds": round(time.time() - t0),
    }
    files["summary.json"] = (json.dumps(summary, sort_keys=True, indent=1) + "\n").encode()
    for name, data in files.items():
        (dest / name).write_bytes(data)
    summary["files"] = {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}
    return summary
