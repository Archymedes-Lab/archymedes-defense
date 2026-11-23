"""Site definitions. A site is an axis-aligned square in a projected national CRS, in metres.

The scope rule applies here: sites are civil areas. Military installations and other sensitive real sites are refused
by name when a site is declared, and are never rebuilt.
"""

from __future__ import annotations

from dataclasses import dataclass

from pyproj import Transformer


@dataclass(frozen=True)
class Site:
    id: str
    name: str
    crs: str  # EPSG code of the projected CRS the source data is delivered in
    vertical: str  # vertical datum of source heights, declared once, never mixed
    x0: float
    y0: float
    size: float  # metres, square side
    tile: float  # world tile side in metres
    notes: str

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        return (self.x0, self.y0, self.x0 + self.size, self.y0 + self.size)

    @property
    def center(self) -> tuple[float, float]:
        return (self.x0 + self.size / 2, self.y0 + self.size / 2)

    def tiles(self) -> list[tuple[int, int]]:
        n = round(self.size / self.tile)
        return [(i, j) for j in range(n) for i in range(n)]

    def tile_bounds(self, i: int, j: int) -> tuple[float, float, float, float]:
        x = self.x0 + i * self.tile
        y = self.y0 + j * self.tile
        return (x, y, x + self.tile, y + self.tile)

    def wgs84_bbox(self, pad: float = 0.0) -> tuple[float, float, float, float]:
        """lon/lat bbox that covers the square (corners transformed, then enveloped)."""
        t = Transformer.from_crs(self.crs, "EPSG:4326", always_xy=True)
        x0, y0, x1, y1 = self.bounds
        xs, ys = [], []
        for x in (x0 - pad, x1 + pad):
            for y in (y0 - pad, y1 + pad):
                lon, lat = t.transform(x, y)
                xs.append(lon)
                ys.append(lat)
        return (min(xs), min(ys), max(xs), max(ys))


SITES: dict[str, Site] = {
    "ch-lauterbrunnen": Site(
        id="ch-lauterbrunnen",
        name="Lauterbrunnen valley, Bernese Oberland (CH)",
        crs="EPSG:2056",  # CH1903+ / LV95
        vertical="LN02",  # swissALTI3D heights; declared, converted only at the ECEF step
        x0=2_634_000.0,
        y0=1_158_000.0,
        size=4_000.0,
        tile=1_000.0,
        notes="Cliffs, waterfalls, forest, village, road, rail, river; Wengen terrace in the NE corner.",
    ),
    "us-boulder": Site(
        id="us-boulder",
        name="Boulder foothills and Flatirons, Colorado (US)",
        crs="EPSG:26913",  # NAD83 / UTM 13N, as USGS 3DEP 1 m DEM tiles are delivered
        vertical="NAVD88",
        x0=474_000.0,
        y0=4_427_000.0,
        size=4_000.0,
        tile=1_000.0,
        notes="Flatirons, Chautauqua, Boulder Canyon, west Boulder town grid; DRCOG 2020 lidar, NAIP 0.6 m.",
    ),
}

# Lower-case substrings that must not appear in a site name or notes (scope rule, checked by tests).
REFUSED_SITE_TERMS = ("air force", "army", "naval", "military", "barracks", "missile", "nuclear", "base camp")
