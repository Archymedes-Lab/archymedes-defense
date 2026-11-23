// Value review of the aerodynamics work: is each piece actually worth having, and why?
// Rerun after every change to the aero code (a test fails if a module in web/lib/aero is not covered by an item):
//   cd ~/orion && bun /home/chris/archymedes-defense/plans/20261120-aero/value_review.ts
// Bun loads TYPESAFE_API_KEY from ~/orion/.env; it is never printed.
//
// Three instruments, one fixed rule:
//  - Compass's judge (Jev): nine dimensions on a 0-4 scale, including DEFENSIBILITY (the moat score: how hard this
//    would be to copy) and QUALITY. The model gives beliefs over five described situations; the score is their mean.
//  - ORION's prioritisation: rank and chance of being first, from five ranking methods over Jev's ratings.
//  - ORION's aftermath: how the net effect plays out over time, with odds of going well, mixed or hard.
//  - The verdict is NOT the model's: it is the rule in `CRITERIA` below applied to the scores and to the evidence
//    counted in the repository (tests, validation against published data).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { DIMS, QUESTIONS } from "/home/chris/compass/src/dims.ts";
import { judge } from "/home/chris/compass/src/judge.ts";
import { prioritizeWithJev, PrioritizeRequestSchema } from "/home/chris/orion/server/prioritize.ts";
import { aftermath } from "/home/chris/orion/src/decision-engine/aftermath.ts";
import { prioritize } from "/home/chris/orion/src/decision-engine/prioritize.ts";
import { JEV_MODEL } from "/home/chris/orion/server/typesafe.ts";

const root = "/home/chris/archymedes-defense";
const data = (f: string) => JSON.parse(readFileSync(`${root}/web/lib/data/${f}`, "utf8"));
const val = data("aero-validation.json"), fl = data("aero-flight.json");
const tests = (f: string) => (readFileSync(`${root}/web/tests/${f}`, "utf8").match(/^\s*test\(/gm) ?? []).length;
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const trimRows = fl.trim.rows as { label: string; cl: number; error: number }[];

export const CRITERIA = {
  usefulMin: 2, moatMin: 2,
  text: {
    useful: "Useful: Jev's impact score is at least 2 of 4 (\"noticeably\" moves the goal).",
    moat: "Defensible: Jev's moat score is at least 2 of 4 (leaves something a competitor would need months to rebuild).",
    proven: "Proven: the repository holds tests for it, or it is validated against published data.",
    verdicts: "valuable = useful, defensible and proven · useful, easy to copy = useful and proven but not defensible · promising, unproven = useful, no evidence yet · low value = not useful · rejected on evidence = tried and measured worse or unidentified.",
  },
};

interface Item { id: string; title: string; label: string; detail: string; track: string; status: "done" | "rejected" | "next"; files: string[]; evidence: { tests: number; validated: boolean; line: string } }
const items: Item[] = [
  { id: "bands", title: "Lift estimates with measured error bands", label: "Vortex-lift engine with error bands measured on NASA wind-tunnel data",
    detail: "Vortex lattice plus the Polhamus suction analogy and a vortex-breakdown limit, with a band beside every estimate measured by leave-one-wing-out on 200 digitized NASA points. Misses are published.",
    track: "data_loop", status: "done", files: ["lib/aero/vlm.ts", "lib/aero/vortex.ts", "lib/aero/geometry.ts", "lib/aero/units.ts", "lib/aero/units.typecheck.ts", "lib/aero/error-model.ts", "lib/aero/predict.ts"],
    evidence: { tests: tests("aero.test.ts"), validated: true, line: `Held-out band coverage ${pct(val.coverage.widened)} on ${val.inDomain.length} wings; ${Object.values(val.criteria).filter((c: any) => c.pass).length} of 4 pre-registered criteria met, the misses shown.` } },
  { id: "flightval", title: "Checked against real F-106B flight and trim data", label: "Model checked against published F-106B flight and trim data, with elevon trim",
    detail: "Elevon lift and trim from the same lattice, a rounded-leading-edge blend, and a comparison with NASA's published F-106B trim table (absolute) and 27 flight points (shape), scored leave-one-flight-out.",
    track: "quality", status: "done", files: ["lib/aero/trim.ts", "lib/aero/flightdata.ts"],
    evidence: { tests: tests("aero-flight.test.ts"), validated: true, line: `Lift error at NASA's trim point ${pct(Math.abs(trimRows[0].error))} before, ${pct(Math.abs(trimRows[trimRows.length - 1].error))} after; elevon within ${fl.criteria.F2.value}°; held-out weight spread ${pct(fl.flight.heldOutCv)} (target 5%).` } },
  { id: "aircraft", title: "Real aircraft only, each tied to its NASA report", label: "Registry of real NASA research aircraft built only from published numbers",
    detail: "F/A-18 HARV, F-16XL-1 and F-106B: every dimension names the NASA table or figure it was read from; planforms are built from those numbers; no invented layouts.",
    track: "trust", status: "done", files: ["lib/aero/aircraft.ts"],
    evidence: { tests: tests("aero-aircraft.test.ts"), validated: true, line: "F-106B's published area, chord and aspect ratio are reproduced from its triangle within 0.1%; the F-16XL planform is 5% larger than the published wing area, and says so." } },
  { id: "unsteady", title: "Lift that lags in pitching motion", label: "Unsteady vortex lift (Goman-Khrabrov state-space model)",
    detail: "One state for the share of vortex lift present, relaxing with a time constant of the order reported for delta wings; exact stepping; reduces to the static polar.",
    track: "quality", status: "done", files: ["lib/aero/unsteady.ts"],
    evidence: { tests: 10, validated: false, line: "Reproduces the published linear frequency response to 3 decimals; the time constant is the reported order of magnitude, not identified for these aircraft." } },
  { id: "flightpath", title: "HARV flight path", label: "Longitudinal point-mass flight path of the HARV with published mass",
    detail: "Speed, flight-path angle and height under prescribed angle of attack and thrust, standard atmosphere, NASA's published weight.",
    track: "quality", status: "done", files: ["lib/aero/flight.ts"],
    evidence: { tests: 13, validated: false, line: "Energy conserved to 1e-7 without drag or thrust; trim holds level; not compared with flight records." } },
  { id: "geometry", title: "HARV rebuilt as a closed solid", label: "HARV 3D geometry as closed, checked solids with smooth curves",
    detail: "Monotone cubic curves through traced stations; every component a closed, oriented, welded 2-manifold; mesh checker tested on known and broken meshes.",
    track: "quality", status: "done", files: ["lib/aero/harv.ts", "lib/aero/harv-mesh.ts", "lib/aero/curves.ts", "lib/aero/mesh-check.ts"],
    evidence: { tests: tests("aero-geometry.test.ts"), validated: false, line: "Fuselage volume converges to the exact section integral; wing planform within 0.5% of the analytic trapezoid; outlines traced to ±0.3 ft, so no more accurate to the aircraft than its sources." } },
  { id: "ramp", title: "Gradual vortex-breakdown model", label: "Gradual vortex-breakdown lift model (tried, not adopted)",
    detail: "A smooth ramp of the burst share instead of a step. Lower error out of sample, but the fitted width ran to the edge of every range tried.",
    track: "quality", status: "rejected", files: [],
    evidence: { tests: 4, validated: true, line: "Pooled held-out error 0.121 → 0.104, but the parameter is not identified: kept as an option, default unchanged." } },
  { id: "next-data", title: "Next: measured lift curves for all three aircraft, and compressibility", label: "Digitise measured lift of all three aircraft and add compressibility",
    detail: "Digitise published wind-tunnel and flight lift curves for the F-16XL-1 and F-106B, add a compressibility correction, and bring the seven Mach 0.67-0.81 F-106B flight points into the comparison.",
    track: "data_loop", status: "next", files: [],
    evidence: { tests: 0, validated: false, line: "Not started. It would turn the flight comparison from one aircraft into three and from 27 points into 34." } },
];

const context = [
  "Archymedes Defense builds open-source engineering tools. This one estimates the lift of slender and delta-wing aircraft at high angles of attack and says how wrong it can be: every estimate carries an error band measured against published NASA data, and the model is compared with real aircraft (F/A-18 HARV, F-16XL-1, F-106B) using only NASA's published geometry, trim and flight tables.",
  "Vortex-lattice solvers are free and mature (OpenVSP, AVL, XFLR5); none ships an estimate with a measured error bar and a public record of where it misses. Users would be aircraft and drone designers, students and test engineers. The code is Apache-2.0 and public, so the code itself is easy to copy; what is harder to copy is the validation corpus, the pre-registered record of hits and misses, and the trust that comes from publishing misses.",
  "Scope: analysis and teaching with public research data. No weapons, stealth or manoeuvre optimisation. The team is small.",
].join(" ");

const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) throw new Error("TYPESAFE_API_KEY not loaded");
const mean = (p: number[]) => p.reduce((a, x, k) => a + k * x, 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

// 1. Compass judge: nine dimensions per item (moat = defensibility)
const judged = [];
for (const it of items) {
  const j = await judge({ title: it.title, detail: `${it.detail} Evidence: ${it.evidence.line}`, track: it.track }, context, apiKey);
  judged.push({ it, levels: Object.fromEntries(DIMS.map((d) => [d, r2(mean(j.dims[d]))])) as Record<string, number>, beliefs: j.dims, promptHash: j.promptHash });
  console.error(`judged ${it.id}: moat ${r2(mean(j.dims.defensibility))} impact ${r2(mean(j.dims.impact))}`);
}

// 2. ORION ranking
const req = PrioritizeRequestSchema.parse({ context: `${context} ${items.map((i) => `- ${i.label}: ${i.evidence.line}`).join(" ")}`.slice(0, 4000), options: items.map((i) => ({ id: i.id, label: i.label.slice(0, 80) })) });
const ranked = prioritize(await prioritizeWithJev(req, { apiKey, timeoutMs: 60_000 })) as any;
const rankOf = Object.fromEntries((ranked.rows as any[]).map((r) => [r.optionId, r]));

// 3. ORION aftermath: four factors from the judged levels; benefits on −10..10 around "somewhat" (2), effort as a cost
const factors = [
  { id: "useful", label: "Usefulness to engineers (impact)", weight: 0.35 },
  { id: "moat", label: "Moat: reputation and data that compound", weight: 0.35 },
  { id: "quality", label: "Quality people can rely on (trust, future)", weight: 0.2 },
  { id: "effort", label: "Effort and time spent", weight: 0.1 },
];
const picture = (lv: Record<string, number>, id: string, label: string) => {
  const option = { id, label, reversibility: Math.min(1, Math.max(0, lv.reversibility / 4)), outcomes: [{ id: "o", label: "as judged", probability: 1, probabilityConfidence: Math.min(1, Math.max(0.05, lv.confidence / 4)),
    factors: [{ factorId: "useful", value: (lv.impact - 2) * 5 }, { factorId: "moat", value: (lv.defensibility - 2) * 5 }, { factorId: "quality", value: (lv.quality - 2) * 5 }, { factorId: "effort", value: -lv.effort * 2.5 }] }] };
  const a = aftermath({ options: [option as any], factors: factors as any, optionId: id, mode: "serious", stakes: "significant", safety: "normal", signal: true });
  return (a?.steps ?? []).map((s) => ({ days: s.days, when: s.when, value: r2(s.value), well: s.odds.well, mixed: s.odds.mixed, hard: s.odds.hard, sign: s.sign }));
};

const verdictOf = (it: Item, lv: Record<string, number>) => {
  const useful = lv.impact >= CRITERIA.usefulMin, moat = lv.defensibility >= CRITERIA.moatMin, proven = it.evidence.tests > 0 || it.evidence.validated;
  return it.status === "rejected" ? "rejected on evidence" : useful && moat && proven ? "valuable" : useful && proven ? "useful, easy to copy" : useful ? "promising, unproven" : "low value";
};
const said = (dim: "impact" | "defensibility" | "quality", lv: number) => {
  const q = QUESTIONS[dim], k = Math.min(4, Math.max(0, Math.round(lv)));
  return `${lv.toFixed(1)} of 4, nearest to: "${(q.criteria ?? q.levels)[k]}"`;
};

const out = {
  generated: new Date().toISOString(), model: JEV_MODEL, engine: "Compass judge (moat, quality and ORION's seven dimensions; Jev beliefs over described situations) · ORION prioritisation (Borda over RICE, ICE, WSJF, leverage, Eisenhower) · ORION aftermath",
  criteria: { usefulMin: CRITERIA.usefulMin, moatMin: CRITERIA.moatMin, ...CRITERIA.text },
  agreement: r2(ranked.kendallW ?? ranked.agreement ?? 0),
  evidenceDigest: createHash("sha256").update(JSON.stringify(items.map((i) => [i.id, i.detail, i.evidence]))).digest("hex").slice(0, 16),
  note: "The scores are a model's judgment of the descriptions and evidence shown here; the verdict is the fixed rule applied to them. The context told the judge that the code is open source and easy to copy.",
  items: judged.map(({ it, levels }) => {
    const r = rankOf[it.id];
    return {
      id: it.id, title: it.title, detail: it.detail, status: it.status, files: it.files, evidence: it.evidence,
      levels: { impact: levels.impact, defensibility: levels.defensibility, quality: levels.quality, confidence: levels.confidence, effort: levels.effort, leverage: levels.leverage, urgency: levels.urgency, reach: levels.reach, reversibility: levels.reversibility },
      orion: { rank: r.rank as number, pFirst: r2(r.pFirst), eisenhower: r.eisenhower as string, effortMatrix: r.effortMatrix as string, door: r.door as string },
      verdict: verdictOf(it, levels),
      why: { useful: `Impact ${said("impact", levels.impact)}.`, moat: `Moat ${said("defensibility", levels.defensibility)}.`, quality: `Quality ${said("quality", levels.quality)}.`, evidence: it.evidence.line },
      aftermath: picture(levels, it.id, it.title),
    };
  }).sort((a, b) => a.orion.rank - b.orion.rank),
};
writeFileSync(`${root}/web/lib/data/aero-value.json`, JSON.stringify(out, null, 1) + "\n");
writeFileSync(`${root}/plans/20261120-aero/value-review.json`, JSON.stringify({ ...out, beliefs: Object.fromEntries(judged.map((j) => [j.it.id, j.beliefs])) }, null, 1) + "\n");
console.log(JSON.stringify({ W: out.agreement, items: out.items.map((i) => `${i.orion.rank}:${i.id} ${i.verdict} moat ${i.levels.defensibility} impact ${i.levels.impact} q ${i.levels.quality}`) }));
