"""Site operations beyond patrol and response, on the same engine and the same world.

  timeline    a drill subject goes on from the fence to a door: is the response there before the task is done?
              (the physical-protection "probability of interruption": detect, assess, respond against the
              time the intruder still needs)
  alarms      fence-sensor alarms, most of them nuisance; verified by camera, drone or robot dog before people go
  gate        visiting trucks queue for the gate check; one booking may be fictitious
  evacuation  site staff walk to the muster point after individual pre-movement delays

Nothing here adds force: a subject is seen, reported and met; a truck is admitted or turned away; staff walk out.
Barrier delays, check times and catch rates are parameters of the drill file, marked as assumptions where they are.
"""

from __future__ import annotations

import zlib

import numpy as np
import shapely

from . import scope
from .engine import Agent, Leg, Sim
from .simworld import Route

INSIDE_M = 10.0  # a fence alarm is checked from this far inside the fence, not from the outside
ASSESS_MS = 20_000  # an operator looks at the camera that covers an alarm
VERIFY_LOITER_MS = 30_000  # a verifier watches the alarm point before calling it clear
GATE_POLL_MS = 15_000
VERIFIERS = ("drone", "dog", "guard")  # preference order for verifying an alarm


class OpsSim(Sim):
    def __init__(self, world, agents, seed, drill=None, **kw) -> None:
        super().__init__(world, agents, seed, drill=drill, **kw)
        cfg = drill or {}
        self.fence = cfg.get("fence")  # {"pd": 0.95}
        self.alarm_policy = cfg.get("alarm_policy", "verify_first")
        self.gate = cfg.get("gate")
        self.queue: list[str] = []
        self.checking: str | None = None
        self.polling = False
        self.n_alarm = 0
        self.muster: dict | None = None
        self.ops_rng = np.random.Generator(np.random.PCG64(np.random.SeedSequence([seed, zlib.crc32(b"site-ops")])))

    def _handlers(self) -> dict:
        return {**super()._handlers(), "timer": self._on_timer}

    def _on_timer(self, data) -> None:
        name, payload = data
        getattr(self, f"_t_{name}")(payload)

    def _timer(self, delay_ms: int, name: str, payload) -> None:
        self._push(self.t + int(delay_ms), "timer", (name, payload))

    def _on_inject(self, ev: dict) -> None:
        kind = ev["type"]
        if kind == "appear":
            super()._on_inject(ev)
            self.agents[ev["agent"]["id"]].steps = [dict(s) for s in ev.get("then", [])]
        elif kind == "alarm":
            self._alarm(tuple(ev["at"]), subject=None)
        elif kind == "arrive_vehicle":
            self._truck_arrive(ev)
        elif kind == "evacuate":
            self._evacuate(ev)
        else:
            super()._on_inject(ev)

    def _arrived(self, a: Agent, leg: Leg) -> None:
        p = leg.purpose
        if p in ("walk", "step"):
            if a.role == "unknown" and not a.contacted:
                self._next_step(a)
        elif p == "verify":
            self._log("verify_arrived", agent=a.id, alarm=leg.target)
            self._timer(VERIFY_LOITER_MS, "verdict", (leg.target, a.id, a.order))
        elif p == "to_gate":
            self._at_queue(a)
        elif p == "to_door":
            self._log("loading", agent=a.id)
            self._timer(int(a.rng.integers(*self.gate["dwell_ms"])), "loaded", a.id)
        elif p == "exit":
            a.t_off = self.t
            if a.booking == "fictitious" and a.outcome == "admitted":
                self._log("loss", agent=a.id)
            self._log("departed", agent=a.id)
        elif p == "muster":
            self.muster["done"] += 1
            self._log("mustered", agent=a.id, after_s=round((self.t - self.muster["t0"]) / 1000, 1))
            if self.muster["done"] == self.muster["n"]:
                self._log("all_mustered", after_s=round((self.t - self.muster["t0"]) / 1000, 1))

    # ------------------------------------------------------------------ timeline: scripted itinerary of a subject

    def _next_step(self, a: Agent) -> None:
        if not a.steps:
            return
        st = a.steps.pop(0)
        do = st["do"]
        if do == "cross":  # a barrier: a short stretch that takes `ms`, however it is passed
            self._log("at_barrier", agent=a.id, barrier=st.get("barrier", "fence"))
            if st.get("barrier", "fence") == "fence" and self.fence and float(self.ops_rng.random()) < self.fence["pd"]:
                self._alarm((float(a.pos[0]), float(a.pos[1])), subject=a.id)
            to = st["to"]
            end = np.array([to[0], to[1], float(self.w.ground(to[0], to[1]))])
            self._go(a, "step", Route(np.array([a.pos, end]), np.array([0, int(st["ms"])], np.int64)))
        elif do == "walk":
            pts, tt = self._offroad(a.kind, a.pos, st["to"])
            self._go(a, "step", Route(pts, tt))
        elif do == "wait":
            self._log(st.get("log", "waiting"), agent=a.id)
            self._timer(int(st["ms"]), "step", a.id)
        elif do == "done":
            self._log("task_complete", agent=a.id)
        else:
            raise scope.ScopeError(f"unknown itinerary step {do!r}")

    def _t_step(self, aid: str) -> None:
        a = self.agents[aid]
        if not a.contacted:
            self._next_step(a)

    # ------------------------------------------------------------------ alarms: sense, assess, verify

    def _check_point(self, xy: tuple[float, float]) -> tuple[float, float]:
        """Where staff go to look at a fence alarm: the same stretch of fence, from inside the yard. Sending them to
        the outer side would mean out through the gate and all the way round."""
        p = shapely.Point(xy)
        for poly in self.w.enclosures:
            if poly.exterior.distance(p) > 15.0:
                continue
            q = poly.exterior.interpolate(poly.exterior.project(p))
            v = np.array([poly.centroid.x - q.x, poly.centroid.y - q.y])
            cand = (float(q.x + v[0] / np.linalg.norm(v) * INSIDE_M), float(q.y + v[1] / np.linalg.norm(v) * INSIDE_M))
            if poly.contains(shapely.Point(cand)):
                return cand
        return xy

    def _alarm(self, xy: tuple[float, float], subject: str | None) -> None:
        self.n_alarm += 1
        aid = subject or f"alarm-{self.n_alarm}"
        self._log("alarm", id=aid, at=[round(xy[0], 1), round(xy[1], 1)], cause="person" if subject else "nuisance")
        point = np.array([xy[0], xy[1], float(self.w.ground(xy[0], xy[1])) + 1.0])
        for m in sorted((a for a in self.agents.values() if a.kind.name == "mast" and a.sensor_ok), key=lambda a: a.id):
            sen = m.sensor
            eye = m.pos + np.array([0.0, 0.0, sen.eye_m])
            if float(np.linalg.norm(point - eye)) > sen.range_m:
                continue
            brg = float(np.degrees(np.arctan2(point[0] - eye[0], point[1] - eye[1])) % 360.0)
            if abs((brg - (m.facing or 0.0) + 180.0) % 360.0 - 180.0) > sen.fov_deg / 2 or not self.w.los(eye, point):
                continue
            self._timer(ASSESS_MS, "assess", (aid, m.id, subject))  # a camera covers the spot: assess from the desk
            break
        xy = self._check_point(xy)
        if self.alarm_policy == "all_respond":
            self._dispatch_to(aid, (round(xy[0]), round(xy[1])))
            return
        for kind in VERIFIERS:
            free = sorted((a for a in self.agents.values() if a.role == "staff" and a.kind.name == kind and a.patrol
                           and a.mode != "charging" and a.responding_to is None and a.sensor_ok
                           and not (a.leg is not None and a.leg.purpose == "recharge")), key=lambda a: a.id)
            if free:
                v = free[0]
                self._assign(v, aid)
                self._retask(v, "verify", xy if not v.kind.ground else ("xy", xy), aid, xy)
                self._log("verify_sent", agent=v.id, alarm=aid)
                return
        self._log("verify_unavailable", alarm=aid)

    def _confirm(self, s: Agent, by: str, how: str) -> None:
        if s.detected_t is None:
            s.detected_t = self.t
            p = self._pos(s, self.t)
            rng_m = float(np.linalg.norm(p - self._pos(self.agents[by], self.t)))
            cause = {"observer": by, "range_m": round(rng_m, 1), "los": True, "p": 1.0, "by": how}
            self._log("detected", subject=s.id, cause=cause)
        p = self._pos(s, self.t)
        s.last_report, s.last_known = self.t, (round(float(p[0])), round(float(p[1])))
        self._log("report", subject=s.id, by=by, at=list(s.last_known))
        self._dispatch(s)

    def _t_assess(self, data) -> None:
        aid, mast, subject = data
        if subject is not None:
            s = self.agents[subject]
            if not s.contacted:
                self._confirm(s, mast, "alarm assessment")
            return
        self._log("cleared", alarm=aid, by=mast)
        for a in self.agents.values():  # nothing there: call back whoever was on the way
            if a.responding_to == aid:
                self._push(self.t, "resume", (a.id, a.order))

    def _t_verdict(self, data) -> None:
        aid, agent_id, order = data
        a = self.agents[agent_id]
        if a.order != order or a.responding_to != aid:
            return
        if aid in self.agents and self.agents[aid].detected_t is not None:
            return  # a real subject, already being followed through the normal reports
        self._log("cleared", alarm=aid, by=a.id)
        self._push(self.t, "resume", (a.id, a.order))

    # ------------------------------------------------------------------ gate: queue, check, admit or turn away

    def _truck_arrive(self, ev: dict) -> None:
        spec = scope.validate_agent({**ev["agent"], "home": ev["from"]})
        if spec["role"] != "visitor" or spec["kind"] != "truck" or spec["id"] in self.agents:
            raise scope.ScopeError("a gate arrival is a visiting truck with a new id")
        a = Agent(spec, self.w, self.seed, self.t)
        a.node = self.w.nearest_node(ev["from"], "drive")
        a.pos = np.array([self.w.nx[a.node], self.w.ny[a.node], self.w.nz[a.node]])
        a.pos0 = a.pos.copy()
        a.booking, a.outcome, a.slot, a.door = ev["booking"], None, len(self.queue), int(ev.get("door", 0))
        a.arrived_gate = a.check_start = None
        self.agents[a.id] = a
        self.trace[a.id] = []
        self.queue.append(a.id)
        self._log("truck_inbound", agent=a.id)
        self._to_slot(a)

    def _hold_node(self, slot: int) -> int:
        hold = self.gate["hold"]
        return self.w.nearest_node(hold[min(slot, len(hold) - 1)], "drive")

    def _to_slot(self, a: Agent) -> None:
        if not self._go(a, "to_gate", self._hold_node(a.slot)):
            self._at_queue(a)  # already standing on its slot

    def _at_queue(self, a: Agent) -> None:
        if a.id not in self.queue:
            return
        want = self.queue.index(a.id)
        if a.slot != want:  # the queue moved while it was driving up
            a.slot = want
            self._to_slot(a)
            return
        if a.arrived_gate is None:
            a.arrived_gate = self.t
            self._log("queued", agent=a.id, position=want + 1)
        if want == 0:
            self._gate_try()

    def _gate_try(self) -> None:
        if self.checking or not self.queue:
            return
        a = self.agents[self.queue[0]]
        if a.mode != "idle" or a.slot != 0 or a.arrived_gate is None:
            return
        g = self.agents[self.gate["guard"]]
        if not (g.mode == "idle" and g.responding_to is None and self._at_home(g)):
            if not self.polling:  # the gate guard is away on a response: the truck waits
                self.polling = True
                self._timer(GATE_POLL_MS, "gate_poll", None)
            return
        self.checking, a.check_start = a.id, self.t
        dur = int(a.rng.integers(*self.gate["check_ms"]))
        if self.gate["procedure"] == "callback":
            dur += int(a.rng.integers(*self.gate["callback_ms"]))
        self._log("gate_check", agent=a.id, waited_s=round((self.t - a.arrived_gate) / 1000))
        self._timer(dur, "gate_done", a.id)

    def _t_gate_poll(self, _) -> None:
        self.polling = False
        self._gate_try()

    def _t_gate_done(self, aid: str) -> None:
        a = self.agents[aid]
        self.checking = None
        self.queue.pop(0)
        caught = a.booking == "fictitious" and float(a.rng.random()) < self.gate["p_catch"][self.gate["procedure"]]
        a.outcome = "refused" if caught else "admitted"
        self._log(a.outcome, agent=a.id, check_s=round((self.t - a.check_start) / 1000))
        dest = self.gate["exit"] if caught else self.gate["doors"][a.door % len(self.gate["doors"])]
        self._go(a, "exit" if caught else "to_door", self.w.nearest_node(dest, "drive"))
        for i, qid in enumerate(self.queue):  # everyone moves up one place
            q = self.agents[qid]
            if q.slot != i and q.mode == "idle":
                q.slot = i
                self._to_slot(q)
        self._gate_try()

    def _t_loaded(self, aid: str) -> None:
        a = self.agents[aid]
        self._log("loaded", agent=a.id)
        self._go(a, "exit", self.w.nearest_node(self.gate["exit"], "drive"))

    # ------------------------------------------------------------------ evacuation: delay, walk out, muster

    def _evacuate(self, ev: dict) -> None:
        workers = sorted((a for a in self.agents.values() if a.kind.name == "worker"), key=lambda a: a.id)
        self.muster = {"at": ev["muster"], "t0": self.t, "n": len(workers), "done": 0}
        self._log("evacuation_start", workers=len(workers))
        med, sigma = ev.get("premovement_s", [30.0, 0.6])
        inside = set(ev.get("inside", []))
        for i, a in enumerate(workers):
            delay = float(a.rng.lognormal(np.log(med), sigma))  # pre-movement time: lognormal, as drills measure it
            if a.id in inside:
                delay += float(a.rng.uniform(*ev.get("indoor_s", [10.0, 60.0])))  # way out of the building
            self._timer(int(delay * 1000), "evac_go", (a.id, i))

    def _t_evac_go(self, data) -> None:
        aid, i = data
        a = self.agents[aid]
        self._assign(a, "evacuation")
        mx, my = self.muster["at"]
        spot = (mx + (i % 4) * 1.2 - 1.8, my + (i // 4) * 1.2)  # people stand next to each other, not on one point
        self._log("moving_out", agent=aid, after_s=round((self.t - self.muster["t0"]) / 1000, 1))
        self._retask(a, "muster", ("xy", spot), "evacuation", spot)
