"""A specific site inside the world: a synthetic warehouse compound placed on real terrain.

Open data has no guarded compound to model, and real facility layouts are out of scope, so the compound is placed
by rule: the flattest open rectangle with no building, tree, path, rail or water in it and a road close by.
Everything it adds (warehouse, fence, yard road, pads, masts) carries provenance method "synthetic" with
confidence 0: it is not a claim about the real place, and it never replaces a measured feature.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import shapely

from ..frames import Frame
from ..osm import _densify
from ..provenance import Record
from ..sites import SITES
from ..terrain import Surface
from . import scope
from .simworld import VEG_MIN, SimWorld

PROV = Record("placed by rule", "archworld.sim.compound", "own work", "synthetic", 0.0).dict()
W, H = 140.0, 100.0  # fence rectangle, long side east-west
WAREHOUSE = (60.0, 30.0, 8.0, 11.0)  # length, width, eave height, ridge height
RING_INSET = 12.0
GATE_W = 8.0
MAST_H = 6.0


def _gate(nxy: np.ndarray, x0: float, x1: float, y0: float, y1: float) -> tuple[str, np.ndarray]:
    """Gate on the fence side that faces the road node, at least 15 m from a corner."""
    sides = {"S": (np.clip(nxy[0], x0 + 15, x1 - 15), y0), "N": (np.clip(nxy[0], x0 + 15, x1 - 15), y1),
             "W": (x0, np.clip(nxy[1], y0 + 15, y1 - 15)), "E": (x1, np.clip(nxy[1], y0 + 15, y1 - 15))}
    side = min(sides, key=lambda k: (float(np.hypot(*(np.array(sides[k]) - nxy))), k))
    return side, np.array(sides[side], float)


def find_site(world: SimWorld, roads: dict, w: float = W, h: float = H, margin: float = 300.0, step: float = 20.0,
              max_relief: float = 8.0, max_road_m: float = 150.0) -> dict:
    """Flattest open rectangle near a road. Deterministic: lowest relief wins, then south-west first."""
    s = world.site
    other = np.array([p[:2] for wy in roads["ways"] if wy["kind"] != "highway" for p in wy["lv95"]] or [[1e12, 1e12]])
    drive = np.flatnonzero(world._comp["drive"] == world._main["drive"])
    hs = world.surf.grid.h
    st = world.surf.step
    best = None
    for cy in np.arange(s.y0 + margin, s.y0 + s.size - margin + 1e-9, step):
        for cx in np.arange(s.x0 + margin, s.x0 + s.size - margin + 1e-9, step):
            x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2
            i0, i1 = int((x0 - s.x0) // st), int(np.ceil((x1 - s.x0) / st))
            j0, j1 = int((y0 - s.y0) // st), int(np.ceil((y1 - s.y0) / st))
            patch = hs[j0:j1 + 1, i0:i1 + 1]
            relief = float(patch.max() - patch.min())
            if relief > max_relief or (best is not None and relief >= best["relief_m"]):
                continue
            if world.canopy is not None:
                c = world.canopy_step
                veg = world.canopy[int((y0 - s.y0) // c):int(np.ceil((y1 - s.y0) / c)),
                                   int((x0 - s.x0) // c):int(np.ceil((x1 - s.x0) / c))]
                if (veg >= VEG_MIN).mean() > 0.01:
                    continue
            box = shapely.box(x0 - 15, y0 - 15, x1 + 15, y1 + 15)
            if world.tree is not None and len(world.tree.query(box, predicate="intersects")):
                continue
            inside = (world.nx > x0 - 5) & (world.nx < x1 + 5) & (world.ny > y0 - 5) & (world.ny < y1 + 5)
            if inside.any():
                continue
            ox, oy = other[:, 0], other[:, 1]
            if ((ox > x0 - 10) & (ox < x1 + 10) & (oy > y0 - 10) & (oy < y1 + 10)).any():
                continue
            dx = np.maximum(np.maximum(x0 - world.nx[drive], world.nx[drive] - x1), 0)
            dy = np.maximum(np.maximum(y0 - world.ny[drive], world.ny[drive] - y1), 0)
            d = np.hypot(dx, dy)
            pick = None
            for k in np.argsort(d, kind="stable")[:400:8]:  # nearest road nodes first, a few metres apart
                if d[k] > max_road_m:
                    break
                nxy = np.array([world.nx[drive[k]], world.ny[drive[k]]])
                link = shapely.LineString([nxy, _gate(nxy, x0, x1, y0, y1)[1]])
                # the link to the road must not run through a building or a stand of trees
                if world.tree is not None and len(world.tree.query(link.buffer(4.0), predicate="intersects")):
                    continue
                lp = np.array([link.interpolate(t).coords[0] for t in np.arange(0.0, link.length, 2.0)] or [nxy])
                if (world.canopy_at(lp[:, 0], lp[:, 1]) >= VEG_MIN).mean() > 0.05:
                    continue
                # ...nor across a river, stream or railway (no bridge is being invented)
                lx0, ly0, lx1, ly1 = link.bounds
                near = other[(ox > lx0 - 8) & (ox < lx1 + 8) & (oy > ly0 - 8) & (oy < ly1 + 8)]
                if len(near) and shapely.dwithin(shapely.points(near), link, 6.0).any():
                    continue
                pick = int(k)
                break
            if pick is None:
                continue
            best = {"centre": [float(cx), float(cy)], "relief_m": round(relief, 2), "road_node": int(drive[pick]),
                    "road_m": round(float(d[pick]), 1)}
    if best is None:
        raise RuntimeError("no open, flat rectangle near a road was found for the compound")
    return best


def layout(world: SimWorld, site: dict, w: float = W, h: float = H) -> dict:
    cx, cy = site["centre"]
    node = site["road_node"]
    nxy = np.array([world.nx[node], world.ny[node]])
    x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2
    side, gate = _gate(nxy, x0, x1, y0, y1)
    inward = {"S": (0, 1), "N": (0, -1), "W": (1, 0), "E": (-1, 0)}[side]
    out_brg = {"S": 180.0, "N": 0.0, "W": 270.0, "E": 90.0}[side]
    r = RING_INSET
    rx0, rx1, ry0, ry1 = x0 + r, x1 - r, y0 + r, y1 - r
    junction = gate + np.array(inward) * r
    corners = [(rx0, ry0), (rx1, ry0), (rx1, ry1), (rx0, ry1)]
    ring = []  # counter-clockwise from SW, with the junction inserted on its side
    for k in range(4):
        a, b = np.array(corners[k]), np.array(corners[(k + 1) % 4])
        ring.append(tuple(a))
        ab, aj = b - a, junction - a
        if abs(ab[0] * aj[1] - ab[1] * aj[0]) < 1e-6 and 0 < np.dot(aj, ab) < np.dot(ab, ab):
            ring.append(tuple(junction))
    ring.append(ring[0])
    wl, ww, eave, ridge = WAREHOUSE
    fx0, fx1, fy0, fy1 = cx - wl / 2, cx + wl / 2, cy - ww / 2, cy + ww / 2
    gx, gy = np.meshgrid(np.linspace(fx0, fx1, 16), np.linspace(fy0, fy1, 9))
    g = world.ground(gx, gy)
    floor = float(g.max()) + 0.15
    along = np.array([1.0, 0.0]) if side in "SN" else np.array([0.0, 1.0])
    tangent = along if np.dot(np.array(corners[1]) - junction, along) > 20 else -along
    obj = {
        "provenance": PROV, "centre": [cx, cy], "size": [w, h], "relief_m": site["relief_m"],
        "fence": [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], "fence_height": 2.4,
        "gate": {"at": gate.tolist(), "width": GATE_W, "side": side, "bearing_out_deg": out_brg},
        "ring": [list(p) for p in ring], "junction": junction.tolist(),
        "link": [nxy.tolist(), gate.tolist(), junction.tolist()],
        "warehouse": {"ring": [(fx0, fy0), (fx1, fy0), (fx1, fy1), (fx0, fy1)], "base": round(float(g.min()) - 1.0, 3),
                      "floor": round(floor, 3), "eave": round(floor + eave, 3), "ridge": round(floor + ridge, 3)},
        "drone_pad": {"at": [cx + 44.0, cy + 27.0], "size": 6.0},
        "dog_dock": {"at": [cx - 44.0, ry1]},
        "vehicle_bay": {"at": (junction + tangent * 14.0).tolist()},
        "guard_post": {"at": (gate + np.array(inward) * 3.0).tolist(), "facing_deg": out_brg},
        "masts": [{"id": f"mast-{n}", "at": [mx, my], "facing_deg": f, "height": MAST_H}
                  for n, (mx, my, f) in enumerate(((x0 + 1, y0 + 1, 225.0), (x1 - 1, y0 + 1, 135.0),
                                                   (x1 - 1, y1 - 1, 45.0), (x0 + 1, y1 - 1, 315.0)), 1)],
        "ring_corners": [list(c) for c in corners],
        "zone": {"centre": [cx, cy], "radius": round(float(np.hypot(w / 2, h / 2)) + 15.0, 1), "notional": True},
    }
    return obj


def synthetic_ways(world: SimWorld, lay: dict, offset: float) -> list[dict]:
    """The yard road and its link to the public road, in the same form as roads.json ways (class "service")."""
    ways = []
    for name, line in (("yard ring", lay["ring"]), ("gate link", lay["link"])):
        xy = np.round(_densify(np.asarray(line, float), 1.0), 3)
        z = world.ground(xy[:, 0], xy[:, 1]) + offset
        ways.append({"osm_id": None, "kind": "highway", "class": "service", "name": name, "render": True,
                     "bridge": False, "tunnel": False, "surface": "", "width": PROV | {"value": 4.0},
                     "lv95": np.column_stack([xy, np.round(z, 4)]).tolist(), "synthetic": True})
    return ways


def load_world(out: Path) -> tuple[SimWorld, dict, dict]:
    """World + compound for a built site: (world with the compound in it, layout, roads incl. synthetic ways)."""
    out = Path(out)
    report = json.loads((out / "report.json").read_text())
    s = SITES[report["site"]["id"]]
    surf = Surface.from_heights(s, np.load(out / "sim" / "terrain.npy"), report["grid"]["leaf_step_m"])
    buildings = json.loads((out / "sim" / "buildings.json").read_text())["buildings"]
    roads = json.loads((out / "roads.json").read_text())
    cpath = out / "sim" / "canopy.npy"
    canopy = np.load(cpath) if cpath.exists() else None
    step = report.get("sim", {}).get("canopy_step_m", 2.0)
    return with_compound(SimWorld.from_parts(s, surf, buildings, roads, canopy=canopy, canopy_step=step), buildings,
                         roads)


def with_compound(base: SimWorld, buildings: list[dict], roads: dict, w: float = W, h: float = H,
                  **find_kw) -> tuple[SimWorld, dict, dict]:
    lay = layout(base, find_site(base, roads, w=w, h=h, **find_kw), w, h)
    wh = lay["warehouse"]
    fid = max((b["fid"] for b in buildings), default=-1) + 1
    placed = {"fid": fid, "ring": [list(p) for p in wh["ring"]], "base": wh["base"], "top": wh["ridge"],
              "synthetic": True}
    roads2 = {**roads, "ways": [*roads["ways"], *synthetic_ways(base, lay, roads.get("offset_m", 0.0))]}
    world = SimWorld.from_parts(base.site, base.surf, [*buildings, placed], roads2, canopy=base.canopy,
                                canopy_step=base.canopy_step, enclosures=[lay["fence"]])
    j = int(np.argmin(np.hypot(world.nx - lay["junction"][0], world.ny - lay["junction"][1])))
    for mode in ("foot", "drive"):
        if world._comp[mode][j] != world._main[mode]:
            raise RuntimeError(f"the compound's yard road is not connected to the public {mode} network")
    return world, lay, roads2


def staff(world: SimWorld, lay: dict) -> list[dict]:
    c = np.array(lay["centre"])
    rc = lay["ring_corners"]
    cams = ["camera", "radio"]
    far = _far_drive_node(world, lay)
    out = [
        {"id": "guard-1", "kind": "guard", "label": "Guard, yard patrol", "home": lay["junction"], "patrol": rc,
         "payloads": ["radio", "light"]},
        {"id": "guard-2", "kind": "guard", "label": "Guard, gate post", "home": lay["guard_post"]["at"],
         "facing_deg": lay["guard_post"]["facing_deg"], "payloads": ["radio"]},
        {"id": "dog-1", "kind": "dog", "label": "Robot dog", "home": lay["dog_dock"]["at"], "patrol": rc[::-1],
         "payloads": ["camera", "thermal_camera", "lidar", "radio"]},
        {"id": "vehicle-1", "kind": "vehicle", "label": "Patrol vehicle", "home": lay["vehicle_bay"]["at"],
         "patrol": [far, lay["vehicle_bay"]["at"]], "payloads": cams},
        {"id": "drone-1", "kind": "drone", "label": "Drone", "home": lay["drone_pad"]["at"],
         "patrol": [(c + 220.0 * np.array(v)).tolist() for v in ((0, 1), (1, 0), (0, -1), (-1, 0))],
         "payloads": ["camera", "thermal_camera", "radio", "gnss", "imu"]},
    ]
    out += [{"id": m["id"], "kind": "mast", "label": f"Camera mast {m['id'][-1]}", "home": m["at"],
             "facing_deg": m["facing_deg"], "payloads": ["camera", "thermal_camera"]} for m in lay["masts"]]
    return [scope.validate_agent(a) for a in out]


def _far_drive_node(world: SimWorld, lay: dict, want: float = 650.0) -> list[float]:
    """A point on the public road about `want` metres from the compound that the vehicle can reach."""
    c = np.array(lay["centre"])
    k = scope.KINDS["vehicle"]
    src = world.nearest_node(lay["vehicle_bay"]["at"], "drive")
    idx = np.flatnonzero(world._comp["drive"] == world._main["drive"])
    d = np.abs(np.hypot(world.nx[idx] - c[0], world.ny[idx] - c[1]) - want)
    for i in idx[np.argsort(d, kind="stable")][:200:20]:
        if world.route(k, src, int(i)) is not None:
            return [float(world.nx[i]), float(world.ny[i])]
    return lay["junction"]


def drills(world: SimWorld, lay: dict, appear_ms: int = 600_000, start_m: float = 450.0,
           bearing: int | None = None) -> list[dict]:
    """Three drills on the same approach: all sensors working, the facing camera mast out, the drone camera out.
    The approach bearing is the first one clockwise from north with a walkable route; it is not chosen to avoid
    detection."""
    c = np.array(lay["centre"])
    w, h = lay["size"]
    person = scope.KINDS["person"]
    for brg in (range(0, 360, 45) if bearing is None else [bearing]):
        u = np.array([np.sin(np.radians(brg)), np.cos(np.radians(brg))])
        start = c + start_m * u
        edge = min((w / 2) / abs(u[0]) if abs(u[0]) > 1e-9 else 1e9, (h / 2) / abs(u[1]) if abs(u[1]) > 1e-9 else 1e9)
        goal = c + (edge + 10.0) * u
        s = world.site
        if not (s.x0 + 20 < start[0] < s.x0 + s.size - 20 and s.y0 + 20 < start[1] < s.y0 + s.size - 20):
            continue
        r = world.cross_country(person, start, goal)
        if r is not None and r.T[-1] <= 30 * 60_000:
            break
    else:
        raise RuntimeError("no walkable approach to the compound was found")
    appear = {"t_ms": appear_ms, "type": "appear", "agent": {"id": "subject-1", "kind": "person", "role": "unknown",
                                                              "label": "Unknown person"},
              "at": start.tolist(), "goto": goal.tolist(), "cross_country": True}
    mast = min(lay["masts"], key=lambda m: (abs((m["facing_deg"] - brg + 180) % 360 - 180), m["id"]))
    info = {"approach_bearing_deg": brg, "start_m": start_m, "walk_s": round(int(r.T[-1]) / 1000)}
    out = [{"id": "approach-on-foot", "title": "Unknown person walks in across open ground", "zone": lay["zone"],
            "events": [appear], "info": info}]
    variants = (("approach-with-mast-fault", f"Same approach, camera {mast['id']} out of service", mast["id"]),
                ("approach-with-drone-down", "Same approach, drone camera out of service", "drone-1"))
    for did, title, who in variants:
        out.append({"id": did, "title": title, "zone": lay["zone"], "info": {**info, "faulted": who},
                    "events": [{"t_ms": 0, "type": "sensor_fault", "agent": who, "duration_ms": 10 ** 9}, appear]})
    return out


def viewer_site(world: SimWorld, lay: dict, frame: Frame) -> dict:
    """The compound in the tiles' ENU frame, for the web viewer."""
    def enu(xy, z=None, lift=0.0):
        xy = np.atleast_2d(np.asarray(xy, float))
        zz = world.ground(xy[:, 0], xy[:, 1]) + lift if z is None else np.full(len(xy), z)
        e, n, u = frame.to_enu(xy[:, 0], xy[:, 1], zz)
        return np.round(np.column_stack([e, n, u]), 2).tolist()

    wh = lay["warehouse"]
    fence = np.asarray([*lay["fence"], lay["fence"][0]], float)
    g = lay["gate"]
    return {
        "provenance": PROV, "notional": True, "centre": enu(lay["centre"])[0],
        "warehouse": {"corners": [enu(p, wh["base"])[0][:2] for p in wh["ring"]],
                      **{k: enu(lay["centre"], wh[k])[0][2] for k in ("base", "floor", "eave", "ridge")}},
        "fence": enu(_densify(fence, 4.0)), "fence_height": lay["fence_height"],
        "gate": {"at": enu(g["at"])[0], "width": g["width"], "side": g["side"]},
        "roads": [enu(_densify(np.asarray(lay[k], float), 2.0), lift=0.15) for k in ("ring", "link")],
        "drone_pad": {"at": enu(lay["drone_pad"]["at"])[0], "size": lay["drone_pad"]["size"]},
        "dog_dock": {"at": enu(lay["dog_dock"]["at"])[0]}, "vehicle_bay": {"at": enu(lay["vehicle_bay"]["at"])[0]},
        "guard_post": {"at": enu(lay["guard_post"]["at"])[0], "facing_deg": lay["guard_post"]["facing_deg"]},
        "masts": [{"id": m["id"], "at": enu(m["at"])[0], "facing_deg": m["facing_deg"], "height": m["height"],
                   "fov_deg": scope.KINDS["mast"].sensor.fov_deg, "range_m": scope.KINDS["mast"].sensor.range_m}
                  for m in lay["masts"]],
        "zone": {"centre": enu(lay["zone"]["centre"])[0], "radius": lay["zone"]["radius"]},
    }


# ---------------------------------------------------------------- more operations at the same site (ops.py)

FENCE_PD = 0.95  # fence sensors are usually specified at 95-99 % probability of detection
FENCE_DELAY_MS = 30_000  # assumed: time the fence holds a person up
DOOR_DELAY_MS = 90_000  # assumed: time a locked door holds a person up
CHECK_MS = (300_000, 600_001)  # a manual gate check takes about 5-10 minutes (vendor-reported)
CALLBACK_MS = (120_000, 300_001)  # assumed: phoning the booking office to confirm a pickup
P_CATCH = {"paper": 0.35, "callback": 0.95}  # assumed chance that a fictitious booking is caught
DWELL_MS = (900_000, 2_100_001)  # 15-35 minutes at the door
TRUCKS_PER_HOUR = 4.0
NUISANCE_PER_DAY = 3.0  # a poor fence sensor; a good one is nearer one per kilometre per day


def _doors(lay: dict) -> tuple[list[list[float]], list[float]]:
    (fx0, fy0), (fx1, _), _, _ = lay["warehouse"]["ring"]
    doors = [[fx0 + f * (fx1 - fx0), fy0 - 6.0] for f in (0.2, 0.5, 0.8)]
    return doors, [fx0 + 0.35 * (fx1 - fx0), fy0 - 2.5]


def workers(lay: dict) -> list[dict]:
    """Twelve site staff: six at work on the apron, six who count as inside the building (they start at its door)."""
    doors, side_door = _doors(lay)
    out = []
    for i in range(6):
        d = doors[i % 3]
        out.append({"id": f"worker-{i + 1}", "kind": "worker", "label": f"Worker {i + 1}",
                    "home": [d[0] + (i // 3) * 3.0 - 1.5, d[1] - 2.0 - (i % 2) * 2.5], "payloads": ["radio"]})
    for i in range(6):
        out.append({"id": f"worker-{i + 7}", "kind": "worker", "label": f"Worker {i + 7} (indoors)",
                    "home": [side_door[0] + (i % 3) * 0.9 - 0.9, side_door[1] - (i // 3) * 0.9], "payloads": []})
    return [scope.validate_agent(a) for a in out]


def _approach(world: SimWorld, lay: dict, **kw) -> tuple[dict, np.ndarray, float]:
    base = drills(world, lay, **kw)[0]
    appear = base["events"][-1]
    c = np.array(lay["centre"])
    u = (np.array(appear["goto"]) - c) / np.linalg.norm(np.array(appear["goto"]) - c)
    return appear, u, float(np.linalg.norm(np.array(appear["goto"]) - c)) - 10.0


def gate_config(world: SimWorld, lay: dict, procedure: str) -> dict:
    gate, road = np.array(lay["gate"]["at"]), np.array(lay["link"][0])
    length = float(np.linalg.norm(road - gate))
    out = (road - gate) / length
    hold = [(gate + out * min(14.0 + 10.0 * k, length - 1.0)).tolist() for k in range(6)]
    doors, _ = _doors(lay)
    return {"hold": hold, "doors": doors, "exit": _far_drive_node(world, lay), "guard": "guard-2",
            "procedure": procedure, "check_ms": list(CHECK_MS), "callback_ms": list(CALLBACK_MS), "p_catch": P_CATCH,
            "dwell_ms": list(DWELL_MS)}


def gate_drill(world: SimWorld, lay: dict, procedure: str, seed: int, hours: float, fictitious: bool = True) -> dict:
    """A shift at the gate: trucks arrive at random (Poisson), one of them on a fictitious booking."""
    rng = np.random.default_rng([seed, 7919])
    cfg = gate_config(world, lay, procedure)
    t, times = 0.0, []
    while True:
        t += float(rng.exponential(3600.0 / TRUCKS_PER_HOUR))
        if t > hours * 3600 - 2400:  # nobody arrives in the last 40 minutes: everyone admitted can finish
            break
        times.append(t)
    fake = int(rng.integers(len(times))) if fictitious and times else -1
    events = [{"t_ms": int(ts * 1000), "type": "arrive_vehicle", "from": cfg["exit"], "door": i,
               "booking": "fictitious" if i == fake else "valid",
               "agent": {"id": f"truck-{i + 1}", "kind": "truck", "role": "visitor", "label": f"Truck {i + 1}"}}
              for i, ts in enumerate(times)]
    return {"id": f"gate-{procedure}", "kind": "gate", "zone": lay["zone"], "gate": cfg, "events": events,
            "title": "Gate shift, paper check" if procedure == "paper" else "Gate shift, call-back check",
            "info": {"procedure": procedure, "trucks": len(times), "hours": hours,
                     "fictitious": fake + 1 if fake >= 0 else None}}


def alarm_drill(lay: dict, policy: str, seed: int, days: float, per_day: float = NUISANCE_PER_DAY) -> dict:
    """Nuisance fence alarms at random times and places along the fence (Poisson)."""
    rng = np.random.default_rng([seed, 104729])
    fence = np.array([*lay["fence"], lay["fence"][0]], float)
    seg = np.linalg.norm(np.diff(fence, axis=0), axis=1)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    t, events = 0.0, []
    while True:
        t += float(rng.exponential(86_400.0 / per_day))
        if t > days * 86_400 - 1800:
            break
        d = float(rng.uniform(0, cum[-1]))
        k = min(int(np.searchsorted(cum, d, side="right")) - 1, len(seg) - 1)
        p = fence[k] + (fence[k + 1] - fence[k]) * ((d - cum[k]) / seg[k])
        events.append({"t_ms": int(t * 1000), "type": "alarm", "at": p.tolist()})
    return {"id": f"alarms-{policy}", "kind": "alarms", "zone": lay["zone"], "fence": {"pd": FENCE_PD},
            "alarm_policy": policy, "events": events, "info": {"policy": policy, "alarms": len(events), "days": days},
            "title": ("Nuisance alarms, verify first" if policy == "verify_first"
                      else "Nuisance alarms, everyone responds")}


def timeline_drill(world: SimWorld, lay: dict, did: str, title: str, faulted: str | None = None,
                   door_delay_ms: int = DOOR_DELAY_MS, alarm_policy: str | None = None, fence_pd: float = FENCE_PD,
                   **approach) -> dict:
    """Protection timeline: approach, fence, door. Optionally with a sensor out of service, and with a nuisance
    alarm on the far side of the site five minutes into the approach (handled by `alarm_policy`)."""
    appear, u, edge = _approach(world, lay, **approach)
    c = np.array(lay["centre"])
    _, side_door = _doors(lay)
    steps = [{"do": "cross", "barrier": "fence", "to": (c + (edge - 10.0) * u).tolist(), "ms": FENCE_DELAY_MS},
             {"do": "walk", "to": side_door},
             {"do": "wait", "ms": int(door_delay_ms), "log": "at_door"},
             {"do": "done"}]
    events: list[dict] = []
    if faulted:
        events.append({"t_ms": 0, "type": "sensor_fault", "agent": faulted, "duration_ms": 10 ** 9})
    if alarm_policy:
        events.append({"t_ms": appear["t_ms"] + 300_000, "type": "alarm", "at": (c - edge * u).tolist()})
    events.append({**appear, "then": steps})
    events.sort(key=lambda e: e["t_ms"])
    info = {"fence_pd": fence_pd, "fence_delay_s": FENCE_DELAY_MS / 1000, "door_delay_s": door_delay_ms / 1000,
            "bearing_deg": approach.get("bearing"), **({"faulted": faulted} if faulted else {}),
            **({"alarm_policy": alarm_policy} if alarm_policy else {})}
    return {"id": did, "kind": "timeline", "title": title, "zone": lay["zone"], "fence": {"pd": fence_pd},
            "events": events, "info": info, **({"alarm_policy": alarm_policy} if alarm_policy else {})}


def operations(world: SimWorld, lay: dict, **approach) -> list[dict]:
    """The scripted drills of the new operations, each short enough to replay."""
    c = np.array(lay["centre"])
    out = [
        timeline_drill(world, lay, "fence-to-door", "Protection timeline: from the fence to a door", **approach),
        timeline_drill(world, lay, "fence-to-door-drone-down", "Protection timeline, drone camera out",
                       faulted="drone-1", **approach),
        timeline_drill(world, lay, "fence-to-door-during-alarm", "Intrusion while a nuisance alarm is being handled",
                       faulted="drone-1", alarm_policy="all_respond", **approach),
    ]
    north = (c + np.array([0.0, lay["size"][1] / 2])).tolist()
    for policy in ("verify_first", "all_respond"):
        out.append({"id": f"nuisance-alarm-{policy.replace('_', '-')}", "kind": "alarm", "zone": lay["zone"],
                    "fence": {"pd": FENCE_PD}, "alarm_policy": policy, "info": {"policy": policy},
                    "events": [{"t_ms": 300_000, "type": "alarm", "at": north}],
                    "title": ("Nuisance fence alarm, checked by drone first" if policy == "verify_first"
                              else "Nuisance fence alarm, everyone responds")})
    g = gate_drill(world, lay, "callback", seed=3, hours=2.0)
    out.append({**g, "id": "gate-two-hours", "title": "Two hours at the gate, one fictitious pickup"})
    muster = (np.array(lay["guard_post"]["at"]) + (c - np.array(lay["gate"]["at"])) / np.linalg.norm(
        c - np.array(lay["gate"]["at"])) * 16.0).tolist()
    out.append({"id": "evacuation", "kind": "evacuation", "title": "Evacuation drill: everyone to the muster point",
                "zone": lay["zone"], "info": {"workers": 12, "premovement_median_s": 30.0, "muster": muster},
                "events": [{"t_ms": 120_000, "type": "evacuate", "muster": muster, "premovement_s": [30.0, 0.6],
                            "indoor_s": [10.0, 60.0], "inside": [f"worker-{i}" for i in range(7, 13)]}]})
    blocked = {**out[-1]["events"][0], "indoor_s": [60.0, 150.0]}  # nearest exit shut: the long way out of the building
    out.append({**out[-1], "id": "evacuation-exit-blocked", "title": "Evacuation drill with the nearest exit blocked",
                "events": [blocked], "info": {**out[-1]["info"], "indoor_s": [60.0, 150.0]}})
    return out
