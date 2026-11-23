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

// Dependencies (`requires`) are stated for what an item cannot run without: the aircraft registry feeds planforms to
// the engine; measured aircraft lift can only be compared with a trimmed model, so the lift-curve work needs the
// engine, the registry and the trim model. A report needs nothing downstream of it.
// The one criterion (owner, 2026-11-23): HIGH VALUE ONLY. An item is high value when Jev's impact score is at least
// 2.5 of 4: at least halfway from "Noticeably" (2) to "Substantially" (3) on "how much would this move the most
// important goal". Work a high-value item cannot run without is kept as a prerequisite and labelled so. Everything
// else is cut from the product. Moat, quality and aftermath are still reported, but they no longer decide.
export const CRITERIA = {
  highValueMin: 2.5,
  text: {
    rule: "High value: impact score at least 2.5 of 4 (halfway from \"noticeably\" to \"substantially\" moves the most important goal).",
    verdicts: "high value = meets the rule · kept as a prerequisite = below the rule, but a high-value item cannot run without it · cut = below the rule and nothing high-value needs it · rejected on evidence = tried and measured worse or unidentified.",
  },
};

interface Item { id: string; title: string; label: string; detail: string; track: string; status: "done" | "rejected" | "next"; requires?: string[];
  /** Built because the owner asked for it directly: shown in the product even when the rule would cut it (stated on the page). */
  ownerRequest?: string; files: string[]; evidence: { tests: number; validated: boolean; line: string } }
const items: Item[] = [
  { id: "bands", title: "Lift estimates with measured error bands", label: "Vortex-lift engine with error bands measured on NASA wind-tunnel data",
    detail: "Vortex lattice plus the Polhamus suction analogy and a vortex-breakdown limit, with a band beside every estimate measured by leave-one-wing-out on 200 digitized NASA points. Misses are published.",
    track: "data_loop", status: "done", files: ["lib/aero/vlm.ts", "lib/aero/vortex.ts", "lib/aero/geometry.ts", "lib/aero/units.ts", "lib/aero/units.typecheck.ts", "lib/aero/error-model.ts", "lib/aero/predict.ts"],
    evidence: { tests: tests("aero.test.ts"), validated: true, line: `Held-out band coverage ${pct(val.coverage.widened)} on ${val.inDomain.length} wings; ${Object.values(val.criteria).filter((c: any) => c.pass).length} of 4 pre-registered criteria met, the misses shown.` } },
  { id: "report", title: "A citable validation report", label: "Validation record published as a citable report with data and misses",
    detail: "One generated document with every comparison against published NASA data, when each criterion was written, the hits and the misses, the data-file digests and a version number, so an engineer can cite which estimates to trust and by how much.",
    track: "trust", status: "done", requires: ["flightval", "bands"], files: [],
    evidence: { tests: 3, validated: true, line: `Version 1.0 generated from the result files: ${[...Object.values(val.criteria), ...Object.values(fl.criteria)].filter((c: any) => c.pass).length} of 8 criteria met, the three misses listed; a test fails if the report does not match the current data.` } },
  { id: "flightval", title: "Checked against real F-106B flight and trim data", label: "Model checked against published F-106B flight and trim data, with elevon trim",
    detail: "Elevon lift and trim from the same lattice, a rounded-leading-edge blend, and a comparison with NASA's published F-106B trim table (absolute) and 27 flight points (shape), scored leave-one-flight-out.",
    track: "quality", status: "done", requires: ["bands", "aircraft"], files: ["lib/aero/trim.ts", "lib/aero/flightdata.ts"],
    evidence: { tests: tests("aero-flight.test.ts"), validated: true, line: `Lift error at NASA's trim point ${pct(Math.abs(trimRows[0].error))} before, ${pct(Math.abs(trimRows[trimRows.length - 1].error))} after; elevon within ${fl.criteria.F2.value}°; held-out weight spread ${pct(fl.flight.heldOutCv)} (target 5%).` } },
  { id: "aircraft", title: "Real aircraft only, each tied to its NASA report", label: "Registry of real NASA research aircraft built only from published numbers",
    detail: "F-16, F/A-18 HARV, F-16XL-1 and F-106B: every dimension names the NASA table or figure it was read from; planforms are built from those numbers; anything traced from a drawing is labelled with its tolerance; no invented layouts.",
    track: "trust", status: "done", requires: ["bands"], files: ["lib/aero/aircraft.ts"],
    evidence: { tests: tests("aero-aircraft.test.ts"), validated: true, line: "F-106B's published area, chord and aspect ratio are reproduced from its triangle within 0.1%; the F-16's published area, span and mean chord exactly, with the sweep fitted to NASA's drawing (40.2° ± 2.5°); the F-16XL planform is 5% larger than the published wing area, and says so." } },
  { id: "live", title: "Fly it: live simulation in the app", label: "Live pilot-in-the-loop flight simulation of the real aircraft in the browser",
    detail: "Stick and throttle, integrated at a fixed 120 Hz step in the browser: flight path, lift and vortex state live, NASA's F-16 thrust table, published weights and wing areas, a generated F-16 3D model scaled to NASA's dimensions; whole-aircraft drag and the stick response are stated assumptions.",
    track: "distribution", status: "done", requires: ["bands", "aircraft", "unsteady"], ownerRequest: "2026-11-23: a live simulation in the app, smooth, like professional software", files: ["lib/aero/live.ts", "lib/aero/f16data.ts"],
    evidence: { tests: tests("aero-live.test.ts"), validated: false, line: "Frame-rate independent (same flight for any split of time into frames); matches the reference integrator step for step; trim holds level; energy change equals thrust-minus-drag work; NASA thrust table checked against its own SI half. Drag is an allowance, not measured." } },
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
];

/** Candidate next steps: judged and ranked the same way, so the review also says what to do next. */
const candidates: Item[] = [
  { id: "next-mach", title: "Compressibility, to use NASA's seven faster F-106B flight runs", label: "Add compressibility and compare with the Mach 0.67-0.81 F-106B flight runs",
    detail: "A Prandtl-Glauert-type correction to the lattice, then the seven published F-106B runs at Mach 0.67-0.81 and load factors 1.6-3.9 g join the comparison: manoeuvring flight, not only 1 g.",
    track: "quality", status: "next", requires: ["flightval"], files: [], evidence: { tests: 0, validated: false, line: "Not started. The data are already transcribed from NASA TP-3374 Table I; 27 points become 34 and the comparison reaches 3.9 g." } },
  { id: "next-xl", title: "The same flight comparison for the F-16XL-1", label: "Compare the model with published F-16XL-1 flight conditions",
    detail: "NASA TP-2001-210629 Table 5 lists the F-16XL-1 flight conditions (angle of attack, Mach, load factor); transcribe them and run the same weight-consistency check on a second real aircraft with a different wing.",
    track: "data_loop", status: "next", requires: ["flightval"], files: [], evidence: { tests: 0, validated: false, line: "Not started. A second aircraft would show whether the F-106B result is a property of the method or of one wing." } },
  { id: "next-curves", title: "Measured lift curves for all three aircraft", label: "Digitise published measured lift curves for the three aircraft",
    detail: "Digitise wind-tunnel and flight lift curves from the NASA reports for the F-16XL-1 and F-106B, as already done for the HARV, so every aircraft has absolute lift data beside its estimate.",
    track: "data_loop", status: "next", requires: ["aircraft", "bands", "flightval"], files: [], evidence: { tests: 0, validated: false, line: "Not started. Today only the HARV has measured lift in the corpus; the F-106B has one absolute point." } },
  { id: "next-tau", title: "Identify the vortex time constant from dynamic test data", label: "Fit the unsteady time constant to published pitch-oscillation data",
    detail: "Digitise published large-amplitude pitch data for a delta wing and identify the Goman-Khrabrov time constants instead of using the reported order of magnitude.",
    track: "quality", status: "next", requires: ["unsteady"], files: [], evidence: { tests: 0, validated: false, line: "Not started. The unsteady model is currently unvalidated against any motion data." } },
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
const REPEATS = 3;
const judged = [];
for (const it of [...items, ...candidates]) {
  // Judged REPEATS times: the model's answer to the same question is not perfectly repeatable, so the score is the
  // mean and the range is kept. An item whose range straddles the bar is reported as borderline.
  const runs = [];
  for (let k = 0; k < REPEATS; k++) runs.push(await judge({ title: it.title, detail: `${it.detail} Evidence: ${it.evidence.line}`, track: it.track }, context, apiKey));
  const per = (d: string) => runs.map((j) => mean((j.dims as any)[d]));
  const impacts = per("impact");
  judged.push({ it, levels: Object.fromEntries(DIMS.map((d) => [d, r2(per(d).reduce((x, y) => x + y, 0) / REPEATS)])) as Record<string, number>,
    impactRange: [r2(Math.min(...impacts)), r2(Math.max(...impacts))] as [number, number], beliefs: runs[0]!.dims, promptHash: runs[0]!.promptHash });
  console.error(`judged ${it.id}: impact ${impacts.map(r2).join(" ")}`);
}

// 2. ORION ranking: the built work and the candidate next steps are ranked separately (each list at most 8)
const rankGroup = async (group: Item[], lead: string) => {
  const req = PrioritizeRequestSchema.parse({ context: `${context} ${lead} ${group.map((i) => `- ${i.label}: ${i.evidence.line}`).join(" ")}`.slice(0, 4000), options: group.map((i) => ({ id: i.id, label: i.label.slice(0, 80) })) });
  const res = prioritize(await prioritizeWithJev(req, { apiKey, timeoutMs: 60_000 })) as any;
  return { rows: Object.fromEntries((res.rows as any[]).map((r) => [r.optionId, r])), w: r2(res.kendallW ?? res.agreement ?? 0) };
};
// ORION takes at most 8 options: work rejected on evidence is already decided and is listed after the ranked items.
const rankable = items.filter((i) => i.status !== "rejected"), rejected = items.filter((i) => i.status === "rejected");
const built = await rankGroup(rankable, "Work already built:"), next = await rankGroup(candidates, "Candidate next steps, nothing built yet:");
const rankOf: Record<string, any> = { ...built.rows, ...next.rows };
rejected.forEach((i, k) => { rankOf[i.id] = { rank: rankable.length + k + 1, pFirst: 0, eisenhower: "not ranked: rejected on evidence", effortMatrix: "n/a", door: "n/a" }; });

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

const levelOf = Object.fromEntries(judged.map((j) => [j.it.id, j.levels]));
const high = (id: string) => (levelOf[id]?.impact ?? 0) >= CRITERIA.highValueMin;
const all = [...items, ...candidates];
/** Built items a high-value item (built or candidate) cannot run without, directly or through another prerequisite. */
const needed = new Set<string>();
const need = (id: string) => { for (const r of all.find((i) => i.id === id)?.requires ?? []) if (!needed.has(r)) { needed.add(r); need(r); } };
for (const i of all) if (high(i.id) && i.status !== "rejected") need(i.id);
const verdictOf = (it: Item) => it.status === "rejected" ? "rejected on evidence" : high(it.id) ? "high value" : needed.has(it.id) ? "kept as a prerequisite" : "cut";
const said = (dim: "impact" | "defensibility" | "quality", lv: number) => {
  const q = QUESTIONS[dim], k = Math.min(4, Math.max(0, Math.round(lv)));
  return `${lv.toFixed(1)} of 4, nearest to: "${(q.criteria ?? q.levels)[k]}"`;
};

const row = ({ it, levels, impactRange }: (typeof judged)[number]) => {
  const r = rankOf[it.id];
  return {
    id: it.id, title: it.title, detail: it.detail, status: it.status, requires: it.requires ?? [], ownerRequest: it.ownerRequest ?? null, files: it.files, evidence: it.evidence,
    levels: { impact: levels.impact, defensibility: levels.defensibility, quality: levels.quality, confidence: levels.confidence, effort: levels.effort, leverage: levels.leverage, urgency: levels.urgency, reach: levels.reach, reversibility: levels.reversibility },
    orion: { rank: r.rank as number, pFirst: r2(r.pFirst), eisenhower: r.eisenhower as string, effortMatrix: r.effortMatrix as string, door: r.door as string },
    verdict: verdictOf(it), impactRange, borderline: impactRange[0] < CRITERIA.highValueMin && impactRange[1] >= CRITERIA.highValueMin,
    neededBy: all.filter((o) => (o.requires ?? []).includes(it.id) && (high(o.id) || needed.has(o.id))).map((o) => o.id),
    why: { useful: `Impact ${said("impact", levels.impact)}.`, moat: `Moat ${said("defensibility", levels.defensibility)}.`, quality: `Quality ${said("quality", levels.quality)}.`, evidence: it.evidence.line },
    aftermath: picture(levels, it.id, it.title),
  };
};
const isCandidate = new Set(candidates.map((c) => c.id));
const out = {
  generated: new Date().toISOString(), model: JEV_MODEL, engine: "Compass judge (impact, moat, quality and ORION's dimensions; Jev beliefs over described situations) · ORION prioritisation (Borda over RICE, ICE, WSJF, leverage, Eisenhower) · ORION aftermath",
  criteria: { highValueMin: CRITERIA.highValueMin, ...CRITERIA.text }, repeats: REPEATS,
  agreement: built.w, agreementCandidates: next.w,
  evidenceDigest: createHash("sha256").update(JSON.stringify(all.map((i) => [i.id, i.detail, i.evidence, i.requires ?? []]))).digest("hex").slice(0, 16),
  note: "The scores are a model's judgment of the descriptions and evidence shown here; the verdict is the fixed rule applied to them.",
  items: judged.filter((j) => !isCandidate.has(j.it.id)).map(row).sort((a, b) => a.orion.rank - b.orion.rank),
  candidates: judged.filter((j) => isCandidate.has(j.it.id)).map(row).sort((a, b) => a.orion.rank - b.orion.rank),
};
writeFileSync(`${root}/web/lib/data/aero-value.json`, JSON.stringify(out, null, 1) + "\n");
writeFileSync(`${root}/plans/20261120-aero/value-review.json`, JSON.stringify({ ...out, beliefs: Object.fromEntries(judged.map((j) => [j.it.id, j.beliefs])) }, null, 1) + "\n");
console.log(JSON.stringify({ W: [out.agreement, out.agreementCandidates], items: out.items.map((i) => `${i.orion.rank}:${i.id} [${i.verdict}${i.borderline ? ", borderline" : ""}] impact ${i.levels.impact} (${i.impactRange.join("-")})`), candidates: out.candidates.map((i) => `${i.orion.rank}:${i.id} [${i.verdict}${i.borderline ? ", borderline" : ""}] impact ${i.levels.impact} (${i.impactRange.join("-")}) effort ${i.levels.effort}`) }));
