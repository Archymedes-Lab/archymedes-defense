// ORION ranking of the synthetic-world milestone order. Run from ~/orion (Bun loads TYPESAFE_API_KEY from .env; never printed).
import { readFileSync, writeFileSync } from "node:fs";
import { prioritizeWithJev, PrioritizeRequestSchema } from "/home/chris/orion/server/prioritize.ts";
import { prioritize } from "/home/chris/orion/src/decision-engine/prioritize.ts";
const dir = "/home/chris/archymedes-defense/plans/20261122-synthetic-world";
const context = readFileSync(`${dir}/context.txt`, "utf8");
const options = [
  { id: "m1-world", label: "Swiss tile as 3D Tiles: terrain, imagery, buildings, roads + provenance report" },
  { id: "m2-deduce", label: "Deduction engine for building heights/roofs, scored against hidden LoD2" },
  { id: "m3-simcore", label: "Deterministic headless sim core: clock, frames, collision, replay" },
  { id: "m4-agents", label: "Agents: PX4 SITL drone, Nav2 ground vehicle, MuJoCo quadruped" },
  { id: "m5-sensors", label: "Sensors (camera, lidar, GNSS denial, IMU) + ROS 2 bridge" },
  { id: "m6-missions", label: "Missions in one world: patrol, search and rescue, convoy" },
  { id: "m7-validate", label: "Realism report: lidar, imagery and flight-log error bands" },
  { id: "us-variant", label: "US Boulder tile through the same pipeline" },
];
const req = PrioritizeRequestSchema.parse({ context, options });
const apiKey = process.env.TYPESAFE_API_KEY; if (!apiKey) throw new Error("TYPESAFE_API_KEY not loaded");
const result = prioritize(await prioritizeWithJev(req, { apiKey, timeoutMs: 60_000 })) as any;
const rows = (result.rows as any[]).sort((a, b) => a.rank - b.rank).map((r) => ({ rank: r.rank, id: r.optionId, pFirst: +r.pFirst.toFixed(3),
  eisenhower: r.eisenhower, effort: r.effortMatrix, door: r.door, level: Object.fromEntries(Object.entries(r.level).map(([k, v]) => [k, +(v as number).toFixed(3)])) }));
const out = { W: result.kendallW ?? result.agreement, rows };
writeFileSync(`${dir}/orion.json`, JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify({ W: out.W, order: rows.map((r) => `${r.rank}:${r.id}(${r.pFirst}) ${r.eisenhower} ${r.effort} ${r.door}`) }));
