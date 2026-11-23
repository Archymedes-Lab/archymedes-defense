// Jev hazard review of the site-sim design (milestone 3): one narrow noul per hazard. Run from ~/orion (key from .env, never printed).
import { readFileSync, writeFileSync } from "node:fs";
import { systemOne, type SystemOneQuestion } from "/home/chris/orion/server/typesafe.ts";
const dir = "/home/chris/archymedes-defense/plans/20261122-synthetic-world";
const state = {
  context: readFileSync(`${dir}/context.txt`, "utf8"),
  design: [
    "Discrete-event simulation in Python on the built world. Time is integer milliseconds. Agents: person, guard, robot dog, ground vehicle, drone, fixed sensor mast. Guards and sensors observe, detect, report and respond by moving; no use of force is modelled.",
    "Motion is piecewise deterministic: a leg is a polyline with integer cumulative arrival times, so position at any time is closed-form interpolation. Ground agents follow the OSM road/path graph (time-optimal Dijkstra, slope-dependent speed: Tobler for people); drones fly straight lines with a terrain-following altitude envelope limited by climb rate.",
    "Detection is geometric: range, field of view, line of sight (terrain sampled every 2 m plus building footprints extruded to roof height), and a dwell time. Sensing ticks at 1 Hz run only while a drill subject is present.",
    "Energy is integer microjoules, settled at state changes; a leg starts only if the battery covers it plus the return home; charging adds a cycle and linear capacity fade. Long-horizon runs (30+ days) skip quiet time because nothing is stepped.",
    "Drills are scripted injected events (unknown person appears and walks a route, sensor fault, road blocked) in one event heap; a dispatcher sends the nearest available responders to the last reported position. Scores: detection time, response time, breach of a notional zone.",
    "Sim state lives in the national grid (LV95 east, north, LN02 height) and is converted to the tiles' ENU frame for replay files. Randomness: one seeded stream per agent. Replay = manifest + legs + event log, hashed.",
    "Invariants tested first: identical replay from a seed, no agent under terrain or inside a building, speed and slope limits, symmetric line of sight, no detection through buildings or ridges, energy never rises without a charge event, an injected event cannot affect anything before its time, forced extra sensing ticks do not change the result, payload whitelist (no weapon types).",
  ],
};
const hazards: Record<string, string> = {
  grid_vs_metric: "Running the sim in projected national-grid coordinates instead of a true metric frame distorts distances or speeds enough to matter over a 4 km site.",
  los_sampling: "Line of sight sampled every 2 m against a 4 m terrain mesh will miss thin obstacles or ridge crests and report false visibility.",
  no_vegetation: "Ignoring forest canopy in line of sight makes detection ranges in wooded terrain unrealistically optimistic.",
  osm_graph_gaps: "The OSM path graph has disconnected components or missing links, so routing fails or agents take absurd detours.",
  float_replay: "Floating-point math in routing or line of sight breaks bit-identical replay across machines or library versions.",
  rng_coupling: "Adding or removing one agent changes the random numbers other agents receive, making runs incomparable.",
  dwell_determinism: "A purely geometric dwell-time detection model overstates how reliably human guards and cameras detect people.",
  interrupt_teleport: "Re-tasking an agent in the middle of a leg causes a position jump or a speed-limit violation.",
  drone_cliff: "A straight-line terrain-following drone path over 300 m cliffs demands impossible climb rates or clips terrain.",
  quiet_skip: "Skipping sensing while no drill subject is present hides events that should have happened, so long-horizon results differ from full stepping.",
  off_road: "Restricting people and robot dogs to mapped paths misrepresents intruders, who would move cross-country.",
  dual_use: "A simulator that scores guard detection and response at a site could be used to plan how to evade guards at a real facility.",
};
const questions: Record<string, SystemOneQuestion> = Object.fromEntries(Object.entries(hazards).map(([k, v]) => [k, {
  type: "noul", instructions: `Given the design in the state, is this hazard real and likely to bite unless addressed? Hazard: ${v}` }]));
const r = await systemOne(state, questions, { timeoutMs: 60_000 });
const out = Object.fromEntries(Object.entries(r.answers).map(([k, a]: [string, any]) => [k, { p: +a.noul.toFixed(3), hazard: hazards[k] }]));
writeFileSync(`${dir}/jev-sim-review.json`, JSON.stringify({ model: r.model, answers: out }, null, 1) + "\n");
console.log(r.model, Object.entries(out).sort((a, b) => b[1].p - a[1].p).map(([k, v]) => `${k}=${v.p}`).join(" "));
