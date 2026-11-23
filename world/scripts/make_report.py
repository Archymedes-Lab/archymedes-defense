"""Write the site assessment report (Markdown) from the result files. Every number comes from those files.

Run after sim, measures, coverage and orion:
  uv run python scripts/make_report.py ch-lauterbrunnen
Output: ../reports/<site>-site-assessment.md with its images in ../reports/img/.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

site = sys.argv[1]
HERE = Path(__file__).resolve().parent.parent
WEB = HERE.parent / "web"
OUT = HERE.parent / "reports"
load = lambda name: json.loads((WEB / "lib" / "data" / f"world-{name}-{site}.json").read_text())  # noqa: E731
sim, ms, cov, orion = load("sim"), load("measures"), load("coverage")["variants"], load("orion")
world = json.loads((WEB / "lib" / "data" / f"world-{site}.json").read_text())
ops, m = sim["operations"], ms["measures"]
(OUT / "img").mkdir(parents=True, exist_ok=True)
for v in ("baseline", "re-aimed-masts", "4k-masts", "mid-masts"):
    shutil.copyfile(WEB / "public" / "world" / site / "report" / f"coverage-{v}.png", OUT / "img" / f"coverage-{v}.png")

pct = lambda x: f"{x * 100:.0f}%"  # noqa: E731
med = lambda q: "n/a" if not q else f"{q['median']:.0f} s"  # noqa: E731
spread = lambda q: "n/a" if not q else f"{q['median']:.0f} s ({q['p10']:.0f} to {q['p90']:.0f})"  # noqa: E731
mins = lambda q: f"{q['median'] / 60:.0f} min"  # noqa: E731
ci = lambda c: f"{pct(c['lo'])} to {pct(c['hi'])}"  # noqa: E731


def money(r: list[float]) -> str | None:
    if r[1] == 0:
        return None
    f = lambda n: f"${n:,.0f}"  # noqa: E731
    return f(r[1]) if r[0] == r[1] else f"{f(r[0])} to {f(r[1])}"


def cost(c: dict | None) -> str:
    if c is None:
        return "no equipment"
    parts = [p for p in (money(c["one_off_usd"]) and f"{money(c['one_off_usd'])} once",
                         money(c["per_year_usd"]) and f"{money(c['per_year_usd'])} a year") if p]
    return ", ".join(parts) or "none"


base_drill = sim["drills"][0]
k_mast_hd = 1920 / (2 * 25.0)  # 90 degree lens: width at distance d is 2d, so d = px / (2 * 25 px/m)
k_mast_4k = 3840 / (2 * 25.0)
tl = {t["id"]: t for t in ops["timeline"]}
alarms = {a["policy"]: a for a in ops["alarms"]}
gate = {g["procedure"]: g for g in ops["gate"]}
coupled = {c["policy"]: c for c in ops["coupled"]}
hz = sim["horizon"]["agents"]
top = orion["rows"][0]
b, hard = m["baseline"], ms["drill"]
walkable = [w for w in ops["sweep"] if w["walkable"]]
worst = min(walkable, key=lambda w: w["interrupted"])
names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
L: list[str] = []
w = L.append

w("# Warehouse site: security assessment from simulation")
w("")
w(f"Site: a synthetic warehouse compound on measured terrain, {world['site']['name']}. "
  "The compound is notional: it was placed by rule on open ground and is not a real facility. "
  "The ground, the surrounding buildings and the tree cover are measured public data.")
w("")
w("## Summary")
w("")
cv = lambda v, k: pct(cov[v][k]["seen_share"])  # noqa: E731
w(f"1. **The fixed cameras cover little of the fence.** Counting only where a camera reaches the density needed to "
  f"detect a person (IEC 62676-4, 25 px/m), the four corner cameras as first laid out see {cv('baseline', 'fence')} "
  f"of the {cov['baseline']['fence']['length_m']:.0f} m fence line and {cv('baseline', 'yard')} of the yard. Aimed "
  f"along the fence: {cv('re-aimed-masts', 'fence')} and {cv('re-aimed-masts', 'yard')}. With 4K cameras on the same "
  f"masts: {cv('4k-masts', 'fence')} and {cv('4k-masts', 'yard')}.")
w(f"2. **Early detection depends on the drone.** With everything working, an approaching person is detected after "
  f"{med(base_drill['time_to_detect_s'])}. With its camera out, detection takes "
  f"{med(sim['drills'][2]['time_to_detect_s'])}. Over {sim['horizon']['days']} days the drone is on its charger "
  f"{pct(1 - hz['drone-1']['availability'])} of the time.")
bc = b["met_in_time_ci"]
w(f"3. **With two sensors out, about one intrusion in {round(b['runs'] / max(1, b['runs'] - b['met_in_time']))} "
  f"is not stopped in time.** In the hard case ({hard.lower()}, at a random time in the shift) the intruder is met "
  f"before finishing in {b['met_in_time']} of {b['runs']} runs (95% interval {ci(bc)}).")
w("")
w(f"**Recommended first step (ORION):** {top['label'][0].lower() + top['label'][1:]}. {top['evidence']}")
w("")
w("## What was assessed, and how")
w("")
w("- **Measured:** terrain (1 m in the site scene, 4 m in the valley), aerial imagery, surrounding buildings, "
  "tree canopy height. Source: swisstopo open data; roads and paths from OpenStreetMap.")
w(f"- **Placed:** the compound ({sim['compound']['size'][0]:.0f} by {sim['compound']['size'][1]:.0f} m, fenced, one "
  f"gate, {sim['compound']['relief_m']} m of relief) with two guards, a robot dog, a patrol vehicle, a drone and "
  "four camera masts.")
w(f"- **Simulated:** a deterministic event simulation. Each drill is run over 40 seeds ({ms['seeds']} for the "
  "measured improvements), because detection is a chance per second that depends on distance, camera resolution, "
  f"field of view and line of sight. Intrusions start at a random time {ms['intrusion_window_s'][0] // 3600} to "
  f"{ms['intrusion_window_s'][1] // 3600} hours into the shift, so the drone, robot dog and vehicle are met charging, "
  "low or mid-patrol as they would be. Guards and machines observe, detect, report and go to meet a person. No use "
  "of force is modelled. Rates are given with exact 95% intervals.")
w("- **Assumed:** equipment speeds, battery sizes and sensor ranges are round class figures; barrier delays, gate "
  "check times and catch rates are placeholders. They are listed at the end.")
w("")
w("## Findings")
w("")
w("### Camera coverage")
w("")
w("| Layout | Cameras | Fence line seen | Fence not seen | Yard seen | 30 m outside seen |")
w("|---|---:|---:|---:|---:|---:|")
for vid, name in (("baseline", "As first laid out, facing outward"), ("re-aimed-masts", "Same four, aimed along the fence"),
                  ("4k-masts", "Same four with 4K cameras, aimed along the fence"),
                  ("mid-masts", "Two more mid-way, all facing outward")):
    c = cov[vid]
    w(f"| {name} | {c['masts']} | {pct(c['fence']['seen_share'])} | {c['fence']['blind_m']:.0f} m | "
      f"{pct(c['yard']['seen_share'])} | {pct(c['band']['seen_share'])} |")
w("")
w("![Coverage as first laid out](img/coverage-baseline.png)")
w("")
w("![Coverage with the same cameras aimed along the fence](img/coverage-re-aimed-masts.png)")
w("")
w("![Coverage with 4K cameras aimed along the fence](img/coverage-4k-masts.png)")
w("")
w(f"A point counts as seen when a camera reaches the IEC 62676-4 detect density there (25 px/m on a person: "
  f"{k_mast_hd:.0f} m for the 1080p cameras with a 90 degree lens, {k_mast_4k:.0f} m for 4K), inside its field "
  "of view, "
  "with a clear line of sight over the measured terrain, buildings and canopy. This is where a camera could detect "
  "someone in daylight, not whether an operator would notice.")
w("")
w("### Detection and response to a person walking in")
w("")
w("| Case | Detected | Time to detect | Detection to being met | In the alarm zone first |")
w("|---|---:|---:|---:|---:|")
for d in sim["drills"]:
    w(f"| {d['title']} | {d['detected']}/{d['runs']} | {spread(d['time_to_detect_s'])} | "
      f"{med(d['detect_to_contact_s'])} | {d['entered_zone_before_contact']}/{d['runs']} |")
w("")
w("### Protection timeline: fence, then a door")
w("")
w(f"The person crosses the fence ({ops['assumptions']['fence_delay_s']:.0f} s), walks to a door and works on it "
  f"({ops['assumptions']['door_delay_s']:.0f} s). The fence sensor alarms {pct(ops['assumptions']['fence_pd'])} of "
  "the time and is checked from inside the yard.")
w("")
w("| Case | Met before the door gives way | 95% interval | Seen before the fence | Task completed |")
w("|---|---:|---:|---:|---:|")
for tid, name in (("fence-to-door", "All sensors working"), ("fence-to-door-drone-down", "Drone camera out"),
                  ("fence-to-door-two-faults", "Drone camera and fence sensor out")):
    t = tl[tid]
    w(f"| {name} | {t['interrupted']}/{t['runs']} | {ci(t['interrupted_ci'])} | "
      f"{t['detected_before_fence']}/{t['runs']} "
      f"| {t['task_completed']}/{t['runs']} |")
w("")
w("\"Seen before the fence\" counts runs where the person was detected and either never reached the fence or was "
  "detected before reaching it.")
w("")
sweep = ", ".join(f"{names[x['bearing_deg'] // 45]} {x['interrupted']}/{x['runs']}" if x["walkable"]
                  else f"{names[x['bearing_deg'] // 45]} not walkable" for x in ops["sweep"])
w(f"By approach direction in the hard case: {sweep}. The weakest side is the {names[worst['bearing_deg'] // 45]}.")
sens = ", ".join(f"{x['door_delay_s']:.0f} s door {x['interrupted']}/{x['runs']}" for x in ops["sensitivity"])
w(f"Dependence on the assumed door delay, same case: {sens}.")
w("")
w("### Fence alarms")
w("")
w(f"{alarms['verify_first']['days']} days at {ops['assumptions']['nuisance_per_day']:.0f} nuisance alarms a day "
  "(a poorly tuned sensor).")
w("")
w("| Procedure | Alarms | Guards sent | Guard hours | Robot dog hours | Drone hours |")
w("|---|---:|---:|---:|---:|---:|")
for p, name in (("verify_first", "A machine checks first"), ("all_respond", "Everyone responds")):
    a = alarms[p]
    w(f"| {name} | {a['alarms']} | {a['guard_dispatches']} | {a['guard_hours_on_alarms']:.1f} | "
      f"{a['dog_hours_on_alarms']:.1f} | {a['drone_hours_on_alarms']:.1f} |")
w("")
w(f"A real intrusion during a nuisance alarm was met in time in {coupled['verify_first']['interrupted']}/"
  f"{coupled['verify_first']['runs']} runs when a machine checks first and {coupled['all_respond']['interrupted']}/"
  f"{coupled['all_respond']['runs']} when everyone responds.")
w("")
w("### Gate and fictitious pickups")
w("")
w(f"A {gate['paper']['hours']:.0f}-hour shift, about {ops['assumptions']['trucks_per_hour']:.0f} trucks an hour, one "
  "on a fictitious booking.")
w("")
w("| Check | Fictitious pickup stopped | Mean wait | Longest wait | Longest queue |")
w("|---|---:|---:|---:|---:|")
for p, name in (("paper", "Paper only"), ("callback", "With call-back")):
    g = gate[p]
    w(f"| {name} | {g['stopped']}/{g['runs']} | {mins(g['mean_wait_s'])} | {mins(g['max_wait_s'])} | "
      f"{g['max_queue']['median']:.0f} |")
w("")
w("The share stopped is close to the assumed catch rate by construction. What the simulation adds is the price "
  "in waiting time.")
w("")
w("### Evacuation")
w("")
e, eb = ops["evacuation"], ops["evacuation_blocked"]
w(f"All {ops['assumptions']['workers']} staff reached the muster point in {e['all_mustered']}/{e['runs']} drills; the "
  f"last person after {spread(e['last_s'])}. With the nearest exit blocked: {spread(eb['last_s'])}. Both are best "
  "cases: no smoke, no crowding, nobody missing.")
w("")
w(f"### Equipment over {sim['horizon']['days']} days")
w("")
w("| Equipment | Distance | Charge cycles | Capacity left | Available |")
w("|---|---:|---:|---:|---:|")
for a in hz.values():
    if a["capacity_fraction"] is None:
        continue
    w(f"| {a['label']} | {a['distance_m'] / 1000:,.0f} km | {a['cycles']} | {pct(a['capacity_fraction'])} | "
      f"{pct(a['availability'])} |")
w("")
w("## Recommendations, ranked")
w("")
w(f"Each measure was run in the simulation on the hard case ({hard.lower()}; baseline {b['met_in_time']}/{b['runs']} "
  f"met in time, 95% interval {ci(bc)}) over {ms['seeds']} seeds, every measure on the same seeds and intrusion "
  "times, then ranked by ORION, the decision engine, with these numbers and the rough costs as evidence. Measures "
  "whose paired runs cannot be told apart (exact McNemar test, 5% level) are marked as tied: between them, the "
  "ranking rests on cost and ORION's judgment, not on a measured difference.")
w("")
w("| Measure | Met in time | 95% interval | Different from now? | Tied with |")
w("|---|---:|---:|---:|---|")
for vid, x in m.items():
    if vid == "baseline":
        continue
    w(f"| {x['label']} | {x['met_in_time']}/{x['runs']} | {ci(x['met_in_time_ci'])} | "
      f"{'yes' if x['vs_baseline_p'] < 0.05 else 'no'} (p = {x['vs_baseline_p']:.3f}) | "
      f"{', '.join(m[o]['label'] for o in x['tied_with'] if o != 'baseline') or 'none'} |")
w("")
w("| # | Measure | Rough cost | Chance it is first | Evidence |")
w("|---:|---|---|---:|---|")
for r in orion["rows"]:
    w(f"| {r['rank']} | {r['label']} | {cost(m.get(r['id'], {}).get('cost'))} | {pct(r['pFirst'])} | {r['evidence']} |")
w("")
w(f"Agreement between ORION's five ranking methods: {orion['agreement']:.2f} (1 means identical orders). "
  "ORION is advisory: it ranks the evidence it is given.")
w("")
w("## Assumptions and limits")
w("")
k = sim["assumptions"]["kinds"]
a = ops["assumptions"]
w(f"- Drone: {k['drone']['battery_wh']:.0f} Wh at {k['drone']['move_w']:.0f} W, camera range "
  f"{k['drone']['sensor']['range_m']:.0f} m. Robot dog: {k['dog']['battery_wh']:.0f} Wh at {k['dog']['move_w']:.0f} W. "
  f"Camera masts: 1080p visible cameras with a {k['mast']['sensor']['fov_deg']:.0f} degree lens, detect range "
  f"{k['mast']['sensor']['range_m']:.0f} m (IEC 62676-4, 25 px/m); chance of noticing rises to its full value at "
  "63 px/m. Class figures, not product data.")
w(f"- Capacity fade {sim['assumptions']['fade_per_cycle'] * 100:.2f}% per cycle; sight ends after "
  f"{sim['assumptions']['foliage_path_limit_m']:.0f} m of foliage; off-path walking at "
  f"{sim['assumptions']['off_path_speed_factor']} of path speed.")
w(f"- Fence delay {a['fence_delay_s']:.0f} s, door delay {a['door_delay_s']:.0f} s, fence sensor detection "
  f"{pct(a['fence_pd'])}; gate check {a['check_s'][0] / 60:.0f} to {a['check_s'][1] / 60:.0f} min, call-back "
  f"{a['callback_s'][0] / 60:.0f} to {a['callback_s'][1] / 60:.0f} min more; catch rates {a['p_catch']['paper']} "
  f"(paper) and {a['p_catch']['callback']} (call-back).")
w("- Agents are moving points on real route and sight geometry. There is no flight controller or gait model. "
  "Fixed cameras are modelled by resolution and lens only: no lighting, compression, mounting blur or video "
  "analytics. The drone, robot dog, vehicle and guards keep a simpler range model. No night, no weather. A machine "
  "sent to check an alarm is assumed never to be wrong.")
w("- Costs are public price ranges found by search in November 2026, mostly from vendors and trade press. They "
  "are rough and are not quotes.")
w("- The site is notional. Nothing here describes the security of a real facility.")
w("")
w("## Sources")
w("")
for title, url in (
        ("Sandia National Laboratories, physical security modeling (probability of interruption)", "https://www.osti.gov/servlets/purl/1807772"),
        ("Sandia, tables for trials and failures with Pd at a designated confidence level", "https://www.osti.gov/servlets/purl/1326340"),
        ("Axis, pixel density based on IEC 62676-4", "https://whitepapers.axis.com/en/pixel-density-based-on-iec-62676-4-2014"),
        ("Verisk CargoNet, 2025 cargo theft analysis", "https://www.verisk.com/company/newsroom/cargo-theft-losses-surge-to-estimated-$725-million-in-2025-verisk-cargonet-analysis-reveals/"),
        ("FreightWaves, GXO deploys robots and drones for warehouse security", "https://www.freightwaves.com/news/gxo-deploys-robots-and-drones-from-asylon-for-warehouse-security"),
        ("DHL, facility patrolling (limits of automated systems)", "https://dhl.com/cl-en/microsites/csi/innovation-warehouse/physical-and-digital-security/facility-patrolling.html"),
        ("VA perimeter intrusion detection specification (nuisance alarm limits)", "https://www.wbdg.org/FFC/VA/VANCAS/VANCA283100.pdf"),
        ("Fire Technology 2019, variation of pre-movement time in evacuation", "https://link.springer.com/article/10.1007/s10694-019-00881-1"),
        ("robotics.press, what security robots cost in 2026", "https://robotics.press/news/security-robot-pricing-2026/"),
        ("latestcost.com, thermal security camera installed costs", "https://latestcost.com/thermal-security-camera-price-equipment-installation-costs/"),
        ("ASIS International, Security Risk Assessment Standard", "https://www.asisonline.org/security-news/press-room/2024/security-risk-assessment-standard/"),
        ("NVIDIA Omniverse, warehouse digital twin use cases", "https://docs.omniverse.nvidia.com/digital-twins/latest/warehouse-digital-twins/use-cases.html")):
    w(f"- [{title}]({url})")
w("")
w(f"Reproduce: `world/scripts/run_flow.sh {site}`. Simulation digest {sim['horizon']['digest'][:12]}; "
  f"ORION evidence digest {orion['context_sha256'][:12]}; model {orion['model']}.")
path = OUT / f"{site}-site-assessment.md"
path.write_text("\n".join(L) + "\n")
print(path, len(L), "lines")
