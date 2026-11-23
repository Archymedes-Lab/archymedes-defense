"""Site-sim invariants (milestone 3). Written before the engine; each maps to a rule in PLAN.md or a Jev hazard.

Fixture: 400 m synthetic site with a 15 m ridge, one building, a forest patch, a road loop, a foot path, and a
stub of road that is not connected to the rest.
"""

from __future__ import annotations

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from archworld import terrain
from archworld.frames import Frame
from archworld.osm import roads_from_overpass
from archworld.sim import compound, scope
from archworld.sim.drill import score, tracks
from archworld.sim.engine import Sim
from archworld.sim.simworld import SimWorld
from archworld.sites import Site

S = Site(id="simfix", name="sim fixture", crs="EPSG:2056", vertical="LN02", x0=2_634_000.0, y0=1_158_000.0,
         size=400.0, tile=200.0, notes="synthetic")
X0, Y0 = S.x0, S.y0


def _h(x, y):
    dx, dy = np.asarray(x) - X0, np.asarray(y) - Y0
    ridge = 15.0 * np.exp(-((dx - 200.0) / 6.0) ** 2) * ((dy > 120) & (dy < 280))
    return 800.0 + 0.02 * dx + 0.01 * dy + ridge


def _world() -> tuple[SimWorld, list, dict]:
    res, pad = 0.5, 2.0
    xs = np.arange(X0 - pad + res / 2, X0 + 400 + pad, res)
    ys = np.arange(Y0 + 400 + pad - res / 2, Y0 - pad, -res)
    gx, gy = np.meshgrid(xs, ys)
    surf = terrain.Surface(S, terrain.Raster(_h(gx, gy).astype(np.float32), X0 - pad, Y0 + 400 + pad, res), 4.0)
    frame = Frame(S)

    def ll(x, y):
        lon, lat = frame.to_wgs84(X0 + x, Y0 + y)
        return {"lon": lon, "lat": lat}

    def way(i, tags, pts):
        return {"type": "way", "id": i, "tags": tags, "geometry": [ll(*p) for p in pts]}

    loop = [(50, 50), (350, 50), (350, 350), (50, 350), (50, 50)]
    ways = {"elements": [
        way(1, {"highway": "residential"}, loop[:2]), way(2, {"highway": "residential"}, loop[1:3]),
        way(3, {"highway": "residential"}, loop[2:4]),
        way(4, {"highway": "residential"}, [(50, 350), (50, 200), (50, 50)]),  # shares a node with the path
        way(5, {"highway": "path"}, [(50, 200), (150, 200)]),
        way(6, {"highway": "service"}, [(250, 120), (300, 120)]),  # an island: touches nothing
    ]}
    roads = roads_from_overpass(ways, S, frame, surf)
    b = 800.0 + 0.02 * 120 + 0.01 * 120 - 1.0
    ring = [(X0 + 114, Y0 + 114), (X0 + 126, Y0 + 114), (X0 + 126, Y0 + 126), (X0 + 114, Y0 + 126)]
    buildings = [{"fid": 0, "ring": ring, "base": b, "top": b + 10.0}]
    canopy = np.zeros((200, 200), np.float32)  # 2 m cells, row 0 = south
    canopy[150:190, 20:120] = 20.0  # forest: x 40..240, y 300..380
    return SimWorld.from_parts(S, surf, buildings, roads, canopy=canopy, canopy_step=2.0), buildings, roads


W, BUILDINGS, ROADS = _world()
P = lambda x, y: (X0 + x, Y0 + y)  # noqa: E731
GUARD = {"id": "g1", "kind": "guard", "home": P(50, 50), "patrol": [P(350, 50), P(350, 350), P(50, 350), P(50, 50)]}
DOG = {"id": "d1", "kind": "dog", "home": P(50, 350), "patrol": [P(350, 350), P(50, 350)]}
DRONE = {"id": "u1", "kind": "drone", "home": P(60, 60), "patrol": [P(340, 340), P(60, 340), P(60, 60)]}
VEH = {"id": "v1", "kind": "vehicle", "home": P(350, 50), "patrol": [P(50, 50), P(350, 50)]}
ZONE = {"centre": P(300, 300), "radius": 40.0, "notional": True}


def _drill(t=120_000, at=(52, 200), goto=(300, 300), cross=False, extra=()):
    return {"id": "t", "zone": ZONE, "events": [
        {"t_ms": t, "type": "appear", "agent": {"id": "x1", "kind": "person", "role": "unknown"}, "at": P(*at),
         "goto": P(*goto), "cross_country": cross}, *extra]}


# ---------------------------------------------------------------- scope

def test_scope_refuses_weapons_unknown_kinds_and_keys():
    scope.validate_agent({"id": "a", "kind": "guard", "home": P(50, 50), "payloads": ["camera", "radio"]})
    for bad in ({"id": "a", "kind": "guard", "home": P(50, 50), "payloads": ["rifle"]},
                {"id": "a", "kind": "guard", "home": P(50, 50), "payloads": ["camera", "munition"]},
                {"id": "a", "kind": "turret", "home": P(50, 50)},
                {"id": "a", "kind": "guard", "home": P(50, 50), "weapon": "none"},
                {"id": "a", "kind": "guard", "home": P(50, 50), "rules_of_engagement": "x"}):
        with pytest.raises(scope.ScopeError):
            scope.validate_agent(bad)
    assert not any("weapon" in k or "engage" in k or "target" in k for k in scope.AGENT_KEYS)


def test_zone_must_be_declared_notional():
    scope.validate_zone(ZONE)
    with pytest.raises(scope.ScopeError):
        scope.validate_zone({"centre": P(1, 1), "radius": 10.0})
    with pytest.raises(scope.ScopeError):
        scope.validate_zone({"centre": P(1, 1), "radius": 10.0, "notional": False})


# ---------------------------------------------------------------- world: graph, frame

def test_graph_components_are_measured_and_routing_stays_inside_one():
    g = W.graph_report()
    assert g["foot"]["components"] == 2 and g["drive"]["components"] == 2  # loop(+path) and the island
    assert 0.8 < g["foot"]["main_fraction"] < 1.0
    a, b = W.nearest_node(P(50, 50), "foot"), W.nearest_node(P(350, 350), "foot")
    r = W.route(scope.KINDS["guard"], a, b)
    assert r is not None and r.T[0] == 0 and (np.diff(r.T) > 0).all() and r.T.dtype == np.int64
    island = W.nearest_node(P(275, 120), "drive", main_only=False)
    assert W.route(scope.KINDS["vehicle"], W.nearest_node(P(50, 50), "drive"), island) is None
    # snapping to the main component never returns the island
    assert W.nearest_node(P(275, 120), "drive") != island


def test_vehicles_do_not_use_foot_paths():
    r = W.route(scope.KINDS["vehicle"], W.nearest_node(P(50, 50), "drive"), W.nearest_node(P(50, 350), "drive"))
    assert not ((np.abs(r.pts[:, 1] - (Y0 + 200)) < 1) & (r.pts[:, 0] > X0 + 60)).any()
    assert W.nearest_node(P(150, 200), "drive") != W.nearest_node(P(150, 200), "foot")


@pytest.mark.parametrize("kind", ["person", "guard", "dog", "vehicle"])
def test_route_respects_speed_limits(kind):
    k = scope.KINDS[kind]
    mode = k.ways
    r = W.route(k, W.nearest_node(P(50, 50), mode), W.nearest_node(P(350, 350), mode))
    d = np.linalg.norm(np.diff(r.pts[:, :2], axis=0), axis=1)
    assert (d / (np.diff(r.T) / 1000.0) <= k.vmax + 1e-9).all()


def test_slope_slows_but_never_blocks_a_mapped_way_and_blocks_open_ground():
    k = scope.KINDS["guard"]
    a, b = W.nearest_node(P(50, 50), "foot"), W.nearest_node(P(51, 50), "foot")
    cls = W.adj[a][0][1]
    flat, steep, wall = (W._edge_ms(k, a, b, cls, dz) for dz in (0.0, 0.4, 50.0))
    assert flat < steep <= wall and wall is not None
    # off the paths the 40 degree limit is hard: nobody walks straight over the 15 m ridge (it is ~55 degrees)
    r = W.cross_country(scope.KINDS["person"], P(170, 200), P(230, 200))
    d = np.linalg.norm(np.diff(r.pts[:, :2], axis=0), axis=1)
    slope = np.degrees(np.arctan2(np.abs(np.diff(r.pts[:, 2])), d))
    assert (slope <= scope.KINDS["person"].slope_max_deg + 1e-6).all() and d.sum() > 150


def test_grid_frame_distortion_is_small_and_measured():
    ppm = W.frame_distortion_ppm(Frame(S))
    assert 0 <= ppm < 500  # grid metres vs true metres; recorded in every run manifest


# ---------------------------------------------------------------- line of sight

@settings(max_examples=80, deadline=None)
@given(st.floats(5, 395), st.floats(5, 395), st.floats(5, 395), st.floats(5, 395), st.floats(0.5, 40),
       st.floats(0.5, 40))
def test_line_of_sight_is_symmetric(ax, ay, bx, by, ah, bh):
    a = np.array([X0 + ax, Y0 + ay, float(W.ground(X0 + ax, Y0 + ay)) + ah])
    b = np.array([X0 + bx, Y0 + by, float(W.ground(X0 + bx, Y0 + by)) + bh])
    assert W.los(a, b) == W.los(b, a)


def _eye(x, y, h=1.7):
    return np.array([X0 + x, Y0 + y, float(W.ground(X0 + x, Y0 + y)) + h])


def test_line_of_sight_blocked_by_ridge_building_and_forest():
    assert W.los(_eye(150, 60), _eye(260, 60))  # open ground south of the ridge
    assert not W.los(_eye(170, 200), _eye(230, 200))  # across the 15 m ridge
    assert W.los(_eye(170, 200, 40), _eye(230, 200, 40))  # ...but not from 40 m up
    assert not W.los(_eye(100, 120), _eye(140, 120))  # through the building
    assert W.los(_eye(100, 120, 30), _eye(140, 120, 30))  # over its roof
    assert not W.los(_eye(45, 340), _eye(235, 340))  # 190 m of forest
    assert W.los(_eye(45, 340), _eye(60, 340))  # 15 m of forest: still visible
    assert W.los(_eye(45, 340, 60), _eye(235, 340, 60))  # above the canopy


# ---------------------------------------------------------------- engine

def _run(agents, seed=1, drill=None, until=900_000, **kw):
    return Sim(W, agents, seed=seed, drill=drill, **kw).run(until)


def test_same_seed_same_run_and_seed_matters():
    a = _run([GUARD, DOG, DRONE, VEH], seed=3, drill=_drill())
    b = _run([GUARD, DOG, DRONE, VEH], seed=3, drill=_drill())
    c = _run([GUARD, DOG, DRONE, VEH], seed=4, drill=_drill())
    assert a.digest == b.digest and a.log == b.log
    assert a.digest != c.digest


def test_an_injected_event_cannot_affect_anything_before_its_time():
    base = _run([GUARD, DOG, DRONE], seed=5, drill=_drill(t=300_000))
    other = _run([GUARD, DOG, DRONE], seed=5, drill=_drill(t=300_000, at=(52, 60), goto=(340, 60)))
    none = _run([GUARD, DOG, DRONE], seed=5)
    cut = lambda r: [e for e in r.log if e["t"] < 300_000]  # noqa: E731
    assert cut(base) == cut(other) == cut(none) and len(cut(base)) > 3
    for aid in ("g1", "d1", "u1"):
        for t in range(0, 300_000, 7_000):
            assert np.array_equal(base.position(aid, t), other.position(aid, t))
            assert np.array_equal(base.position(aid, t), none.position(aid, t))


def test_forced_sensing_ticks_change_nothing():
    a = _run([GUARD, DOG, DRONE], seed=6, drill=_drill())
    b = _run([GUARD, DOG, DRONE], seed=6, drill=_drill(), force_sense=True)
    assert a.digest == b.digest
    assert _run([GUARD, DOG], seed=6).digest == _run([GUARD, DOG], seed=6, force_sense=True).digest


def test_adding_an_agent_does_not_change_another_agents_randomness():
    a = _run([GUARD], seed=7, until=2_400_000)
    b = _run([GUARD, DOG, VEH], seed=7, until=2_400_000)
    ga = [e for e in a.log if e.get("agent") == "g1"]
    gb = [e for e in b.log if e.get("agent") == "g1"]
    assert ga == gb and len(ga) > 4


def _samples(r, aid, step=500):
    t0, t1 = r.span(aid)
    ts = np.arange(t0, t1 + 1, step)
    return ts, np.array([r.position(aid, int(t)) for t in ts])


def test_no_agent_under_terrain_or_inside_a_building_and_limits_hold():
    r = _run([GUARD, DOG, DRONE, VEH], seed=8, drill=_drill(cross=True), until=1_200_000)
    assert any(e["type"] == "dispatch" for e in r.log)  # the run includes re-tasking in the middle of legs
    for aid, kind in (("g1", "guard"), ("d1", "dog"), ("v1", "vehicle"), ("x1", "person"), ("u1", "drone")):
        k = scope.KINDS[kind]
        ts, p = _samples(r, aid, 250)
        ground = W.ground(p[:, 0], p[:, 1])
        assert (p[:, 2] >= ground - 1e-6).all(), aid
        step = np.linalg.norm(np.diff(p[:, :2], axis=0), axis=1)
        assert (step <= k.vmax * 0.25 + 1e-6).all(), f"{aid}: jump or speeding"
        if k.ground:
            assert not W.inside_building(p[:, 0], p[:, 1]).any(), aid
        else:
            air = step > 1e-9
            assert (p[1:][air][:, 2] - ground[1:][air] >= k.min_clear_m - 1e-6).all(), "drone clearance"
            assert (np.abs(np.diff(p[:, 2])) <= k.climb_ms * 0.25 + 1e-6).all(), "drone climb rate"


def test_energy_never_rises_without_a_charge_event_and_never_goes_negative():
    r = _run([DOG, DRONE, VEH], seed=9, until=6 * 3_600_000)
    assert any(e["type"] == "charge_done" for e in r.log)
    for aid in ("d1", "u1", "v1"):
        tr = r.energy_trace[aid]  # (t, energy, cause)
        assert all(e >= 0 for _, e, _ in tr)
        for (_, e0, _), (_, e1, cause) in zip(tr[:-1], tr[1:], strict=True):
            assert e1 <= e0 or cause == "charge_done"


def test_no_detection_through_a_building_or_a_ridge():
    # a guard on the path at x=100 looks east; the subject crosses x=140..180 right behind the building
    post = {"id": "g2", "kind": "guard", "home": P(100, 120), "facing_deg": 90.0}
    hidden = _drill(t=10_000, at=(140, 120), goto=(141, 121), cross=True)
    r = _run([post], seed=1, drill=hidden, until=400_000, detect="sure")
    assert not any(e["type"] == "detected" for e in r.log)
    post2 = {"id": "g3", "kind": "guard", "home": P(170, 200), "facing_deg": 90.0}
    r2 = _run([post2], seed=1, drill=_drill(t=10_000, at=(230, 200), goto=(231, 201), cross=True), until=400_000,
              detect="sure")
    assert not any(e["type"] == "detected" for e in r2.log)
    # control: same guard, subject in the open and in view
    r3 = _run([post], seed=1, drill=_drill(t=10_000, at=(100, 160), goto=(101, 161), cross=True), until=400_000,
              detect="sure")
    assert not any(e["type"] == "detected" for e in r3.log)  # north of the guard: outside the 120 degree view
    post4 = {"id": "g4", "kind": "guard", "home": P(100, 60), "facing_deg": 90.0}
    r4 = _run([post4], seed=1, drill=_drill(t=10_000, at=(160, 60), goto=(161, 61), cross=True), until=400_000,
              detect="sure")
    d = [e for e in r4.log if e["type"] == "detected"]
    assert d and d[0]["cause"]["observer"] == "g4" and d[0]["cause"]["los"] is True and d[0]["cause"]["range_m"] < 150


def test_every_detection_has_a_cause_and_a_live_sensor():
    fault = {"t_ms": 0, "type": "sensor_fault", "agent": "g4", "duration_ms": 200_000}
    post4 = {"id": "g4", "kind": "guard", "home": P(100, 60), "facing_deg": 90.0}
    r = _run([post4], seed=1, drill=_drill(t=10_000, at=(160, 60), goto=(161, 61), cross=True, extra=(fault,)),
             until=400_000, detect="sure")
    d = [e for e in r.log if e["type"] == "detected"]
    assert d and d[0]["t"] >= 200_000  # nothing while the sensor was down
    assert {"observer", "range_m", "los", "p"} <= set(d[0]["cause"])


def test_drill_is_scored_and_responders_arrive():
    r = _run([GUARD, DOG, DRONE, VEH], seed=11, drill=_drill(), until=1_500_000)
    s = score(r, _drill())["subjects"]["x1"]
    assert s["appeared_ms"] == 120_000 and s["detected_ms"] is not None and s["detected_ms"] >= s["appeared_ms"]
    assert s["time_to_detect_s"] == (s["detected_ms"] - s["appeared_ms"]) / 1000
    assert s["contact_ms"] is None or s["contact_ms"] >= s["detected_ms"]
    assert isinstance(s["entered_zone"], bool)
    assert any(e["type"] == "dispatch" for e in r.log)


def test_road_block_changes_routes_only_after_it_is_logged():
    blk = {"t_ms": 60_000, "type": "road_block", "at": P(200, 50), "radius": 10.0}
    veh = {"id": "v1", "kind": "vehicle", "home": P(60, 50), "patrol": [P(340, 50), P(60, 50)]}
    r = _run([veh], seed=2, drill={"id": "b", "zone": ZONE, "events": [blk]}, until=1_800_000)
    assert any(e["type"] == "road_block" and e["t"] == 60_000 for e in r.log)
    ts, p = _samples(r, "v1", 1000)
    late = ts > 400_000
    near = np.hypot(p[:, 0] - (X0 + 200), p[:, 1] - (Y0 + 50)) < 9.0
    assert not (near & late).any()  # after the block the vehicle goes the long way round
    assert (np.hypot(p[late][:, 0] - (X0 + 350), p[late][:, 1] - (Y0 + 350)) < 30).any()


def test_cross_country_route_avoids_buildings_and_steep_ground():
    r = W.cross_country(scope.KINDS["person"], P(100, 120), P(140, 120))
    assert r is not None and not W.inside_building(r.pts[:, 0], r.pts[:, 1]).any()
    d = np.linalg.norm(np.diff(r.pts[:, :2], axis=0), axis=1)
    assert (d / (np.diff(r.T) / 1000) <= scope.KINDS["person"].vmax + 1e-9).all()
    assert d.sum() > 40  # had to walk around the building


def test_long_horizon_run_counts_cycles_wear_and_availability():
    r = _run([DOG, DRONE], seed=12, until=10 * 86_400_000, keep_legs=False)
    for aid in ("d1", "u1"):
        a = r.agents[aid]
        assert a["cycles"] > 5 and 0.9 < a["capacity_fraction"] < 1.0
        assert a["moving_ms"] + a["idle_ms"] + a["charging_ms"] == 10 * 86_400_000
        assert 0 < a["availability"] < 1
    assert r.events_processed < 400_000  # nothing is stepped while nothing happens


def test_tracks_are_in_the_tile_frame():
    r = _run([GUARD], seed=1, until=300_000)
    f = Frame(S)
    tr = tracks(r, f, every_ms=2000)["g1"]
    t, e, n, u = tr[0]
    x, y, z = r.position("g1", int(t * 1000))
    ee, nn, uu = f.to_enu(np.array([x]), np.array([y]), np.array([z]))
    assert abs(e - ee[0]) < 0.06 and abs(n - nn[0]) < 0.06 and abs(u - uu[0]) < 0.06


# ---------------------------------------------------------------- off-path response, warehouse compound

def test_a_responder_leaves_the_path_and_meets_the_subject():
    post = {"id": "g4", "kind": "guard", "home": P(100, 60), "facing_deg": 90.0}
    r = _run([post], seed=1, drill=_drill(t=10_000, at=(160, 60), goto=(161, 61), cross=True), until=600_000,
             detect="sure")
    c = [e for e in r.log if e["type"] == "contact"]
    assert c and c[0]["agent"] == "g4"
    gap = np.linalg.norm(r.position("g4", c[0]["t"]) - r.position("x1", c[0]["t"]))
    assert gap <= 10.0 + 1e-6
    ts, p = _samples(r, "g4", 250)
    assert (np.linalg.norm(np.diff(p[:, :2], axis=0), axis=1) <= 1.7 * 0.25 + 1e-6).all()  # no jump on re-tasking
    assert (p[:, 2] >= W.ground(p[:, 0], p[:, 1]) - 1e-6).all() and not W.inside_building(p[:, 0], p[:, 1]).any()


@pytest.fixture(scope="module")
def yard():
    return compound.with_compound(W, BUILDINGS, ROADS, w=120.0, h=90.0, margin=100.0, step=5.0)


def test_compound_sits_on_open_flat_ground_and_is_synthetic(yard):
    world, lay, roads = yard
    fence = compound.shapely.Polygon(lay["fence"])
    assert lay["relief_m"] <= 8.0
    assert lay["provenance"]["method"] == "synthetic" and lay["provenance"]["confidence"] == 0
    assert not any(fence.intersects(p) for p in W.polys)  # no measured building inside or across the fence
    bx0, by0, bx1, by1 = fence.bounds
    gx, gy = np.meshgrid(np.linspace(bx0 + 1, bx1 - 1, 60), np.linspace(by0 + 1, by1 - 1, 45))
    assert (W.canopy_at(gx, gy) >= 2.0).mean() <= 0.01  # the rule: at most 1 % tree cover, at the very edge
    assert not ((W.nx > fence.bounds[0]) & (W.nx < fence.bounds[2]) & (W.ny > fence.bounds[1])
                & (W.ny < fence.bounds[3])).any()  # no existing path runs through it
    placed = [b for b in world.buildings if b.get("synthetic")]
    assert len(placed) == 1 and len(world.buildings) == len(BUILDINGS) + 1  # measured buildings are all still there
    assert all(w.get("synthetic") for w in roads["ways"][len(ROADS["ways"]):]) and lay["zone"]["notional"] is True
    assert lay["ring"][0] == lay["ring"][-1]


def test_compound_yard_is_connected_through_the_gate_only(yard):
    world, lay, _ = yard
    bay = world.nearest_node(lay["vehicle_bay"]["at"], "drive")
    outside = world.nearest_node(P(50, 50), "drive")
    r = world.route(scope.KINDS["vehicle"], bay, outside)
    assert r is not None
    gate = np.array(lay["gate"]["at"])
    assert np.hypot(r.pts[:, 0] - gate[0], r.pts[:, 1] - gate[1]).min() < 1.0  # the only way out is the gate
    inside_pt = np.array(lay["centre"]) + np.array([40.0, 25.0])
    out_pt = np.array(lay["centre"]) + np.array([0.0, lay["size"][1] / 2 + 25.0])
    assert world.side_of(inside_pt) == 0 and world.side_of(out_pt) == -1
    assert world.cross_country(scope.KINDS["person"], inside_pt, out_pt) is None  # nobody walks through the fence
    j = world.nearest_node(lay["junction"], "foot")
    ex = world.best_exit(scope.KINDS["guard"], j, out_pt)
    assert world._node_side[ex] == -1 and world.side_of((world.nx[ex], world.ny[ex])) == -1


def test_compound_staff_and_drills_are_in_scope_and_run(yard):
    world, lay, _ = yard
    agents = compound.staff(world, lay)
    assert {a["kind"] for a in agents} == {"guard", "dog", "vehicle", "drone", "mast"}
    ds = compound.drills(world, lay, appear_ms=60_000, start_m=140.0)
    assert [d["id"] for d in ds] == ["approach-on-foot", "approach-with-mast-fault", "approach-with-drone-down"]
    for d in ds:
        scope.validate_zone(d["zone"])
    r = Sim(world, agents, seed=3, drill=ds[0]).run(60_000 + 20 * 60_000)
    s = score(r, ds[0])["subjects"]["subject-1"]
    assert s["detected_ms"] is not None
    site = compound.viewer_site(world, lay, Frame(S))
    assert site["notional"] is True and len(site["masts"]) == 4 and len(site["warehouse"]["corners"]) == 4
    # nobody on staff ends up inside the warehouse or under the ground
    for a in agents:
        if a["kind"] == "mast":
            continue
        _, p = _samples(r, a["id"], 1000)
        assert (p[:, 2] >= world.ground(p[:, 0], p[:, 1]) - 1e-6).all(), a["id"]
        if scope.KINDS[a["kind"]].ground:
            assert not world.inside_building(p[:, 0], p[:, 1]).any(), a["id"]


def test_compound_link_does_not_cross_water_or_rail(yard):
    # the same fixture with a stream between the compound and its nearest road: another road must be chosen
    _, lay, _ = yard
    link = compound.shapely.LineString(lay["link"][:2])
    mid = np.array(link.interpolate(0.5, normalized=True).coords[0])
    d = np.array(lay["link"][1]) - np.array(lay["link"][0])
    nrm = np.array([-d[1], d[0]]) / np.hypot(*d)
    stream = [list(mid + nrm * t) + [0.0] for t in np.arange(-40.0, 40.1, 1.0)]
    water = {"kind": "waterway", "class": "stream", "lv95": stream, "tunnel": False}
    roads = {**ROADS, "ways": [*ROADS["ways"], water]}
    try:
        _, lay2, _ = compound.with_compound(W, BUILDINGS, roads, w=120.0, h=90.0, margin=100.0, step=5.0)
    except RuntimeError:
        return  # no other road in reach: refusing is also correct
    link2 = compound.shapely.LineString(lay2["link"][:2])
    assert not link2.intersects(compound.shapely.LineString([p[:2] for p in stream]))
