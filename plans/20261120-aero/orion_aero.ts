// ORION ranking of aerodynamics project directions. Run from ~/orion (Bun loads TYPESAFE_API_KEY from .env; never printed).
import { readFileSync, writeFileSync } from "node:fs";
import { prioritizeWithJev, PrioritizeRequestSchema } from "/home/chris/orion/server/prioritize.ts";
import { prioritize } from "/home/chris/orion/src/decision-engine/prioritize.ts";
const dir = "/home/chris/archymedes-defense/plans/20261120-aero";
const context = readFileSync(`${dir}/context.txt`, "utf8");
const options = [
  { id: "vortex-lift", label: "Vortex-lift and high-AoA aero estimator validated on public NASA data" },
  { id: "uq-aero", label: "Low-fidelity aero with calibrated error bars from a public validation corpus" },
  { id: "uav-sysid", label: "Fixed-wing drone aero model identified from PX4/ArduPilot flight logs" },
  { id: "tunnel-plan", label: "Wind-tunnel test planner: fewer runs via Bayesian design and physics prior" },
  { id: "multifi", label: "Multi-fidelity aero database: vortex lattice corrected by sparse CFD runs" },
];
const req = PrioritizeRequestSchema.parse({ context, options });
const apiKey = process.env.TYPESAFE_API_KEY; if (!apiKey) throw new Error("TYPESAFE_API_KEY not loaded");
const result = prioritize(await prioritizeWithJev(req, { apiKey, timeoutMs: 40_000 })) as any;
const rows = (result.rows as any[]).sort((a, b) => a.rank - b.rank).map((r) => ({ rank: r.rank, id: r.optionId, pFirst: +r.pFirst.toFixed(3),
  eisenhower: r.eisenhower, effort: r.effortMatrix, door: r.door, level: Object.fromEntries(Object.entries(r.level).map(([k, v]) => [k, +(v as number).toFixed(3)])) }));
const out = { W: result.kendallW ?? result.agreement, rows };
writeFileSync(`${dir}/orion.json`, JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify({ W: out.W, order: rows.map((r) => `${r.rank}:${r.id}(${r.pFirst}) ${r.eisenhower}`) }));
