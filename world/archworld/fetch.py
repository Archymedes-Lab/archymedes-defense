"""Fetch raw open data for a site, with a source manifest (url, sha256, bytes, licence, retrieval time).

Run: uv run python -m archworld.fetch ch-lauterbrunnen [--lidar]   (lidar adds ~2.7 GB; held-out truth for milestone 2)
Raw files go to data/raw/<site>/<layer>/; the manifest to data/raw/<site>/sources.json. Existing files whose
sha256 matches the manifest are not downloaded again.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

from .sites import SITES, Site

ROOT = Path(__file__).resolve().parent.parent
UA = "archworld/0.1 (open-data research prototype)"
STAC = "https://data.geo.admin.ch/api/stac/v0.9"
OVERPASS = "https://overpass-api.de/api/interpreter"

LICENCES = {
    "swisstopo": "swisstopo Open Government Data (free use, attribution: (c) swisstopo)",
    "osm": "ODbL 1.0 (c) OpenStreetMap contributors",
}


def _get(url: str, data: bytes | None = None, timeout: int = 300) -> bytes:
    if urllib.parse.urlsplit(url).scheme != "https":  # open data only over HTTPS; never file:// or custom schemes
        raise ValueError(f"refusing non-HTTPS URL: {url[:80]}")
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:  # nosec B310: scheme checked above
                return r.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** (attempt + 1))
    raise AssertionError("unreachable")


def _stac_items(collection: str, bbox: tuple[float, ...]) -> list[dict]:
    q = urllib.parse.urlencode({"bbox": ",".join(f"{v:.6f}" for v in bbox), "limit": 100})
    url = f"{STAC}/collections/{collection}/items?{q}"
    out: list[dict] = []
    while url:
        page = json.loads(_get(url))
        out += page["features"]
        url = next((link["href"] for link in page.get("links", []) if link.get("rel") == "next"), None)
    return out


def _latest_per_key(items: list[dict], key_re: str) -> dict[str, dict]:
    """Group STAC items by the regex key in their id; keep the item with the highest year."""
    best: dict[str, tuple[str, dict]] = {}
    for it in items:
        m = re.search(key_re, it["id"])
        if not m:
            continue
        year = re.search(r"_(\d{4})", it["id"]).group(1)
        k = m.group(1)
        if k not in best or year > best[k][0]:
            best[k] = (year, it)
    return {k: v[1] for k, v in best.items()}


def plan_swiss(site: Site, lidar: bool = False) -> list[dict]:
    """Return download jobs: {layer, url, name, licence, item}."""
    jobs: list[dict] = []
    bbox = site.wgs84_bbox(pad=-50)  # slightly inside, so neighbouring km tiles are not pulled
    wanted = {f"{int(site.x0 / 1000) + i}-{int(site.y0 / 1000) + j}" for i, j in site.tiles()}
    for coll, layer, suffix in (
        ("ch.swisstopo.swissalti3d", "dtm", "_0.5_2056_5728.tif"),
        ("ch.swisstopo.swissimage-dop10", "ortho", "_0.1_2056.tif"),
        # surface model (terrain + trees + buildings): canopy height for line of sight in the site sim
        ("ch.swisstopo.swisssurface3d-raster", "dsm", "_0.5_2056_5728.tif"),
        *([("ch.swisstopo.swisssurface3d", "lidar", ".las.zip")] if lidar else []),
    ):
        latest = _latest_per_key(_stac_items(coll, bbox), r"_(\d{4}-\d{4})$")
        missing = wanted - latest.keys()
        if missing:
            raise RuntimeError(f"{coll}: no item for km tiles {sorted(missing)}")
        for k in sorted(wanted):
            it = latest[k]
            href = next(a["href"] for a in it["assets"].values() if a["href"].endswith(suffix))
            jobs.append({"layer": layer, "url": href, "name": href.rsplit("/", 1)[1], "licence": LICENCES["swisstopo"],
                         "item": it["id"]})
    sheets = _latest_per_key(_stac_items("ch.swisstopo.swissbuildings3d_3_0", bbox), r"_(\d{4}-\d{2})$")
    for k in sorted(sheets):
        it = sheets[k]
        href = next(a["href"] for a in it["assets"].values() if a["href"].endswith(".gdb.zip"))
        jobs.append({"layer": "buildings3d", "url": href, "name": href.rsplit("/", 1)[1],
                     "licence": LICENCES["swisstopo"], "item": it["id"]})
    return jobs


OSM_QUERY = """[out:json][timeout:180];
(
  way["building"]({s},{w},{n},{e});
  relation["building"]({s},{w},{n},{e});
  way["highway"]({s},{w},{n},{e});
  way["railway"]({s},{w},{n},{e});
  way["waterway"]({s},{w},{n},{e});
  way["aerialway"]({s},{w},{n},{e});
  way["natural"]({s},{w},{n},{e});
  way["landuse"]({s},{w},{n},{e});
);
out body geom;"""


def fetch_osm(site: Site, out: Path) -> dict:
    w, s, e, n = site.wgs84_bbox(pad=20)
    q = OSM_QUERY.format(s=f"{s:.6f}", w=f"{w:.6f}", n=f"{n:.6f}", e=f"{e:.6f}")
    body = _get(OVERPASS, data=urllib.parse.urlencode({"data": q}).encode())
    json.loads(body)  # refuse a non-JSON (error page) answer
    p = out / "osm" / "overpass.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(body)
    return {"layer": "osm", "url": OVERPASS, "query": q, "name": p.name, "licence": LICENCES["osm"],
            "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body), "retrieved": _now()}


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _download(job: dict, out: Path, known: dict[str, dict]) -> dict:
    p = out / job["layer"] / job["name"]
    p.parent.mkdir(parents=True, exist_ok=True)
    prev = known.get(job["url"])
    if prev and p.exists() and hashlib.sha256(p.read_bytes()).hexdigest() == prev["sha256"]:
        return prev
    body = _get(job["url"], timeout=900)
    tmp = p.with_suffix(p.suffix + ".part")
    tmp.write_bytes(body)
    tmp.replace(p)
    return {**job, "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body), "retrieved": _now()}


def main(site_id: str, lidar: bool = False) -> None:
    site = SITES[site_id]
    out = ROOT / "data" / "raw" / site.id
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "sources.json"
    known = {}
    if manifest_path.exists():
        known = {s["url"]: s for s in json.loads(manifest_path.read_text())["sources"] if s["layer"] != "osm"}
    if site.crs != "EPSG:2056":
        raise SystemExit(f"{site.id}: only the Swiss fetcher exists in milestone 1")
    jobs = plan_swiss(site, lidar)
    print(f"{len(jobs)} files", file=sys.stderr)
    with ThreadPoolExecutor(4) as ex:
        sources = list(ex.map(lambda j: _download(j, out, known), jobs))
    sources.append(fetch_osm(site, out))
    manifest = {"site": site.id, "crs": site.crs, "bounds": site.bounds, "sources": sources}
    manifest_path.write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"{sum(s['bytes'] for s in sources) / 1e6:.0f} MB in {len(sources)} sources", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1], lidar="--lidar" in sys.argv[2:])
