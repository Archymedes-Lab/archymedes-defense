"""What the site sim may contain. Guards, sensors and machines observe, detect, report and respond by moving.

Nothing here models force: there is no weapon payload, no engagement field and no effect on a person other than
being seen and met. Unknown kinds, payloads and keys are refused, so a scenario file cannot smuggle them in.
The sim also has no "least-detected route" planner: drill subjects walk scripted or time-optimal routes.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


class ScopeError(ValueError):
    pass


# Pixel density on a person, IEC 62676-4:2014 (horizontal pixels per metre at the target): 25 px/m to detect a
# person, 63 px/m to observe one. Below "detect" a camera is not counted as able to notice anyone.
DETECT_PPM = 25.0
OBSERVE_PPM = 63.0


@dataclass(frozen=True)
class Camera:
    h_px: int  # horizontal resolution of a visible-light camera


@dataclass(frozen=True)
class Sensor:
    range_m: float
    fov_deg: float  # 360 = all round (gimbal or dome)
    eye_m: float  # height of the sensor above the agent's feet or body
    p0: float  # chance per sensing tick of noticing a visible subject at zero range
    camera: Camera | None = None  # set: chance follows pixel density; unset: falls as 1 - (r / range_m)^2


def ppm(sen: Sensor, r: float) -> float:
    """Horizontal pixels per metre on a target r metres away, across the full field of view."""
    if sen.camera is None:
        raise ValueError("pixel density needs a camera")
    return sen.camera.h_px / (2.0 * max(r, 1e-6) * math.tan(math.radians(sen.fov_deg) / 2))


def camera_range_m(sen: Sensor) -> float:
    """Distance at which the camera reaches the IEC detect density."""
    return sen.camera.h_px / (2.0 * DETECT_PPM * math.tan(math.radians(sen.fov_deg) / 2))


def p_notice(sen: Sensor, r: float) -> float:
    """Chance per sensing tick of noticing a visible subject r metres away. Never rises with distance."""
    if sen.camera is None:
        return sen.p0 * max(0.0, 1.0 - (r / sen.range_m) ** 2)
    q = ppm(sen, r)
    if q < DETECT_PPM:
        return 0.0
    return sen.p0 * min(1.0, (q - DETECT_PPM) / (OBSERVE_PPM - DETECT_PPM))


def _mast(h_px: int) -> Sensor:
    s = Sensor(0.0, 90.0, 6.0, 0.6, Camera(h_px))
    return Sensor(round(camera_range_m(s), 1), s.fov_deg, s.eye_m, s.p0, s.camera)


# Fixed cameras are visible-light bullets with a 90 degree lens: 1080p by default, 4K as an option. Thermal
# payloads matter at night, which is not modelled yet (daylight only), so they do not change detection.
MAST_SENSORS = {"camera": _mast(1920), "camera_4k": _mast(3840)}


@dataclass(frozen=True)
class Kind:
    name: str
    ground: bool
    vmax: float  # m/s, horizontal
    slope_max_deg: float
    ways: str | None  # "foot", "drive" or None (flies / fixed)
    p_move_mw: int
    p_idle_mw: int
    capacity_mwh: int  # 0 = no battery modelled
    charge_mw: int
    sensor: Sensor | None
    responder: bool
    contact: bool = False  # can meet a subject on the ground
    agl_m: float = 0.0
    min_clear_m: float = 0.0
    climb_ms: float = 0.0


# Performance figures are round public numbers for each class of equipment, not a vendor model. They are
# assumptions (provenance method "default") until replaced by logs: see PLAN.md, validation milestone.
KINDS: dict[str, Kind] = {k.name: k for k in (
    Kind("person", True, 1.7, 40.0, "foot", 0, 0, 0, 0, None, False),
    Kind("guard", True, 1.7, 40.0, "foot", 0, 0, 0, 0, Sensor(150.0, 120.0, 1.7, 0.35), True, contact=True),
    Kind("dog", True, 3.0, 35.0, "foot", 120_000, 25_000, 236_000, 350_000, Sensor(60.0, 100.0, 0.5, 0.5), True,
         contact=True),
    Kind("vehicle", True, 14.0, 20.0, "drive", 12_000_000, 400_000, 60_000_000, 22_000_000,
         Sensor(100.0, 90.0, 1.5, 0.3), True, contact=True),
    Kind("drone", False, 12.0, 90.0, None, 180_000, 4_000, 80_000, 160_000, Sensor(300.0, 360.0, 0.0, 0.6), True,
         agl_m=60.0, min_clear_m=25.0, climb_ms=4.0),
    Kind("mast", True, 0.0, 0.0, None, 0, 0, 0, 0, MAST_SENSORS["camera"], False),
    Kind("worker", True, 1.7, 40.0, "foot", 0, 0, 0, 0, None, False),  # site staff who are not security
    Kind("truck", True, 11.0, 15.0, "drive", 0, 0, 0, 0, None, False),  # a visiting goods vehicle
)}

FADE_PER_CYCLE = 2e-4  # capacity lost per full charge cycle (assumed linear; the battery project replaces this)
ALLOWED_PAYLOADS = frozenset({"camera", "camera_4k", "thermal_camera", "lidar", "radio", "loudspeaker", "light",
                              "first_aid_kit",
                              "gnss", "imu"})
AGENT_KEYS = frozenset({"id", "kind", "home", "patrol", "payloads", "facing_deg", "role", "label"})
ROLES = frozenset({"staff", "unknown", "visitor"})


def sensor_for(kind: str, payloads) -> Sensor | None:
    """The sensor an agent of this kind carries. Only masts change with their payload (camera resolution)."""
    if kind == "mast":
        return MAST_SENSORS["camera_4k" if "camera_4k" in payloads else "camera"]
    return KINDS[kind].sensor


def validate_agent(spec: dict) -> dict:
    extra = set(spec) - AGENT_KEYS
    if extra:
        raise ScopeError(f"agent keys not allowed: {sorted(extra)}")
    if spec.get("kind") not in KINDS:
        raise ScopeError(f"unknown agent kind {spec.get('kind')!r}")
    bad = set(spec.get("payloads", ())) - ALLOWED_PAYLOADS
    if bad:
        raise ScopeError(f"payloads not allowed: {sorted(bad)}")
    if spec.get("role", "staff") not in ROLES:
        raise ScopeError(f"unknown role {spec.get('role')!r}")
    if not isinstance(spec.get("id"), str) or not spec["id"] or "home" not in spec:
        raise ScopeError("agent needs an id and a home position")
    return {"role": "staff", "payloads": [], "patrol": [], "facing_deg": None, "label": spec["id"], **spec}


def validate_zone(zone: dict) -> dict:
    """A protected zone is a notional perimeter we drew, never a real facility's security layout."""
    if zone.get("notional") is not True:
        raise ScopeError("a zone must be declared notional: true (no real facility layouts)")
    if not zone.get("radius", 0) > 0 or len(zone.get("centre", ())) != 2:
        raise ScopeError("zone needs a centre (x, y) and a positive radius")
    return zone
