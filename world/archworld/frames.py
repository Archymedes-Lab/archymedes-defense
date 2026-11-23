"""Coordinate frames. Source CRS (+ vertical datum) -> geodetic (ellipsoidal) -> ECEF -> local ENU at the site centre.

Heights go through the official geoid grid (CHGeo2004 for LN02). Ballpark transformations are refused: over the
Lauterbrunnen site the LN02 -> ellipsoid offset varies by ~35 cm, so a constant offset would be wrong.
The ENU frame is the single world frame for tiles and the simulation (x east, y north, z up, metres, float64).
"""

from __future__ import annotations

import numpy as np
from pyproj import Transformer, network
from pyproj.transformer import TransformerGroup

from .sites import Site

VERTICAL_EPSG = {"LN02": 5728, "NAVD88": 5703}
_A = 6378137.0
_F = 1 / 298.257223563
_E2 = _F * (2 - _F)


def geodetic_to_ecef(lon, lat, h):
    lon, lat = np.radians(lon), np.radians(lat)
    n = _A / np.sqrt(1 - _E2 * np.sin(lat) ** 2)
    return ((n + h) * np.cos(lat) * np.cos(lon), (n + h) * np.cos(lat) * np.sin(lon), (n * (1 - _E2) + h) * np.sin(lat))


def ecef_to_geodetic(x, y, z):
    lon = np.arctan2(y, x)
    p = np.hypot(x, y)
    lat = np.arctan2(z, p * (1 - _E2))
    for _ in range(6):  # converges to < 1e-12 rad at these heights
        n = _A / np.sqrt(1 - _E2 * np.sin(lat) ** 2)
        h = p / np.cos(lat) - n
        lat = np.arctan2(z, p * (1 - _E2 * n / (n + h)))
    n = _A / np.sqrt(1 - _E2 * np.sin(lat) ** 2)
    h = p / np.cos(lat) - n
    return np.degrees(lon), np.degrees(lat), h


class Frame:
    def __init__(self, site: Site) -> None:
        network.set_network_enabled(True)  # PROJ fetches and caches the geoid grid once
        src = f"{site.crs}+{VERTICAL_EPSG[site.vertical]}"
        group = TransformerGroup(src, "EPSG:4979", always_xy=True)
        ok = [t for t in group.transformers if "allpark" not in t.description]
        if not ok:
            raise RuntimeError(f"{site.id}: no grid-based vertical transformation available")
        self._fwd = ok[0]
        self.vertical_method = ok[0].description
        self._ll = Transformer.from_crs(site.crs, "EPSG:4326", always_xy=True)
        cx, cy = site.center
        lon0, lat0, _ = self._fwd.transform(cx, cy, 0.0)
        self.lon0, self.lat0 = float(lon0), float(lat0)
        self.origin_ecef = np.array(geodetic_to_ecef(lon0, lat0, 0.0))
        lo, la = np.radians(lon0), np.radians(lat0)
        # rows: east, north, up expressed in ECEF
        self.R = np.array([
            [-np.sin(lo), np.cos(lo), 0.0],
            [-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)],
            [np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)],
        ])

    def to_wgs84(self, x, y):
        return self._ll.transform(x, y)

    def from_wgs84(self, lon, lat):
        return self._ll.transform(lon, lat, direction="INVERSE")

    def to_enu(self, x, y, h):
        lon, lat, eh = self._fwd.transform(np.asarray(x, float), np.asarray(y, float), np.asarray(h, float))
        ecef = np.stack(geodetic_to_ecef(lon, lat, eh), axis=-1) - self.origin_ecef
        enu = ecef @ self.R.T
        return enu[..., 0], enu[..., 1], enu[..., 2]

    def from_enu(self, e, n, u):
        enu = np.stack([np.asarray(e, float), np.asarray(n, float), np.asarray(u, float)], axis=-1)
        ecef = enu @ self.R + self.origin_ecef
        lon, lat, eh = ecef_to_geodetic(ecef[..., 0], ecef[..., 1], ecef[..., 2])
        inv = lambda a, b, c: np.array(self._fwd.transform(a, b, c, direction="INVERSE"))  # noqa: E731
        # PROJ's inverse oblique Mercator stops at ~1 mm. The forward is closed-form, so refine against it: the
        # inverse's bias cancels in inv(target) - inv(fwd(p)).
        target = inv(lon, lat, eh)
        p = target.copy()
        for _ in range(2):
            p = p + (target - inv(*self._fwd.transform(*p)))
        return p[0], p[1], p[2]

    def enu_to_ecef_matrix(self) -> np.ndarray:
        m = np.eye(4)
        m[:3, :3] = self.R.T
        m[:3, 3] = self.origin_ecef
        return m
