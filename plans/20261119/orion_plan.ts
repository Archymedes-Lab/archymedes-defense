// ORION ranking of the build steps for the two chosen projects. Run from ~/orion (loads TYPESAFE_API_KEY from .env).
import { writeFileSync } from "node:fs";
import { prioritizeWithJev, PrioritizeRequestSchema } from "/home/chris/orion/server/prioritize.ts";
import { prioritize } from "/home/chris/orion/src/decision-engine/prioritize.ts";

const context = `Archymedes (small defense-tech startup, software prototypes on public data, no customers yet) will build two defensive simulation
products step by step: (1) battery thermal-runaway propagation simulation for soldier, drone and vehicle packs; (2) soft body-armor
screening and ballistic test planning for armor makers and accredited test labs. Goal this quarter: credible, validated prototypes
that a pack maker or a test lab would pilot, then partner data that compounds. Literature: Feng 2016 3D propagation model; Lopez 2015
module propagation vs spacing; Battery Failure Databank 2024 (hundreds of abuse tests, fractional calorimetry; site currently
unreachable from our network); Nat Commun 2024 heat-release variability from 139 calorimetry tests; 2020 dense 18650 mitigation
(barriers slow but do not stop propagation). Armor: Phoenix-Porwal 2003 membrane V50 model; Cunniff dimensionless model; NIST 2020
links both to measured performance of aged armor; DoD 2014 shows three-phase optimal sequential designs and probit estimate V50 best;
NIJ 0101.07 (2023) changed tests. Existing app: Next.js with design system, login, battery-aging explorer.`;
const options = [
  { id: "b-model", label: "Battery: lumped cell-network propagation model with Monte Carlo heat release" },
  { id: "b-data", label: "Battery: obtain Battery Failure Databank and fit heat-release distributions" },
  { id: "b-validate", label: "Battery: reproduce published spacing and barrier propagation results" },
  { id: "b-ui", label: "Battery: interactive pack-layout designer page with 3D propagation replay" },
  { id: "a-model", label: "Armor: Cunniff and Phoenix-Porwal V50 screening model for soft armor" },
  { id: "a-planner", label: "Armor: Bayesian V50 test planner that cuts shots per lab test" },
  { id: "a-validate", label: "Armor: validate V50 predictions against published test data" },
  { id: "a-ui", label: "Armor: screening and test-planning page" },
];
const req = PrioritizeRequestSchema.parse({ context, options });
const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) throw new Error("TYPESAFE_API_KEY not loaded");
const result = prioritize(await prioritizeWithJev(req, { apiKey, timeoutMs: 40_000 })) as any;
const rows = (result.rows as any[]).sort((a, b) => a.rank - b.rank).map((r) => ({ rank: r.rank, id: r.optionId, pFirst: +r.pFirst.toFixed(3),
  eisenhower: r.eisenhower, effort: r.effortMatrix, door: r.door, ranks: r.ranks,
  level: Object.fromEntries(Object.entries(r.level).map(([k, v]) => [k, +(v as number).toFixed(2)])) }));
writeFileSync("/home/chris/archymedes-defense/plans/20261119/orion-plan.json", JSON.stringify({ W: result.kendallW ?? result.agreement, rows }, null, 1));
console.log(JSON.stringify({ W: result.kendallW ?? result.agreement, rows: rows.map((r) => [r.rank, r.id, r.pFirst, r.eisenhower, r.effort, r.level.impact, r.level.effort, r.level.leverage]) }));
