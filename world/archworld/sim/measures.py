"""Candidate improvements, measured in the sim before anyone ranks them.

Each measure changes the staff or equipment list and is run on a hard case: the protection timeline with the
first drone's camera and the fence sensor both out, so only patrols and cameras can detect. The decision engine
(ORION) then ranks the measures with these numbers as its evidence; see
plans/20261122-synthetic-world/orion_site.ts.
"""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np

from . import scope, stats
from .compound import load_world, staff, timeline_drill, workers
from .drill import SCORERS, WARMUP_MS, WINDOW_MS, at_time, intrusion_ms, summarise
from .engine import Sim
from .ops import OpsSim

TAIL_MS = 40 * 60_000
GUARD_HOUR = (28.0, 42.0)  # USD, fully loaded, per industry guides (2026)
# Public price ranges, as found by search in November 2026. Mostly vendor or trade sources: rough, not quotes.
COSTS = {
    "baseline": {"one_off_usd": [0, 0], "per_year_usd": [0, 0], "basis": "no change"},
    "re-aimed-masts": {"one_off_usd": [0, 2000], "per_year_usd": [0, 0],
                       "basis": "no new equipment; a technician's visit to re-aim four cameras (assumed up to $2,000)"},
    "mid-masts": {"one_off_usd": [12000, 90000], "per_year_usd": [0, 0],
                  "basis": "two installed thermal cameras at $3,000-15,000 each, times 2-3 for poles, cabling, "
                           "recording and integration"},
    "4k-masts": {"one_off_usd": [2000, 8000], "per_year_usd": [0, 0],
                 "basis": "assumed: four 4K bullet cameras at $500-2,000 each installed, swapped onto the existing "
                          "masts and re-aimed along the fence"},
    "second-drone": {"one_off_usd": [15000, 50000], "per_year_usd": [0, 0],
                     "basis": "one surveillance drone at $15,000-50,000 to buy; no subscription price was found"},
    "second-guard": {"one_off_usd": [0, 0], "per_year_usd": [round(8760 * GUARD_HOUR[0]), round(8760 * GUARD_HOUR[1])],
                     "basis": "one more post staffed all year at $28-42 an hour fully loaded"},
}


def variants(lay: dict, base: list[dict]) -> dict[str, dict]:
    (x0, y0), (x1, _), (_, y1), _ = lay["fence"]
    cx = (x0 + x1) / 2
    c = np.array(lay["centre"])
    drone = next(a for a in base if a["id"] == "drone-1")
    guard = next(a for a in base if a["id"] == "guard-1")
    mid = [{"id": f"mast-{n}", "kind": "mast", "label": f"Camera mast {n}", "home": [cx, y], "facing_deg": f,
            "payloads": ["camera", "thermal_camera"]} for n, (y, f) in ((5, (y1 - 1.0, 0.0)), (6, (y0 + 1.0, 180.0)))]
    drone2 = {**drone, "id": "drone-2", "label": "Second drone", "home": (c + np.array([44.0, -27.0])).tolist(),
              "patrol": drone["patrol"][2:] + drone["patrol"][:2]}  # same circuit, starting on the far side
    guard3 = {**guard, "id": "guard-3", "label": "Second patrolling guard", "patrol": guard["patrol"][::-1]}
    # the four corner cameras turned to look along the fence, each toward the next corner (clockwise from the
    # south-west): the usual perimeter layout, in which every camera covers the stretch the next one cannot
    along = {"mast-1": 90.0, "mast-2": 0.0, "mast-3": 270.0, "mast-4": 180.0}
    reaimed = [{**a, "facing_deg": along[a["id"]]} if a["id"] in along else a for a in base]
    out = {
        "baseline": {"label": "As it is now", "staff": base},
        "re-aimed-masts": {"label": "Re-aim the four corner cameras along the fence", "staff": reaimed},
        "4k-masts": {"label": "4K cameras on the four corner masts, aimed along the fence",
                     "staff": [{**a, "payloads": ["camera_4k", "thermal_camera"]} if a["kind"] == "mast" else a
                               for a in reaimed]},
        "mid-masts": {"label": "Camera masts at the middle of both long sides", "staff": [*base, *mid]},
        "second-drone": {"label": "A second drone on the same circuit", "staff": [*base, drone2]},
        "second-guard": {"label": "A second guard on foot patrol", "staff": [*base, guard3]},
    }
    for v in out.values():
        v["staff"] = [scope.validate_agent(a) for a in v["staff"]]
    return out


def _drone_cover(world, crew: list[dict], days: int) -> dict:
    """Share of time with at least one drone not on its charger, from a patrol-only run."""
    r = Sim(world, crew, seed=0, keep_legs=False).run(days * 86_400_000)
    drones = [a["id"] for a in crew if a["kind"] == "drone"]
    edges = []
    for d in drones:
        on = None
        for e in r.log:
            if e.get("agent") != d:
                continue
            if e["type"] == "charge_start":
                on = e["t"]
            elif e["type"] == "charge_done" and on is not None:
                edges += [(on, 1), (e["t"], -1)]
                on = None
        if on is not None:
            edges += [(on, 1), (r.until, -1)]
    edges.sort()
    charging, last, none_up = 0, 0, 0
    for t, step in edges:
        if charging == len(drones):
            none_up += t - last
        charging += step
        last = t
    return {"drones": len(drones), "days": days, "share_with_a_drone_available": round(1 - none_up / r.until, 4),
            "cycles": {d: r.agents[d]["cycles"] for d in drones}}


def evaluate(out: Path, seeds: int = 120, days: int = 30, log=print) -> dict:
    t0 = time.time()
    world, lay, _ = load_world(Path(out))
    base = staff(world, lay)
    crew_extra = workers(lay)
    # two faults at once, so that only patrols and cameras can detect: the case that separates the measures
    d = timeline_drill(world, lay, "measure", "Protection timeline, first drone's camera and the fence sensor out",
                       faulted="drone-1", fence_pd=0.0)
    tail = d["events"][-1]["t_ms"] - next(e["t_ms"] for e in d["events"] if e["type"] == "appear") + TAIL_MS
    rows, met = {}, {}
    for vid, v in variants(lay, base).items():
        res = []
        for k in range(seeds):  # same seed, same intrusion time in every variant: the comparison is paired
            t = intrusion_ms(k)
            dk = at_time(d, t)
            res.append(SCORERS["timeline"](OpsSim(world, v["staff"] + crew_extra, seed=k, drill=dk).run(t + tail), dk))
        s = summarise(res)
        met[vid] = [r["interrupted"] for r in res]
        rows[vid] = {"label": v["label"], "cost": COSTS[vid], "runs": s["runs"], "met_in_time": s["interrupted"],
                     "met_in_time_ci": stats.rate(met[vid]),
                     "task_completed": s["task_completed"], "seen_before_fence": s["detected_before_fence"],
                     "time_to_detect_s": s["time_to_detect_s"], "time_to_contact_s": s["contact_s"]}
        if vid in ("baseline", "second-drone"):
            rows[vid]["drone_cover"] = _drone_cover(world, v["staff"], days)
        log(f"measure {vid}: met in time {s['interrupted']}/{s['runs']}, {time.time() - t0:.0f} s")
    groups = stats.tie_groups(met)
    for vid, row in rows.items():
        row["vs_baseline_p"] = round(stats.mcnemar(met[vid], met["baseline"]), 5)
        row["tie_group"] = groups[vid]
        row["tied_with"] = sorted(o for o in rows if o != vid and groups[o] == groups[vid])
    return {"site": world.site.id, "drill": d["title"], "seeds": seeds, "measures": rows,
            "intrusion_window_s": [WARMUP_MS // 1000, (WARMUP_MS + WINDOW_MS) // 1000],
            "note": "Each measure is the baseline plus one change, on the same seeds and the same intrusion times. "
                    "Rates carry exact 95 % intervals; measures the paired runs cannot tell apart share a tie group."}
