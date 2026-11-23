"""Assemble a site into OGC 3D Tiles 1.1: a coarse root and one leaf per tile (terrain + ortho + buildings),
plus buildings.json (provenance per building), roads.json (OSM, ODbL, separate) and report.json (measured realism).

Frames: tileset root transform = ENU -> ECEF (float64). Leaf transforms translate to the tile centre in ENU; leaf
vertices are float32 relative to that centre (< 710 m away, so < 0.1 mm rounding). glTF content is y-up, as
3D Tiles expects: local (e, n, u) is stored as (e, u, -n).
"""

from __future__ import annotations

import hashlib
import io
import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import mapbox_earcut
import numpy as np
import shapely
from affine import Affine
from PIL import Image
from rasterio import features as rio_features
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

from . import glb, terrain
from .frames import Frame
from .osm import roads_from_overpass, viewer_lines
from .provenance import SWISSTOPO, Ledger, Record
from .sites import Site

WALL = (222, 216, 206, 255)
ROOF = (150, 108, 96, 255)
SKIRT = (170, 164, 156, 255)
SKIRT_MARGIN = 0.5  # m below the lowest rendered ground under the footprint


@dataclass
class Inputs:
    dtm: terrain.Raster
    # bounds, px -> (px, px, 3) uint8, row 0 = north
    ortho: Callable[[tuple[float, float, float, float], int], np.ndarray]
    buildings: list[dict]  # {"id", "faces": [ring | [ring, hole...]], "attrs"}; LV95 + LN02 metres
    overpass: dict
    sources: list[dict]
    dsm: terrain.Raster | None = None  # surface model (terrain + trees + buildings), same grid as the DTM
    building_source: str = "swissBUILDINGS3D 3.0"
    building_licence: str = SWISSTOPO


def _jpeg(img: np.ndarray) -> bytes:
    b = io.BytesIO()
    Image.fromarray(img, "RGB").save(b, "JPEG", quality=85, optimize=False, progressive=False, subsampling=2)
    return b.getvalue()


def _yup(e, n, u) -> np.ndarray:
    return np.column_stack([e, u, -np.asarray(n)]).astype(np.float32)


def _box(local_enu: np.ndarray) -> list[float]:
    lo, hi = local_enu.min(0), local_enu.max(0)
    c, h = (lo + hi) / 2, (hi - lo) / 2 + 0.01
    return [*map(float, c), float(h[0]), 0, 0, 0, float(h[1]), 0, 0, 0, float(h[2])]


def _rings(face) -> list[np.ndarray]:
    """A face is one ring [(x, y, z), ...] or a list of rings [exterior, hole, ...]."""
    if np.asarray(face[0], dtype=object).ndim == 1 and not isinstance(face[0][0], list | tuple):
        return [np.asarray(face, float)]
    return [np.asarray(r, float) for r in face]


def _triangulate_face(rings: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray] | None:
    """Triangles (K, 3, 3) of a planar 3D polygon with holes, and its unit normal."""
    rings = [r[:-1] if len(r) > 1 and np.array_equal(r[0], r[-1]) else r for r in rings]  # exact compare
    ext = rings[0]
    if len(ext) < 3:
        return None
    nrm = np.zeros(3)  # Newell normal
    for a, b in zip(ext, np.roll(ext, -1, 0), strict=True):
        nrm += [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]
    ln = np.linalg.norm(nrm)
    if ln < 1e-6:
        # A zero-area sliver. As a triangle it is kept: its neighbours need its edges for the solid to stay closed.
        return (ext[None].copy(), np.zeros(3)) if len(rings) == 1 and len(ext) == 3 else None
    nrm /= ln
    if len(rings) == 1 and len(ext) == 3:
        return ext[None], nrm
    drop = int(np.argmax(np.abs(nrm)))
    keep = [k for k in range(3) if k != drop]
    pts = np.concatenate(rings)
    ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
    idx = mapbox_earcut.triangulate_float64(pts[:, keep], ends)
    if len(idx) == 0:
        return None
    out = pts[idx].reshape(-1, 3, 3)
    # earcut works in a 2D projection and does not keep the face's winding: restore it from the Newell normal
    back = np.einsum("ij,j->i", np.cross(out[:, 1] - out[:, 0], out[:, 2] - out[:, 0]), nrm) < 0
    out[back] = out[back][:, [0, 2, 1]]
    return out, nrm


def _building_geometry(b: dict, surf: terrain.Surface) -> dict | None:
    tris, normals, footprint_polys = [], [], []
    for face in b["faces"]:
        rings = _rings(face)
        t = _triangulate_face(rings)
        if t is None:
            continue
        tris.append(t[0])
        normals.append(np.repeat(t[1][None], len(t[0]), 0))
        p = Polygon(rings[0][:, :2])
        if p.is_valid and p.area > 1e-4:
            footprint_polys.append(p)
    if not tris:
        return None
    tri = np.concatenate(tris)
    nrm = np.concatenate(normals)
    closed, volume = _solid_check(tri)
    flipped = closed and volume < 0
    if flipped:  # source solids wound inward (ESRI multipatch convention): make every face point outward
        tri = tri[:, [0, 2, 1]]
        nrm = -nrm
        volume = -volume
    base, top = float(tri[..., 2].min()), float(tri[..., 2].max())
    # Footprint = union of the faces seen from above, on a 1 mm grid (no buffering: round joins add hundreds of
    # vertices, and a negative mitre buffer can erase a small building altogether).
    fp = unary_union([shapely.set_precision(p, 0.001) for p in footprint_polys])
    fp = unary_union([g for g in getattr(fp, "geoms", [fp]) if g.geom_type == "Polygon" and g.area > 1e-4])
    if fp.is_empty:
        return None
    rings = [np.asarray(orient(p, 1.0).exterior.coords) for p in getattr(fp, "geoms", [fp])]  # counter-clockwise
    dense = list(rings)
    for r in rings:  # densify so the ground check sees every grid cell the outline crosses
        for a, c in zip(r[:-1], r[1:], strict=True):
            k = max(1, int(np.ceil(np.hypot(*(c - a)) / (surf.step / 2))))
            dense.append(a + (c - a) * (np.arange(k)[:, None] / k))
    dense.append(np.asarray(fp.representative_point().coords))
    d = np.concatenate(dense)
    ground = surf.height(d[:, 0], d[:, 1])
    gmin, gmax = float(ground.min()), float(ground.max())
    # A skirt is added only when the solid does not already reach SKIRT_MARGIN below the lowest rendered ground.
    need = base > gmin - SKIRT_MARGIN
    bottom = gmin - SKIRT_MARGIN if need else base
    skirt = []
    if need:
        for r in rings:
            for a, c in zip(r[:-1], r[1:], strict=True):
                at, ab = [a[0], a[1], base], [a[0], a[1], bottom]
                ct, cb = [c[0], c[1], base], [c[0], c[1], bottom]
                skirt += [[at, ab, cb], [at, cb, ct]]  # outward for a counter-clockwise ring
    return {"tri": tri, "nrm": nrm, "skirt": np.array(skirt, float).reshape(-1, 3, 3), "base": base, "top": top,
            "footprint": fp, "ground_min": gmin, "ground_max": gmax, "bottom": bottom, "closed": closed,
            "flipped": flipped, "volume": volume, "skirted": need}


def _solid_check(tri: np.ndarray) -> tuple[bool, float]:
    """Closed = every edge (welded at 1 mm) is used once in each direction. Volume is signed: > 0 means outward."""
    keys = np.round(tri.reshape(-1, 3) * 1000).astype(np.int64)
    _, inv = np.unique(keys, axis=0, return_inverse=True)
    idx = inv.reshape(-1, 3)
    idx = idx[(idx[:, 0] != idx[:, 1]) & (idx[:, 1] != idx[:, 2]) & (idx[:, 2] != idx[:, 0])]
    e = np.concatenate([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]])
    n = int(inv.max()) + 1
    fwd = np.sort(e[:, 0] * n + e[:, 1])
    rev = np.sort(e[:, 1] * n + e[:, 0])
    closed = len(fwd) > 0 and len(np.unique(fwd)) == len(fwd) and np.array_equal(fwd, rev)
    c = tri.mean((0, 1))
    vol = float(np.einsum("ij,ij->i", tri[:, 0] - c, np.cross(tri[:, 1] - c, tri[:, 2] - c)).sum() / 6)
    return bool(closed), vol


def _welded_mesh(parts: list[tuple], feature_count: int, double_sided: bool) -> glb.Mesh:
    """Buildings as one indexed mesh. Vertices that share position (0.1 mm), colour and feature are merged; no
    normals are stored, so viewers shade each face flat from its geometry."""
    P = np.concatenate([p[0] for p in parts])
    C = np.concatenate([p[1] for p in parts]).astype(np.int64)
    F = np.concatenate([p[2] for p in parts]).astype(np.int64)
    key = np.column_stack([np.round(P * 1e4).astype(np.int64), C[:, :3], F])
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    idx = inv.reshape(-1, 3)
    idx = idx[(idx[:, 0] != idx[:, 1]) & (idx[:, 1] != idx[:, 2]) & (idx[:, 2] != idx[:, 0])].ravel()
    nv = len(first)
    return glb.Mesh(_yup(*P[first].T), idx.astype(np.uint16 if nv < 65536 else np.uint32),
                    colors=C[first].astype(np.uint8), feature_ids=F[first].astype(np.float32),
                    feature_count=feature_count, double_sided=double_sided, name="buildings")


def _terrain_mesh(site: Site, g: terrain.Grid, tb, frame: Frame, centre: np.ndarray, skirt: float):
    """Grid mesh in tile-local ENU plus an edge skirt `skirt` metres deep. Where a fine tile meets a coarser one
    their edges differ between shared vertices; the skirt (deeper than the measured difference) hides that crack.
    Returns local float32 positions (grid first, then skirt bottoms), uv, indices and the float64 grid in ENU."""
    e, n, u = frame.to_enu(g.x.ravel(), g.y.ravel(), g.h.ravel())
    enu = np.column_stack([e, n, u])
    rows, cols = g.x.shape
    vid = np.arange(rows * cols).reshape(rows, cols)
    # perimeter, counter-clockwise seen from above: south edge W->E, east S->N, north E->W, west N->S
    ring = np.concatenate([vid[0, :-1], vid[:-1, -1], vid[-1, :0:-1], vid[:0:-1, 0]])
    gx, gy, gh = g.x.ravel()[ring], g.y.ravel()[ring], g.h.ravel()[ring]
    be, bn, bu = frame.to_enu(gx, gy, gh - skirt)
    pos = np.concatenate([enu, np.column_stack([be, bn, bu])]) - centre
    uv_grid = np.column_stack([(g.x.ravel() - tb[0]) / (tb[2] - tb[0]), (tb[3] - g.y.ravel()) / (tb[3] - tb[1])])
    uv = np.concatenate([uv_grid, uv_grid[ring]]).astype(np.float32)
    k = len(ring)
    a_top, c_top = ring, np.roll(ring, -1)
    a_bot = rows * cols + np.arange(k)
    c_bot = np.roll(a_bot, -1)
    sk = np.concatenate([np.stack([a_top, a_bot, c_bot], 1), np.stack([a_top, c_bot, c_top], 1)]).ravel()
    idx = np.concatenate([terrain.grid_indices(g.x.shape), sk.astype(np.uint32)])
    idx = idx.astype(np.uint16) if len(pos) < 65536 else idx.astype(np.uint32)
    return pos.astype(np.float32), uv, idx, enu


CANOPY_STEP = 2.0
CANOPY_MIN, CANOPY_MAX = 2.0, 60.0


def _npy(a: np.ndarray) -> bytes:
    b = io.BytesIO()
    np.save(b, a, allow_pickle=False)
    return b.getvalue()


def _canopy(site: Site, dtm: terrain.Raster, dsm: terrain.Raster, footprints: list) -> np.ndarray:
    """Vegetation height on a 2 m grid (row 0 = south): highest surface-minus-terrain value in each cell, with
    buildings removed (they are opaque solids of their own) and anything under 2 m treated as open ground."""
    if dtm.arr.shape != dsm.arr.shape or (dtm.x0, dtm.y1, dtm.res) != (dsm.x0, dsm.y1, dsm.res):
        raise ValueError("surface model and terrain model are not on the same grid")
    k = round(CANOPY_STEP / dtm.res)
    n = round(site.size / CANOPY_STEP)
    c0, r0 = round((site.x0 - dtm.x0) / dtm.res), round((dtm.y1 - (site.y0 + site.size)) / dtm.res)
    out = np.zeros((n, n), np.float32)
    for r in range(0, n, 250):  # in strips, to keep memory flat
        a = (dsm.arr[r0 + r * k:r0 + (r + 250) * k, c0:c0 + n * k].astype(np.float32)
             - dtm.arr[r0 + r * k:r0 + (r + 250) * k, c0:c0 + n * k].astype(np.float32))
        out[r:r + a.shape[0] // k] = a.reshape(a.shape[0] // k, k, n, k).max((1, 3))
    out = out[::-1].copy()  # south first
    if footprints:
        mask = rio_features.rasterize([(shapely.buffer(p, 1.0), 1) for p in footprints], out_shape=(n, n),
                                      transform=Affine(CANOPY_STEP, 0, site.x0, 0, CANOPY_STEP, site.y0),
                                      all_touched=True, dtype="uint8")
        out[mask == 1] = 0.0
    out[out < CANOPY_MIN] = 0.0
    return np.minimum(out, CANOPY_MAX)


def _stats(v: list[float]) -> dict:
    if not v:
        return {}
    a = np.asarray(v)
    return {k: round(float(np.quantile(a, q)), 3) for k, q in (("p5", 0.05), ("median", 0.5), ("p95", 0.95))}


def build_world(site: Site, inputs: Inputs, out: Path, leaf_step: float = 4.0, root_step: float = 32.0,
                tex_px: int = 2048, root_tex_px: int = 2048, mid_step: float | None = None,
                mid_tex_px: int | None = None) -> dict:
    """Three levels: root (whole site, coarse) -> one mid tile per square (2x coarser mesh, half-size texture)
    -> one fine leaf per square. A viewer shows the root from afar, mid tiles over the site, and fine leaves only
    near the camera, so memory follows what is actually looked at."""
    mid_step = mid_step or leaf_step * 2
    mid_tex_px = mid_tex_px or tex_px // 2
    out = Path(out)
    (out / "tiles").mkdir(parents=True, exist_ok=True)
    frame = Frame(site)
    surf = terrain.Surface(site, inputs.dtm, leaf_step)
    root_surf = terrain.Surface(site, inputs.dtm, root_step)
    mid_surf = terrain.Surface(site, inputs.dtm, mid_step)
    ledger = Ledger()
    digests: dict[str, str] = {}

    def emit(rel: str, data: bytes) -> None:
        (out / rel).write_bytes(data)
        digests[rel] = hashlib.sha256(data).hexdigest()

    # ---- buildings: measured LoD2 solids, assigned to tiles by representative point
    per_tile: dict[tuple[int, int], list] = {t: [] for t in site.tiles()}
    features, gaps = [], []
    sim_buildings: list[dict] = []
    sim_polys: list = []
    dropped: dict[str, list[str]] = {"no_geometry": [], "outside_site": []}
    x0, y0, x1, y1 = site.bounds
    for b in sorted(inputs.buildings, key=lambda b: str(b["id"])):
        g = _building_geometry(b, surf)
        if g is None:
            dropped["no_geometry"].append(str(b["id"]))
            continue
        rp = g["footprint"].representative_point()
        if not (x0 <= rp.x < x1 and y0 <= rp.y < y1):
            dropped["outside_site"].append(str(b["id"]))
            continue
        ti = (int((rp.x - x0) // site.tile), int((rp.y - y0) // site.tile))
        fid = len(features)
        per_tile[ti].append((fid, g))
        sim_buildings.append({"fid": fid, "ring": np.round(np.asarray(g["footprint"].convex_hull.exterior.coords
                                                                      if g["footprint"].geom_type != "Polygon"
                                                                      else g["footprint"].exterior.coords), 3).tolist(),
                              "base": round(g["bottom"], 3), "top": round(g["top"], 3)})
        sim_polys.append(g["footprint"])
        h = Record(round(g["top"] - g["base"], 3), inputs.building_source, inputs.building_licence, "measured", 1.0)
        fpa = Record(round(g["footprint"].area, 2), inputs.building_source, inputs.building_licence, "measured", 1.0)
        ledger.put(f"b/{b['id']}/height", h, "buildings")
        features.append({"fid": fid, "id": str(b["id"]), "tile": list(ti), "attrs": b.get("attrs", {}),
                         "base_z": round(g["base"], 3), "top_z": round(g["top"], 3),
                         "height": h.dict(), "footprint": fpa.dict()})
        gaps.append({"fid": fid, "base": round(g["base"], 3), "skirt_bottom": round(g["bottom"], 3),
                     "min_surface_under_footprint": round(g["ground_min"], 3),
                     "max_surface_under_footprint": round(g["ground_max"], 3), "closed": g["closed"],
                     "flipped": g["flipped"], "skirted": g["skirted"], "volume_m3": round(g["volume"], 1)})

    # ---- leaves
    children, terrain_rows, edges, lod_rows = [], [], {}, []
    root_err = 0.0
    root_errs: list[np.ndarray] = []
    root_b: list[tuple] = []  # buildings again in the root, so the overview keeps the villages
    all_closed = all(bg["closed"] for v in per_tile.values() for _, bg in v)
    for i, j in site.tiles():
        tb = site.tile_bounds(i, j)
        g = terrain.tile_grid(site, inputs.dtm, i, j, leaf_step)
        gm = terrain.tile_grid(site, inputs.dtm, i, j, mid_step)
        # crack between this fine tile and a mid-level neighbour: difference of the two surfaces along the border
        border = np.concatenate([g.h[0] - mid_surf.height(g.x[0], g.y[0]), g.h[-1] - mid_surf.height(g.x[-1], g.y[-1]),
                                 g.h[:, 0] - mid_surf.height(g.x[:, 0], g.y[:, 0]),
                                 g.h[:, -1] - mid_surf.height(g.x[:, -1], g.y[:, -1])])
        crack = float(np.abs(border).max())
        skirt_depth = round(crack + 0.5, 2)
        e, n, u = frame.to_enu(g.x.ravel(), g.y.ravel(), g.h.ravel())
        centre = np.round(np.column_stack([e, n, u]).mean(0), 2)
        local, uv, idx, enu = _terrain_mesh(site, g, tb, frame, centre, skirt_depth)
        mlocal, muv, midx, _ = _terrain_mesh(site, gm, tb, frame, centre, skirt_depth)
        rows, cols = g.x.shape
        recon_grid = (local[:rows * cols].astype(np.float64) + centre).reshape(rows, cols, 3)
        edges[(i, j)] = {"W": recon_grid[:, 0], "E": recon_grid[:, -1], "S": recon_grid[0, :], "N": recon_grid[-1, :]}
        meshes = [glb.Mesh(_yup(*local.T), idx, uv=uv, texture_jpeg=_jpeg(inputs.ortho(tb, tex_px)), unlit=True,
                           name="terrain", extras={"grid": [rows, cols], "skirt_m": skirt_depth})]
        mid_meshes = [glb.Mesh(_yup(*mlocal.T), midx, uv=muv, texture_jpeg=_jpeg(inputs.ortho(tb, mid_tex_px)),
                               unlit=True, name="terrain", extras={"grid": list(gm.x.shape), "skirt_m": skirt_depth})]
        all_local = [local, mlocal]
        if per_tile[(i, j)]:
            parts = []
            for fid, bg in per_tile[(i, j)]:
                for tri, kind in ((bg["tri"], "b"), (bg["skirt"], "s")):
                    if len(tri) == 0:
                        continue
                    p = tri.reshape(-1, 3)
                    be, bn, bu = frame.to_enu(p[:, 0], p[:, 1], p[:, 2])
                    loc = np.column_stack([be, bn, bu]) - centre
                    if kind == "b":
                        wall = np.abs(np.repeat(bg["nrm"], 3, 0)[:, 2]) < 0.3
                        col = np.where(wall[:, None], WALL, ROOF)
                    else:
                        col = np.tile(SKIRT, (len(p), 1))
                    parts.append((loc, col, np.full(len(p), fid)))
            all_local.append(np.concatenate([p[0] for p in parts]))
            root_b += [(p[0] + centre, p[1], p[2]) for p in parts]
            meshes.append(_welded_mesh(parts, len(features), not all_closed))
            mid_meshes.append(_welded_mesh(parts, len(features), not all_closed))
        rel = f"tiles/{i}_{j}.glb"
        emit(rel, glb.write(meshes, extras={"licence": SWISSTOPO, "tile": [i, j], "level": "fine"}))
        mrel = f"tiles/m_{i}_{j}.glb"
        emit(mrel, glb.write(mid_meshes, extras={"licence": SWISSTOPO, "tile": [i, j], "level": "mid"}))
        mid_err = np.abs(mid_surf.height(g.x, g.y) - g.h)
        # what the mid tile loses against the fine one: terrain shape (99th percentile) or texture detail
        mid_ge = round(max(float(np.quantile(mid_err, 0.99)), site.tile / mid_tex_px, 0.5), 2)
        # realism: rendered surface vs every DTM pixel in the tile
        px, py, pv = inputs.dtm.centres(tb)
        err = surf.height(px, py) - pv
        re_ = np.abs(root_surf.height(g.x, g.y) - g.h)
        root_errs.append(re_.ravel())
        root_err = max(root_err, float(re_.max()))
        terrain_rows.append({"tile": [i, j], "rmse_m": round(float(np.sqrt(np.mean(err ** 2))), 3),
                             "p99_m": round(float(np.quantile(np.abs(err), 0.99)), 3),
                             "max_m": round(float(np.abs(err).max()), 3), "pixels": int(err.size)})
        tbox = {"box": _box(np.concatenate(all_local))}
        children.append({"transform": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, *map(float, centre), 1],
                         "boundingVolume": tbox, "geometricError": mid_ge, "refine": "REPLACE",
                         "content": {"uri": mrel},
                         "children": [{"boundingVolume": tbox, "geometricError": 0, "content": {"uri": rel}}]})
        lod_rows.append({"tile": [i, j], "crack_m": round(crack, 3), "skirt_m": skirt_depth, "mid_ge_m": mid_ge})
        ledger.put(f"terrain/{i}_{j}", Record(f"{leaf_step} m grid", "swissALTI3D 0.5 m", SWISSTOPO, "measured", 1.0),
                   "terrain")
        ledger.put(f"ortho/{i}_{j}", Record(f"{site.tile / tex_px:.3f} m/px", "SWISSIMAGE 10 cm", SWISSTOPO,
                                            "measured", 1.0), "imagery")

    seam = 0.0
    for (i, j), ed in edges.items():
        if (i + 1, j) in edges:
            seam = max(seam, float(np.abs(ed["E"] - edges[(i + 1, j)]["W"]).max()))
        if (i, j + 1) in edges:
            seam = max(seam, float(np.abs(ed["N"] - edges[(i, j + 1)]["S"]).max()))

    # ---- root: coarse terrain over the whole site, mosaic texture, no buildings
    rg = root_surf.grid
    e, n, u = frame.to_enu(rg.x.ravel(), rg.y.ravel(), rg.h.ravel())
    renu = np.column_stack([e, n, u])
    k = round(site.size / site.tile)
    sub = root_tex_px // k
    mosaic = np.zeros((sub * k, sub * k, 3), np.uint8)
    for i, j in site.tiles():
        mosaic[(k - 1 - j) * sub:(k - j) * sub, i * sub:(i + 1) * sub] = inputs.ortho(site.tile_bounds(i, j), sub)
    ruv = np.column_stack([(rg.x.ravel() - x0) / site.size, (y1 - rg.y.ravel()) / site.size]).astype(np.float32)
    ridx = terrain.grid_indices(rg.x.shape)
    ridx = ridx.astype(np.uint16) if rg.x.size < 65536 else ridx
    root_meshes = [glb.Mesh(_yup(*renu.T), ridx, uv=ruv, texture_jpeg=_jpeg(mosaic), unlit=True, name="terrain-root")]
    if root_b:
        root_meshes.append(_welded_mesh(root_b, len(features), not all_closed))
    emit("tiles/root.glb", glb.write(root_meshes, extras={"licence": SWISSTOPO}))
    # Geometric error = what a viewer loses by showing the root instead of the leaves. The 99th percentile is used,
    # not the maximum: single pixels on a 300 m wall would otherwise force every leaf to load at any distance.
    root_p99 = float(np.quantile(np.concatenate(root_errs), 0.99))
    root_ge = round(max(root_p99, 2 * site.size / (sub * k), 2 * max(c["geometricError"] for c in children), 1.0), 2)
    tileset = {
        "asset": {"version": "1.1", "extras": {
            "licence": SWISSTOPO, "attribution": "(c) swisstopo", "site": site.id, "crs": site.crs,
            "vertical": site.vertical, "vertical_method": frame.vertical_method,
            "frame": {"type": "ENU", "lon0": frame.lon0, "lat0": frame.lat0, "h0": 0.0}}},
        "geometricError": round(root_ge * 4, 2),
        "root": {
            "transform": [float(v) for v in frame.enu_to_ecef_matrix().T.ravel()],
            "boundingVolume": {"box": _box(renu)},  # widened below to contain every child box
            "geometricError": root_ge, "refine": "REPLACE", "content": {"uri": "tiles/root.glb"},
            "children": children,
        },
    }
    # widen root box to contain children boxes (centre +- half axes)
    pts = [renu]
    for c in children:
        bx = np.array(c["boundingVolume"]["box"])
        ctr = bx[:3] + np.array(c["transform"][12:15])
        half = np.array([bx[3], bx[7], bx[11]])
        pts += [ctr - half, ctr + half]
    tileset["root"]["boundingVolume"]["box"] = _box(np.vstack(pts))
    emit("tileset.json", (json.dumps(tileset, sort_keys=True, indent=1) + "\n").encode())

    emit("buildings.json", (json.dumps({"licence": inputs.building_licence, "source": inputs.building_source,
                                        "features": features}, sort_keys=True) + "\n").encode())
    roads = roads_from_overpass(inputs.overpass, site, frame, surf)
    emit("roads.json", (json.dumps(roads, sort_keys=True, separators=(",", ":")) + "\n").encode())
    emit("lines.json", (json.dumps(viewer_lines(roads), sort_keys=True, separators=(",", ":")) + "\n").encode())
    for w in roads["ways"]:
        r = Record(**w["width"])
        ledger.put(f"w/{w['osm_id']}/{len(w['lv95'])}/width", r, f"lines:{w['kind']}")

    # ---- inputs for the site simulation (not published to the viewer)
    (out / "sim").mkdir(exist_ok=True)
    emit("sim/terrain.npy", _npy(surf.grid.h.astype(np.float64)))
    emit("sim/buildings.json", (json.dumps({"licence": inputs.building_licence, "buildings": sim_buildings},
                                           sort_keys=True) + "\n").encode())
    sim_info = {"canopy_step_m": CANOPY_STEP, "canopy": None}
    if inputs.dsm is not None:
        canopy = _canopy(site, inputs.dtm, inputs.dsm, sim_polys)
        emit("sim/canopy.npy", _npy(canopy))
        veg = canopy >= CANOPY_MIN
        sim_info["canopy"] = {"source": "swissSURFACE3D raster minus swissALTI3D", "method": "measured",
                              "forest_fraction": round(float(veg.mean()), 4),
                              "median_height_m": round(float(np.median(canopy[veg])), 1) if veg.any() else 0.0}

    floating = [gp for gp in gaps if gp["skirt_bottom"] > gp["min_surface_under_footprint"] + 1e-6]
    report = {
        "site": {"id": site.id, "name": site.name, "crs": site.crs, "bounds": site.bounds, "size_m": site.size,
                 "tile_m": site.tile, "notes": site.notes},
        "frame": {"lon0": frame.lon0, "lat0": frame.lat0, "vertical_method": frame.vertical_method},
        "sim": sim_info,
        "lod": {"levels": ["root", "mid", "fine"], "mid_step_m": mid_step, "mid_tex_px": mid_tex_px, "tiles": lod_rows},
        "grid": {"leaf_step_m": leaf_step, "root_step_m": root_step, "tex_px": tex_px,
                 "tex_m_per_px": site.tile / tex_px},
        "sources": inputs.sources,
        "coverage": ledger.coverage(),
        "terrain": {"tiles": terrain_rows, "max_seam_gap_m": seam, "root_max_err_m": round(root_err, 3),
                    "root_p99_err_m": round(root_p99, 3),
                    "rmse_m": round(float(np.sqrt(np.mean([t["rmse_m"] ** 2 for t in terrain_rows]))), 3)},
        "buildings": {"count": len(features), "floating": len(floating), "input": len(inputs.buildings),
                      "dropped": {k: len(v) for k, v in dropped.items()},
                      "dropped_no_geometry_ids": dropped["no_geometry"],
                      "closed_solids": sum(gp["closed"] for gp in gaps),
                      "winding_flipped": sum(gp["flipped"] for gp in gaps),
                      "skirted": sum(gp["skirted"] for gp in gaps),
                      # swissBUILDINGS3D solids reach ~3 m below ground by design; this is the depth, not a defect
                      "embed_m": _stats([gp["min_surface_under_footprint"] - gp["base"] for gp in gaps]),
                      "base_above_ground": sum(1 for gp in gaps if gp["base"] > gp["min_surface_under_footprint"]),
                      "gaps": gaps},
        "lines": {"ways": len(roads["ways"]), "rendered": sum(w["render"] for w in roads["ways"]),
                  "by_kind": {k: sum(1 for w in roads["ways"] if w["kind"] == k) for k in ("highway", "railway",
                                                                                           "waterway")}},
        "digests": dict(sorted(digests.items())),
    }
    (out / "report.json").write_text(json.dumps(report, sort_keys=True, indent=1) + "\n")
    return report
