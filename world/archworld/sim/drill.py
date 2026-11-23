"""Drills: scoring a run, sampling tracks into the tiles' ENU frame, and replay files for the viewer."""

from __future__ import annotations

import numpy as np

from ..frames import Frame
from .engine import Result, Sim
from .simworld import SimWorld


def _first(log: list[dict], type_: str, **match) -> int | None:
    for e in log:
        if e["type"] == type_ and all(e.get(k) == v for k, v in match.items()):
            return e["t"]
    return None


def score(r: Result, drill: dict) -> dict:
    """Defender-side outcome of a drill. Times are from the moment the subject appears."""
    zone = drill["zone"]
    subjects = {}
    for ev in drill["events"]:
        if ev["type"] != "appear":
            continue
        sid = ev["agent"]["id"]
        t0 = _first(r.log, "appear", agent=sid)
        det = _first(r.log, "detected", subject=sid)
        con = _first(r.log, "contact", subject=sid)
        arr = _first(r.log, "arrived", subject=sid)
        end = con if con is not None else r.until
        entered = None
        if t0 is not None:
            for t in range(t0, end + 1, 1000):
                p = r.position(sid, t)
                if np.hypot(p[0] - zone["centre"][0], p[1] - zone["centre"][1]) <= zone["radius"]:
                    entered = t
                    break
        sec = lambda a, b: None if a is None or b is None else (a - b) / 1000  # noqa: E731
        subjects[sid] = {
            "appeared_ms": t0, "detected_ms": det, "first_arrival_ms": arr, "contact_ms": con,
            "entered_zone_ms": entered, "entered_zone": entered is not None,
            "time_to_detect_s": sec(det, t0), "time_to_contact_s": sec(con, t0),
            "detect_to_contact_s": sec(con, det),
            "detected_by": next((e["cause"]["observer"] for e in r.log if e["type"] == "detected"
                                 and e["subject"] == sid), None),
        }
    return {"drill": drill["id"], "seed": r.manifest["seed"], "digest": r.digest, "subjects": subjects}


def tracks(r: Result, frame: Frame, every_ms: int = 2000) -> dict[str, list[list[float]]]:
    """Per agent: [t_s, east, north, up] samples (0.1 m), with runs of standing still collapsed to their ends."""
    out = {}
    for aid in r.agents:
        t0, t1 = r.span(aid)
        ts = np.arange(t0, t1 + 1, every_ms)
        if ts[-1] != t1:
            ts = np.append(ts, t1)
        p = np.array([r.position(aid, int(t)) for t in ts])
        e, n, u = frame.to_enu(p[:, 0], p[:, 1], p[:, 2])
        q = np.round(np.column_stack([ts / 1000.0, e, n, u]), 1)
        keep = np.ones(len(q), bool)
        same = (q[1:, 1:] == q[:-1, 1:]).all(1)
        keep[1:-1] = ~(same[:-1] & same[1:])
        out[aid] = q[keep].tolist()
    return out


def replay(r: Result, drill: dict | None, frame: Frame, world: SimWorld, every_ms: int = 2000,
           scorer=None) -> dict:
    zone = None
    if drill is not None:
        z = drill["zone"]
        e, n, u = frame.to_enu(np.array([z["centre"][0]]), np.array([z["centre"][1]]),
                               np.array([float(world.ground(*z["centre"]))]))
        zone = {"centre": [round(float(e[0]), 1), round(float(n[0]), 1), round(float(u[0]), 1)], "radius": z["radius"],
                "notional": True}
    return {
        "manifest": {**r.manifest, "frame_distortion_ppm": world.frame_distortion_ppm(frame),
                     "graph": world.graph_report()},
        "zone": zone,
        "agents": [{"id": k, "kind": v["kind"], "role": v["role"], "label": v["label"]} for k, v in r.agents.items()],
        "tracks": tracks(r, frame, every_ms),
        "events": [e for e in r.log if e["type"] != "leg"],
        "score": score(r, drill) if drill is not None and scorer is None else None,
        "ops": {"kind": drill.get("kind"), "result": scorer(r, drill)} if drill is not None and scorer else None,
        "title": drill.get("title") if drill is not None else None,
        "start_s": max(0, min((e["t"] for e in r.log if e["type"] not in ("leg", "low_battery", "charge_start",
                                                                              "charge_done")), default=0) / 1000 - 30),
        "summary": r.agents,
    }


def batch(world: SimWorld, agents: list[dict], drill: dict, seeds: range, until_ms: int) -> dict:
    """The same drill over many seeds: detection is probabilistic, so a drill result is a distribution."""
    rows = []
    for seed in seeds:
        r = Sim(world, agents, seed=seed, drill=drill, keep_legs=True).run(until_ms)
        s = score(r, drill)
        rows.append({"seed": seed, "digest": r.digest[:16], **next(iter(s["subjects"].values()))})

    def q(key):
        v = sorted(x[key] for x in rows if x[key] is not None)
        if not v:
            return None
        pick = lambda f: v[min(len(v) - 1, int(f * len(v)))]  # noqa: E731
        return {"n": len(v), "p10": pick(0.1), "median": pick(0.5), "p90": pick(0.9)}

    n = len(rows)
    return {"drill": drill["id"], "runs": n, "detected": sum(x["detected_ms"] is not None for x in rows),
            "contacted": sum(x["contact_ms"] is not None for x in rows),
            "entered_zone": sum(x["entered_zone"] for x in rows),
            "entered_zone_before_contact": sum(x["entered_zone"] and (x["contact_ms"] is None or x["entered_zone_ms"]
                                                                      < x["contact_ms"]) for x in rows),
            "time_to_detect_s": q("time_to_detect_s"), "time_to_contact_s": q("time_to_contact_s"),
            "detect_to_contact_s": q("detect_to_contact_s"), "rows": rows}


# ---------------------------------------------------------------- scoring of the further operations (ops.py)

def _all(log: list[dict], type_: str) -> list[dict]:
    return [e for e in log if e["type"] == type_]


# When an intrusion starts. Drills used to start every intruder 10 minutes in, with every battery full and every
# patrol at its start. Now each seed draws a start after a one-hour warm-up, uniformly over eight hours: longer than
# the drone (~49 min), robot dog (~4.2 h) and patrol vehicle (~7.7 h) charge cycles seen over 30 days, so runs meet
# equipment charging, low and mid-patrol. The draw depends on the seed only, so every variant of a measure meets
# the intruder at the same time (paired comparisons).
WARMUP_MS = 3_600_000
WINDOW_MS = 8 * 3_600_000


def intrusion_ms(seed: int) -> int:
    g = np.random.Generator(np.random.PCG64(np.random.SeedSequence([seed, 0x1A7E])))
    return WARMUP_MS + int(g.integers(0, WINDOW_MS))


def at_time(drill: dict, t_ms: int) -> dict:
    """The same drill with the intrusion starting at t_ms. Faults set at the start stay; events from the
    intruder's appearance on (a nuisance alarm during the approach, for instance) move with it."""
    t0 = next(e["t_ms"] for e in drill["events"] if e["type"] == "appear")
    shift = int(t_ms) - t0
    events = sorted(({**e, "t_ms": e["t_ms"] + shift} if e["t_ms"] >= t0 else dict(e) for e in drill["events"]),
                    key=lambda e: e["t_ms"])
    return {**drill, "events": events, "info": {**drill.get("info", {}), "appear_s": t_ms / 1000}}


def score_timeline(r: Result, drill: dict) -> dict:
    """The protection timeline of one run: was the subject met before the task was done?"""
    sid = next(e["agent"]["id"] for e in drill["events"] if e["type"] == "appear")
    t0 = _first(r.log, "appear", agent=sid)
    at_fence = next((e["t"] for e in r.log if e["type"] == "at_barrier" and e["agent"] == sid), None)
    alarm = next((e["t"] for e in r.log if e["type"] == "alarm" and e["id"] == sid), None)
    det = _first(r.log, "detected", subject=sid)
    con = _first(r.log, "contact", subject=sid)
    done = _first(r.log, "task_complete", agent=sid)
    sec = lambda a, b: None if a is None or b is None else (a - b) / 1000  # noqa: E731
    return {"interrupted": con is not None and (done is None or con < done), "task_completed": done is not None,
            "fence_alarm": alarm is not None,
            # seen before the fence: detected, and either never reached the fence or detected before reaching it
            "detected_before_fence": det is not None and (at_fence is None or det < at_fence),
            "time_to_detect_s": sec(det, t0), "fence_to_contact_s": sec(con, at_fence),
            "margin_s": sec(done, con) if done is not None and con is not None and con < done else None,
            "contact_s": sec(con, t0), "task_s": sec(done, t0)}


def score_alarm(r: Result, drill: dict) -> dict:
    alarms = _all(r.log, "alarm")
    cleared = _all(r.log, "cleared")
    t0 = alarms[0]["t"] if alarms else None
    people = sum(len([a for a in e["agents"] if r.agents[a]["kind"] in ("guard",)]) for e in _all(r.log, "dispatch"))
    return {"cleared_after_s": (cleared[0]["t"] - t0) / 1000 if cleared and t0 is not None else None,
            "cleared_by": cleared[0]["by"] if cleared else None, "guards_sent": people,
            "guard_walk_m": round(sum(v["distance_m"] for v in r.agents.values() if v["kind"] == "guard"), 1)}


def score_alarms(r: Result, drill: dict) -> dict:
    """Workload of a long run with nuisance alarms."""
    n = len(_all(r.log, "alarm"))
    task = lambda kind, keys: sum(v["task_ms"].get(k, 0) for v in r.agents.values() if v["kind"] == kind  # noqa: E731
                                  for k in keys) / 3_600_000
    return {"alarms": n, "cleared": len(_all(r.log, "cleared")),
            "guard_hours_on_alarms": round(task("guard", ("respond", "verify", "hold", "home")), 2),
            "dog_hours_on_alarms": round(task("dog", ("respond", "verify", "hold")), 2),
            "drone_hours_on_alarms": round(task("drone", ("respond", "verify", "hold")), 2),
            "guard_dispatches": sum(sum(1 for a in e["agents"] if r.agents[a]["kind"] == "guard")
                                    for e in _all(r.log, "dispatch")),
            "drone_verifications": sum(1 for e in _all(r.log, "verify_sent")
                                       if r.agents[e["agent"]]["kind"] == "drone"),
            "unverified": len(_all(r.log, "verify_unavailable"))}


def score_gate(r: Result, drill: dict) -> dict:
    checks = _all(r.log, "gate_check")
    waits = sorted(e["waited_s"] for e in checks)
    fake = next((e["agent"]["id"] for e in drill["events"] if e.get("booking") == "fictitious"), None)
    outcome = None
    if fake is not None:
        outcome = ("stopped" if any(e["agent"] == fake for e in _all(r.log, "refused")) else
                   "lost" if any(e["agent"] == fake for e in _all(r.log, "loss")) else "unresolved")
    pick = lambda f: waits[min(len(waits) - 1, int(f * len(waits)))] if waits else None  # noqa: E731
    return {"trucks": len(_all(r.log, "truck_inbound")), "checked": len(checks),
            "mean_wait_s": round(sum(waits) / len(waits), 1) if waits else None, "p90_wait_s": pick(0.9),
            "max_wait_s": waits[-1] if waits else None,
            "max_queue": max((e["position"] for e in _all(r.log, "queued")), default=0),
            "fictitious": outcome, "stopped": outcome == "stopped", "lost": outcome == "lost"}


def score_evacuation(r: Result, drill: dict) -> dict:
    out = sorted(e["after_s"] for e in _all(r.log, "mustered"))
    n = next(e["workers"] for e in r.log if e["type"] == "evacuation_start")
    return {"workers": n, "mustered": len(out), "all_mustered": len(out) == n,
            "median_s": out[len(out) // 2] if out else None, "last_s": out[-1] if out else None}


SCORERS = {"timeline": score_timeline, "alarm": score_alarm, "alarms": score_alarms, "gate": score_gate,
           "evacuation": score_evacuation}


def summarise(rows: list[dict]) -> dict:
    """Counts for yes/no results, 10th/50th/90th percentiles for numbers, tallies for labels."""
    out: dict = {"runs": len(rows)}
    for key in rows[0] if rows else []:
        vals = [r[key] for r in rows if r[key] is not None]
        if not vals:
            out[key] = None
        elif all(isinstance(v, bool) for v in vals):
            out[key] = sum(vals)
        elif all(isinstance(v, int | float) for v in vals):
            v = sorted(vals)
            pick = lambda f, v=v: v[min(len(v) - 1, int(f * len(v)))]  # noqa: E731
            out[key] = {"n": len(v), "p10": pick(0.1), "median": pick(0.5), "p90": pick(0.9)}
        else:
            tally: dict = {}
            for v in vals:
                tally[str(v)] = tally.get(str(v), 0) + 1
            out[key] = dict(sorted(tally.items()))
    return out
