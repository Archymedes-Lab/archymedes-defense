"""The world as the simulation sees it: rendered terrain surface, building solids as prisms, canopy height,
and the road/path graph. Coordinates are the site's national grid (east, north in metres, height in the site's
vertical datum). Replays are converted to the tiles' ENU frame on output; the difference between grid metres and
true metres is measured by `frame_distortion_ppm` and written into every run manifest.
"""

from __future__ import annotations

import heapq
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import LineString, Polygon
from shapely.strtree import STRtree

from ..frames import Frame
from ..sites import SITES, Site
from ..terrain import Surface
from .scope import Kind

DRIVE = frozenset({"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "service",
                   "living_street", "track", "motorway_link", "trunk_link", "primary_link", "secondary_link",
                   "tertiary_link"})
DRIVE_SPEED = {"motorway": 14.0, "trunk": 14.0, "primary": 14.0, "secondary": 12.0, "tertiary": 10.0,
               "unclassified": 8.0, "residential": 7.0, "living_street": 3.0, "service": 4.0, "track": 3.0}
LOS_STEP = 1.0  # m between line-of-sight samples
LOS_END_GAP = 1.5  # m near each end that is not tested (the observer's own position, the subject's own body)
VEG_MIN = 2.0  # m: lower "canopy" is grass, crops or noise
VEG_PATH_LIMIT = 25.0  # m of foliage a sight line may cross (assumed; alpine spruce stands are denser)
WAY_SLOPE_CAP = 0.45  # steepest gradient a mapped way is slowed for (about 24 degrees)
GRADE_WINDOW = 11  # points (about metres) over which a road's gradient is measured
XC_STEP = 8.0  # cross-country grid
FENCE_CLEAR = 8.0  # m: cross-country cells this close to a fence line are not walkable
XC_FACTOR, XC_FOREST = 0.6, 0.7  # off-path and in-forest walking speed factors (assumed)


def tobler(slope: np.ndarray | float) -> np.ndarray | float:
    """Walking speed in m/s on a slope dz/dx (Tobler's hiking function)."""
    return (6.0 / 3.6) * np.exp(-3.5 * np.abs(slope + 0.05))


@dataclass(frozen=True)
class Route:
    pts: np.ndarray  # (N, 3) grid x, y, height
    T: np.ndarray  # (N,) int64 ms from the start; strictly increasing
    nodes: tuple[int, ...] = ()


class SimWorld:
    def __init__(self) -> None:
        raise TypeError("use SimWorld.from_parts or SimWorld.load")

    @classmethod
    def from_parts(cls, site: Site, surf: Surface, buildings: list[dict], roads: dict, canopy: np.ndarray | None = None,
                   canopy_step: float = 2.0, enclosures: list | None = None) -> SimWorld:
        w = object.__new__(cls)
        w.site, w.surf = site, surf
        w.buildings = sorted(buildings, key=lambda b: b["fid"])
        w.polys = [Polygon(b["ring"]) for b in w.buildings]
        w.tops = np.array([b["top"] for b in w.buildings], float)
        w.tree = STRtree(w.polys) if w.polys else None
        w.canopy, w.canopy_step = canopy, canopy_step
        # fenced areas: walkers cannot cross the fence line; the only way in or out is a road through a gate
        w.enclosures = [Polygon(r) for r in (enclosures or [])]
        w._build_graph(roads)
        w._route_cache = {}
        w._xc = None
        w._xc_cache = {}
        w._near_fence = np.zeros(len(w.nx), bool)
        w._node_side = np.full(len(w.nx), -1, np.int64)
        if w.enclosures and len(w.nx):
            pts = shapely.points(w.nx, w.ny)
            for i, poly in enumerate(w.enclosures):
                w._near_fence |= shapely.dwithin(pts, poly.exterior, FENCE_CLEAR + 2.0)
                w._node_side[shapely.contains(poly, pts)] = i
        return w

    @classmethod
    def load(cls, out: Path) -> SimWorld:
        out = Path(out)
        report = json.loads((out / "report.json").read_text())
        site = SITES[report["site"]["id"]]
        surf = Surface.from_heights(site, np.load(out / "sim" / "terrain.npy"), report["grid"]["leaf_step_m"])
        buildings = json.loads((out / "sim" / "buildings.json").read_text())["buildings"]
        cpath = out / "sim" / "canopy.npy"
        canopy = np.load(cpath) if cpath.exists() else None
        roads = json.loads((out / "roads.json").read_text())
        return cls.from_parts(site, surf, buildings, roads, canopy=canopy,
                              canopy_step=report.get("sim", {}).get("canopy_step_m", 2.0))

    # ------------------------------------------------------------------ terrain, buildings, canopy

    def ground(self, x, y):
        return self.surf.height(x, y)

    def inside_building(self, x, y) -> np.ndarray:
        x, y = np.atleast_1d(np.asarray(x, float)), np.atleast_1d(np.asarray(y, float))
        if self.tree is None:
            return np.zeros(len(x), bool)
        hit = self.tree.query(shapely.points(x, y), predicate="within")[0]
        out = np.zeros(len(x), bool)
        out[hit] = True
        return out

    def canopy_at(self, x, y) -> np.ndarray:
        x = np.asarray(x, float)
        if self.canopy is None:
            return np.zeros(x.shape)
        n = self.canopy.shape[0]
        c = np.clip(((x - self.site.x0) / self.canopy_step).astype(np.int64), 0, n - 1)
        r = np.clip(((np.asarray(y, float) - self.site.y0) / self.canopy_step).astype(np.int64), 0, n - 1)
        return self.canopy[r, c].astype(float)

    def los(self, a, b) -> bool:
        """Is b visible from a? Terrain and buildings are opaque; foliage blocks after VEG_PATH_LIMIT metres.
        The endpoints are put in a fixed order first, so los(a, b) and los(b, a) run the same arithmetic."""
        a, b = np.asarray(a, float), np.asarray(b, float)
        if tuple(a) > tuple(b):
            a, b = b, a
        d = float(np.linalg.norm(b - a))
        if d <= 2 * LOS_END_GAP:
            return True
        n = int(np.ceil(d / LOS_STEP))
        t = np.arange(1, n) / n
        t = t[(t * d > LOS_END_GAP) & ((1 - t) * d > LOS_END_GAP)]
        p = a + (b - a) * t[:, None]
        ground = self.ground(p[:, 0], p[:, 1])
        if (p[:, 2] < ground).any():
            return False
        if self.tree is not None:
            line = LineString([a[:2], b[:2]])
            L = line.length
            for i in self.tree.query(line, predicate="intersects"):
                part = line.intersection(self.polys[i])
                for g in getattr(part, "geoms", [part]):
                    if g.geom_type != "LineString":
                        continue
                    s = [line.project(shapely.Point(c)) / L for c in g.coords] if L > 0 else [0.0]
                    if a[2] + (b[2] - a[2]) * min(s) < self.tops[i] or a[2] + (b[2] - a[2]) * max(s) < self.tops[i]:
                        return False
        if self.canopy is not None:
            ch = self.canopy_at(p[:, 0], p[:, 1])
            in_veg = (ch >= VEG_MIN) & (p[:, 2] < ground + ch)
            if in_veg.sum() * (d / n) > VEG_PATH_LIMIT:
                return False
        return True

    # ------------------------------------------------------------------ road / path graph

    def _build_graph(self, roads: dict) -> None:
        off = roads.get("offset_m", 0.0)
        index: dict[tuple[int, int], int] = {}
        xs, ys, zs = [], [], []
        ea, eb, ecls, eg = [], [], [], []
        classes: list[str] = []
        for w in roads["ways"]:
            if w["kind"] != "highway" or w.get("tunnel"):
                continue  # tunnels are not walkable here: their height is the surface above them
            if w["class"] not in classes:
                classes.append(w["class"])
            ci = classes.index(w["class"])
            prev = None
            # gradient over a window (about 11 m at 1 m spacing): a single bump of the 4 m terrain mesh under a
            # road is not a slope a vehicle or a walker would notice
            zw = np.array([p[2] for p in w["lv95"]], float)
            zs_smooth = np.convolve(np.pad(zw, GRADE_WINDOW // 2, mode="edge"), np.ones(GRADE_WINDOW) / GRADE_WINDOW,
                                    mode="valid")
            for (x, y, z), zsm, zsm_prev in zip(w["lv95"], zs_smooth, np.concatenate([[zs_smooth[0]], zs_smooth[:-1]]),
                                                strict=True):
                key = (round(x * 100), round(y * 100))
                i = index.get(key)
                if i is None:
                    i = index[key] = len(xs)
                    xs.append(x)
                    ys.append(y)
                    zs.append(z - off)
                if prev is not None and prev != i:
                    ea.append(prev)
                    eb.append(i)
                    ecls.append(ci)
                    eg.append(float(zsm - zsm_prev))
                prev = i
        self.nx, self.ny, self.nz = np.array(xs, float), np.array(ys, float), np.array(zs, float)
        if len(xs):  # stored heights are rounded: never below the surface (bridges stay above it)
            self.nz = np.maximum(self.nz, self.surf.height(self.nx, self.ny))
        ea, eb, ecls = np.array(ea, np.int64), np.array(eb, np.int64), np.array(ecls, np.int64)
        eg = np.array(eg, float)
        self.classes = classes
        self.blocked_by_building = 0
        if len(ea) and self.tree is not None:
            mid = shapely.points((self.nx[ea] + self.nx[eb]) / 2, (self.ny[ea] + self.ny[eb]) / 2)
            bad = np.zeros(len(ea), bool)
            bad[self.tree.query(mid, predicate="within")[0]] = True
            self.blocked_by_building = int(bad.sum())  # OSM line through a measured building: not walkable
            ea, eb, ecls, eg = ea[~bad], eb[~bad], ecls[~bad], eg[~bad]
        n = len(xs)
        # adjacency: (neighbour, class, height change towards the neighbour over the gradient window)
        self.adj: list[list[tuple[int, int, float]]] = [[] for _ in range(n)]
        for a, b, c, dz in zip(ea.tolist(), eb.tolist(), ecls.tolist(), eg.tolist(), strict=True):
            self.adj[a].append((b, c, dz))
            self.adj[b].append((a, c, -dz))
        self.adj = [sorted({(v, c): (v, c, dz) for v, c, dz in lst}.values()) for lst in self.adj]
        drive_cls = {i for i, c in enumerate(classes) if c in DRIVE}
        self._comp, self._main, self._usable = {}, {}, {}
        for mode, ok in (("foot", None), ("drive", drive_cls)):
            comp = np.full(n, -1, np.int64)
            sizes = []
            for s in range(n):
                if comp[s] >= 0 or not any(ok is None or c in ok for _, c, _ in self.adj[s]):
                    continue
                cid, stack, size = len(sizes), [s], 0
                comp[s] = cid
                while stack:
                    u = stack.pop()
                    size += 1
                    for v, c, _ in self.adj[u]:
                        if comp[v] < 0 and (ok is None or c in ok):
                            comp[v] = cid
                            stack.append(v)
                sizes.append(size)
            self._comp[mode] = comp
            self._main[mode] = int(np.argmax(sizes)) if sizes else -1
            self._usable[mode] = (sizes, drive_cls if ok is not None else None)

    def graph_report(self) -> dict:
        out = {"nodes": len(self.nx), "edges_dropped_inside_buildings": self.blocked_by_building}
        for mode in ("foot", "drive"):
            sizes = self._usable[mode][0]
            out[mode] = {"components": len(sizes), "nodes": int(sum(sizes)),
                         "main_fraction": round(max(sizes) / sum(sizes), 4) if sizes else 0.0}
        return out

    def nearest_node(self, xy, mode: str, main_only: bool = True) -> int:
        comp = self._comp[mode]
        ok = comp == self._main[mode] if main_only else comp >= 0
        idx = np.flatnonzero(ok)
        d = (self.nx[idx] - xy[0]) ** 2 + (self.ny[idx] - xy[1]) ** 2
        return int(idx[np.argmin(d)])

    def _edge_ms(self, kind: Kind, a: int, b: int, cls: int, dz: float) -> int | None:
        """Travel time along one mapped edge. A mapped way is taken as passable for its class: the 4 m terrain
        mesh cannot show a road bench cut into a hillside, so slope here only slows an agent down (and is capped
        at WAY_SLOPE_CAP). Hard slope limits apply off the paths, in `cross_country`."""
        dx = float(np.hypot(self.nx[b] - self.nx[a], self.ny[b] - self.ny[a]))
        if dx <= 0:
            return None
        s = float(np.clip(dz / dx, -WAY_SLOPE_CAP, WAY_SLOPE_CAP))
        if kind.ways == "drive":
            name = self.classes[cls].removesuffix("_link")
            if self.classes[cls] not in DRIVE:
                return None
            v = min(kind.vmax, DRIVE_SPEED.get(name, 5.0)) * max(0.3, 1.0 - 3.0 * abs(s))
        elif kind.name == "dog":
            v = min(kind.vmax, 2.0 * float(tobler(s)))
        else:
            v = min(kind.vmax, float(tobler(s)))
        return max(1, int(np.ceil(1000.0 * dx / v)))  # rounded up: never faster than the limit

    def route(self, kind: Kind, src: int, dst: int, blocked: frozenset[int] = frozenset()) -> Route | None:
        key = (kind.name, src, dst, blocked)
        if key in self._route_cache:
            return self._route_cache[key]
        dist = {src: 0}
        prev: dict[int, int] = {}
        heap = [(0, src)]
        done = set()
        while heap:
            d, u = heapq.heappop(heap)
            if u in done:
                continue
            done.add(u)
            if u == dst:
                break
            for v, c, dz in self.adj[u]:
                if v in done or v in blocked:
                    continue
                ms = self._edge_ms(kind, u, v, c, dz)
                if ms is None:
                    continue
                nd = d + ms
                if nd < dist.get(v, 1 << 62):
                    dist[v] = nd
                    prev[v] = u
                    heapq.heappush(heap, (nd, v))
        if dst not in done:
            self._route_cache[key] = None
            return None
        nodes = [dst]
        while nodes[-1] != src:
            nodes.append(prev[nodes[-1]])
        nodes.reverse()
        i = np.array(nodes)
        r = Route(np.column_stack([self.nx[i], self.ny[i], self.nz[i]]), np.array([dist[k] for k in nodes], np.int64),
                  tuple(nodes))
        self._route_cache[key] = r
        return r

    def side_of(self, xy) -> int:
        """Index of the fenced area that contains xy, or -1 for outside all of them."""
        p = shapely.Point(xy[0], xy[1])
        return next((i for i, poly in enumerate(self.enclosures) if poly.contains(p)), -1)

    def join_node(self, xy, mode: str) -> int:
        """Nearest path node from which xy can be walked to without crossing a fence."""
        ok = (self._comp[mode] == self._main[mode]) & (self._node_side == self.side_of(xy)) & ~self._near_fence
        idx = np.flatnonzero(ok)
        if not len(idx):
            return self.nearest_node(xy, mode)
        return int(idx[np.argmin((self.nx[idx] - xy[0]) ** 2 + (self.ny[idx] - xy[1]) ** 2)])

    def best_exit(self, kind: Kind, src: int, xy, blocked: frozenset[int] = frozenset()) -> int:
        """The path node at which to leave the paths for the point xy: the one that minimises path time from
        `src` plus a straight-line estimate of the walk from there. One bounded Dijkstra: the search stops once
        every remaining node is already further by path than the best total found."""
        side = self.side_of(xy)
        gait = 2.0 if kind.name == "dog" else 1.0
        v_off = min(kind.vmax, gait * float(tobler(0.0)) * XC_FACTOR)
        best, best_node = 1 << 62, src
        dist = {src: 0}
        heap = [(0, src)]
        done = set()
        while heap:
            d, u = heapq.heappop(heap)
            if u in done:
                continue
            if d >= best:
                break
            done.add(u)
            if self._node_side[u] == side and (not self._near_fence[u] or u == src):
                total = d + int(1000.0 * float(np.hypot(self.nx[u] - xy[0], self.ny[u] - xy[1])) / v_off)
                if total < best:
                    best, best_node = total, u
            for v, c, dz in self.adj[u]:
                if v in done or v in blocked:
                    continue
                ms = self._edge_ms(kind, u, v, c, dz)
                if ms is None:
                    continue
                nd = d + ms
                if nd < dist.get(v, 1 << 62):
                    dist[v] = nd
                    heapq.heappush(heap, (nd, v))
        return best_node

    def nodes_within(self, xy, radius: float) -> frozenset[int]:
        d = np.hypot(self.nx - xy[0], self.ny - xy[1])
        return frozenset(np.flatnonzero(d <= radius).tolist())

    # ------------------------------------------------------------------ cross-country walking

    def _xc_grid(self):
        if self._xc is None:
            n = round(self.site.size / XC_STEP)
            gx, gy = np.meshgrid(self.site.x0 + np.arange(n + 1) * XC_STEP, self.site.y0 + np.arange(n + 1) * XC_STEP)
            h = self.ground(gx, gy)
            free = np.ones(gx.shape, bool)
            if self.tree is not None:  # keep a cell's half-diagonal away from walls so segments cannot clip a corner
                hit = self.tree.query(shapely.points(gx.ravel(), gy.ravel()), predicate="dwithin", distance=XC_STEP)[0]
                free.ravel()[hit] = False
            for poly in self.enclosures:
                near = shapely.dwithin(shapely.points(gx.ravel(), gy.ravel()), poly.exterior, FENCE_CLEAR)
                free.ravel()[near] = False
            forest = self.canopy_at(gx, gy) >= VEG_MIN
            self._xc = (n, gx, gy, h, free, forest)
        return self._xc

    def cross_country(self, kind: Kind, src_xy, dst_xy) -> Route | None:
        """Time-optimal walk over open ground on an 8 m grid (8 neighbours, A*). Not a stealth planner: the cost
        is travel time only and never depends on who can see the walker."""
        n, gx, gy, h, free, forest = self._xc_grid()

        def cell(xy, towards=None):
            fx, fy = (xy[0] - self.site.x0) / XC_STEP, (xy[1] - self.site.y0) / XC_STEP
            if towards is not None:  # start: the free corner of this grid square that is nearest the goal
                rows, cols = (int(np.floor(fy)), int(np.ceil(fy))), (int(np.floor(fx)), int(np.ceil(fx)))
                opts = [(r_, c_) for r_ in rows for c_ in cols if 0 <= r_ <= n and 0 <= c_ <= n and free[r_, c_]]
                if opts:
                    return min(opts, key=lambda rc: ((rc[0] - towards[0]) ** 2 + (rc[1] - towards[1]) ** 2, rc))
            c = np.clip(np.array([round(fx), round(fy)]), 0, n)
            if not free[c[1], c[0]]:  # nearest free cell
                yy, xx = np.nonzero(free)
                k = np.argmin((xx - c[0]) ** 2 + (yy - c[1]) ** 2)
                c = np.array([xx[k], yy[k]])
            return int(c[1]), int(c[0])

        g = cell(dst_xy)
        s = cell(src_xy, towards=g)
        key = (kind.name, s, g)
        if key in self._xc_cache:
            return self._xc_cache[key]
        gait = 2.0 if kind.name == "dog" else 1.0
        est = lambda c: int(1000.0 * XC_STEP * float(np.hypot(c[0] - g[0], c[1] - g[1])) / kind.vmax)  # noqa: E731
        dist = {s: 0}
        prev = {}
        heap = [(est(s), 0, s)]
        done = set()
        nb = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
        while heap:
            _, d, u = heapq.heappop(heap)
            if u in done:
                continue
            done.add(u)
            if u == g:
                break
            for dr, dc in nb:
                v = (u[0] + dr, u[1] + dc)
                if not (0 <= v[0] <= n and 0 <= v[1] <= n) or v in done or not free[v]:
                    continue
                dx = XC_STEP * (1.4142135623730951 if dr and dc else 1.0)
                dz = float(h[v] - h[u])
                if np.degrees(np.arctan2(abs(dz), dx)) > kind.slope_max_deg:
                    continue
                speed = min(kind.vmax, gait * float(tobler(dz / dx)) * XC_FACTOR * (XC_FOREST if forest[v] else 1.0))
                nd = d + max(1, int(np.ceil(1000.0 * dx / speed)))
                if nd < dist.get(v, 1 << 62):
                    dist[v] = nd
                    prev[v] = u
                    heapq.heappush(heap, (nd + est(v), nd, v))
        if g not in done:
            self._xc_cache[key] = None
            return None
        cells = [g]
        while cells[-1] != s:
            cells.append(prev[cells[-1]])
        cells.reverse()
        r, c = np.array(cells).T
        out = Route(np.column_stack([gx[r, c], gy[r, c], h[r, c]]), np.array([dist[k] for k in cells], np.int64))
        self._xc_cache[key] = out
        return out

    # ------------------------------------------------------------------ frame

    def frame_distortion_ppm(self, frame: Frame) -> float:
        """Largest relative difference between a grid distance and the true (ENU) distance across the site."""
        x0, y0, x1, y1 = self.site.bounds
        worst = 0.0
        pairs = (((x0, y0), (x1, y0)), ((x0, y0), (x0, y1)), ((x0, y0), (x1, y1)), ((x1, y0), (x0, y1)))
        for (ax, ay), (bx, by) in pairs:
            ha, hb = float(self.ground(ax, ay)), float(self.ground(bx, by))
            e, n, u = frame.to_enu(np.array([ax, bx]), np.array([ay, by]), np.array([ha, hb]))
            true = float(np.sqrt((e[1] - e[0]) ** 2 + (n[1] - n[0]) ** 2 + (u[1] - u[0]) ** 2))
            grid = float(np.sqrt((bx - ax) ** 2 + (by - ay) ** 2 + (hb - ha) ** 2))
            worst = max(worst, abs(grid - true) / true * 1e6)
        return round(worst, 1)
