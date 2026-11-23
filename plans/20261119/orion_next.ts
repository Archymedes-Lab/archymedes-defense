// ORION ranking of next steps after battery milestones 1-5 and armor milestones 1-2. Run from ~/orion.
import { writeFileSync } from "node:fs";
import { prioritizeWithJev, PrioritizeRequestSchema } from "/home/chris/orion/server/prioritize.ts";
import { prioritize } from "/home/chris/orion/src/decision-engine/prioritize.ts";
const context = `Archymedes builds defensive simulation prototypes for pack makers and armor labs (no customers yet). State:
Battery thermal-runaway propagation model (lumped cells, Battery Failure Databank heat draws, 3 parameters calibrated to Lopez 2015
and Lee 2020). Held-out validation: 5 mm gap partial; ceramic barrier MISS (model says stops, experiment only slowed 30x: optimistic,
unsafe direction); variability MISS (model propagates in 60% of runs, experiments 100%); critical temperature sits on its 110 C bound;
interior trigger cells propagate less in the model, untested. Armor screening + V50 planner live; not yet validated on NIST raw data
(repository down). Exa research credits exhausted; OpenAlex works. Goal next month: a prototype a pack maker or test lab would pilot.`;
const options = [
  { id: "barrier", label: "Battery: hot-gas bypass and barrier heat capacity to fix optimistic barriers" },
  { id: "kinetics", label: "Battery: Arrhenius self-heating from ARC data instead of a critical temperature" },
  { id: "variability", label: "Battery: explain and fix 60% vs 100% propagation in dense arrays" },
  { id: "more-data", label: "Battery: add more published propagation experiments for validation" },
  { id: "armor-data", label: "Armor: validate on NIST aged-armor V50 data when the repository returns" },
  { id: "pilot", label: "Draft a pilot offer and outreach list for pack makers and test labs" },
  { id: "exa", label: "Restore Exa credits for broader research" },
];
const req = PrioritizeRequestSchema.parse({ context, options });
const apiKey = process.env.TYPESAFE_API_KEY; if (!apiKey) throw new Error("no key");
const result = prioritize(await prioritizeWithJev(req, { apiKey, timeoutMs: 40_000 })) as any;
const rows = (result.rows as any[]).sort((a, b) => a.rank - b.rank).map((r) => ({ rank: r.rank, id: r.optionId, pFirst: +r.pFirst.toFixed(3), eisenhower: r.eisenhower, effort: r.effortMatrix }));
writeFileSync("/home/chris/archymedes-defense/plans/20261119/orion-next.json", JSON.stringify({ W: result.kendallW ?? result.agreement, rows }, null, 1));
console.log(JSON.stringify({ W: result.kendallW ?? result.agreement, rows }));
