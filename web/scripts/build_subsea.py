"""Build the Gulf of Finland subsea exposure model from public data.

Inputs (cached under .feasibility/20261118/subsea, fetched with --fetch):
  - EMODnet Digital Bathymetry (DTM) mean depth, WCS tiles, ~115 m grid
  - EMODnet Human Activities vessel density 2024 annual average (cargo 09, tanker 10, all), WCS, EPSG:3857
  - OpenStreetMap submarine cables and pipelines (Overpass), ODbL
  - Sentinel-2 cloudless 2017 by EOX (CC BY 4.0), z9 tiles, for the 3D texture only

Outputs:
  lib/data/subsea.json (+ public/subsea/model.json, sign-in gated)  cables sampled every ~1 km with depth, traffic and along-cable distance to shore
  public/subsea/{depth,density}.png     Web Mercator overlays for the map
  public/subsea/terrain.bin, terrain.jpg  3D heightfield (Float32) and texture

Nothing here is a measured hazard. It combines public layers under stated assumptions; the page says so.
"""
from __future__ import annotations

import argparse
import hashlib
import heapq
import io
import json
import math
import subprocess
import time
import zlib
from pathlib import Path

import numpy as np
from PIL import Image

WEB = Path(__file__).resolve().parents[1]
SRC = WEB.parent / '.feasibility/20261118/subsea'
OUT_JSON = WEB / 'lib/data/subsea.json'
OUT_PUB = WEB / 'public/subsea'

LON0, LON1, LAT0, LAT1 = 22.0, 30.0, 59.0, 60.6
R_EARTH = 6378137.0
NODATA = -1e30
STEP_KM = 1.0
LANDING_DEPTH_M = -3.0      # endpoint shallower than this (or on land) counts as a shore landing
UA = 'archymedes-research/0.1'


def merc_x(lon: float) -> float:
    return math.radians(lon) * R_EARTH


def merc_y(lat: float) -> float:
    return R_EARTH * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def inv_y(y: float) -> float:
    return math.degrees(2 * math.atan(math.exp(y / R_EARTH)) - math.pi / 2)


def hav_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(min(1.0, math.sqrt(a)))


# ---------------------------------------------------------------- fetch (network; cached)

def curl(url: str, out: Path, *args: str) -> None:
    if out.exists() and out.stat().st_size > 0:
        return
    tmp = out.with_suffix(out.suffix + '.part')
    subprocess.run(['curl', '-sS', '-f', '-m', '180', '-A', UA, '-o', str(tmp), *args, url], check=True)
    tmp.rename(out)


def fetch() -> None:
    SRC.mkdir(parents=True, exist_ok=True)
    tiles = SRC / 's2_z9'
    tiles.mkdir(exist_ok=True)
    z = 9
    n = 2 ** z
    x0, x1 = int((LON0 + 180) / 360 * n), int((LON1 + 180) / 360 * n)
    ty = lambda lat: int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)  # noqa: E731
    y0, y1 = ty(LAT1), ty(LAT0)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            curl(f'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2017_3857/default/g/{z}/{y}/{x}.jpg', tiles / f'{z}_{x}_{y}.jpg')
            time.sleep(0.05)
    print('sentinel-2 tiles', len(list(tiles.glob('*.jpg'))))


# ---------------------------------------------------------------- grids

def read_tiff(path: Path) -> np.ndarray:
    a = np.array(Image.open(path), dtype=np.float64)
    a[~np.isfinite(a) | (a < -1e20)] = np.nan
    return a


def bathymetry() -> tuple[np.ndarray, float]:
    """Mosaic of 0.4 x 1 degree WCS tiles; rows run north to south. Returns grid and cell size (degrees)."""
    rows = []
    for la in ('60.2', '59.8', '59.4', '59.0'):
        rows.append(np.hstack([read_tiff(SRC / f'bt/b_{la}_{lo}.tif') for lo in range(22, 30)]))
    grid = np.vstack(rows)
    return grid, (LAT1 - LAT0) / grid.shape[0]


class Bathy:
    def __init__(self) -> None:
        self.g, self.cell = bathymetry()
        self.h, self.w = self.g.shape

    def depth(self, lon: float, lat: float) -> float | None:
        if not (LON0 <= lon < LON1 and LAT0 <= lat < LAT1):
            return None
        r = min(self.h - 1, int((LAT1 - lat) / self.cell))
        c = min(self.w - 1, int((lon - LON0) / self.cell))
        v = self.g[r, c]
        return None if math.isnan(v) else float(v)

    def land_near(self, lon: float, lat: float, km: float = 1.0) -> bool:
        if not (LON0 <= lon < LON1 and LAT0 <= lat < LAT1):
            return False
        r = int((LAT1 - lat) / self.cell)
        c = int((lon - LON0) / self.cell)
        dr = max(1, int(km / 111.0 / self.cell))
        dc = max(1, int(km / (111.0 * math.cos(math.radians(lat))) / self.cell))
        win = self.g[max(0, r - dr):r + dr + 1, max(0, c - dc):c + dc + 1]
        return bool(np.nanmax(win) >= 0) if np.isfinite(win).any() else False


class Density:
    """EMODnet vessel density (hours per km2 per month), EPSG:3857 grid covering 21-30.5E, 58.8-60.9N."""

    def __init__(self, *names: str) -> None:
        self.g = sum(np.nan_to_num(read_tiff(SRC / f'vd_{n}.out'), nan=0.0) for n in names)
        self.h, self.w = self.g.shape
        self.x0, self.x1 = merc_x(21.0), merc_x(30.5)
        self.y0, self.y1 = merc_y(58.8), merc_y(60.9)

    def at(self, lon: float, lat: float) -> float:
        c = int((merc_x(lon) - self.x0) / (self.x1 - self.x0) * self.w)
        r = int((self.y1 - merc_y(lat)) / (self.y1 - self.y0) * self.h)
        if 0 <= r < self.h and 0 <= c < self.w:
            return float(max(0.0, self.g[r, c]))
        return 0.0

    def crop(self) -> np.ndarray:
        c0 = int((merc_x(LON0) - self.x0) / (self.x1 - self.x0) * self.w)
        c1 = int((merc_x(LON1) - self.x0) / (self.x1 - self.x0) * self.w)
        r0 = int((self.y1 - merc_y(LAT1)) / (self.y1 - self.y0) * self.h)
        r1 = int((self.y1 - merc_y(LAT0)) / (self.y1 - self.y0) * self.h)
        return self.g[r0:r1, c0:c1]


# ---------------------------------------------------------------- cables

def kind_of(tags: dict[str, str]) -> str:
    if tags.get('man_made') == 'pipeline' or tags.get('seamark:type') == 'pipeline_submarine':
        return 'pipeline'
    if tags.get('power') == 'cable' or tags.get('seamark:cable_submarine:category') == 'power':
        return 'power'
    if tags.get('communication') == 'line' or tags.get('telecom') == 'line' or tags.get('seamark:cable_submarine:category') == 'telecom':
        return 'telecom'
    return 'cable'


def load_ways() -> list[dict]:
    d = json.loads((SRC / 'osm_cables.json').read_text())
    ways = []
    for e in d['elements']:
        if e.get('type') != 'way' or not e.get('geometry'):
            continue
        tags = e.get('tags', {})
        pts = [(round(p['lon'], 6), round(p['lat'], 6)) for p in e['geometry']]
        if len(pts) >= 2:
            ways.append({'id': e['id'], 'tags': tags, 'pts': pts})
    return ways


def along_shore_distance(ways: list[dict], bathy: Bathy) -> dict[tuple[float, float], float]:
    """Multi-source Dijkstra over the OSM node graph from every shore landing (chain ends on or near land).

    Chain ends outside the study area are treated as landings (cables end ashore); ends inside the area that
    are neither shallow nor near land are mapping gaps and get no interrogator.
    """
    adj: dict[tuple[float, float], list[tuple[tuple[float, float], float]]] = {}
    for w in ways:
        for a, b in zip(w['pts'], w['pts'][1:]):
            d = hav_km(*a, *b)
            adj.setdefault(a, []).append((b, d))
            adj.setdefault(b, []).append((a, d))
    sources = []
    for node, nbrs in adj.items():
        if len(nbrs) != 1:
            continue
        lon, lat = node
        inside = LON0 <= lon < LON1 and LAT0 <= lat < LAT1
        dep = bathy.depth(lon, lat)
        if not inside or (dep is not None and dep >= LANDING_DEPTH_M) or bathy.land_near(lon, lat, 0.6):
            sources.append(node)
    dist = {s: 0.0 for s in sources}
    pq = [(0.0, s) for s in sources]
    heapq.heapify(pq)
    while pq:
        d0, u = heapq.heappop(pq)
        if d0 > dist.get(u, math.inf):
            continue
        for v, w in adj[u]:
            nd = d0 + w
            if nd < dist.get(v, math.inf):
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return dist


def sample_way(pts: list[tuple[float, float]], step: float) -> list[tuple[float, float, int, float]]:
    """Points every `step` km along the way; returns (lon, lat, segment index, fraction) for interpolation."""
    out = [(pts[0][0], pts[0][1], 0, 0.0)]
    carry = 0.0
    for i, (a, b) in enumerate(zip(pts, pts[1:])):
        seg = hav_km(*a, *b)
        if seg == 0:
            continue
        t = step - carry
        while t <= seg:
            f = t / seg
            out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, i, f))
            t += step
        carry = (carry + seg) % step
    last = pts[-1]
    if (out[-1][0], out[-1][1]) != last:
        out.append((last[0], last[1], len(pts) - 2, 1.0))
    return out


def build_cables(bathy: Bathy, ct: Density, allv: Density) -> list[dict]:
    ways = load_ways()
    shore = along_shore_distance(ways, bathy)
    groups: dict[str, list[dict]] = {}
    for w in ways:
        name = w['tags'].get('name') or w['tags'].get('seamark:name')
        key = f'name:{name}' if name else f'way:{w["id"]}'
        groups.setdefault(key, []).append(w)
    cables = []
    for key, ws in groups.items():
        tags = ws[0]['tags']
        name = tags.get('name') or tags.get('seamark:name')
        parts, length = [], 0.0
        for w in ws:
            pts = w['pts']
            cum = [0.0]
            for a, b in zip(pts, pts[1:]):
                cum.append(cum[-1] + hav_km(*a, *b))
            samples = []
            for lon, lat, i, f in sample_way(pts, STEP_KM):
                if not (LON0 <= lon < LON1 and LAT0 <= lat < LAT1):
                    if samples:
                        parts.append(samples)
                        samples = []
                    continue
                da, db = shore.get(pts[i], math.inf), shore.get(pts[min(i + 1, len(pts) - 1)], math.inf)
                seg = cum[min(i + 1, len(pts) - 1)] - cum[i]
                to_shore = min(da + f * seg, db + (1 - f) * seg)
                dep = bathy.depth(lon, lat)
                samples.append([round(lon, 5), round(lat, 5), None if dep is None else round(dep, 1),
                                round(ct.at(lon, lat), 3), round(allv.at(lon, lat), 3),
                                None if math.isinf(to_shore) else round(to_shore, 2)])
            if len(samples) >= 2:
                parts.append(samples)
            elif len(samples) == 1 and parts == []:
                pass
        parts = [p for p in parts if len(p) >= 2]
        if not parts:
            continue
        length = sum(hav_km(a[0], a[1], b[0], b[1]) for p in parts for a, b in zip(p, p[1:]))
        if length < 0.3:
            continue
        cables.append({'id': key, 'name': name, 'kind': kind_of(tags), 'named': bool(name),
                       'operator': tags.get('operator'), 'lengthKm': round(length, 2), 'parts': parts})
    cables.sort(key=lambda c: (not c['named'], -c['lengthKm']))
    return cables


# ---------------------------------------------------------------- rasters

def merc_rows(height: int) -> np.ndarray:
    ys = np.linspace(merc_y(LAT1), merc_y(LAT0), height)
    return np.array([inv_y(y) for y in ys])


def depth_overlay(bathy: Bathy, width: int = 1600) -> tuple[np.ndarray, np.ndarray]:
    """Resample the bathymetry onto a Web Mercator grid so it lines up exactly with the map."""
    h = int(width * (merc_y(LAT1) - merc_y(LAT0)) / (merc_x(LON1) - merc_x(LON0)))
    lats = merc_rows(h)
    rows = np.clip(((LAT1 - lats) / bathy.cell).astype(int), 0, bathy.h - 1)
    cols = np.clip((np.linspace(0, bathy.w - 1, width)).astype(int), 0, bathy.w - 1)
    return bathy.g[np.ix_(rows, cols)], lats


DEPTH_STOPS = [(0, (64, 96, 120)), (-20, (38, 70, 98)), (-50, (24, 50, 78)), (-80, (16, 34, 58)), (-120, (9, 20, 38)), (-250, (4, 10, 22))]


def depth_rgba(g: np.ndarray) -> np.ndarray:
    out = np.zeros(g.shape + (4,), dtype=np.uint8)
    sea = np.isfinite(g) & (g < 0)
    d = np.where(sea, g, 0)
    xs = [s[0] for s in DEPTH_STOPS][::-1]
    for ch in range(3):
        ys = [s[1][ch] for s in DEPTH_STOPS][::-1]
        out[..., ch] = np.interp(d, xs, ys).astype(np.uint8)
    out[..., 3] = np.where(sea, 200, 0)
    return out


def density_rgba(g: np.ndarray, p90: float) -> np.ndarray:
    """Log-scaled single-hue (amber) ramp; transparent where there is no traffic."""
    out = np.zeros(g.shape + (4,), dtype=np.uint8)
    v = np.clip(np.log10(np.maximum(g, 1e-3) / 0.05) / math.log10(max(p90 * 10, 1) / 0.05), 0, 1)
    v = np.where(g > 0.05, v, 0)
    out[..., 0] = (255 * (0.55 + 0.45 * v)).astype(np.uint8)
    out[..., 1] = (190 * (0.35 + 0.65 * v)).astype(np.uint8)
    out[..., 2] = (40 * (1 - v)).astype(np.uint8)
    out[..., 3] = (v * 230).astype(np.uint8)
    return out


def save_png(a: np.ndarray, path: Path) -> None:
    Image.fromarray(a, 'RGBA').save(path, optimize=True)


def satellite_texture(width: int) -> np.ndarray | None:
    tiles = sorted((SRC / 's2_z9').glob('9_*.jpg'))
    if not tiles:
        return None
    z, n = 9, 512
    xs = sorted({int(t.stem.split('_')[1]) for t in tiles})
    ys = sorted({int(t.stem.split('_')[2]) for t in tiles})
    mosaic = Image.new('RGB', (256 * len(xs), 256 * len(ys)))
    for t in tiles:
        _, x, y = map(int, t.stem.split('_'))
        mosaic.paste(Image.open(t).convert('RGB'), ((x - xs[0]) * 256, (y - ys[0]) * 256))
    # crop to the study area in tile pixel space (tiles are Web Mercator)
    px = lambda lon: ((lon + 180) / 360 * n - xs[0]) * 256  # noqa: E731
    py = lambda lat: ((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n - ys[0]) * 256  # noqa: E731
    box = (round(px(LON0)), round(py(LAT1)), round(px(LON1)), round(py(LAT0)))
    crop = mosaic.crop(box)
    h = int(width * crop.height / crop.width)
    return np.array(crop.resize((width, h), Image.LANCZOS))


def terrain(bathy: Bathy, width: int = 400) -> dict:
    g, _ = depth_overlay(bathy, width)
    hgt = np.nan_to_num(g, nan=0.0).astype(np.float32)
    OUT_PUB.mkdir(parents=True, exist_ok=True)
    (OUT_PUB / 'terrain.bin').write_bytes(hgt.tobytes())
    tex_w = 2048
    sat = satellite_texture(tex_w)
    deep, _ = depth_overlay(bathy, tex_w)
    sea_rgba = depth_rgba(deep)
    if sat is not None and sat.shape[:2] != deep.shape:
        sat = np.array(Image.fromarray(sat).resize((deep.shape[1], deep.shape[0]), Image.LANCZOS))
    land = sat if sat is not None else np.full(deep.shape + (3,), 60, np.uint8)
    sea = sea_rgba[..., 3:4] > 0
    tex = np.where(sea, sea_rgba[..., :3], (land * 0.85).astype(np.uint8))
    buf = io.BytesIO()
    Image.fromarray(tex.astype(np.uint8), 'RGB').save(buf, 'JPEG', quality=84, optimize=True)
    (OUT_PUB / 'terrain.jpg').write_bytes(buf.getvalue())
    return {'width': hgt.shape[1], 'height': hgt.shape[0], 'min': float(hgt.min()), 'max': float(hgt.max()),
            'satellite': sat is not None}


# ---------------------------------------------------------------- main

def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--fetch', action='store_true', help='download the Sentinel-2 tiles (network)')
    args = ap.parse_args()
    if args.fetch:
        fetch()
    bathy = Bathy()
    ct, allv = Density('09avg', '10avg'), Density('allavg')
    sea_ct = ct.crop()
    sea_ct = sea_ct[sea_ct > 0]
    p90 = float(np.percentile(sea_ct, 90))
    cables = build_cables(bathy, ct, allv)

    OUT_PUB.mkdir(parents=True, exist_ok=True)
    dg, _ = depth_overlay(bathy, 1600)
    save_png(depth_rgba(dg), OUT_PUB / 'depth.png')
    save_png(density_rgba(ct.crop(), p90), OUT_PUB / 'density.png')
    t = terrain(bathy)

    sea_depths = bathy.g[np.isfinite(bathy.g) & (bathy.g < 0)]
    data = {
        'bbox': [LON0, LAT0, LON1, LAT1],
        'built': '2026-11-18',
        'stepKm': STEP_KM,
        'trafficP90': round(p90, 3),
        'terrain': t,
        'seaDepth': {'median': round(float(np.median(sea_depths)), 1), 'p95': round(float(np.percentile(sea_depths, 5)), 1),
                     'max': round(float(sea_depths.min()), 1)},
        'cables': cables,
        'inputs': {p.name: sha(p) for p in [SRC / 'osm_cables.json', SRC / 'vd_09avg.out', SRC / 'vd_10avg.out',
                                             SRC / 'vd_allavg.out', SRC / 'bt/b_59.4_24.tif']},
        'osmTimestamp': json.loads((SRC / 'osm_cables.json').read_text()).get('osm3s', {}).get('timestamp_osm_base'),
    }
    blob = json.dumps(data, separators=(',', ':'))
    OUT_JSON.write_text(blob)
    (OUT_PUB / 'model.json').write_text(blob)
    named = [c for c in cables if c['named']]
    print('cables', len(cables), 'named', len(named), 'km', round(sum(c['lengthKm'] for c in cables)),
          'json', OUT_JSON.stat().st_size, 'p90', round(p90, 2), 'terrain', t)
    for c in named:
        print(f"  {c['name'][:36]:36} {c['kind']:8} {c['lengthKm']:7.1f} km parts={len(c['parts'])}")
    _ = zlib  # stdlib PNG fallback not needed while PIL is present


if __name__ == '__main__':
    main()
