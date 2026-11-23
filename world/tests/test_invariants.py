"""World invariants (milestone 1). Written before the pipeline; every one maps to a rule in PLAN.md or a Jev hazard.

Synthetic fixtures only: an analytic terrain with a cliff, a few box buildings and OSM-style ways. Real-data checks
run in the build itself and land in report.json.
"""

from __future__ import annotations

import hashlib
import json
import struct

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from archworld import glb, guard, provenance, terrain
from archworld.build import Inputs, build_world
from archworld.frames import Frame
from archworld.osm import roads_from_overpass
from archworld.sites import REFUSED_SITE_TERMS, SITES, Site

SITE = SITES["ch-lauterbrunnen"]
SMALL = Site(id="t", name="fixture", crs="EPSG:2056", vertical="LN02", x0=2_634_000.0, y0=1_158_000.0,
             size=400.0, tile=200.0, notes="synthetic")


def _height(x, y):
    """Valley floor at 800 m, a 300 m cliff along x = x0+250, gentle slope."""
    dx = np.asarray(x) - SMALL.x0
    dy = np.asarray(y) - SMALL.y0
    return 800.0 + 0.05 * dy + 300.0 / (1.0 + np.exp(-(dx - 250.0) / 4.0)) + 3.0 * np.sin(dx / 17.0)


def _raster(res=0.5, pad=2.0):
    x0, y0, x1, y1 = SMALL.bounds
    xs = np.arange(x0 - pad + res / 2, x1 + pad, res)
    ys = np.arange(y1 + pad - res / 2, y0 - pad, -res)
    gx, gy = np.meshgrid(xs, ys)
    return terrain.Raster(_height(gx, gy).astype(np.float32), x0 - pad, y1 + pad, res)


def _box(cx, cy, w, h, base):
    x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - w / 2, cy + w / 2
    top = base + h
    ring = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    faces = [[(x, y, top) for x, y in ring], [(x, y, base) for x, y in reversed(ring)]]  # roof up, floor down
    for k in range(4):
        (ax, ay), (bx, by) = ring[k], ring[(k + 1) % 4]
        faces.append([(ax, ay, base), (bx, by, base), (bx, by, top), (ax, ay, top)])
    return faces


def _inputs():
    r = _raster()
    x0, y0 = SMALL.x0, SMALL.y0
    blds = [
        {"id": "b1", "faces": _box(x0 + 60, y0 + 60, 12, 9, float(_height(x0 + 60, y0 + 60)) - 0.2),
         "attrs": {"EGID": 1}},
        # on the cliff: the coarse mesh is far from the true ground here, the skirt must still reach it
        {"id": "b2", "faces": _box(x0 + 248, y0 + 150, 10, 6, float(_height(x0 + 248, y0 + 150))),
         "attrs": {"EGID": 2}},
    ]
    t = Frame(SMALL).to_wgs84
    def ll(x, y):
        lon, lat = t(x, y)
        return {"lon": lon, "lat": lat}
    ways = {"elements": [
        {"type": "way", "id": 10, "tags": {"highway": "secondary", "name": "Talstrasse"},
         "geometry": [ll(SMALL.x0 + 5, SMALL.y0 + 5), ll(SMALL.x0 + 390, SMALL.y0 + 395)]},
        {"type": "way", "id": 11, "tags": {"highway": "path", "width": "1.5"},
         "geometry": [ll(SMALL.x0 + 100, SMALL.y0 + 20), ll(SMALL.x0 + 300, SMALL.y0 + 20)]},
        {"type": "way", "id": 12, "tags": {"highway": "track", "tunnel": "yes"},
         "geometry": [ll(SMALL.x0 + 10, SMALL.y0 + 300), ll(SMALL.x0 + 200, SMALL.y0 + 300)]},
    ]}
    def ortho(bounds, px):
        x0, y0, x1, y1 = bounds
        xs = np.linspace(x0, x1, px)
        img = np.zeros((px, px, 3), np.uint8)
        img[..., 1] = (xs[None, :] - x0) / (x1 - x0) * 255
        return img
    return Inputs(dtm=r, ortho=ortho, buildings=blds, overpass=ways,
                  sources=[{"layer": "dtm", "url": "fixture", "sha256": "0" * 64, "licence": provenance.SWISSTOPO}])


# ---------------------------------------------------------------- scope

def test_sites_are_civil_and_declared():
    for s in SITES.values():
        text = (s.name + " " + s.notes).lower()
        assert not any(t in text for t in REFUSED_SITE_TERMS), s.id
        assert s.size / s.tile == round(s.size / s.tile)
        assert s.vertical in {"LN02", "NAVD88"}


# ---------------------------------------------------------------- provenance

def test_every_record_needs_source_licence_method():
    with pytest.raises(provenance.ProvenanceError):
        provenance.Record(1.0, "", provenance.SWISSTOPO, "measured", 1.0)
    with pytest.raises(provenance.ProvenanceError):
        provenance.Record(1.0, "x", "", "measured", 1.0)
    with pytest.raises(provenance.ProvenanceError):
        provenance.Record(1.0, "x", provenance.SWISSTOPO, "guessed", 0.5)
    with pytest.raises(provenance.ProvenanceError):
        provenance.Record(1.0, "x", provenance.SWISSTOPO, "measured", 1.5)


@given(st.sampled_from(provenance.METHODS), st.sampled_from(provenance.METHODS))
def test_deduced_never_overwrites_measured(a, b):
    led = provenance.Ledger()
    ra = provenance.Record(1.0, "s", provenance.SWISSTOPO, a, provenance.CAP[a])
    rb = provenance.Record(2.0, "s", provenance.SWISSTOPO, b, provenance.CAP[b])
    led.put("k", ra)
    if provenance.RANK[b] < provenance.RANK[a]:
        with pytest.raises(provenance.ProvenanceError):
            led.put("k", rb)
        assert led.get("k").value == 1.0
    else:
        led.put("k", rb)
        assert led.get("k").value == 2.0


@given(st.sampled_from(provenance.METHODS), st.floats(0, 1))
def test_confidence_is_capped_by_method(m, c):
    if c > provenance.CAP[m]:
        with pytest.raises(provenance.ProvenanceError):
            provenance.Record(0, "s", provenance.SWISSTOPO, m, c)
    else:
        provenance.Record(0, "s", provenance.SWISSTOPO, m, c)


def test_method_caps_are_monotone():
    caps = [provenance.CAP[m] for m in sorted(provenance.METHODS, key=lambda m: -provenance.RANK[m])]
    assert caps == sorted(caps, reverse=True)


# ---------------------------------------------------------------- hidden truth

@pytest.mark.parametrize("layer", sorted(guard.TRUTH_LAYERS))
def test_truth_layers_refused_to_deduction(tmp_path, layer):
    with pytest.raises(guard.TruthLeak):
        guard.raw_path(tmp_path, layer, purpose="deduce")
    assert guard.raw_path(tmp_path, layer, purpose="world") == tmp_path / layer


def test_unknown_purpose_refused(tmp_path):
    with pytest.raises(ValueError):
        guard.raw_path(tmp_path, "dtm", purpose="anything")


# ---------------------------------------------------------------- frames

_F = Frame(SITE)


def test_vertical_uses_geoid_grid_not_ballpark():
    assert "LN02" in _F.vertical_method and "allpark" not in _F.vertical_method


@settings(max_examples=60, deadline=None)
@given(st.floats(0, 4000), st.floats(0, 4000), st.floats(500, 4200))
def test_enu_round_trip_sub_millimetre(dx, dy, h):
    x, y = SITE.x0 + dx, SITE.y0 + dy
    e, n, u = _F.to_enu(np.array([x]), np.array([y]), np.array([h]))
    x2, y2, h2 = _F.from_enu(e, n, u)
    assert abs(x2[0] - x) < 1e-3 and abs(y2[0] - y) < 1e-3 and abs(h2[0] - h) < 1e-3


def test_enu_matches_local_distances():
    # 1 km east in LV95 is ~1 km in ENU (LV95 scale error < 0.1% here), and up is up
    e, n, u = _F.to_enu(np.array([SITE.x0, SITE.x0 + 1000]), np.array([SITE.y0, SITE.y0]), np.array([800.0, 800.0]))
    assert abs(np.hypot(e[1] - e[0], n[1] - n[0]) - 1000) < 1.0
    e, n, u = _F.to_enu(np.array([SITE.center[0]] * 2), np.array([SITE.center[1]] * 2), np.array([800.0, 900.0]))
    assert abs((u[1] - u[0]) - 100) < 1e-3


# ---------------------------------------------------------------- terrain

def test_tile_seams_share_vertices_exactly():
    r = _raster()
    a = terrain.tile_grid(SMALL, r, 0, 0, step=4.0)
    b = terrain.tile_grid(SMALL, r, 1, 0, step=4.0)
    c = terrain.tile_grid(SMALL, r, 0, 1, step=4.0)
    # east edge of a == west edge of b; north edge of a == south edge of c (same LV95 xy and same height, bitwise)
    assert np.array_equal(a.x[:, -1], b.x[:, 0]) and np.array_equal(a.y[:, -1], b.y[:, 0])
    assert np.array_equal(a.h[:, -1], b.h[:, 0])
    assert np.array_equal(a.h[-1, :], c.h[0, :])


def test_surface_height_matches_triangles():
    r = _raster()
    g = terrain.tile_grid(SMALL, r, 0, 0, step=4.0)
    surf = terrain.Surface(SMALL, r, step=4.0)
    # vertices are exact
    assert np.allclose(surf.height(g.x.ravel(), g.y.ravel()), g.h.ravel(), atol=1e-4)
    # interior points lie on the plane of the triangle that contains them
    rng = np.random.default_rng(0)
    px = SMALL.x0 + rng.uniform(0, 199, 500)
    py = SMALL.y0 + rng.uniform(0, 199, 500)
    hz = surf.height(px, py)
    i = np.floor((px - SMALL.x0) / 4).astype(int)
    j = np.floor((py - SMALL.y0) / 4).astype(int)
    fx = (px - SMALL.x0) / 4 - i
    fy = (py - SMALL.y0) / 4 - j
    h00, h10, h01, h11 = g.h[j, i], g.h[j, i + 1], g.h[j + 1, i], g.h[j + 1, i + 1]
    lower = fx >= fy  # diagonal from (0,0) to (1,1)
    ref = np.where(lower, h00 + fx * (h10 - h00) + fy * (h11 - h10), h00 + fy * (h01 - h00) + fx * (h11 - h01))
    assert np.allclose(hz, ref, atol=1e-4)


def test_mesh_indices_valid_and_ccw_up():
    r = _raster()
    g = terrain.tile_grid(SMALL, r, 0, 0, step=4.0)
    idx = terrain.grid_indices(g.x.shape)
    assert idx.max() < g.x.size and idx.min() >= 0
    tri = idx.reshape(-1, 3)
    x, y = g.x.ravel(), g.y.ravel()
    cross = (x[tri[:, 1]] - x[tri[:, 0]]) * (y[tri[:, 2]] - y[tri[:, 0]]) - (y[tri[:, 1]] - y[tri[:, 0]]) * (
        x[tri[:, 2]] - x[tri[:, 0]])
    assert (cross > 0).all()  # counter-clockwise seen from above: faces point up


# ---------------------------------------------------------------- glb

def test_glb_is_deterministic_and_well_formed():
    pos = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], np.float32)
    mk = lambda: glb.write(meshes=[glb.Mesh(pos, np.array([0, 1, 2], np.uint16), uv=np.zeros((3, 2), np.float32),  # noqa: E731
                                            texture_jpeg=b"\xff\xd8\xff\xd9", unlit=True)], extras={"a": 1})
    a, b = mk(), mk()
    assert a == b
    magic, version, length = struct.unpack("<4sII", a[:12])
    assert magic == b"glTF" and version == 2 and length == len(a) and length % 4 == 0
    jlen, jtype = struct.unpack("<I4s", a[12:20])
    assert jtype == b"JSON" and jlen % 4 == 0
    doc = json.loads(a[20:20 + jlen])
    acc = doc["accessors"][0]
    assert acc["min"] == [0, 0, 0] and acc["max"] == [1, 1, 0]


# ---------------------------------------------------------------- roads (OSM layer)

def test_roads_densified_draped_and_tunnels_hidden():
    r = _raster()
    surf = terrain.Surface(SMALL, r, step=4.0)
    frame = Frame(SMALL)
    roads = roads_from_overpass(_inputs().overpass, SMALL, frame, surf, max_seg=1.0)
    by = {w["osm_id"]: w for w in roads["ways"]}
    road = by[10]
    xy = np.array(road["lv95"])
    seg = np.hypot(*np.diff(xy[:, :2], axis=0).T)
    assert seg.max() <= 1.0 + 1e-6
    above = xy[:, 2] - surf.height(xy[:, 0], xy[:, 1])
    assert np.allclose(above, roads["offset_m"], atol=1e-3)  # follows the rendered surface, never cuts into it
    assert by[12]["render"] is False  # tunnel
    assert by[11]["width"]["method"] == "tagged" and by[10]["width"]["method"] == "default"
    assert roads["licence"] == provenance.ODBL


# ---------------------------------------------------------------- whole build

@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp("w1")
    report = build_world(SMALL, _inputs(), out, leaf_step=4.0, root_step=20.0, tex_px=64, root_tex_px=64)
    return out, report


def test_no_building_floats(built):
    _, report = built
    for b in report["buildings"]["gaps"]:
        assert b["skirt_bottom"] <= b["min_surface_under_footprint"] + 1e-6


def test_every_feature_has_provenance(built):
    out, report = built
    bl = json.loads((out / "buildings.json").read_text())
    assert bl["features"]
    for f in bl["features"]:
        for k in ("height", "footprint"):
            provenance.Record(**f[k])  # validates
    assert report["coverage"]["buildings"]["measured"] == len(bl["features"])


def test_one_licence_family_per_file(built):
    out, _ = built
    ts = json.loads((out / "tileset.json").read_text())
    assert ts["asset"]["extras"]["licence"] == provenance.SWISSTOPO
    roads = json.loads((out / "roads.json").read_text())
    assert roads["licence"] == provenance.ODBL
    # nothing from OSM inside swisstopo tiles
    for p in out.glob("tiles/*.glb"):
        assert b"openstreetmap" not in p.read_bytes().lower()


def test_tileset_consistent(built):
    out, report = built
    ts = json.loads((out / "tileset.json").read_text())
    root = ts["root"]
    assert ts["geometricError"] >= root["geometricError"] > 0
    for ch in root["children"]:  # mid level: one per square, each refined by exactly one fine leaf
        assert (out / ch["content"]["uri"]).exists() and ch["content"]["uri"].startswith("tiles/m_")
        assert 0 < ch["geometricError"] < root["geometricError"]
        (fine,) = ch["children"]
        assert (out / fine["content"]["uri"]).exists() and fine["geometricError"] == 0
        assert "transform" not in fine and fine["boundingVolume"] == ch["boundingVolume"]
    # root transform maps ENU origin to the ECEF origin of the frame
    m = np.array(root["transform"]).reshape(4, 4).T
    assert np.allclose(m[:3, 3], Frame(SMALL).origin_ecef, atol=1e-6)
    assert report["terrain"]["tiles"] and all(t["rmse_m"] >= 0 for t in report["terrain"]["tiles"])


def test_seams_after_float32_storage(built):
    _, report = built
    assert report["terrain"]["max_seam_gap_m"] < 1e-3


def test_build_is_deterministic(built, tmp_path):
    out, report = built
    report2 = build_world(SMALL, _inputs(), tmp_path, leaf_step=4.0, root_step=20.0, tex_px=64, root_tex_px=64)
    assert report["digests"] == report2["digests"]
    for name, digest in report["digests"].items():
        assert hashlib.sha256((out / name).read_bytes()).hexdigest() == digest


def test_viewer_lines_are_odbl_and_rendered_only(built):
    out, _ = built
    lines = json.loads((out / "lines.json").read_text())
    roads = json.loads((out / "roads.json").read_text())
    assert lines["licence"] == provenance.ODBL
    assert len(lines["ways"]) == sum(w["render"] for w in roads["ways"])
    assert all(len(w["p"]) % 3 == 0 and len(w["p"]) >= 6 for w in lines["ways"])


def test_buildings_are_closed_and_wound_outward(built):
    _, report = built
    b = report["buildings"]
    assert b["closed_solids"] == b["count"] == 2
    assert all(g["volume_m3"] > 0 for g in b["gaps"])


def test_inward_wound_solid_is_flipped_outward():
    from archworld.build import _building_geometry, _solid_check
    surf = terrain.Surface(SMALL, _raster(), step=4.0)
    faces = [list(reversed(f)) for f in _box(SMALL.x0 + 60, SMALL.y0 + 60, 12, 9, 700.0)]  # every face inward
    g = _building_geometry({"id": "x", "faces": faces}, surf)
    assert g["flipped"] and g["closed"] and abs(g["volume"] - 12 * 12 * 9) < 1e-6
    assert _solid_check(g["tri"]) == (True, pytest.approx(12 * 12 * 9))
    # an open shell (roof removed) is reported open, and left as it is
    g2 = _building_geometry({"id": "y", "faces": _box(SMALL.x0 + 60, SMALL.y0 + 60, 12, 9, 700.0)[1:]}, surf)
    assert not g2["closed"] and not g2["flipped"]


def test_skirt_only_where_the_solid_stops_above_ground():
    from archworld.build import SKIRT_MARGIN, _building_geometry
    surf = terrain.Surface(SMALL, _raster(), step=4.0)
    x, y = SMALL.x0 + 60, SMALL.y0 + 60
    ground = float(surf.height(x, y))
    deep = _building_geometry({"id": "d", "faces": _box(x, y, 8, 12, ground - 4.0)}, surf)
    high = _building_geometry({"id": "h", "faces": _box(x, y, 8, 12, ground + 1.0)}, surf)
    assert not deep["skirted"] and len(deep["skirt"]) == 0
    assert high["skirted"] and high["bottom"] <= high["ground_min"] - SKIRT_MARGIN + 1e-9
    # skirt faces point outward too: same sign of volume contribution as the walls
    t = high["skirt"]
    c = np.array([x, y, ground])
    assert (np.einsum("ij,ij->i", np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), t.mean(1) - c) > 0).all()


def test_no_building_disappears_silently(built):
    _, report = built
    b = report["buildings"]
    assert b["count"] + sum(b["dropped"].values()) == b["input"]
    assert b["dropped"]["no_geometry"] == 0


def test_sliver_triangle_keeps_the_solid_closed():
    from archworld.build import _building_geometry
    surf = terrain.Surface(SMALL, _raster(), step=4.0)
    x, y, b, t = SMALL.x0 + 60.0, SMALL.y0 + 60.0, 700.0, 706.0
    A, B, C, D = (x, y), (x + 8, y), (x + 8, y + 8), (x, y + 8)
    M = (x + 4, y)  # extra vertex on edge A-B of the roof only: the wall below needs a zero-area triangle A-M-B
    up = lambda p, z: (p[0], p[1], z)  # noqa: E731
    faces = [[up(A, t), up(M, t), up(B, t), up(C, t), up(D, t)], [up(D, b), up(C, b), up(B, b), up(A, b)]]
    for p, q in ((A, B), (B, C), (C, D), (D, A)):
        faces.append([up(p, b), up(q, b), up(q, t), up(p, t)])
    open_ = _building_geometry({"id": "o", "faces": faces}, surf)
    closed = _building_geometry({"id": "c", "faces": [*faces, [up(A, t), up(B, t), up(M, t)]]}, surf)
    assert not open_["closed"] and closed["closed"] and closed["volume"] == pytest.approx(8 * 8 * 6)


def test_lod_skirts_cover_the_crack_between_fine_and_mid(built):
    _, report = built
    r = _raster()
    fine_step, mid_step = report["grid"]["leaf_step_m"], report["lod"]["mid_step_m"]
    mid = terrain.Surface(SMALL, r, mid_step)
    rows = {tuple(t["tile"]): t for t in report["lod"]["tiles"]}
    assert len(rows) == len(SMALL.tiles())
    worst = 0.0
    for (i, j), t in rows.items():
        g = terrain.tile_grid(SMALL, r, i, j, fine_step)
        edge = [(g.x[0], g.y[0], g.h[0]), (g.x[-1], g.y[-1], g.h[-1]), (g.x[:, 0], g.y[:, 0], g.h[:, 0]),
                (g.x[:, -1], g.y[:, -1], g.h[:, -1])]
        crack = max(float(np.abs(h - mid.height(x, y)).max()) for x, y, h in edge)
        assert t["skirt_m"] >= crack + 0.5 - 0.006  # depth is rounded to the centimetre
        worst = max(worst, crack)
    assert worst > 1.0  # the fixture cliff does open a real crack, so the test is not vacuous


def test_fetch_refuses_non_https_urls():
    """Open data is fetched over HTTPS only; file:// and custom schemes are refused before any request."""
    from archworld import fetch
    for url in ("http://example.org/x.tif", "file:///etc/passwd", "ftp://example.org/x"):
        with pytest.raises(ValueError):
            fetch._get(url)
