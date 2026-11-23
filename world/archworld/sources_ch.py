"""Load fetched swisstopo + OSM files for a Swiss site into build Inputs (purpose "world": measured layers)."""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

from . import guard
from .build import Inputs
from .sites import Site
from .terrain import Raster


def _km(path: Path) -> tuple[int, int]:
    m = re.search(r"_(\d{4})-(\d{4})_", path.name)
    return int(m.group(1)), int(m.group(2))


def load_dtm(site: Site, raw: Path, layer: str = "dtm") -> Raster:
    res = 0.5
    n = round(site.size / res)
    arr = np.full((n, n), np.nan, np.float32)
    x0, y0, x1, y1 = site.bounds
    for p in sorted(guard.raw_path(raw, layer, "world").glob("*.tif")):
        with rasterio.open(p) as ds:
            if abs(ds.res[0] - res) > 1e-9 or abs(ds.res[1] - res) > 1e-9:
                raise ValueError(f"{p.name}: resolution {ds.res}, expected {res}")
            b = ds.bounds
            c0, r0 = round((b.left - x0) / res), round((y1 - b.top) / res)
            if not (0 <= c0 < n and 0 <= r0 < n):
                continue
            a = ds.read(1).astype(np.float32)
            if ds.nodata is not None:
                a[a == ds.nodata] = np.nan
            arr[r0:r0 + a.shape[0], c0:c0 + a.shape[1]] = a
    if np.isnan(arr).any():
        raise ValueError(f"{layer} has {int(np.isnan(arr).sum())} missing pixels in the site")
    return Raster(arr, x0, y1, res)


def ortho_reader(raw: Path):
    files = {_km(p): p for p in guard.raw_path(raw, "ortho", "world").glob("*.tif")}

    def read(bounds, px):
        key = (int(bounds[0] // 1000), int(bounds[1] // 1000))
        if bounds[2] - bounds[0] != 1000 or key not in files:
            raise KeyError(f"no ortho tile for {bounds}")
        with rasterio.open(files[key]) as ds:
            w = from_bounds(*bounds, transform=ds.transform)
            a = ds.read([1, 2, 3], window=w, out_shape=(3, px, px), resampling=Resampling.average)
        return np.ascontiguousarray(np.moveaxis(a, 0, -1)).astype(np.uint8)

    return read


def load_buildings(raw: Path) -> list[dict]:
    seen, out = set(), []
    for p in sorted(guard.raw_path(raw, "buildings3d", "world").glob("*.geojson")):
        for f in json.loads(p.read_text())["features"]:
            props = f["properties"]
            uid = props["UUID"]
            if uid in seen or not f.get("geometry"):
                continue
            seen.add(uid)
            faces = [poly for poly in f["geometry"]["coordinates"]]
            attrs = {k: props.get(k) for k in ("EGID", "OBJEKTART", "GEBAEUDE_NUTZUNG", "NAME_KOMPLETT", "DACH_MAX",
                                              "DACH_MIN", "GELAENDEPUNKT", "GESAMTHOEHE", "HERKUNFT_JAHR")}
            out.append({"id": uid.strip("{}"), "faces": faces, "attrs": attrs})
    return out


def load_inputs(site: Site, raw: Path) -> Inputs:
    manifest = json.loads((raw / "sources.json").read_text())
    conv = raw / "buildings3d" / "converter.txt"
    sources = [{k: s[k] for k in ("layer", "url", "sha256", "bytes", "licence", "retrieved") if k in s}
               for s in manifest["sources"]]
    if conv.exists():
        sources.append({"layer": "buildings3d", "url": "conversion", "licence": "-",
                        "note": f"FileGDB TIN -> GeoJSON MultiPolygonZ (LV95) with {conv.read_text().strip()}"})
    has_dsm = any((raw / "dsm").glob("*.tif"))
    return Inputs(dtm=load_dtm(site, raw), dsm=load_dtm(site, raw, "dsm") if has_dsm else None,
                  ortho=ortho_reader(raw), buildings=load_buildings(raw),
                  overpass=json.loads((raw / "osm" / "overpass.json").read_text()), sources=sources)
