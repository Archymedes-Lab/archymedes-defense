"""Terrain: a regular grid sampled from the DTM on one global lattice, so tile edges share vertices exactly.

All grid coordinates are computed as origin + integer * step from the same site origin, and heights come from the
same bilinear sampler, so the shared edge of two tiles is bit-identical (no cracks, no T-junctions).
Every cell is split along the same diagonal, and `Surface.height` interpolates on exactly those triangles: anything
placed with it (roads, skirts, agents) sits on the rendered surface, not on a different one.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .sites import Site


@dataclass(frozen=True)
class Raster:
    """Pixel-is-area raster. arr[0, 0] is the north-west pixel; x0/y1 are the outer NW corner."""

    arr: np.ndarray
    x0: float
    y1: float
    res: float

    def sample(self, x, y):
        a = self.arr
        fc = (np.asarray(x, float) - self.x0) / self.res - 0.5
        fr = (self.y1 - np.asarray(y, float)) / self.res - 0.5
        fc = np.clip(fc, 0, a.shape[1] - 1)
        fr = np.clip(fr, 0, a.shape[0] - 1)
        c0 = np.minimum(np.floor(fc).astype(np.int64), a.shape[1] - 2)
        r0 = np.minimum(np.floor(fr).astype(np.int64), a.shape[0] - 2)
        tc, tr = fc - c0, fr - r0
        v00 = a[r0, c0].astype(float)
        v01 = a[r0, c0 + 1].astype(float)
        v10 = a[r0 + 1, c0].astype(float)
        v11 = a[r0 + 1, c0 + 1].astype(float)
        return (v00 * (1 - tc) + v01 * tc) * (1 - tr) + (v10 * (1 - tc) + v11 * tc) * tr

    def centres(self, bounds):
        """Pixel-centre coordinates and values inside bounds (for error measurement)."""
        x0, y0, x1, y1 = bounds
        c0 = int(np.ceil((x0 - self.x0) / self.res - 0.5))
        c1 = int(np.floor((x1 - self.x0) / self.res - 0.5))
        r0 = int(np.ceil((self.y1 - y1) / self.res - 0.5))
        r1 = int(np.floor((self.y1 - y0) / self.res - 0.5))
        c0, r0 = max(c0, 0), max(r0, 0)
        c1, r1 = min(c1, self.arr.shape[1] - 1), min(r1, self.arr.shape[0] - 1)
        cs = np.arange(c0, c1 + 1)
        rs = np.arange(r0, r1 + 1)
        xs = self.x0 + (cs + 0.5) * self.res
        ys = self.y1 - (rs + 0.5) * self.res
        gx, gy = np.meshgrid(xs, ys)
        return gx, gy, self.arr[r0:r1 + 1, c0:c1 + 1].astype(float)


@dataclass(frozen=True)
class Grid:
    x: np.ndarray  # (rows, cols), rows go south -> north
    y: np.ndarray
    h: np.ndarray


def _axis(origin: float, start: int, count: int, step: float) -> np.ndarray:
    return origin + (start + np.arange(count)) * step


def _cells_per_tile(site: Site, step: float) -> int:
    nt = site.tile / step
    if abs(nt - round(nt)) > 1e-9:
        raise ValueError("tile size must be a multiple of the grid step")
    return round(nt)


def tile_grid(site: Site, raster: Raster, i: int, j: int, step: float) -> Grid:
    nt = _cells_per_tile(site, step)
    xs = _axis(site.x0, i * nt, nt + 1, step)
    ys = _axis(site.y0, j * nt, nt + 1, step)
    gx, gy = np.meshgrid(xs, ys)
    return Grid(gx, gy, raster.sample(gx, gy))


def site_grid(site: Site, raster: Raster, step: float) -> Grid:
    n = round(site.size / step)
    if abs(site.size / step - n) > 1e-9:
        raise ValueError("site size must be a multiple of the grid step")
    gx, gy = np.meshgrid(_axis(site.x0, 0, n + 1, step), _axis(site.y0, 0, n + 1, step))
    return Grid(gx, gy, raster.sample(gx, gy))


def grid_indices(shape: tuple[int, int]) -> np.ndarray:
    rows, cols = shape
    r, c = np.meshgrid(np.arange(rows - 1), np.arange(cols - 1), indexing="ij")
    v00 = (r * cols + c).ravel()
    v10 = v00 + 1
    v01 = v00 + cols
    v11 = v01 + 1
    lower = np.stack([v00, v10, v11], 1)
    upper = np.stack([v00, v11, v01], 1)
    return np.concatenate([lower, upper], 1).reshape(-1).astype(np.uint32)


class Surface:
    """Height of the rendered terrain mesh at any (x, y) in the site, at a given grid step."""

    def __init__(self, site: Site, raster: Raster, step: float) -> None:
        self.site, self.step = site, step
        self.grid = site_grid(site, raster, step)
        self.n = self.grid.h.shape[0] - 1

    @classmethod
    def from_heights(cls, site: Site, h: np.ndarray, step: float) -> Surface:
        """Rebuild the surface from stored lattice heights (the simulation loads it this way, without the raster)."""
        self = object.__new__(cls)
        self.site, self.step = site, step
        n = h.shape[0] - 1
        if h.shape != (n + 1, n + 1) or abs(n * step - site.size) > 1e-9:
            raise ValueError("height lattice does not match the site")
        gx, gy = np.meshgrid(_axis(site.x0, 0, n + 1, step), _axis(site.y0, 0, n + 1, step))
        self.grid = Grid(gx, gy, np.asarray(h, float))
        self.n = n
        return self

    def height(self, x, y):
        s = self.step
        fx = (np.asarray(x, float) - self.site.x0) / s
        fy = (np.asarray(y, float) - self.site.y0) / s
        i = np.clip(np.floor(fx).astype(np.int64), 0, self.n - 1)
        j = np.clip(np.floor(fy).astype(np.int64), 0, self.n - 1)
        fx = np.clip(fx - i, 0, 1)
        fy = np.clip(fy - j, 0, 1)
        h = self.grid.h
        h00, h10, h01, h11 = h[j, i], h[j, i + 1], h[j + 1, i], h[j + 1, i + 1]
        lower = fx >= fy
        return np.where(lower, h00 + fx * (h10 - h00) + fy * (h11 - h10), h00 + fy * (h01 - h00) + fx * (h11 - h01))
