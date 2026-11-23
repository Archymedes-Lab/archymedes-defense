"""OSM line layer (roads, rail, waterways) draped on the rendered terrain surface. ODbL: written to its own file.

Heights follow `Surface.height` (the triangles actually rendered) plus a fixed offset, after densifying to at most
`max_seg` metres, so ribbons neither cut into nor hover over the mesh. Bridges interpolate between their ends;
tunnels are kept as data but not rendered.
"""

from __future__ import annotations

import numpy as np
from shapely.geometry import LineString, box

from .frames import Frame
from .provenance import ODBL, Record
from .sites import Site
from .terrain import Surface

# Default carriageway widths in metres by OSM class (method "default": a class convention, not a measurement)
DEFAULT_WIDTH = {
    "motorway": 11.0, "trunk": 9.0, "primary": 7.5, "secondary": 6.5, "tertiary": 5.5, "unclassified": 4.5,
    "residential": 4.5, "service": 3.5, "living_street": 4.0, "pedestrian": 4.0, "track": 3.0, "footway": 1.5,
    "path": 1.0, "cycleway": 2.0, "steps": 1.5, "bridleway": 1.5,
    "rail": 3.0, "narrow_gauge": 2.6, "funicular": 2.6, "rack": 2.6, "light_rail": 3.0,
    "river": 12.0, "stream": 2.0, "canal": 6.0, "ditch": 1.0, "drain": 1.0,
}
KINDS = ("highway", "railway", "waterway")


def _width(tags: dict, cls: str) -> Record:
    raw = tags.get("width", "").replace("m", "").strip()
    try:
        w = float(raw)
        if 0.2 <= w <= 60:
            return Record(w, "osm:width", ODBL, "tagged", 0.8)
    except ValueError:
        pass
    return Record(DEFAULT_WIDTH.get(cls, 3.0), f"class-default:{cls}", ODBL, "default", 0.3)


def _densify(xy: np.ndarray, max_seg: float) -> np.ndarray:
    out = [xy[:1]]
    for a, b in zip(xy[:-1], xy[1:], strict=True):
        n = max(1, int(np.ceil(np.hypot(*(b - a)) / max_seg)))
        t = np.arange(1, n + 1)[:, None] / n
        out.append(a + (b - a) * t)
    return np.concatenate(out)


def roads_from_overpass(data: dict, site: Site, frame: Frame, surf: Surface, max_seg: float = 1.0,
                        offset: float = 0.2) -> dict:
    clip = box(*site.bounds)
    ways = []
    for el in sorted(data.get("elements", []), key=lambda e: (e.get("type", ""), e.get("id", 0))):
        tags = el.get("tags", {})
        if el.get("type") != "way" or "geometry" not in el or tags.get("area") == "yes":
            continue
        kind = next((k for k in KINDS if k in tags), None)
        if kind is None:
            continue
        cls = tags[kind]
        lon = np.array([p["lon"] for p in el["geometry"]])
        lat = np.array([p["lat"] for p in el["geometry"]])
        if len(lon) < 2:
            continue
        x, y = frame.from_wgs84(lon, lat)
        geom = LineString(np.column_stack([x, y])).intersection(clip)
        parts = getattr(geom, "geoms", [geom])
        tunnel = tags.get("tunnel") in {"yes", "building_passage", "culvert"} or tags.get("layer", "0").startswith("-")
        bridge = tags.get("bridge") not in (None, "no")
        for part in parts:
            if part.is_empty or part.geom_type != "LineString" or part.length < 0.5:
                continue
            xy = np.round(_densify(np.asarray(part.coords)[:, :2], max_seg), 3)  # heights from stored xy
            ground = surf.height(xy[:, 0], xy[:, 1])
            if bridge:
                s = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(xy, axis=0).T))])
                z = ground[0] + (ground[-1] - ground[0]) * s / s[-1] + offset
                z = np.maximum(z, ground + offset)
            else:
                z = ground + offset
            e, n, u = frame.to_enu(xy[:, 0], xy[:, 1], z)
            ways.append({
                "osm_id": el["id"], "kind": kind, "class": cls, "name": tags.get("name", ""),
                "render": not tunnel, "bridge": bridge, "tunnel": tunnel,
                "surface": tags.get("surface", ""),
                "width": _width(tags, cls).dict(),
                "lv95": np.column_stack([xy, np.round(z, 4)]).tolist(),
                "enu": np.round(np.column_stack([e, n, u]), 3).tolist(),
            })
    return {"licence": ODBL, "attribution": "(c) OpenStreetMap contributors", "offset_m": offset,
            "frame": "ENU at site centre (see tileset.json asset.extras)", "ways": ways}


def viewer_lines(roads: dict, every: int = 2) -> dict:
    """Compact copy for the web viewer: rendered ways only, every n-th densified point (last kept), ENU in integer
    decimetres. Still ODbL; the full roads.json stays with the simulation data."""
    kinds = ["highway", "railway", "waterway"]
    ways = []
    for w in roads["ways"]:
        if not w["render"]:
            continue
        pts = w["enu"]
        keep = pts[::every] + ([pts[-1]] if (len(pts) - 1) % every else [])
        ways.append({"k": kinds.index(w["kind"]), "c": w["class"], "n": w["name"], "w": w["width"]["value"],
                     "wm": w["width"]["method"], "p": [round(v * 10) for p in keep for v in p]})
    return {"licence": roads["licence"], "attribution": roads["attribution"], "unit": "dm", "kinds": kinds,
            "ways": ways}
