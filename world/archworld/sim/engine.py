"""Deterministic discrete-event engine for the site sim.

Time is integer milliseconds, energy integer microjoules (mW x ms). Motion is piecewise deterministic: a leg is a
polyline with integer arrival times, so a position at any time is interpolation, and nothing is stepped while
nothing happens. That is what lets one engine run a 20 minute drill and a 30 day equipment-use run.

Order of events at the same millisecond is fixed (ORDER, then insertion). Each agent has its own random stream,
keyed by its id, so adding an agent does not change what the others draw.
"""

from __future__ import annotations

import bisect
import hashlib
import heapq
import json
import zlib
from dataclasses import dataclass, field

import numpy as np

from . import scope
from .simworld import XC_FACTOR, Route, SimWorld, tobler

ORDER = {"inject": 0, "leg_end": 1, "charge_done": 2, "restore": 3, "depart": 4, "resume": 5, "sense": 6, "timer": 7}
REPORT_EVERY_MS = 10_000
CONTACT_M = 10.0
RETASK_M = 20.0
CLOSE_IN_M = 60.0
DRONE_STEP = 4.0
UJ_PER_MWH = 3_600_000


class Leg:
    __slots__ = ("pts", "T", "purpose", "target", "nodes", "ground")

    def __init__(self, pts, T, purpose, target=None, nodes=(), ground=None):
        self.pts, self.T, self.purpose, self.target, self.nodes, self.ground = pts, T, purpose, target, nodes, ground

    def pos(self, t: int) -> np.ndarray:
        T = self.T
        if t <= T[0]:
            p = self.pts[0].copy()
        elif t >= T[-1]:
            p = self.pts[-1].copy()
        else:
            k = int(np.searchsorted(T, t, side="right")) - 1
            p = self.pts[k] + (self.pts[k + 1] - self.pts[k]) * ((t - T[k]) / (T[k + 1] - T[k]))
        if self.ground is not None:  # a chord between two vertices can dip under a convex bump: stay on the surface
            p[2] = max(p[2], float(self.ground(p[0], p[1])))
        return p

    def heading(self, t: int) -> float | None:
        if len(self.T) < 2:
            return None
        k = min(max(int(np.searchsorted(self.T, t, side="right")) - 1, 0), len(self.T) - 2)
        for j in (*range(k, len(self.T) - 1), *range(k - 1, -1, -1)):
            d = self.pts[j + 1] - self.pts[j]
            if abs(d[0]) + abs(d[1]) > 1e-9:
                return float(np.degrees(np.arctan2(d[0], d[1])) % 360.0)
        return None

    def length(self) -> float:
        return float(np.linalg.norm(np.diff(self.pts[:, :2], axis=0), axis=1).sum()) if len(self.pts) > 1 else 0.0


class Agent:
    def __init__(self, spec: dict, world: SimWorld, seed: int, t: int):
        self.spec = spec
        self.id, self.role = spec["id"], spec["role"]
        self.kind = scope.KINDS[spec["kind"]]
        self.sensor = scope.sensor_for(spec["kind"], spec.get("payloads", ()))
        k = self.kind
        self.rng = np.random.Generator(np.random.PCG64(np.random.SeedSequence([seed, zlib.crc32(self.id.encode())])))
        hx, hy = spec["home"]
        self.home_xy = (float(hx), float(hy))
        self.node: int | None = None
        self.home_node: int | None = None
        self.patrol: list = []
        if k.ground and k.ways and spec["patrol"]:
            self.home_node = self.node = world.nearest_node(self.home_xy, k.ways)
            self.pos = np.array([world.nx[self.node], world.ny[self.node], world.nz[self.node]])
            self.patrol = [world.nearest_node(p, k.ways) for p in spec["patrol"]]
        else:  # fixed post, mast, drone or drill subject: exactly where it was put
            self.pos = np.array([hx, hy, float(world.ground(hx, hy))], float)
            if k.ground and k.ways and self.role == "staff":
                self.home_node = world.nearest_node(self.home_xy, k.ways)
            self.patrol = [tuple(map(float, p)) for p in spec["patrol"]]
        self.landed = not k.ground
        self.facing = spec["facing_deg"]
        self.leg: Leg | None = None
        self.mode = "idle"
        self.cap0 = self.cap = k.capacity_mwh * UJ_PER_MWH
        self.energy = self.cap
        self.e_t = t
        self.cycles = 0
        self.pi = 0
        self.sensor_ok = True
        self.t_on = t
        self.pending = None
        self.responding_to: str | None = None
        self.dest_xy: tuple[float, float] | None = None
        self.order = 0
        self.contacted = False
        self.detected_t: int | None = None
        self.last_report = -(1 << 60)
        self.last_known: tuple[float, float] | None = None
        self.ms = {"moving": 0, "idle": 0, "charging": 0}
        self.dist = 0.0
        self.hist: list[Leg] = []
        self.hist_t: list[int] = []
        self.pos0 = self.pos.copy()
        self.t_off: int | None = None  # set when a visitor leaves the site
        self.steps: list[dict] = []  # scripted itinerary of a drill subject (ops.py)
        self.task_ms: dict[str, int] = {}  # time spent per task, for workload figures

    def power(self) -> int:
        if self.mode == "charging" or not self.cap0:
            return 0
        airborne = not self.kind.ground and not self.landed
        return self.kind.p_move_mw if self.mode == "moving" or airborne else self.kind.p_idle_mw


@dataclass
class Result:
    log: list[dict]
    digest: str
    agents: dict[str, dict]
    energy_trace: dict[str, list]
    until: int
    events_processed: int
    manifest: dict
    _agents: dict = field(repr=False, default_factory=dict)

    def position(self, aid: str, t: int) -> np.ndarray:
        a = self._agents[aid]
        i = bisect.bisect_right(a.hist_t, t) - 1
        return a.pos0.copy() if i < 0 else a.hist[i].pos(t)

    def span(self, aid: str) -> tuple[int, int]:
        a = self._agents[aid]
        return a.t_on, self.until if a.t_off is None else a.t_off


class Sim:
    def __init__(self, world: SimWorld, agents: list[dict], seed: int, drill: dict | None = None,
                 sense_period_ms: int = 1000, force_sense: bool = False, keep_legs: bool = True,
                 detect: str = "prob") -> None:
        self.w, self.seed, self.period, self.force, self.keep, self.detect = (world, seed, sense_period_ms, force_sense,
                                                                               keep_legs, detect)
        self.t = 0
        self.heap: list = []
        self.seq = 0
        self.log: list[dict] = []
        self.blocked: frozenset[int] = frozenset()
        self.agents: dict[str, Agent] = {}
        self.trace: dict[str, list] = {}
        self.pair_rng: dict = {}
        self.tracking: set[tuple[str, str]] = set()
        self.sense_on = False
        self.n_events = 0
        self.drill = drill
        for spec in agents:
            a = Agent(scope.validate_agent(spec), world, seed, 0)
            if a.role != "staff":
                raise scope.ScopeError("unknown persons enter through a drill event, not the staff list")
            if a.id in self.agents:
                raise ValueError(f"duplicate agent id {a.id}")
            self.agents[a.id] = a
            self.trace[a.id] = [(0, a.energy, "start")]
            if a.patrol:
                self._push(int(a.rng.integers(0, 30_001)), "depart", (a.id, a.order))
        if drill is not None:
            scope.validate_zone(drill["zone"])
            for ev in drill["events"]:
                self._push(int(ev["t_ms"]), "inject", ev)
        if force_sense:
            self.sense_on = True
            self._push(0, "sense", None)

    # ------------------------------------------------------------------ plumbing

    def _push(self, t: int, kind: str, data) -> None:
        self.seq += 1
        heapq.heappush(self.heap, (t, ORDER[kind], self.seq, kind, data))

    def _log(self, type_: str, **kw) -> None:
        self.log.append({"t": self.t, "type": type_, **kw})

    def _settle(self, a: Agent, cause: str = "") -> None:
        dt = self.t - a.e_t
        if dt:
            mode = "moving" if (a.mode == "moving" or (not a.kind.ground and not a.landed)) else a.mode
            a.ms[mode] += dt
            moving = a.mode == "moving" and a.leg is not None
            task = a.leg.purpose if moving else ("hold" if a.responding_to else a.mode)
            a.task_ms[task] = a.task_ms.get(task, 0) + dt
            if a.cap0:
                a.energy -= a.power() * dt
                if self.keep:
                    self.trace[a.id].append((self.t, a.energy, cause or a.mode))
        a.e_t = self.t

    def _assign(self, a: Agent, incident: str | None) -> None:
        """Change what an agent is responding to. The time up to now is booked first, under the task it had:
        otherwise hours of patrol before a dispatch would be counted as time spent on the alarm."""
        self._settle(a)
        a.responding_to = incident

    def _pos(self, a: Agent, t: int) -> np.ndarray:
        return a.leg.pos(t) if a.mode == "moving" and a.leg is not None else a.pos

    # ------------------------------------------------------------------ planning

    def _walk(self, k, p0: np.ndarray, xy) -> tuple[np.ndarray, np.ndarray]:
        """Straight walk over open ground from p0 to xy (used to join a post to the path graph)."""
        d = float(np.hypot(xy[0] - p0[0], xy[1] - p0[1]))
        n = max(1, int(np.ceil(d / 2.0)))
        f = np.arange(n + 1)[:, None] / n
        xyz = np.column_stack([p0[:2] + (np.array(xy) - p0[:2]) * f, np.zeros(n + 1)])
        xyz[:, 2] = self.w.ground(xyz[:, 0], xyz[:, 1])
        seg = np.maximum(np.hypot(*np.diff(xyz[:, :2], axis=0).T), 1e-9)
        v = np.minimum(k.vmax, tobler(np.diff(xyz[:, 2]) / seg) * XC_FACTOR)
        return xyz, np.concatenate([[0], np.cumsum(np.maximum(1, np.ceil(1000.0 * seg / v))).astype(np.int64)])

    def _offroad(self, k, p0: np.ndarray, xy) -> tuple[np.ndarray, np.ndarray]:
        """Walk from p0 to xy off the paths: cross-country route (around buildings, steep ground and fences) with
        a short straight stub at each end. Falls back to a straight walk when the two points are in one grid cell."""
        r = self.w.cross_country(k, p0[:2], xy) if np.hypot(xy[0] - p0[0], xy[1] - p0[1]) > 12.0 else None
        if r is None or len(r.T) < 2:
            return self._walk(k, p0, xy)
        a_pts, a_t = self._walk(k, p0, r.pts[0][:2])
        b_pts, b_t = self._walk(k, r.pts[-1], xy)
        pts = np.vstack([a_pts[:-1], r.pts, b_pts[1:]])
        T = np.concatenate([a_t[:-1], r.T + a_t[-1], b_t[1:] + a_t[-1] + r.T[-1]])
        keep = np.concatenate([[True], np.diff(T) > 0])
        return pts[keep], T[keep].astype(np.int64)

    def _plan_ground(self, a: Agent, pos: np.ndarray, node: int | None, dest, final_xy=None) -> Route | None:
        """Path-graph route, with an off-path walk before it (agent not on a path) and after it (`final_xy`).
        `dest` is a node, or ("xy", point) for foot agents going to a point off the paths."""
        k = a.kind
        pts, T, nodes = [], [], []
        t0 = 0
        target_xy = dest[1] if isinstance(dest, tuple) else None
        if node is None and target_xy is not None and self.w.side_of(pos[:2]) == self.w.side_of(target_xy):
            xyz, tt = self._offroad(k, pos, target_xy)  # already off the paths, same side of every fence: go straight
            return Route(xyz, tt, (-1,) * len(tt))
        if node is None:
            node = self.w.join_node(pos[:2], k.ways)
            xyz, tt = self._offroad(k, pos, (self.w.nx[node], self.w.ny[node]))
            pts.append(xyz[:-1])
            T.append(tt[:-1])
            nodes += [-1] * (len(tt) - 1)
            t0 = int(tt[-1])
        if target_xy is not None:  # leave the paths where that is quickest overall
            final_xy = target_xy
            dest = self.w.best_exit(k, node, target_xy, self.blocked)
        r = self.w.route(k, node, dest, self.blocked)
        if r is None:
            return None
        pts.append(r.pts)
        T.append(r.T + t0)
        nodes += list(r.nodes)
        if final_xy is not None:
            xyz, tt = self._offroad(k, r.pts[-1], final_xy)
            pts.append(xyz[1:])
            T.append(tt[1:] + t0 + int(r.T[-1]))
            nodes += [-1] * (len(tt) - 1)
        return Route(np.vstack(pts), np.concatenate(T).astype(np.int64), tuple(nodes))

    def _plan_drone(self, a: Agent, pos: np.ndarray, landed: bool, xy, land: bool) -> Route:
        k = a.kind
        d = float(np.hypot(xy[0] - pos[0], xy[1] - pos[1]))
        n = max(1, int(np.ceil(d / DRONE_STEP)))
        f = np.arange(n + 1) / n
        x, y = pos[0] + (xy[0] - pos[0]) * f, pos[1] + (xy[1] - pos[1]) * f
        want = self.w.ground(x, y) + k.agl_m
        z = want.copy()
        if not landed:
            z[0] = max(z[0], pos[2])
        s = k.climb_ms / k.vmax * (d / n)  # height change allowed per horizontal step
        for i in range(1, n + 1):
            z[i] = max(z[i], z[i - 1] - s)
        for i in range(n - 1, -1, -1):
            z[i] = max(z[i], z[i + 1] - s)
        pts, T = [pos.copy()], [0]

        def add(p, ms):
            pts.append(np.asarray(p, float))
            T.append(T[-1] + max(1, int(np.ceil(ms))))

        if z[0] - pos[2] > 1e-9:
            add([pos[0], pos[1], z[0]], 1000.0 * (z[0] - pos[2]) / k.climb_ms)
        step_ms = 1000.0 * (d / n) / k.vmax
        if d > 1e-9:
            for i in range(1, n + 1):
                add([x[i], y[i], z[i]], step_ms)
        if land:
            g = float(self.w.ground(xy[0], xy[1]))
            add([xy[0], xy[1], g], 1000.0 * (z[-1] - g) / k.climb_ms)
        if len(pts) == 1:
            add(pos, 1)
        return Route(np.array(pts), np.array(T, np.int64))

    def _plan(self, a: Agent, pos, node, landed, dest, land=False, final_xy=None) -> Route | None:
        if isinstance(dest, Route):
            return dest
        if not a.kind.ground:
            return self._plan_drone(a, pos, landed, dest, land)
        return self._plan_ground(a, pos, node, dest, final_xy)

    def _home_dest(self, a: Agent):
        if not a.kind.ground:
            return a.home_xy, None
        on_graph = bool(a.spec["patrol"])
        return a.home_node, (None if on_graph else a.home_xy)

    def _at_home(self, a: Agent) -> bool:
        return bool(np.hypot(a.pos[0] - a.home_xy[0], a.pos[1] - a.home_xy[1]) < 0.5) or (
            a.node is not None and a.node == a.home_node and bool(a.spec["patrol"]))

    # ------------------------------------------------------------------ acting

    def _go(self, a: Agent, purpose: str, dest, target: str | None = None, dest_xy=None) -> bool:
        k = a.kind
        home = purpose in ("recharge", "home")
        final_xy = None
        if home:
            dest, final_xy = self._home_dest(a)
        r = self._plan(a, a.pos, a.node, a.landed, dest, land=home and not k.ground, final_xy=final_xy)
        if r is None:
            if not (purpose == "respond" and a.dest_xy == dest_xy):
                self._log("no_route", agent=a.id, purpose=purpose)
            if purpose == "respond":
                a.dest_xy = dest_xy  # remembered, so the same unreachable point is not tried again
            if purpose == "patrol":
                a.pi += 1
                self._push(self.t + 60_000, "depart", (a.id, a.order))
            return False
        if purpose == "respond" and len(r.T) and r.T[-1] <= 1 and a.kind.ground:
            a.dest_xy = dest_xy  # already as close as this agent can get
            if a.mode == "idle":  # it is there: count it as arrived, and release it like any other arrival
                self._log("arrived", agent=a.id, subject=target)
                self._push(self.t + 120_000, "resume", (a.id, a.order))
            return False
        self._settle(a)
        if a.cap0 and not home:
            hd, hxy = self._home_dest(a)
            end_node = r.nodes[-1] if r.nodes and r.nodes[-1] >= 0 else None
            back = self._plan(a, r.pts[-1], end_node, False, hd, land=not k.ground, final_xy=hxy)
            back_ms = int(back.T[-1]) if back is not None else 0
            need = k.p_move_mw * (int(r.T[-1]) + back_ms) + a.cap // 20 + k.p_idle_mw * 120_000
            if a.energy < need:
                self._log("low_battery", agent=a.id, wanted=purpose, energy_frac=round(a.energy / a.cap, 4))
                self._assign(a, None)
                if self._at_home(a) and (k.ground or a.landed):
                    if a.energy >= a.cap:  # a full battery cannot do this leg and come back: skip it
                        self._log("infeasible", agent=a.id, wanted=purpose)
                        a.pi += 1
                        self._push(self.t + 60_000, "depart", (a.id, a.order))
                    else:
                        self._charge(a)
                else:
                    self._go(a, "recharge", None)
                return False
        leg = Leg(r.pts, r.T + self.t, purpose, target, r.nodes, self.w.ground if k.ground else None)
        a.leg, a.mode, a.node, a.landed = leg, "moving", None, False
        a.dest_xy = dest_xy
        self._record(a, leg)
        self._push(int(leg.T[-1]), "leg_end", (a.id, leg))
        self._log("leg", agent=a.id, purpose=purpose, eta=int(leg.T[-1]), length_m=round(leg.length(), 1),
                  **({"subject": target} if target else {}))
        return True

    def _record(self, a: Agent, leg: Leg, replace: bool = False) -> None:
        if replace and a.hist:
            a.hist[-1] = leg
        elif self.keep:
            a.hist.append(leg)
            a.hist_t.append(int(leg.T[0]))
        else:
            a.hist, a.hist_t = [leg], [int(leg.T[0])]

    def _charge(self, a: Agent) -> None:
        a.mode = "charging"
        self._log("charge_start", agent=a.id, energy_frac=round(a.energy / a.cap, 4))
        self._push(self.t + max(1, -(-(a.cap - a.energy) // a.kind.charge_mw)), "charge_done", a.id)

    def _retask(self, a: Agent, purpose: str, dest, target=None, dest_xy=None) -> None:
        """Give a new order. An agent on the path graph first finishes the metre it is on (no jump, no speeding);
        anything else is cut exactly where it is."""
        a.order += 1
        if a.mode != "moving":
            self._go(a, purpose, dest, target, dest_xy)
            return
        leg, t = a.leg, self.t
        k = int(np.searchsorted(leg.T, t, side="left"))
        on_graph = a.kind.ground and len(leg.nodes) > k and leg.nodes[min(k, len(leg.nodes) - 1)] >= 0
        if on_graph:
            k = min(k, len(leg.T) - 1)
            pts, T, nodes = leg.pts[:k + 1], leg.T[:k + 1], leg.nodes[:k + 1]
        else:
            j = int(np.searchsorted(leg.T, t, side="right"))
            pts, T, nodes = leg.pts[:j], leg.T[:j], ()
            if T[-1] < t:
                pts, T = np.vstack([pts, leg.pos(t)]), np.append(T, t)
        if len(T) == 1:  # the leg starts at this very moment
            pts, T = np.vstack([pts, pts]), np.array([T[0], T[0]], np.int64)
        cut = Leg(pts, T.astype(np.int64), "cut", None, nodes, leg.ground)
        a.leg = cut
        self._record(a, cut, replace=True)
        a.pending = (purpose, dest, target, dest_xy)
        self._push(int(cut.T[-1]), "leg_end", (a.id, cut))

    # ------------------------------------------------------------------ handlers

    def _on_depart(self, data) -> None:
        aid, order = data
        a = self.agents[aid]
        if order != a.order or a.mode != "idle" or not a.patrol or a.responding_to:
            return
        self._go(a, "patrol", a.patrol[a.pi % len(a.patrol)])

    def _on_leg_end(self, data) -> None:
        aid, leg = data
        a = self.agents[aid]
        if a.leg is not leg:
            return  # the leg was cut; this is its old arrival
        self._settle(a)
        a.pos = leg.pts[-1].copy()
        if a.kind.ground:
            a.pos[2] = max(a.pos[2], float(self.w.ground(a.pos[0], a.pos[1])))
        a.node = leg.nodes[-1] if leg.nodes and leg.nodes[-1] >= 0 else None
        a.dist += leg.length()
        h = leg.heading(int(leg.T[-1]))
        if h is not None and a.spec["facing_deg"] is None:
            a.facing = h
        a.mode, a.leg = "idle", None
        p = leg.purpose
        if p == "cut":
            purpose, dest, target, dest_xy = a.pending
            a.pending = None
            self._go(a, purpose, dest, target, dest_xy)
        elif p == "patrol":
            a.pi += 1
            pause = 0 if not a.kind.ground else int(a.rng.integers(20_000, 90_001))
            self._push(self.t + pause, "depart", (a.id, a.order))
        elif p in ("recharge", "home"):
            a.landed = not a.kind.ground
            if a.spec["facing_deg"] is not None:
                a.facing = a.spec["facing_deg"]
            if a.cap0 and a.energy < a.cap and p == "recharge":
                self._charge(a)
            else:
                self._push(self.t, "depart", (a.id, a.order))
        elif p == "respond":
            self._log("arrived", agent=a.id, subject=leg.target)
            self._push(self.t + (60_000 if not a.kind.ground else 120_000), "resume", (a.id, a.order))
        elif p == "walk":
            self._log("reached_goal", agent=a.id)
            self._arrived(a, leg)
        else:
            self._arrived(a, leg)

    def _arrived(self, a: Agent, leg: Leg) -> None:
        """Hook for operations beyond patrol and response (ops.py)."""

    def _on_charge_done(self, aid: str) -> None:
        a = self.agents[aid]
        self._settle(a)
        a.cycles += 1
        a.cap = int(a.cap0 * (1.0 - scope.FADE_PER_CYCLE * a.cycles))
        a.energy = a.cap
        if self.keep:
            self.trace[a.id].append((self.t, a.energy, "charge_done"))
        a.mode = "idle"
        self._log("charge_done", agent=a.id, cycles=a.cycles, capacity_frac=round(a.cap / a.cap0, 5))
        self._push(self.t, "depart", (a.id, a.order))

    def _on_resume(self, data) -> None:
        aid, order = data
        a = self.agents[aid]
        if order != a.order:
            return
        self._assign(a, None)
        a.order += 1
        if a.patrol:
            if a.mode == "moving":
                self._retask(a, "patrol", a.patrol[a.pi % len(a.patrol)])
            else:
                self._push(self.t, "depart", (a.id, a.order))
        elif not self._at_home(a) or a.mode == "moving":
            self._retask(a, "home", None)

    def _on_inject(self, ev: dict) -> None:
        kind = ev["type"]
        if kind == "appear":
            spec = scope.validate_agent({**ev["agent"], "home": ev["at"]})
            if spec["role"] != "unknown" or spec["kind"] != "person" or spec["id"] in self.agents:
                raise scope.ScopeError("a drill subject is an unknown person with a new id")
            a = Agent(spec, self.w, self.seed, self.t)
            self.agents[a.id] = a
            self.trace[a.id] = []
            if ev.get("cross_country"):
                r = self.w.cross_country(a.kind, ev["at"], ev["goto"])
                if r is not None:
                    a.pos = r.pts[0].copy()
                    a.pos0 = a.pos.copy()
            else:
                a.node = self.w.nearest_node(ev["at"], "foot")
                a.pos = np.array([self.w.nx[a.node], self.w.ny[a.node], self.w.nz[a.node]])
                a.pos0 = a.pos.copy()
                r = self.w.nearest_node(ev["goto"], "foot")
            self._log("appear", agent=a.id, at=[round(float(a.pos[0]), 1), round(float(a.pos[1]), 1)])
            if r is not None:
                self._go(a, "walk", r)
            else:
                self._log("no_route", agent=a.id, purpose="walk")
            if not self.sense_on:
                self.sense_on = True
                self._push(-(-self.t // self.period) * self.period, "sense", None)
        elif kind == "sensor_fault":
            self.agents[ev["agent"]].sensor_ok = False
            self.tracking = {p for p in self.tracking if p[0] != ev["agent"]}
            self._log("sensor_fault", agent=ev["agent"], duration_ms=ev["duration_ms"])
            self._push(self.t + int(ev["duration_ms"]), "restore", ev["agent"])
        elif kind == "road_block":
            self.blocked = self.blocked | self.w.nodes_within(ev["at"], ev["radius"])
            self._log("road_block", at=[round(float(v), 1) for v in ev["at"]], radius=ev["radius"],
                      nodes=len(self.blocked))
        else:
            raise scope.ScopeError(f"unknown drill event {kind!r}")

    def _on_restore(self, aid: str) -> None:
        self.agents[aid].sensor_ok = True
        self._log("sensor_restored", agent=aid)

    # ------------------------------------------------------------------ sensing, reporting, responding

    def _on_sense(self, _) -> None:
        t = self.t
        subjects = [a for a in self.agents.values() if a.role == "unknown" and not a.contacted]
        if not subjects and not self.force:
            self.sense_on = False
            return
        self._push(t + self.period, "sense", None)
        staff = [a for a in self.agents.values() if a.role == "staff" and a.mode != "charging"]
        for s in subjects:
            sp = self._pos(s, t)
            body = sp + np.array([0.0, 0.0, 1.0])
            seen_by = None
            for o in staff:
                sen = o.sensor
                if sen is None or not o.sensor_ok:
                    continue
                op = self._pos(o, t) + np.array([0.0, 0.0, sen.eye_m])
                rng_m = float(np.linalg.norm(body - op))
                pair = (o.id, s.id)
                if rng_m > sen.range_m:
                    self.tracking.discard(pair)
                    continue
                if sen.fov_deg < 360.0:
                    head = o.leg.heading(t) if o.mode == "moving" and o.leg is not None else o.facing
                    if head is not None:
                        brg = float(np.degrees(np.arctan2(body[0] - op[0], body[1] - op[1])) % 360.0)
                        if abs((brg - head + 180.0) % 360.0 - 180.0) > sen.fov_deg / 2:
                            self.tracking.discard(pair)
                            continue
                if not self.w.los(op, body):
                    self.tracking.discard(pair)
                    continue
                if pair not in self.tracking:
                    p = 1.0 if self.detect == "sure" else scope.p_notice(sen, rng_m)
                    if p < 1.0:
                        g = self.pair_rng.get(pair)
                        if g is None:
                            g = self.pair_rng[pair] = np.random.Generator(np.random.PCG64(np.random.SeedSequence(
                                [self.seed, zlib.crc32(o.id.encode()), zlib.crc32(s.id.encode()), 1])))
                        if float(g.random()) >= p:
                            continue
                    self.tracking.add(pair)
                    if s.detected_t is None:
                        s.detected_t = t
                        self._log("detected", subject=s.id, cause={"observer": o.id, "range_m": round(rng_m, 1),
                                                                    "los": True, "p": round(p, 3)})
                seen_by = seen_by or o.id
            for o in staff:  # meeting the subject on the ground
                if o.kind.contact and float(np.linalg.norm(self._pos(o, t) - sp)) <= CONTACT_M and self.w.los(
                        self._pos(o, t) + np.array([0.0, 0.0, 1.0]), body):
                    if s.detected_t is None:
                        s.detected_t = t
                        self._log("detected", subject=s.id, cause={"observer": o.id, "range_m": round(float(
                            np.linalg.norm(self._pos(o, t) - sp)), 1), "los": True, "p": 1.0})
                    self._contact(s, o)
                    break
            if s.contacted:
                continue
            if seen_by and t - s.last_report >= REPORT_EVERY_MS:
                s.last_report = t
                s.last_known = (round(float(sp[0])), round(float(sp[1])))
                self._log("report", subject=s.id, by=seen_by, at=list(s.last_known))
                self._dispatch(s)

    def _contact(self, s: Agent, o: Agent) -> None:
        self._log("contact", subject=s.id, agent=o.id)
        s.contacted = True
        if s.mode == "moving":  # the subject stops where it is
            t, leg = self.t, s.leg
            j = int(np.searchsorted(leg.T, t, side="right"))
            pts, T = leg.pts[:j], leg.T[:j]
            if T[-1] < t:
                pts, T = np.vstack([pts, leg.pos(t)]), np.append(T, t)
            if len(T) == 1:
                pts, T = np.vstack([pts, pts]), np.array([T[0], T[0]], np.int64)
            cut = Leg(pts, T.astype(np.int64), "stopped", None, (), leg.ground)
            self._settle(s)
            s.leg, s.mode, s.pos = None, "idle", cut.pts[-1].copy()
            self._record(s, cut, replace=True)
        self.tracking = {p for p in self.tracking if p[1] != s.id}
        for a in self.agents.values():
            if a.responding_to == s.id:
                self._push(self.t + 60_000, "resume", (a.id, a.order))

    def _dispatch(self, s: Agent) -> None:
        self._dispatch_to(s.id, s.last_known)

    def _dispatch_to(self, incident: str, lk: tuple[float, float]) -> None:
        """Send responders to a reported position. `incident` is a subject id or an alarm id."""
        sent = []
        cands = [a for a in self.agents.values() if a.role == "staff" and a.kind.responder and a.mode != "charging"
                 and not (a.leg is not None and a.leg.purpose == "recharge")
                 and not (a.pending is not None and a.pending[0] == "recharge")]
        cands.sort(key=lambda a: (float(np.hypot(*(self._pos(a, self.t)[:2] - np.array(lk)))) / a.kind.vmax, a.id))
        # at most two responders on foot (they are the ones who can meet the subject), plus vehicles and drones
        foot = sum(1 for a in cands if a.responding_to == incident and a.kind.ways == "foot")
        for a in cands:
            if a.responding_to == incident:
                # far away a 20 m change of the reported position is not worth a new plan; close in, every report is
                near = float(np.hypot(*(self._pos(a, self.t)[:2] - np.array(lk)))) <= CLOSE_IN_M
                if a.dest_xy is not None and np.hypot(a.dest_xy[0] - lk[0], a.dest_xy[1] - lk[1]) <= (
                        2.0 if near else RETASK_M):
                    continue
            elif a.responding_to is not None or (a.kind.ways == "foot" and foot >= 2):
                continue
            elif a.kind.ways == "foot":
                foot += 1
            if not a.kind.ground:
                dest = lk
            elif a.kind.ways == "foot":
                dest = ("xy", lk)  # people and legged robots leave the path for the last stretch
            else:
                dest = self.w.nearest_node(lk, a.kind.ways)
            self._assign(a, incident)
            self._retask(a, "respond", dest, incident, lk)
            sent.append(a.id)
        if sent:
            self._log("dispatch", subject=incident, agents=sent, to=list(lk))

    # ------------------------------------------------------------------ run

    def _handlers(self) -> dict:
        return {"inject": self._on_inject, "leg_end": self._on_leg_end, "charge_done": self._on_charge_done,
                "restore": self._on_restore, "depart": self._on_depart, "resume": self._on_resume,
                "sense": self._on_sense}

    def run(self, until_ms: int) -> Result:
        handlers = self._handlers()
        while self.heap and self.heap[0][0] <= until_ms:
            t, _, _, kind, data = heapq.heappop(self.heap)
            self.t = t
            self.n_events += 1
            handlers[kind](data)
        self.t = until_ms
        summary = {}
        for a in self.agents.values():
            self._settle(a, "end")
            p = self._pos(a, until_ms)
            total = sum(a.ms.values())
            summary[a.id] = {
                "kind": a.kind.name, "role": a.role, "label": a.spec["label"],
                "pos": [round(float(v), 3) for v in p], "mode": a.mode,
                "distance_m": round(a.dist, 1), "moving_ms": a.ms["moving"], "idle_ms": a.ms["idle"],
                "charging_ms": a.ms["charging"], "cycles": a.cycles,
                "capacity_fraction": round(a.cap / a.cap0, 5) if a.cap0 else None,
                "energy_fraction": round(a.energy / a.cap, 5) if a.cap0 else None,
                "availability": round(1.0 - a.ms["charging"] / total, 5) if total else None,
                "task_ms": dict(sorted(a.task_ms.items())),
            }
        digest = hashlib.sha256(json.dumps({"log": self.log, "agents": summary}, sort_keys=True).encode()).hexdigest()
        manifest = {"seed": self.seed, "until_ms": until_ms, "sense_period_ms": self.period, "detect": self.detect,
                    "site": self.w.site.id, "drill": self.drill["id"] if self.drill else None,
                    "numpy": np.__version__, "digest": digest,
                    "scope": "observe, detect, report, respond by moving; no force modelled; zone is notional"}
        return Result(self.log, digest, summary, self.trace, until_ms, self.n_events, manifest, self.agents)
