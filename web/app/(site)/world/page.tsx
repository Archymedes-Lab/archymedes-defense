import type { Metadata } from "next";
import { WorldScene } from "@/components/three/client";
import { PageHeader, Panel, Section, Stat } from "@/components/ui/primitives";
import { INVARIANTS, type Quant, SIM_INVARIANTS, swiss, swissCoverage, swissMeasures, swissOrion, swissSim } from "@/lib/world";

export const metadata: Metadata = { title: "Synthetic world" };

const BASE = "/world/ch-lauterbrunnen";
const LAYER_LABEL: Record<string, string> = {
  terrain: "Terrain tiles", imagery: "Imagery tiles", buildings: "Buildings", "lines:highway": "Roads and paths (width)",
  "lines:railway": "Rail (width)", "lines:waterway": "Waterways (width)",
};
const LAYER_SOURCE: Record<string, string> = {
  terrain: "swissALTI3D 0.5 m DTM", imagery: "SWISSIMAGE 10 cm", buildings: "swissBUILDINGS3D 3.0 (LoD2)",
  "lines:highway": "OpenStreetMap", "lines:railway": "OpenStreetMap", "lines:waterway": "OpenStreetMap",
};
const METHODS = ["measured", "tagged", "inferred", "default"] as const;

const COVERAGE: [string, string][] = [["baseline", "Cameras as first laid out"], ["re-aimed-masts", "Same four cameras, aimed along the fence"], ["4k-masts", "4K cameras on the same masts, aimed along the fence"], ["mid-masts", "Two more cameras mid-way, all facing outward"]];
const pc = (x: number) => `${(x * 100).toFixed(0)}%`;
const k = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`);
const range = (r: [number, number]) => (r[1] === 0 ? null : r[0] === r[1] ? k(r[1]) : `${k(r[0])}–${k(r[1])}`);
function costText(c?: { one_off_usd: [number, number]; per_year_usd: [number, number] }) {
  if (!c) return "no equipment";
  const once = range(c.one_off_usd), year = range(c.per_year_usd);
  return [once && `${once} once`, year && `${year} a year`].filter(Boolean).join(", ") || "none";
}
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const q = (x: Quant | null) => (x ? `${Math.round(x.median)} s (${Math.round(x.p10)}–${Math.round(x.p90)})` : "–");

export default function WorldPage() {
  const r = swiss;
  const sim = swissSim;
  const base = sim.drills[0]!;
  const ops = sim.operations;
  const measures = swissMeasures;
  const orion = swissOrion;
  const cov = swissCoverage.variants;
  const kinds = sim.assumptions.kinds;
  const zoneR = Math.hypot(sim.compound.size[0]! / 2, sim.compound.size[1]! / 2) + 15;
  const km2 = (r.site.size_m / 1000) ** 2;
  const n = Math.round(r.site.size_m / r.site.tile_m);
  const tiles = new Map(r.terrain.tiles.map((t) => [`${t.tile[0]}_${t.tile[1]}`, t]));
  const totalMB = r.sources.reduce((s, x) => s + (x.bytes ?? 0), 0) / 1e6;
  return (
    <>
      <PageHeader eyebrow="Synthetic world · milestone 1 · real open data" title="One world, rebuilt from open data."
        lede={`The Lauterbrunnen valley, ${km2} km², rebuilt from public swisstopo and OpenStreetMap data. Every building, road and tile records where its numbers come from and how far the world is from the source. Drones, robot dogs and vehicles will run their patrol, search and convoy missions in this same world.`}>
        <div className="flex flex-wrap gap-2"><span className="tag">Built · Swiss site</span><span className="tag">Site sim · drills</span><span className="tag">US site planned</span><span className="tag">No weapons or targeting</span></div>
        <div className="mt-4 grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat value={r.buildings.count.toLocaleString("en")} label="buildings, measured" hint="LoD2 roofs" />
          <Stat value={r.lines.ways.toLocaleString("en")} label="roads, rail, rivers" hint="OpenStreetMap" />
          <Stat value={`${r.terrain.rmse_m} m`} label="terrain RMSE" hint={`${r.grid.leaf_step_m} m mesh vs 0.5 m source`} />
          <Stat value={r.buildings.floating} label="floating buildings" hint={`seams ≤ ${(r.terrain.max_seam_gap_m * 1000).toFixed(2)} mm`} />
        </div>
      </PageHeader>

      <WorldScene base={BASE} buildingsUrl={`${BASE}/buildings.json`} linesUrl={`${BASE}/lines.json`}
        sim={{ base: `${BASE}/sim`, drills: sim.replays }} />

      <a href="/world/site" className="panel group grid gap-2 p-5 transition-colors hover:bg-surface sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div><div className="text-[16px] font-medium group-hover:text-accent">Open the warehouse site close up</div>
          <p className="text-[13.5px] text-fg-2">The site as its own scene: 12.5 cm imagery, 1 m terrain, scanned props, realistic guards, a real sky and shadows. Lighter to run than the whole valley.</p></div>
        <span className="tag">Site scene →</span>
      </a>

      <Section eyebrow="Site sim · one site, one simulation" title="Drills at a warehouse site"
        description={`A synthetic warehouse compound (${sim.compound.size[0]} × ${sim.compound.size[1]} m, fenced, one gate) is placed by rule on the flattest open ground in the valley: ${sim.compound.relief_m} m of relief, no building, tree, path, rail or water in it. Two guards, a robot dog, a patrol vehicle, a drone and four camera masts work the site. In each drill an unknown person appears ${base.info.start_m} m away and walks in across open ground. Guards and machines observe, detect, report and go to meet the person. No use of force is modelled.`}>
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[14px]">
            <thead><tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">
              <th className="p-3 font-normal">Drill, {base.runs} seeds each</th><th className="p-3 text-right font-normal">Detected</th>
              <th className="p-3 text-right font-normal">Time to detect</th><th className="p-3 text-right font-normal">Detection to meeting</th>
              <th className="p-3 text-right font-normal">Reached the zone first</th>
            </tr></thead>
            <tbody>
              {sim.drills.map((d) => (
                <tr key={d.id} className="border-b border-line align-top last:border-0">
                  <td className="p-3">{d.title}</td>
                  <td className="num p-3 text-right font-mono">{d.detected}/{d.runs}</td>
                  <td className="num p-3 text-right font-mono">{q(d.time_to_detect_s)}</td>
                  <td className="num p-3 text-right font-mono">{q(d.detect_to_contact_s)}{d.contacted < d.runs ? ` (${d.contacted}/${d.runs} met)` : ""}</td>
                  <td className="num p-3 text-right font-mono">{d.entered_zone_before_contact}/{d.runs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <p className="text-[13px] text-fg-2">
          Times are the median with the 10th to 90th percentile in brackets. Detection is a chance per second that depends on range, field of view and line of sight through the measured terrain, buildings and tree canopy, so each drill is a spread over seeds, not one number. The replay above is the median run of each batch. The walk to the fence takes {base.info.walk_s} s; "reached the zone first" counts runs where the person was inside the {Math.round(zoneR)} m alarm circle before anyone met them.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Panel className="grid content-start gap-1.5 p-4">
            <div className="text-[14.5px] font-medium">The drone carries early detection</div>
            <p className="text-[13px] text-fg-2">With everything working, the drone made the first detection in every run, about a minute after the person appeared. With its camera out, the first detection came from a patrolling guard, the robot dog or the vehicle, {Math.round((sim.drills[2]?.time_to_detect_s?.median ?? 0) / (base.time_to_detect_s?.median ?? 1))} times later, and the person was inside the alarm circle every time.</p>
          </Panel>
          <Panel className="grid content-start gap-1.5 p-4">
            <div className="text-[14.5px] font-medium">The masts leave a gap on the long side</div>
            <p className="text-[13px] text-fg-2">No camera mast detected the person in any of the {sim.drills.reduce((n, d) => n + d.runs, 0)} runs, which is why losing one changed nothing. Each corner mast looks outward along its diagonal, so an approach square-on to the north fence passes between two fields of view, within 70 m of a camera. A mast at the middle of each long side would close it.</p>
          </Panel>
          <Panel className="grid content-start gap-1.5 p-4">
            <div className="text-[14.5px] font-medium">One drone cannot be the plan</div>
            <p className="text-[13px] text-fg-2">Over {sim.horizon.days} days of continuous patrol the single drone is on its charger {(100 - (sim.horizon.agents["drone-1"]?.availability ?? 0) * 100).toFixed(0)}% of the time and goes through {sim.horizon.agents["drone-1"]?.cycles} charge cycles. Under the assumed fade that leaves {((sim.horizon.agents["drone-1"]?.capacity_fraction ?? 0) * 100).toFixed(0)}% of its battery capacity after one month.</p>
          </Panel>
        </div>
        <h3 className="mt-2 text-[15px] font-medium">More operations at the same site</h3>
        <p className="text-[13px] text-fg-2">Four further operations run in the same world with the same staff and equipment, each grounded in how sites are actually assessed and attacked: the protection timeline used in physical-protection engineering, alarm verification by drone as logistics operators now deploy it, the fictitious pickups that made up a quarter of reported cargo-theft incidents in the third quarter of 2026, and evacuation drills. Each has a replay in the viewer above.</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="grid content-start gap-2 p-4">
            <div className="text-[14.5px] font-medium">Protection timeline: is the response there in time?</div>
            <p className="text-[13px] text-fg-2">The person does not stop at the fence. They cross it ({ops.assumptions.fence_delay_s} s), walk to a door and work on it ({ops.assumptions.door_delay_s} s). The fence sensor alarms {(ops.assumptions.fence_pd * 100).toFixed(0)}% of the time; a camera that covers the spot confirms 20 s later. A fence alarm is checked from inside the yard. The measure is how often someone meets the person before the door gives way.</p>
            <table className="w-full text-[13.5px]">
              <thead><tr className="border-b border-line text-left font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-3"><th className="py-1.5 font-normal">Case</th><th className="py-1.5 text-right font-normal">Met in time</th><th className="py-1.5 text-right font-normal">Seen before the fence</th><th className="py-1.5 text-right font-normal">Time to spare</th></tr></thead>
              <tbody>{ops.timeline.map((t) => (
                <tr key={t.id} className="border-b border-line last:border-0"><td className="py-1.5">{t.id.endsWith("two-faults") ? "Drone camera and fence sensor out" : t.info.faulted ? "Drone camera out" : "All sensors working"}</td>
                  <td className="num py-1.5 text-right font-mono">{t.interrupted}/{t.runs}</td><td className="num py-1.5 text-right font-mono">{t.detected_before_fence}/{t.runs}</td>
                  <td className="num py-1.5 text-right font-mono">{t.margin_s ? `${Math.round(t.margin_s.median)} s` : "not reached"}</td></tr>))}</tbody>
            </table>
            <p className="text-[12.5px] text-fg-3">"Time to spare" is the median gap between the meeting and the moment the door would have given way, in runs where the person got that far.</p>
            <p className="text-[13px] text-fg-2"><span className="font-medium text-fg">By direction, drone camera and fence sensor out:</span>{" "}
              {ops.sweep.map((w) => `${COMPASS[w.bearing_deg / 45]} ${w.walkable ? `${w.interrupted}/${w.runs}` : "no way in on foot"}`).join(" · ")}. The weakest side is the one to fix first; one path alone would overstate the protection.</p>
            <p className="text-[13px] text-fg-2"><span className="font-medium text-fg">How much this leans on the assumed door delay (same hard case):</span>{" "}
              {ops.sensitivity.map((x) => `${x.door_delay_s} s door: ${x.interrupted}/${x.runs}`).join(" · ")}. The barrier delays are placeholders, so read these as "if the door holds this long", not as a protection level.</p>
          </Panel>
          <Panel className="grid content-start gap-2 p-4">
            <div className="text-[14.5px] font-medium">Fence alarms: check first, or send everyone?</div>
            <p className="text-[13px] text-fg-2">{ops.alarms[0]!.days} days with {ops.assumptions.nuisance_per_day} nuisance alarms a day, the rate of a poorly tuned fence sensor (a good one manages about one per kilometre per day). Either a drone or the robot dog looks first and people stay at their posts, or two responders and the drone go to every alarm.</p>
            <table className="w-full text-[13.5px]">
              <thead><tr className="border-b border-line text-left font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-3"><th className="py-1.5 font-normal">Procedure</th><th className="py-1.5 text-right font-normal">Alarms</th><th className="py-1.5 text-right font-normal">Guards sent</th><th className="py-1.5 text-right font-normal">Guard hours</th><th className="py-1.5 text-right font-normal">Drone hours</th></tr></thead>
              <tbody>{ops.alarms.map((a) => (
                <tr key={a.policy} className="border-b border-line last:border-0"><td className="py-1.5">{a.policy === "verify_first" ? "Machine checks first" : "Everyone responds"}</td>
                  <td className="num py-1.5 text-right font-mono">{a.alarms}</td><td className="num py-1.5 text-right font-mono">{a.guard_dispatches}</td>
                  <td className="num py-1.5 text-right font-mono">{a.guard_hours_on_alarms.toFixed(1)}</td><td className="num py-1.5 text-right font-mono">{a.drone_hours_on_alarms.toFixed(1)}</td></tr>))}</tbody>
            </table>
            <p className="text-[13px] text-fg-2"><span className="font-medium text-fg">When a real intrusion comes during a nuisance alarm</span> (drone camera out, alarm on the far side five minutes into the approach): met in time{" "}
              {ops.coupled.map((x) => `${x.interrupted}/${x.runs} ${x.policy === "verify_first" ? "when a machine checks first" : "when everyone responds"}`).join(", ")}. Workload alone would hide this side of the choice.</p>
            <p className="text-[12.5px] text-fg-3">{ops.alarms[0]!.unverified > 0 ? `With checking first, ${ops.alarms[0]!.unverified} alarms found no machine free (charging or already out) and went unchecked.` : "With checking first, a machine was free for every alarm."}</p>
          </Panel>
          <Panel className="grid content-start gap-2 p-4">
            <div className="text-[14.5px] font-medium">Gate: catching a fictitious pickup costs queue time</div>
            <p className="text-[13px] text-fg-2">A {ops.gate[0]!.hours}-hour shift with about {ops.assumptions.trucks_per_hour} trucks an hour and one truck on a fictitious booking. A paper check takes {ops.assumptions.check_s[0]! / 60}–{ops.assumptions.check_s[1]! / 60} minutes. Phoning the booking office adds {ops.assumptions.callback_s[0]! / 60}–{ops.assumptions.callback_s[1]! / 60} minutes and is assumed to catch {(ops.assumptions.p_catch.callback! * 100).toFixed(0)}% of false bookings against {(ops.assumptions.p_catch.paper! * 100).toFixed(0)}%.</p>
            <table className="w-full text-[13.5px]">
              <thead><tr className="border-b border-line text-left font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-3"><th className="py-1.5 font-normal">Check</th><th className="py-1.5 text-right font-normal">Stopped</th><th className="py-1.5 text-right font-normal">Mean wait</th><th className="py-1.5 text-right font-normal">Longest wait</th><th className="py-1.5 text-right font-normal">Longest queue</th></tr></thead>
              <tbody>{ops.gate.map((g) => (
                <tr key={g.procedure} className="border-b border-line last:border-0"><td className="py-1.5">{g.procedure === "paper" ? "Paper only" : "With call-back"}</td>
                  <td className="num py-1.5 text-right font-mono">{g.stopped}/{g.runs}</td><td className="num py-1.5 text-right font-mono">{(g.mean_wait_s.median / 60).toFixed(0)} min</td>
                  <td className="num py-1.5 text-right font-mono">{(g.max_wait_s.median / 60).toFixed(0)} min</td><td className="num py-1.5 text-right font-mono">{g.max_queue.median}</td></tr>))}</tbody>
            </table>
            <p className="text-[12.5px] text-fg-3">Medians over {ops.gate[0]!.runs} shifts. The catch rates are assumptions: the result shows the shape of the trade, not its size.</p>
          </Panel>
          <Panel className="grid content-start gap-2 p-4">
            <div className="text-[14.5px] font-medium">Evacuation: everyone at the muster point</div>
            <p className="text-[13px] text-fg-2">{ops.assumptions.workers} staff, half of them indoors. After the alarm each person takes their own time to start moving (drill studies find these delays follow a lognormal spread; here the median is 30 s), then walks to the muster point by the gate.</p>
            <div className="grid grid-cols-3 gap-4">
              <Stat value={`${ops.evacuation.all_mustered}/${ops.evacuation.runs}`} label="drills complete" />
              <Stat value={`${Math.round(ops.evacuation.median_s.median)} s`} label="half the staff there" />
              <Stat value={`${Math.round(ops.evacuation.last_s.median)} s`} label="last person" hint={`${Math.round(ops.evacuation.last_s.p10)}–${Math.round(ops.evacuation.last_s.p90)} s`} />
            </div>
            <p className="text-[13px] text-fg-2">With the nearest exit blocked and people indoors taking the long way out, the last person arrives after {Math.round(ops.evacuation_blocked.last_s.median)} s ({Math.round(ops.evacuation_blocked.last_s.p10)}–{Math.round(ops.evacuation_blocked.last_s.p90)} s). Both are best cases: no smoke, no crowding at doors, nobody missing.</p>
          </Panel>
        </div>
        <p className="text-[13px] text-fg-2">
          Limits of these four, from the design review: a machine sent to check an alarm is assumed never to be wrong, in any weather or light. The gate is one guard and one lane with no appointment windows, and its "stopped" share is close to the assumed catch rate by construction, so the simulation adds the queueing cost, not the catch rate. Everything runs in daylight. The site is notional and the barrier delays are placeholders, so none of this describes a real facility.
        </p>
        <h3 className="mt-2 text-[15px] font-medium">{sim.horizon.days} days of equipment use</h3>
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-[14px]">
            <thead><tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">
              <th className="p-3 font-normal">Equipment</th><th className="p-3 text-right font-normal">Distance</th><th className="p-3 text-right font-normal">Charge cycles</th>
              <th className="p-3 text-right font-normal">Capacity left</th><th className="p-3 text-right font-normal">Available</th>
            </tr></thead>
            <tbody>
              {Object.entries(sim.horizon.agents).map(([id, a]) => (
                <tr key={id} className="border-b border-line last:border-0">
                  <td className="p-3">{a.label}</td>
                  <td className="num p-3 text-right font-mono">{(a.distance_m / 1000).toFixed(0)} km</td>
                  <td className="num p-3 text-right font-mono">{a.capacity_fraction === null ? "–" : a.cycles}</td>
                  <td className="num p-3 text-right font-mono">{a.capacity_fraction === null ? "–" : `${(a.capacity_fraction * 100).toFixed(1)}%`}</td>
                  <td className="num p-3 text-right font-mono">{a.availability === null ? "–" : `${(a.availability * 100).toFixed(1)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <p className="text-[13px] text-fg-2">
          The same engine ran {sim.horizon.days} days of patrols in {sim.horizon.events.toLocaleString("en")} events: time is integer milliseconds and nothing is stepped while nothing happens. "Available" is the share of time not on the charger. A guard here is a post that is always staffed, so its distance is what several people on shifts walk between them.
          {" "}What is assumed, not measured: equipment figures are round class numbers (drone {kinds.drone!.battery_wh} Wh at {kinds.drone!.move_w} W, dog {kinds.dog!.battery_wh} Wh at {kinds.dog!.move_w} W), capacity fades {(sim.assumptions.fade_per_cycle * 100).toFixed(2)}% per cycle, sight ends after {sim.assumptions.foliage_path_limit_m} m of foliage, and off-path walking is {sim.assumptions.off_path_speed_factor} of path speed. Agents are moving points with real route and sight geometry: no flight controller, gait or camera model yet.
        </p>
        <p className="text-[13px] text-fg-2">
          Measured about the path network the agents use: {sim.graph.nodes.toLocaleString("en")} nodes, {(sim.graph.foot.main_fraction * 100).toFixed(1)}% of walkable and {(sim.graph.drive.main_fraction * 100).toFixed(1)}% of drivable nodes in one connected piece ({sim.graph.foot.components} and {sim.graph.drive.components} pieces in all), {sim.graph.edges_dropped_inside_buildings} path segments dropped because they run through a measured building. Grid metres differ from true metres by at most {sim.frame_distortion_ppm} parts per million across the site.
        </p>
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-[14px]">
            <tbody>
              {SIM_INVARIANTS.map((v) => (
                <tr key={v.rule} className="border-b border-line align-top last:border-0">
                  <td className="w-[120px] p-3 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">{v.group}</td>
                  <td className="p-3">{v.rule}<div className="text-[12.5px] text-fg-3">{v.why}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </Section>

      <Section eyebrow="Camera coverage" title="What the cameras can and cannot see"
        description="For every 2 m of fence line, yard and a 30 m band outside the fence: does a camera reach the pixel density needed to detect a person there (IEC 62676-4, 25 px/m: about 38 m for a 1080p camera with a 90 degree lens, 77 m for 4K), inside its field of view, with a clear line of sight over the measured terrain, buildings and tree canopy? The same test the drills use. It shows where a camera could detect someone in daylight, not whether an operator would notice.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {COVERAGE.map(([id, caption]) => (
            <figure key={id} className="m-0 grid content-start gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${BASE}/report/coverage-${id}.png`} alt={`Camera coverage map, ${caption.toLowerCase()}: fence line ${(cov[id]!.fence.seen_share * 100).toFixed(0)}% seen, yard ${(cov[id]!.yard.seen_share * 100).toFixed(0)}% seen`} className="w-full border border-line" loading="lazy" />
              <figcaption className="text-[13px] text-fg-2">{caption}</figcaption>
            </figure>
          ))}
        </div>
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-[14px]">
            <thead><tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">
              <th className="p-3 font-normal">Layout</th><th className="p-3 text-right font-normal">Cameras</th><th className="p-3 text-right font-normal">Fence line seen</th>
              <th className="p-3 text-right font-normal">Fence not seen</th><th className="p-3 text-right font-normal">Yard seen</th><th className="p-3 text-right font-normal">30 m outside seen</th>
            </tr></thead>
            <tbody>
              {COVERAGE.map(([id, caption]) => (
                <tr key={id} className="border-b border-line last:border-0">
                  <td className="p-3">{caption}</td><td className="num p-3 text-right font-mono">{cov[id]!.masts}</td>
                  <td className="num p-3 text-right font-mono">{(cov[id]!.fence.seen_share * 100).toFixed(0)}%</td>
                  <td className="num p-3 text-right font-mono">{cov[id]!.fence.blind_m.toFixed(0)} m</td>
                  <td className="num p-3 text-right font-mono">{(cov[id]!.yard.seen_share * 100).toFixed(0)}%</td>
                  <td className="num p-3 text-right font-mono">{(cov[id]!.band.seen_share * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <p className="text-[13px] text-fg-2">The compound was first laid out with each corner camera looking diagonally outward, which watches the fields and leaves the fence itself unwatched. Turned to look along the fence, each toward the next corner (the usual perimeter layout), the same four cameras cover {pc(cov["re-aimed-masts"]!.fence.seen_share)} of the fence line; with 4K cameras on the same masts, {pc(cov["4k-masts"]!.fence.seen_share)}. A camera only detects a person where it has enough pixels on them, so resolution limits a long fence as much as aim does. <a href={`${BASE}/report/site-assessment.pdf`} className="text-accent underline">Download the site assessment report (PDF)</a>.</p>
      </Section>

      <Section eyebrow="ORION · what to do first" title="Improvements, measured then ranked"
        description={`The drills point at gaps. Each candidate improvement is first run in the simulation on the hardest case found (${measures.drill.toLowerCase()}, ${measures.seeds} seeds, each starting at a random time ${measures.intrusion_window_s[0] / 3600} to ${measures.intrusion_window_s[1] / 3600} hours into the shift so equipment is met charging or mid-patrol; the same seeds and times as the baseline), and only then given to ORION, the decision engine, with those numbers as its evidence. Rates carry exact 95% intervals; improvements the paired runs cannot tell apart are marked tied, and between them the order rests on cost and ORION's judgment. ORION ranks; it does not invent the evidence.`}>
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-[14px]">
            <thead><tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">
              <th className="p-3 font-normal">Measured on the hard case</th><th className="p-3 text-right font-normal">Met in time</th><th className="p-3 text-right font-normal">95% interval</th><th className="p-3 font-normal">Tied with</th>
            </tr></thead>
            <tbody>
              {Object.entries(measures.measures).map(([id, x]) => (
                <tr key={id} className="border-b border-line align-top last:border-0">
                  <td className="p-3">{x.label}</td>
                  <td className="num p-3 text-right font-mono">{x.met_in_time}/{x.runs}</td>
                  <td className="num p-3 text-right font-mono">{pc(x.met_in_time_ci.lo)} to {pc(x.met_in_time_ci.hi)}</td>
                  <td className="p-3 text-[12.5px] text-fg-2">{x.tied_with.map((o) => measures.measures[o]?.label ?? o).join("; ") || "none"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[14px]">
            <thead><tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">
              <th className="p-3 font-normal">#</th><th className="p-3 font-normal">Improvement and the evidence ORION was given</th><th className="p-3 text-right font-normal">Rough cost</th>
              <th className="p-3 text-right font-normal">Chance it is first</th><th className="p-3 font-normal">ORION's reading</th>
            </tr></thead>
            <tbody>
              {orion.rows.map((o) => (
                <tr key={o.id} className="border-b border-line align-top last:border-0">
                  <td className="num p-3 font-mono text-[18px] font-medium">{o.rank}</td>
                  <td className="p-3"><div className="font-medium">{o.label}</div><div className="text-[12.5px] text-fg-2">{o.evidence}</div></td>
                  <td className="num p-3 text-right font-mono text-[12.5px]">{costText(measures.measures[o.id]?.cost)}</td>
                  <td className="num p-3 text-right font-mono">{(o.pFirst * 100).toFixed(0)}%</td>
                  <td className="p-3 font-mono text-[11.5px] text-fg-2">{o.eisenhower.replaceAll("_", " ")}<br />{o.effort.replaceAll("_", " ")}<br />{o.door.replaceAll("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <p className="text-[13px] text-fg-2">
          Agreement between ORION's five ranking methods: {orion.agreement.toFixed(2)} (1 is identical orders). Baseline on this drill: met in time {measures.measures.baseline!.met_in_time}/{measures.measures.baseline!.runs}.
          {" "}{orion.note} Model {orion.model}; evidence digest {orion.context_sha256.slice(0, 12)}.
        </p>
      </Section>

      <Section eyebrow="How real is it" title="Terrain error per square kilometre"
        description={`The rendered ${r.grid.leaf_step_m} m mesh compared with every 0.5 m pixel of the source terrain (${(r.terrain.tiles.reduce((s, t) => s + t.pixels, 0) / 1e6).toFixed(0)} million points). The error is concentrated on the valley's near-vertical walls, where a 4 m grid cannot follow a 300 m drop. North is up.`}>
        <Panel className="overflow-x-auto p-4">
          <div className="grid min-w-[480px] gap-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
            {Array.from({ length: n }, (_, row) => n - 1 - row).flatMap((j) => Array.from({ length: n }, (_, i) => {
              const t = tiles.get(`${i}_${j}`)!;
              return (
                <div key={`${i}_${j}`} className="grid gap-0.5 border border-line p-2.5">
                  <span className="num font-mono text-[18px] font-medium">{t.rmse_m.toFixed(2)} m</span>
                  <span className="font-mono text-[10.5px] text-fg-3">99% within {t.p99_m.toFixed(1)} m</span>
                  <span className="font-mono text-[10.5px] text-fg-3">worst {t.max_m.toFixed(0)} m</span>
                </div>
              );
            }))}
          </div>
        </Panel>
        <p className="text-[13px] text-fg-2">
          Buildings: all {r.buildings.closed_solids.toLocaleString("en")} solids are closed (watertight). The source winds them inward, so {r.buildings.winding_flipped.toLocaleString("en")} were flipped to face outward.
          {" "}They reach {r.buildings.embed_m.median} m below ground (middle 90%: {r.buildings.embed_m.p5}–{r.buildings.embed_m.p95} m) by swisstopo design, so only {r.buildings.skirted} needed a skirt to meet the coarse mesh.
          {" "}{r.buildings.dropped.outside_site ?? 0} of the {r.buildings.input.toLocaleString("en")} source buildings lie outside the site and were left out; none was lost for any other reason.
          {" "}Vertical datum: {r.frame.vertical_method.split(" + ").slice(0, 3).join(" + ")}.
        </p>
      </Section>

      <Section eyebrow="Provenance" title="What is measured and what is assumed"
        description="Each value carries a method. Measured beats tagged beats inferred beats a class default, and a lower method can never overwrite a higher one. Milestone 2 adds deduced buildings and scores them against the measured roofs, which stay hidden from the deduction code.">
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-[14px]">
            <thead><tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">
              <th className="p-3 font-normal">Layer</th><th className="p-3 font-normal">Source</th>
              {METHODS.map((m) => <th key={m} className="p-3 text-right font-normal">{m}</th>)}
            </tr></thead>
            <tbody>
              {Object.entries(r.coverage).map(([layer, c]) => (
                <tr key={layer} className="border-b border-line last:border-0">
                  <td className="p-3">{LAYER_LABEL[layer] ?? layer}</td>
                  <td className="p-3 text-fg-2">{LAYER_SOURCE[layer] ?? "–"}</td>
                  {METHODS.map((m) => <td key={m} className="num p-3 text-right font-mono">{c[m] ? c[m].toLocaleString("en") : "–"}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <p className="text-[13px] text-fg-2">Most OSM ways carry no width tag, so their width is a class default with confidence 0.3. That is the first gap the deduction engine will close: real road edges are visible in the 10 cm imagery.</p>
      </Section>

      <Section eyebrow="Invariants" title="Rules the world must keep"
        description="Tested before features, with property-based tests on synthetic terrain that includes a 300 m cliff. The build also checks the seam and floating-building rules on the real data and records the results above.">
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-[14px]">
            <tbody>
              {INVARIANTS.map((v) => (
                <tr key={v.rule} className="border-b border-line align-top last:border-0">
                  <td className="w-[120px] p-3 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">{v.group}</td>
                  <td className="p-3">{v.rule}<div className="text-[12.5px] text-fg-3">{v.why}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </Section>

      <Section eyebrow="Sites" title="Swiss site built, US site next"
        description="The same pipeline runs per site. Data-rich sites come first because they bring their own ground truth.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Panel className="grid content-start gap-2 p-5">
            <div className="flex items-center justify-between"><span className="text-[16px] font-medium">Lauterbrunnen, CH</span><span className="tag">Built</span></div>
            <p className="text-[13.5px] text-fg-2">{r.site.notes} LV95 {r.site.bounds.slice(0, 2).join(", ")}, {r.site.size_m / 1000} × {r.site.size_m / 1000} km.</p>
            <p className="font-mono text-[11px] text-fg-3">{r.sources.length} source files · {totalMB.toFixed(0)} MB · sha256 for each recorded</p>
          </Panel>
          <Panel className="grid content-start gap-2 p-5">
            <div className="flex items-center justify-between"><span className="text-[16px] font-medium">Boulder foothills, US</span><span className="tag">Next</span></div>
            <p className="text-[13.5px] text-fg-2">Flatirons, Chautauqua, Boulder Canyon and the west Boulder town grid. UTM 13N, 4 × 4 km. Sources checked on 22 Nov 2026 through the USGS National Map API: DRCOG 2020 classified lidar (37 tiles), USGS 1 m DEM, NAIP imagery, OSM and Overture buildings.</p>
            <p className="font-mono text-[11px] text-fg-3">No open LoD2 in the US: lidar building points serve as the held-out truth instead.</p>
          </Panel>
        </div>
      </Section>
    </>
  );
}
