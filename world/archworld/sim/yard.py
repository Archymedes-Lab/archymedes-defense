"""Extract the warehouse site as its own small scene: a square around the compound at full source resolution.

The valley world is 4 km wide at 4 m terrain and 0.5 m imagery. A close view of one site needs more detail and far
less area, so this cuts a 512 m square: terrain on a 1 m lattice from the 0.5 m model, imagery at 12.5 cm from the
10 cm orthophoto, the measured buildings inside it, and one tree per canopy peak from the measured canopy grid.
Coordinates are the valley's ENU frame minus the compound centre, so replays and site objects need only an offset.
"""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.merge import merge

from .. import glb, guard
from ..build import _building_geometry, _welded_mesh
from ..frames import Frame
from ..provenance import SWISSTOPO
from ..sources_ch import load_buildings, load_dtm
from ..terrain import Surface
from .compound import load_world, viewer_site

HALF = 256.0  # metres from the compound centre to the edge of the scene
TILE = 256.0
STEP = 1.0
TEX = 2048
TREE_MIN = 5.0  # m: lower canopy is shrub or hedge
TREE_WINDOW = 2  # cells (2 m each) on each side: one tree per peak within about 10 m


def _ortho(raw: Path, bounds, px: int) -> np.ndarray:
    x0, y0, x1, y1 = bounds
    files = [p for p in sorted(guard.raw_path(raw, "ortho", "world").glob("*.tif"))]
    use = []
    for p in files:
        with rasterio.open(p) as ds:
            b = ds.bounds
            if b.left < x1 and b.right > x0 and b.bottom < y1 and b.top > y0:
                use.append(p)
    srcs = [rasterio.open(p) for p in use]
    try:
        arr, _ = merge(srcs, bounds=(x0, y0, x1, y1), res=(x1 - x0) / px, resampling=Resampling.bilinear,
                       indexes=[1, 2, 3])
    finally:
        for s in srcs:
            s.close()
    return np.ascontiguousarray(np.moveaxis(arr[:, :px, :px], 0, -1)).astype(np.uint8)


def _jpeg(img: np.ndarray) -> bytes:
    b = io.BytesIO()
    Image.fromarray(img, "RGB").save(b, "JPEG", quality=88, optimize=False, progressive=False, subsampling=2)
    return b.getvalue()


def _yup(a: np.ndarray) -> np.ndarray:
    return np.column_stack([a[:, 0], a[:, 2], -a[:, 1]]).astype(np.float32)


def extract(out: Path, raw: Path, publish: Path) -> dict:
    out, raw, publish = Path(out), Path(raw), Path(publish)
    world, lay, _ = load_world(out)
    site = world.site
    frame = Frame(site)
    dtm = load_dtm(site, raw)
    cx, cy = lay["centre"]
    cz = float(world.ground(cx, cy))
    ce, cn, cu = (float(v[0]) for v in frame.to_enu(np.array([cx]), np.array([cy]), np.array([cz])))
    centre = np.array([ce, cn, cu])

    def local(x, y, z) -> np.ndarray:
        e, n, u = frame.to_enu(np.asarray(x, float), np.asarray(y, float), np.asarray(z, float))
        return np.column_stack([e, n, u]) - centre

    publish.mkdir(parents=True, exist_ok=True)
    files: dict[str, str] = {}

    def emit(name: str, data: bytes) -> None:
        (publish / name).write_bytes(data)
        files[name] = hashlib.sha256(data).hexdigest()

    # ---- terrain: 2 x 2 tiles on one 1 m lattice (shared edges are the same numbers), smooth normals
    n = round(TILE / STEP)
    tiles = []
    k = round(2 * HALF / TILE)
    for j in range(k):
        for i in range(k):
            bx0, by0 = cx - HALF + i * TILE, cy - HALF + j * TILE
            xs = cx - HALF + (i * n + np.arange(n + 1)) * STEP
            ys = cy - HALF + (j * n + np.arange(n + 1)) * STEP
            gx, gy = np.meshgrid(xs, ys)
            h = dtm.sample(gx, gy)
            pos = local(gx.ravel(), gy.ravel(), h.ravel())
            # normals from the height field (central differences on a padded lattice)
            px_, py_ = np.meshgrid(np.concatenate([[xs[0] - STEP], xs, [xs[-1] + STEP]]),
                                   np.concatenate([[ys[0] - STEP], ys, [ys[-1] + STEP]]))
            hp = dtm.sample(px_, py_)
            dzdx = (hp[1:-1, 2:] - hp[1:-1, :-2]) / (2 * STEP)
            dzdy = (hp[2:, 1:-1] - hp[:-2, 1:-1]) / (2 * STEP)
            nrm = np.column_stack([-dzdx.ravel(), -dzdy.ravel(), np.ones(dzdx.size)])
            nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
            uv = np.column_stack([(gx.ravel() - bx0) / TILE, (by0 + TILE - gy.ravel()) / TILE]).astype(np.float32)
            r, c = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
            v00 = (r * (n + 1) + c).ravel()
            idx = np.stack([v00, v00 + 1, v00 + n + 2, v00, v00 + n + 2, v00 + n + 1], 1).ravel().astype(np.uint32)
            tex = _jpeg(_ortho(raw, (bx0, by0, bx0 + TILE, by0 + TILE), TEX))
            name = f"terrain_{i}_{j}.glb"
            emit(name, glb.write([glb.Mesh(_yup(pos), idx, uv=uv, normals=_yup(nrm), texture_jpeg=tex, name="terrain")],
                                 extras={"licence": SWISSTOPO, "tile": [i, j]}))
            tiles.append(name)

    # ---- height lookup for the viewer: local up on the same 1 m lattice, plus the map from local east/north to
    # lattice metres (the national grid is turned 0.34 degrees from true north here)
    nl = round(2 * HALF / STEP)
    lx = cx - HALF + np.arange(nl + 1) * STEP
    ly = cy - HALF + np.arange(nl + 1) * STEP
    hx, hy = np.meshgrid(lx, ly)
    hl = local(hx.ravel(), hy.ravel(), dtm.sample(hx, hy).ravel())
    emit("height.bin", hl[:, 2].astype("<f4").tobytes())
    to_lattice, *_ = np.linalg.lstsq(hl[:, :2], np.column_stack([hx.ravel() - (cx - HALF), hy.ravel() - (cy - HALF)])
                                     - HALF, rcond=None)
    fit = float(np.abs(hl[:, :2] @ to_lattice + HALF - np.column_stack([hx.ravel() - (cx - HALF),
                                                                         hy.ravel() - (cy - HALF)])).max())

    # ---- measured buildings inside the square (the synthetic warehouse is drawn by the viewer, not from here)
    surf1 = Surface.from_heights(site, world.surf.grid.h, world.surf.step)
    parts, count = [], 0
    for b in sorted(load_buildings(raw), key=lambda b: str(b["id"])):
        g = _building_geometry(b, surf1)
        if g is None:
            continue
        rp = g["footprint"].representative_point()
        if abs(rp.x - cx) > HALF or abs(rp.y - cy) > HALF:
            continue
        p = g["tri"].reshape(-1, 3)
        wall = np.abs(np.repeat(g["nrm"], 3, 0)[:, 2]) < 0.3
        col = np.where(wall[:, None], (226, 221, 211, 255), (112, 86, 78, 255))
        parts.append((local(p[:, 0], p[:, 1], p[:, 2]), col, np.full(len(p), count)))
        count += 1
    if parts:
        emit("buildings.glb", glb.write([_welded_mesh(parts, count, False)], extras={"licence": SWISSTOPO}))

    # ---- trees: one per canopy peak
    trees = []
    if world.canopy is not None:
        cs = world.canopy_step
        c0, c1 = int((cx - HALF - site.x0) // cs), int((cx + HALF - site.x0) // cs)
        r0, r1 = int((cy - HALF - site.y0) // cs), int((cy + HALF - site.y0) // cs)
        w = TREE_WINDOW
        can = world.canopy[r0 - w:r1 + w, c0 - w:c1 + w].astype(np.float32)
        core = can[w:-w, w:-w]
        peak = np.ones(core.shape, bool)
        for dr in range(-w, w + 1):
            for dc in range(-w, w + 1):
                if dr or dc:
                    nb = can[w + dr:can.shape[0] - w + dr, w + dc:can.shape[1] - w + dc]
                    peak &= (core > nb) if (dr, dc) > (0, 0) else (core >= nb)  # ties go to one cell only
        peak &= core >= TREE_MIN
        rr, cc = np.nonzero(peak)
        tx = site.x0 + (c0 + cc + 0.5) * cs
        ty = site.y0 + (r0 + rr + 0.5) * cs
        fence = np.array(lay["fence"])
        clear = ~((tx > fence[:, 0].min() - 6) & (tx < fence[:, 0].max() + 6) & (ty > fence[:, 1].min() - 6)
                  & (ty < fence[:, 1].max() + 6)) & ~world.inside_building(tx, ty)
        tx, ty, th = tx[clear], ty[clear], core[rr, cc][clear]
        tp = local(tx, ty, world.ground(tx, ty))
        trees = np.round(np.column_stack([tp, th]), 2).tolist()

    vs = viewer_site(world, lay, frame)

    def shift(o):
        if isinstance(o, dict):
            return {k_: shift(v) for k_, v in o.items()}
        if isinstance(o, list) and len(o) == 3 and all(isinstance(v, int | float) for v in o):
            return [round(o[0] - ce, 2), round(o[1] - cn, 2), round(o[2] - cu, 2)]
        if isinstance(o, list) and len(o) == 2 and all(isinstance(v, int | float) for v in o):
            return [round(o[0] - ce, 2), round(o[1] - cn, 2)]
        if isinstance(o, list):
            return [shift(v) for v in o]
        return o

    wh = vs["warehouse"]
    skip = ("warehouse", "fence_height", "provenance", "notional")
    site_local = shift({k_: v for k_, v in vs.items() if k_ not in skip})
    for key in ("gate", "drone_pad", "guard_post", "zone"):  # scalars that are not coordinates
        for f in ("width", "size", "facing_deg", "radius", "side"):
            if f in vs[key]:
                site_local[key][f] = vs[key][f]
    for m_local, m in zip(site_local["masts"], vs["masts"], strict=True):
        m_local.update({f: m[f] for f in ("id", "facing_deg", "height", "fov_deg", "range_m")})
    site_local["warehouse"] = {"corners": [[round(c[0] - ce, 2), round(c[1] - cn, 2)] for c in wh["corners"]],
                               **{f: round(wh[f] - cu, 2) for f in ("base", "floor", "eave", "ridge")}}
    site_local["fence_height"] = vs["fence_height"]
    info = {
        "site": site.id, "notional": True, "provenance": vs["provenance"],
        "centre_enu": [round(ce, 3), round(cn, 3), round(cu, 3)], "half_m": HALF,
        "terrain": {"tiles": tiles, "step_m": STEP, "tile_m": TILE, "tex_px": TEX, "tex_m_per_px": TILE / TEX,
                    "source": "swissALTI3D 0.5 m, SWISSIMAGE 10 cm", "licence": SWISSTOPO},
        "height": {"file": "height.bin", "n": nl + 1, "step_m": STEP, "dtype": "float32-le, row 0 = south",
                   "local_to_lattice": [round(float(v), 9) for v in to_lattice.ravel()], "fit_error_m": round(fit, 4)},
        "buildings": {"file": "buildings.glb" if parts else None, "count": count, "source": "swissBUILDINGS3D 3.0"},
        "trees": {"count": len(trees), "items": trees, "method": "inferred",
                  "note": "one conifer per canopy peak; position and height from the canopy grid, shape is generic"},
        "compound": site_local,
    }
    emit("yard.json", (json.dumps(info, sort_keys=True, separators=(",", ":")) + "\n").encode())
    return {"files": files, "buildings": count, "trees": len(trees), "tiles": len(tiles),
            "bytes": sum((publish / f).stat().st_size for f in files)}
