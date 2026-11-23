// ORION ranking of site improvements, on evidence measured in the sim.
// Run from ~/orion after `archworld sim` and `archworld measures` (Bun loads TYPESAFE_API_KEY from .env; never printed):
//   cd ~/orion && bun /home/chris/archymedes-defense/plans/20261122-synthetic-world/orion_site.ts
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { prioritizeWithJev, PrioritizeRequestSchema } from "/home/chris/orion/server/prioritize.ts";
import { prioritize } from "/home/chris/orion/src/decision-engine/prioritize.ts";
import { JEV_MODEL } from "/home/chris/orion/server/typesafe.ts";

const root = "/home/chris/archymedes-defense";
const site = "ch-lauterbrunnen";
const sim = JSON.parse(readFileSync(`${root}/web/lib/data/world-sim-${site}.json`, "utf8"));
const ms = JSON.parse(readFileSync(`${root}/web/lib/data/world-measures-${site}.json`, "utf8"));
const cov = JSON.parse(readFileSync(`${root}/web/lib/data/world-coverage-${site}.json`, "utf8")).variants;
const ops = sim.operations, m = ms.measures, base = m.baseline;
const money = (n: number) => "USD " + n.toLocaleString("en");
const usd = (r: number[]) => (r[1] === 0 ? "nothing" : r[0] === r[1] ? money(r[1]) : `${money(r[0])} to ${money(r[1])}`);
const cost = (id: string) => { const c = m[id].cost; return `Cost: ${usd(c.one_off_usd)} once, ${usd(c.per_year_usd)} a year (${c.basis}).`; };
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const seen = (id: string) => `Cameras see ${pct(cov[id].fence.seen_share)} of the fence line and ${pct(cov[id].yard.seen_share)} of the yard (now ${pct(cov.baseline.fence.seen_share)} and ${pct(cov.baseline.yard.seen_share)}).`;
const ci = (c: { lo: number; hi: number }) => `95% interval ${pct(c.lo)}-${pct(c.hi)}`;
const share = (x: { met_in_time: number; runs: number; met_in_time_ci: { lo: number; hi: number } }) =>
  `${x.met_in_time}/${x.runs} (${ci(x.met_in_time_ci)})`;
const tied = (id: string) => (m[id].tied_with.length
  ? ` The paired runs cannot tell this apart from: ${m[id].tied_with.map((o: string) => m[o].label).join("; ")}.` : "");
const med = (q: { median: number } | null) => (q ? `${Math.round(q.median)} s` : "n/a");
const alarms = Object.fromEntries(ops.alarms.map((a: any) => [a.policy, a]));
const gate = Object.fromEntries(ops.gate.map((g: any) => [g.procedure, g]));
const coupled = Object.fromEntries(ops.coupled.map((c: any) => [c.policy, c]));
const worst = [...ops.sweep].filter((s: any) => s.walkable).sort((a: any, b: any) => a.interrupted - b.interrupted)[0];

// One line of measured evidence per option: the page shows exactly what ORION was given.
const drill = (id: string) => `Hard case (drone camera and fence sensor out, intrusion at a random time across equipment charge cycles): intruder met in time ${share(m[id])} (now ${share(base)}), detected after ${med(m[id].time_to_detect_s)} (now ${med(base.time_to_detect_s)}).${tied(id)}`;
const options = [
  { id: "re-aimed-masts", label: "Re-aim the four corner cameras to look along the fence",
    evidence: `${seen("re-aimed-masts")} ${drill("re-aimed-masts")} ${cost("re-aimed-masts")}` },
  { id: "4k-masts", label: "Fit 4K cameras to the corner masts, aimed along the fence",
    evidence: `${seen("4k-masts")} ${drill("4k-masts")} ${cost("4k-masts")}` },
  { id: "mid-masts", label: "Add camera masts at the middle of both long sides",
    evidence: `${seen("mid-masts")} ${drill("mid-masts")} ${cost("mid-masts")}` },
  { id: "second-drone", label: "Add a second drone on the patrol circuit",
    evidence: `${drill("second-drone")} A drone is available ${pct(m["second-drone"].drone_cover.share_with_a_drone_available)} of the time (now ${pct(base.drone_cover.share_with_a_drone_available)}). ${cost("second-drone")}` },
  { id: "second-guard", label: "Add a second guard on foot patrol",
    evidence: `${drill("second-guard")} ${cost("second-guard")}` },
  { id: "verify-first", label: "Check fence alarms by drone or robot dog before sending guards",
    evidence: `Over ${alarms.verify_first.days} days and ${alarms.verify_first.alarms} nuisance alarms: guards sent ${alarms.verify_first.guard_dispatches} times and ${alarms.verify_first.guard_hours_on_alarms} guard hours (${alarms.all_respond.guard_dispatches} times and ${alarms.all_respond.guard_hours_on_alarms} hours when everyone responds). Intrusion during a nuisance alarm met in time ${coupled.verify_first.interrupted}/${coupled.verify_first.runs} (${coupled.all_respond.interrupted}/${coupled.all_respond.runs} when everyone responds). ${alarms.verify_first.unverified} alarms found no machine free. Cost: none; saves about ${Math.round(alarms.all_respond.guard_hours_on_alarms - alarms.verify_first.guard_hours_on_alarms)} guard hours a month.` },
  { id: "callback", label: "Confirm every pickup by phone at the gate before admitting",
    evidence: `Fictitious pickup stopped in ${gate.callback.stopped}/${gate.callback.runs} shifts (${gate.paper.stopped}/${gate.paper.runs} with a paper check); mean wait ${(gate.callback.mean_wait_s.median / 60).toFixed(0)} min (${(gate.paper.mean_wait_s.median / 60).toFixed(0)} min); longest wait ${(gate.callback.max_wait_s.median / 60).toFixed(0)} min (${(gate.paper.max_wait_s.median / 60).toFixed(0)} min). The catch rates (${ops.assumptions.p_catch.callback} against ${ops.assumptions.p_catch.paper}) are assumed, not measured. Cost: no equipment; the gate guard's time and the drivers' waiting.` },
];
const context = [
  "A synthetic warehouse compound (140 x 100 m, fenced, one gate) on real terrain, simulated: two guards, a robot dog, a patrol vehicle, one drone, four corner camera masts. Guards and machines observe, detect, report and go to meet a person; no force. The site is notional. Goal: decide which improvement to make first. Evidence below is measured in the simulation over 40 seeded runs each; equipment figures and barrier delays are assumptions. Costs are public price ranges, rough and mostly from vendors.",
  `Findings: with all sensors working an intruder is met before finishing in ${ops.timeline[0].interrupted}/${ops.timeline[0].runs} runs; with the drone camera out in ${ops.timeline[1].interrupted}/${ops.timeline[1].runs}. The four corner cameras face outward and see only ${pct(cov.baseline.fence.seen_share)} of the fence line. Weakest direction with the drone out: ${worst.bearing_deg} degrees, met in time ${worst.interrupted}/${worst.runs}. The single drone is on its charger about half the time.`,
  ...options.map((o) => `- ${o.label}: ${o.evidence}`),
].join("\n");

const req = PrioritizeRequestSchema.parse({ context: context.slice(0, 4000), options: options.map(({ id, label }) => ({ id, label: label.slice(0, 80) })) });
const apiKey = process.env.TYPESAFE_API_KEY; if (!apiKey) throw new Error("TYPESAFE_API_KEY not loaded");
const result = prioritize(await prioritizeWithJev(req, { apiKey, timeoutMs: 60_000 })) as any;
const byId = Object.fromEntries(options.map((o) => [o.id, o]));
const rows = (result.rows as any[]).sort((a, b) => a.rank - b.rank).map((r) => ({
  rank: r.rank, id: r.optionId, label: byId[r.optionId].label, evidence: byId[r.optionId].evidence, pFirst: +r.pFirst.toFixed(3),
  eisenhower: r.eisenhower, effort: r.effortMatrix, door: r.door,
  level: Object.fromEntries(Object.entries(r.level).map(([k, v]) => [k, +(v as number).toFixed(3)])) }));
const out = {
  site, engine: "ORION (Borda over RICE, ICE, WSJF, leverage, Eisenhower; judgments by Jev)", model: JEV_MODEL,
  agreement: +(result.kendallW ?? result.agreement ?? 0).toFixed(3), rows,
  context_sha256: createHash("sha256").update(context).digest("hex"), context_chars: context.length,
  evidence_from: { sim_digest: sim.horizon.digest, seeds: ms.seeds },
  note: "Advisory. ORION ranks on the measured evidence above; the costs are rough public price ranges, and the evidence rests on the simulation's stated assumptions.",
};
writeFileSync(`${root}/web/lib/data/world-orion-${site}.json`, JSON.stringify(out, null, 1) + "\n");
writeFileSync(`${root}/plans/20261122-synthetic-world/orion-site.json`, JSON.stringify({ ...out, context }, null, 1) + "\n");
console.log(JSON.stringify({ W: out.agreement, order: rows.map((r) => `${r.rank}:${r.id}(${r.pFirst}) ${r.eisenhower} ${r.effort} ${r.door}`) }));
