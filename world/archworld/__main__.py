"""Build a site.

uv run python -m archworld build ch-lauterbrunnen --out data/out/ch-lauterbrunnen \\
    --publish ../web/public/world/ch-lauterbrunnen --summary ../web/lib/data/world-ch-lauterbrunnen.json
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

from .build import build_world
from .sites import SITES

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    ap = argparse.ArgumentParser(prog="archworld")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("site", choices=sorted(SITES))
    b.add_argument("--out", type=Path, required=True)
    b.add_argument("--summary", type=Path, help="also write a compact report (no per-building gaps) here")
    b.add_argument("--publish", type=Path, help="copy viewer files (tileset, tiles, buildings, lines) here")
    sm = sub.add_parser("sim", help="site sim: drill batches, replays and a long-horizon run for a built site")
    sm.add_argument("site", choices=sorted(SITES))
    sm.add_argument("--out", type=Path, required=True, help="the build output directory of the site")
    sm.add_argument("--seeds", type=int, default=40)
    sm.add_argument("--days", type=int, default=30)
    sm.add_argument("--publish", type=Path, help="copy site.json and replays here for the viewer")
    sm.add_argument("--summary", type=Path)
    yd = sub.add_parser("yard", help="extract the warehouse site as its own small, high-resolution scene")
    yd.add_argument("site", choices=sorted(SITES))
    yd.add_argument("--out", type=Path, required=True, help="the build output directory of the site")
    yd.add_argument("--publish", type=Path, required=True)
    ms = sub.add_parser("measures", help="measure candidate improvements in the sim (evidence for ORION)")
    ms.add_argument("site", choices=sorted(SITES))
    ms.add_argument("--out", type=Path, required=True)
    ms.add_argument("--seeds", type=int, default=120)
    ms.add_argument("--days", type=int, default=30)
    ms.add_argument("--summary", type=Path, required=True)
    cv = sub.add_parser("coverage", help="camera coverage of the compound: shares, fence gaps and maps")
    cv.add_argument("site", choices=sorted(SITES))
    cv.add_argument("--out", type=Path, required=True)
    cv.add_argument("--publish", type=Path, required=True, help="folder for the map images")
    cv.add_argument("--summary", type=Path, required=True)
    a = ap.parse_args()
    if a.cmd == "coverage":
        from .sim.coverage import run as coverage_run

        res = coverage_run(a.out, ROOT / "data" / "raw" / a.site, a.publish)
        a.summary.write_text(json.dumps(res, sort_keys=True, indent=1) + "\n")
        print(json.dumps({k: [v["fence"]["seen_share"], v["yard"]["seen_share"], v["band"]["seen_share"],
                              v["fence"]["blind_m"]] for k, v in res["variants"].items()}))
        return 0
    if a.cmd == "measures":
        from .sim.measures import evaluate

        res = evaluate(a.out, a.seeds, a.days, log=lambda m: print(m, file=sys.stderr))
        a.summary.write_text(json.dumps(res, sort_keys=True, indent=1) + "\n")
        print(json.dumps({k: [v["met_in_time"], v["runs"]] for k, v in res["measures"].items()}))
        return 0
    if a.cmd == "yard":
        from .sim.yard import extract

        res = extract(a.out, ROOT / "data" / "raw" / a.site, a.publish)
        print(json.dumps({k: v for k, v in res.items() if k != "files"}))
        return 0
    if a.cmd == "sim":
        from .sim.run import run_site

        s = run_site(a.out, a.seeds, a.days, log=lambda m: print(m, file=sys.stderr))
        if a.publish:
            a.publish.mkdir(parents=True, exist_ok=True)
            for name in s["files"]:
                if name != "summary.json":
                    shutil.copyfile(a.out / "simruns" / name, a.publish / name)
        if a.summary:
            a.summary.write_text(json.dumps(s, sort_keys=True, indent=1) + "\n")
        keys = ("runs", "detected", "contacted", "entered_zone_before_contact", "time_to_detect_s",
                "detect_to_contact_s")
        print(json.dumps({d["id"]: {k: d[k] for k in keys} for d in s["drills"]}))
        return 0
    site = SITES[a.site]
    if site.crs != "EPSG:2056":
        print(f"{site.id}: US loader is milestone 1b (see PLAN.md)", file=sys.stderr)
        return 2
    from .sources_ch import load_inputs

    t0 = time.time()
    inputs = load_inputs(site, ROOT / "data" / "raw" / site.id)
    print(f"loaded in {time.time() - t0:.0f} s: {len(inputs.buildings)} buildings", file=sys.stderr)
    report = build_world(site, inputs, a.out)
    print(f"built in {time.time() - t0:.0f} s", file=sys.stderr)
    if a.summary:
        compact = {**report, "buildings": {k: v for k, v in report["buildings"].items() if k != "gaps"}}
        a.summary.write_text(json.dumps(compact, sort_keys=True, indent=1) + "\n")
    if a.publish:
        if a.publish.exists():
            shutil.rmtree(a.publish)
        (a.publish / "tiles").mkdir(parents=True)
        for rel in report["digests"]:
            if rel != "roads.json" and not rel.startswith("sim/"):
                shutil.copyfile(a.out / rel, a.publish / rel)
    print(json.dumps({"terrain_rmse_m": report["terrain"]["rmse_m"], "seam": report["terrain"]["max_seam_gap_m"],
                      "buildings": report["buildings"]["count"], "floating": report["buildings"]["floating"],
                      "ways": report["lines"]["ways"], "coverage": report["coverage"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
