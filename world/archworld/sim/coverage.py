"""Camera coverage of the compound: what the fixed cameras can see, and where they cannot.

A point counts as seen by a camera mast when it is within the camera's range and field of view and the line of
sight from the camera head to a point 1 m above the ground is clear of terrain, buildings and more than 25 m of
foliage (the same test the drills use). Three areas are measured: the fence line, the yard inside it, and a
30 m band outside it (early warning). The gaps on the fence line are listed with their side and length.
"""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import shapely
from PIL import Image, ImageDraw, ImageFont

from . import scope
from .simworld import SimWorld

STEP = 2.0  # m between sample points
BAND = 30.0  # m outside the fence
TARGET_M = 1.0
# sequential blue for "seen by 1 / 2 or more cameras"; status red for a gap, always with its label
SEEN_1, SEEN_2, GAP, INK = (134, 182, 239), (28, 92, 171), (208, 59, 59), (240, 239, 236)


def _seen(world: SimWorld, masts: list[dict], pts: np.ndarray) -> np.ndarray:
    """Number of masts that see each point (x, y)."""
    z = world.ground(pts[:, 0], pts[:, 1]) + TARGET_M
    count = np.zeros(len(pts), int)
    for m in masts:
        sen = scope.sensor_for("mast", m.get("payloads", ()))
        mx, my = m["home"]
        eye = np.array([mx, my, float(world.ground(mx, my)) + sen.eye_m])
        d = np.column_stack([pts[:, 0] - mx, pts[:, 1] - my, z - eye[2]])
        rng = np.linalg.norm(d, axis=1)
        brg = np.degrees(np.arctan2(d[:, 0], d[:, 1])) % 360.0
        ok = (rng <= sen.range_m) & (np.abs((brg - m["facing_deg"] + 180.0) % 360.0 - 180.0) <= sen.fov_deg / 2)
        for i in np.flatnonzero(ok):
            if world.los(eye, np.array([pts[i, 0], pts[i, 1], z[i]])):
                count[i] += 1
    return count


def analyse(world: SimWorld, lay: dict, masts: list[dict]) -> dict:
    fence = shapely.Polygon(lay["fence"])
    ring = fence.exterior
    n = int(np.ceil(ring.length / STEP))
    fpts = np.array([ring.interpolate(k * ring.length / n).coords[0] for k in range(n)])
    x0, y0, x1, y1 = fence.bounds
    gx, gy = np.meshgrid(np.arange(x0 - BAND + STEP / 2, x1 + BAND, STEP),
                         np.arange(y0 - BAND + STEP / 2, y1 + BAND, STEP))
    cells = np.column_stack([gx.ravel(), gy.ravel()])
    pts = shapely.points(cells)
    inside = shapely.contains(fence, pts)
    band = ~inside & shapely.dwithin(pts, fence, BAND)
    open_ = ~world.inside_building(cells[:, 0], cells[:, 1])
    fseen = _seen(world, masts, fpts)
    cseen = np.zeros(len(cells), int)
    use = (inside | band) & open_
    cseen[use] = _seen(world, masts, cells[use])
    # runs of fence line that no camera sees
    gaps, k = [], 0
    blind = fseen == 0
    if blind.all():
        gaps.append({"from": 0, "points": n})
    else:
        start = int(np.flatnonzero(~blind)[0])  # begin on a seen point so that a run cannot wrap
        order = np.roll(np.arange(n), -start)
        run = []
        for i in order:
            if blind[i]:
                run.append(i)
            elif run:
                gaps.append({"from": int(run[0]), "points": len(run)})
                run = []
        if run:
            gaps.append({"from": int(run[0]), "points": len(run)})
    cx, cy = lay["centre"]
    for g in gaps:
        idx = (g["from"] + np.arange(g["points"])) % n
        mid = fpts[idx[len(idx) // 2]]
        side = ("north" if mid[1] > cy else "south") if abs(mid[1] - cy) / (y1 - y0) > abs(mid[0] - cx) / (x1 - x0) \
            else ("east" if mid[0] > cx else "west")
        g.update({"side": side, "length_m": round(g["points"] * ring.length / n, 1),
                  "mid": [round(float(v), 1) for v in mid], "idx": idx.tolist()})
        k += g["points"]
    share = lambda mask, c=cseen: round(float((c[mask & open_] > 0).mean()), 4)  # noqa: E731
    return {
        "masts": len(masts), "sample_step_m": STEP, "band_m": BAND,
        "fence": {"length_m": round(float(ring.length), 1), "seen_share": round(float((fseen > 0).mean()), 4),
                  "seen_by_two_share": round(float((fseen > 1).mean()), 4), "blind_m": round(k * ring.length / n, 1),
                  "gaps": [{kk: v for kk, v in g.items() if kk != "idx"}
                           for g in sorted(gaps, key=lambda g: -g["length_m"])]},
        "yard": {"seen_share": share(inside), "area_m2": round(float((inside & open_).sum() * STEP * STEP))},
        "band": {"seen_share": share(band), "area_m2": round(float((band & open_).sum() * STEP * STEP))},
        "_draw": {"fpts": fpts, "fseen": fseen, "cells": cells, "cseen": cseen, "use": use, "gaps": gaps},
    }


def render(world: SimWorld, lay: dict, masts: list[dict], res: dict, ortho: np.ndarray, bounds, title: str) -> bytes:
    """Map: aerial photo, blue where cameras see (darker for two or more), fence gaps in red with their length."""
    x0, y0, x1, y1 = bounds
    h, w = ortho.shape[:2]
    sx, sy = w / (x1 - x0), h / (y1 - y0)
    px = lambda x, y: ((x - x0) * sx, (y1 - y) * sy)  # noqa: E731
    base = Image.fromarray(ortho, "RGB").convert("RGBA")
    base = Image.blend(base, Image.new("RGBA", base.size, (20, 22, 24, 255)), 0.35)  # quiet the photo under the data
    over = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    dr = res["_draw"]
    half = STEP / 2
    for (x, y), c, u in zip(dr["cells"], dr["cseen"], dr["use"], strict=True):
        if u and c > 0:
            d.rectangle([*px(x - half, y + half), *px(x + half, y - half)], fill=(*(SEEN_2 if c > 1 else SEEN_1), 150))
    img = Image.alpha_composite(base, over)
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 15)
        bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 17)
    except OSError:
        font = bold = ImageFont.load_default()
    fp, fs = dr["fpts"], dr["fseen"]
    n = len(fp)
    for i in range(n):
        a, b = px(*fp[i]), px(*fp[(i + 1) % n])
        blind = fs[i] == 0 and fs[(i + 1) % n] == 0
        d.line([a, b], fill=GAP if blind else INK, width=7 if blind else 2)
    wh = lay["warehouse"]["ring"]
    d.polygon([px(*p) for p in wh], fill=(60, 66, 72), outline=INK)
    for g in dr["gaps"]:
        if g["length_m"] < 6:
            continue
        mx, my = px(*g["mid"])
        label = f"not seen: {g['length_m']:.0f} m"
        tw = d.textlength(label, font=bold)
        lx = min(max(mx - tw / 2, 6), w - tw - 6)
        ly = my - 30 if g["side"] in ("north", "east", "west") else my + 12
        d.rectangle([lx - 5, ly - 3, lx + tw + 5, ly + 21], fill=(20, 22, 24))
        d.text((lx, ly), label, fill=INK, font=bold)
    for m in masts:
        mx, my = px(*m["home"])
        f = np.radians(m["facing_deg"])
        d.line([(mx, my), (mx + 26 * np.sin(f), my - 26 * np.cos(f))], fill=INK, width=3)
        d.ellipse([mx - 7, my - 7, mx + 7, my + 7], fill=(20, 22, 24), outline=INK, width=2)
        d.text((mx + 10, my + 6), m["id"].replace("mast-", "camera "), fill=INK, font=font)
    # legend and headline, in ink on a dark plate; the red swatch carries its label
    rows = [(SEEN_1, "seen by one camera"), (SEEN_2, "seen by two or more"), (GAP, "fence line no camera sees")]
    d.rectangle([10, h - 118, 318, h - 10], fill=(20, 22, 24))
    for k, (col, text) in enumerate(rows):
        yy = h - 108 + k * 26
        d.rectangle([20, yy, 44, yy + 16], fill=col)
        d.text((54, yy - 1), text, fill=INK, font=font)
    d.text((20, h - 30), "north is up · 20 m", fill=INK, font=font)
    d.line([(210, h - 20), (210 + 20 * sx, h - 20)], fill=INK, width=3)
    head = f"{title}: fence {res['fence']['seen_share'] * 100:.0f}% seen, yard {res['yard']['seen_share'] * 100:.0f}%"
    d.rectangle([10, 10, 30 + d.textlength(head, font=bold), 42], fill=(20, 22, 24))
    d.text((20, 15), head, fill=INK, font=bold)
    out = io.BytesIO()
    img.convert("RGB").save(out, "PNG", optimize=True)
    return out.getvalue()


def run(out: Path, raw: Path, publish: Path) -> dict:
    from .compound import load_world, staff
    from .measures import variants
    from .yard import _ortho

    world, lay, _ = load_world(Path(out))
    base = staff(world, lay)
    (x0, y0), (x1, _), (_, y1), _ = lay["fence"]
    bounds = (x0 - 45.0, y0 - 45.0, x1 + 45.0, y1 + 45.0)
    scale = 4  # pixels per metre
    w, h = round((bounds[2] - bounds[0]) * scale), round((bounds[3] - bounds[1]) * scale)
    side = max(w, h)
    sq = (bounds[0], bounds[3] - side / scale, bounds[0] + side / scale, bounds[3])
    ortho = _ortho(Path(raw), sq, side)[:h, :w]
    Path(publish).mkdir(parents=True, exist_ok=True)
    result = {}
    for vid, title in (("baseline", "Cameras now"), ("re-aimed-masts", "Same four cameras, aimed along the fence"),
                       ("4k-masts", "4K cameras on the same masts, aimed along the fence"),
                       ("mid-masts", "With two more cameras, mid-way along the long sides")):
        masts = [a for a in variants(lay, base)[vid]["staff"] if a["kind"] == "mast"]
        res = analyse(world, lay, masts)
        (Path(publish) / f"coverage-{vid}.png").write_bytes(render(world, lay, masts, res, ortho, bounds, title))
        result[vid] = {k: v for k, v in res.items() if k != "_draw"}
    return {"site": world.site.id, "method": "IEC 62676-4 detect density (25 px/m) for the camera's resolution and "
            "lens, field of view and line of sight over measured terrain, buildings and canopy; target 1 m above "
            "ground; 2 m samples", "variants": result}
