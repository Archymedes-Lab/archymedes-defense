// Jev hazard review of the further site operations (ops.py): one narrow noul per hazard. Run from ~/orion (key from .env, never printed).
import { readFileSync, writeFileSync } from "node:fs";
import { systemOne, type SystemOneQuestion } from "/home/chris/orion/server/typesafe.ts";
const dir = "/home/chris/archymedes-defense/plans/20261122-synthetic-world";
const state = {
  context: readFileSync(`${dir}/context.txt`, "utf8"),
  design: [
    "Four operations added to a deterministic discrete-event site sim of a synthetic warehouse compound on real terrain. Guards, a robot dog, a drone, a patrol vehicle and camera masts observe, detect, report and move to meet; no force is modelled.",
    "Protection timeline: an unknown person walks in, crosses the fence (30 s assumed delay), walks to a door and works on it (90 s assumed), then the task counts as complete. A fence sensor alarms with probability 0.95; a camera mast that covers the spot confirms 20 s later. Result: share of 40 seeded runs in which a responder meets the person before the task is complete.",
    "Alarm handling: nuisance fence alarms arrive as a Poisson process (3 per day). Policy A sends a drone or robot dog to look first and guards stay at their posts; policy B sends two responders and the drone to every alarm. Result over 30 days: guard hours and dispatches, drone hours.",
    "Gate: trucks arrive as a Poisson process (4 per hour) over a 10 hour shift, queue first-come-first-served, and are checked one at a time by the gate guard (5 to 10 minutes; call-back verification adds 2 to 5 minutes). One truck has a fictitious booking, caught with assumed probability 0.35 by paper check and 0.95 by call-back. Result: share stopped, waiting times, queue length.",
    "Evacuation: 12 workers, half indoors, start after individual lognormal pre-movement delays (median 30 s) and walk to a muster point near the gate. Result: time until the last person is there.",
    "All assumed parameters are listed next to the results and labelled as assumptions. The compound is declared notional.",
  ],
};
const hazards: Record<string, string> = {
  assumed_delays: "Reporting a share of runs 'met in time' built on assumed fence and door delay times will be read as a real protection level although it mostly reflects the assumed numbers.",
  single_path: "Evaluating only one approach path and one target door overstates protection, because physical-protection practice evaluates the weakest path.",
  catch_rate: "The gate result is circular: the share of fictitious pickups stopped is essentially the assumed catch probability, so the simulation adds nothing but the queueing cost.",
  mm1_queue: "A single-guard first-come-first-served gate with uniform service times misses real effects such as appointment windows, bunching of arrivals and a second lane, so queue figures are unrealistic.",
  nuisance_only: "Comparing alarm policies on nuisance alarms alone hides the real risk of verify-first: slower response when the alarm is a real intrusion.",
  verifier_reliability: "Assuming a drone or robot dog always correctly clears a nuisance alarm ignores verification errors in wind, rain, darkness or foliage.",
  evac_no_fire: "An evacuation model without a hazard, blocked exits, crowding at doors or missing persons gives only a best-case muster time.",
  guard_coupling: "Operations run separately miss their coupling: a guard at a gate check or on an alarm is not available for an intrusion at the same time.",
  no_night: "Running every operation in daylight with full sensor ranges misses the hours when most warehouse burglaries happen.",
  dual_use_timeline: "Publishing a protection timeline with barrier delays and the share of runs not met in time could help someone plan an intrusion at a real facility.",
};
const questions: Record<string, SystemOneQuestion> = Object.fromEntries(Object.entries(hazards).map(([k, v]) => [k, {
  type: "noul", instructions: `Given the design in the state, is this hazard real and likely to bite unless addressed? Hazard: ${v}` }]));
const r = await systemOne(state, questions, { timeoutMs: 60_000 });
const out = Object.fromEntries(Object.entries(r.answers).map(([k, a]: [string, any]) => [k, { p: +a.noul.toFixed(3), hazard: hazards[k] }]));
writeFileSync(`${dir}/jev-ops-review.json`, JSON.stringify({ model: r.model, answers: out }, null, 1) + "\n");
console.log(r.model, Object.entries(out).sort((a, b) => b[1].p - a[1].p).map(([k, v]) => `${k}=${v.p}`).join(" "));
