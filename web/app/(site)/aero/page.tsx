import type { Metadata } from "next";
import { ScatterChart, type Series } from "@/components/aero/dynamics";
import { AeroWorkbench, type CaseView } from "@/components/aero/workbench";
import { PageHeader, Panel, Section, Stat } from "@/components/ui/primitives";
import type { Bands } from "@/lib/aero/error-model";
import { AIRCRAFT } from "@/lib/aero/aircraft";
import corpus from "@/lib/data/aero-corpus.json";
import flight from "@/lib/data/aero-flight.json";
import value from "@/lib/data/aero-value.json";
import validation from "@/lib/data/aero-validation.json";

export const metadata: Metadata = { title: "Wing aerodynamics" };

const SOURCES = [
  { k: "Vortex lift", v: "Polhamus 1966, NASA TN D-3767", href: "https://ntrs.nasa.gov/citations/19670003842", note: "Suction analogy; Fig. 12 delta-wing data digitized (5 wings)" },
  { k: "Breakdown and lift", v: "Wentz & Kohlman 1968, NASA CR-98737", href: "https://ntrs.nasa.gov/citations/19690005430", note: "Breakdown map Fig. 4.1.1; lift curves 50°–80° deltas (7 wings)" },
  { k: "Vortex lattice", v: "NASA SP-405 (1976), Vortex-Lattice Utilization", href: "https://ntrs.nasa.gov/citations/19760021075", note: "Method reference; horseshoe lattice, Trefftz-plane drag" },
  { k: "F/A-18 data", v: "NASA TM-112360 (1996), HATP F/A-18 baseline", href: "https://ntrs.nasa.gov/citations/19970012895", note: "Fig. 28 wind-tunnel CL to 70°; reference S, b, MAC" },
  { k: "HARV geometry", v: "NASA TP-1999-206573, Fig. 2 and Table 3", href: "https://ntrs.nasa.gov/citations/19980007172", note: "Three-view traced at 300 dpi; length, span, height, stabilator span and area" },
  { k: "HARV description", v: "Iliff & Wang 1997, NASA TM-4786; NASA TM-104261 (1992)", href: "https://ntrs.nasa.gov/citations/19970010502", note: "Wing area, MAC, aspect ratio; vertical tails canted 20°" },
  { k: "Vortex-lift centroid", v: "Lamar & Gloss 1975, NASA TN D-7921", href: "https://ntrs.nasa.gov/citations/19750023950", note: "Vortex lift acts at the centroid of the suction it replaces" },
  { k: "Bands", v: "Vovk, Gammerman & Shafer 2005, Algorithmic Learning in a Random World", href: "https://doi.org/10.1007/b106715", note: "Split conformal intervals; scored leave-one-wing-out" },
];

type Row = (typeof validation.inDomain)[number];
type OutRow = (typeof validation.outOfDomain)[number];
const pct = (v: number) => `${Math.round(v * 100)}%`;
const f3 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(3));

function caseViews(): Record<string, CaseView> {
  const byId = new Map<string, Row | OutRow>([...validation.inDomain, ...validation.outOfDomain].map((r) => [r.id, r]));
  return Object.fromEntries(corpus.cases.map((c) => {
    const r = byId.get(c.id);
    const inDom = validation.inDomain.some((x) => x.id === c.id);
    const att = r && "rmsAttached" in r ? r.rmsAttached : null;
    const note = r ? `${inDom ? "Scored without this wing in the fit" : "Outside the validated domain"}: ${pct(r.coverage)} of ${r.n} points inside the band; RMS error ${f3(r.rmsAll)}${att !== null ? ` (${f3(att)} before breakdown)` : ""}.` : "";
    const label = c.kind === "aircraft" ? "NASA wind-tunnel data" : `${c.source.split(",")[0]} data`;
    return [c.id, { id: c.id, label, source: `${c.source.split(",")[0]} · ${c.figure}`, coverage: r?.coverage ?? null, rmsAttached: att,
      note, points: c.points.map((p) => ({ alphaDeg: p.alphaDeg, cl: p.cl, ...("series" in p ? { series: String(p.series) } : {}) })) }];
  }));
}

const VERDICT_TONE: Record<string, string> = { "high value": "text-good", "kept as a prerequisite": "text-accent", cut: "text-warning", "rejected on evidence": "text-fg-3" };
type Reviewed = (typeof value.items)[number];
const STATUS: Record<string, string> = { done: "built", rejected: "tried, not adopted", next: "not started" };

export default function AeroPage() {
  const fv = flight.flight.variants;
  const weightSeries: Series[] = [
    { label: "sharp edge (old)", color: "var(--fg-3)", pts: (fv[0]?.points ?? []).map((q) => [q.alphaDeg, q.weightLb] as const) },
    { label: "attached edge", color: "var(--c3)", pts: (fv[1]?.points ?? []).map((q) => [q.alphaDeg, q.weightLb] as const) },
    { label: "rounded edge, fitted", color: "var(--accent)", pts: (fv[2]?.points ?? []).map((q) => [q.alphaDeg, q.weightLb] as const) },
  ];
  const trimFirst = flight.trim.rows[0], trimLast = flight.trim.rows[flight.trim.rows.length - 1];
  const reviewed: Reviewed[] = [...value.items, ...value.candidates];
  const counts = reviewed.reduce<Record<string, number>>((a, i) => ({ ...a, [i.verdict]: (a[i.verdict] ?? 0) + 1 }), {});
  const titleOf = (id: string) => reviewed.find((i) => i.id === id)?.title ?? id;
  const highValue = reviewed.filter((i) => i.verdict === "high value");
  const cr = validation.criteria;
  const nPts = corpus.cases.reduce((a, c) => a + c.points.length, 0);
  const criteria = [
    { id: "C1", ...cr.C1, detail: cr.C1.pass ? "all wings" : `misses: ${cr.C1.failing.join(", ")}` },
    { id: "C2", ...cr.C2, detail: cr.C2.pass ? "all wings" : `misses: ${cr.C2.failing.join(", ")}` },
    { id: "C3", ...cr.C3, detail: `${pct(cr.C3.value)} with the nested widening (first version ${pct(cr.C3.baselineValue)})` },
    { id: "C4", ...cr.C4, detail: cr.C4.pass ? "every point of every outside case" : `misses: ${cr.C4.failing.join(", ")}` },
  ];
  return (
    <>
      <PageHeader eyebrow="Aerodynamics · high angle of attack · prototype" title="Three real NASA research fighters, with measured error bars."
        lede="Vortex-lattice and leading-edge vortex lift for slender wings, from attached flow through vortex breakdown, with a band beside every estimate that says how far published wind-tunnel data have fallen from it on wings the model never saw. Analysis and teaching only: public NASA research data, nothing that improves combat capability.">
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
          <Stat value={pct(validation.coverage.widened)} label="held-out band coverage" hint={`90% band · ${validation.inDomain.length} wings left out in turn`} />
          <Stat value={`${nPts}`} label="digitized data points" hint={`${corpus.cases.length} cases · 3 NASA reports`} />
          <Stat value="96" label="checks on what is shown" hint="83 invariant tests · 7 static rules · 6 type proofs" />
          <Stat value={pct(Math.abs(trimLast?.error ?? 0))} label="lift error at NASA's F-106B trim point" hint={`was ${pct(Math.abs(trimFirst?.error ?? 0))} before the elevon and rounded-edge model`} />
        </div>
      </PageHeader>

      <Section eyebrow="Workbench" title="Real aircraft: published data, lift curve, drawing and 3D view"
        description={`Only real airframes: ${AIRCRAFT.map((a) => a.name).join(", ")}. Each is a NASA research aircraft, and every dimension shown names the NASA table or figure it was read from. There are no invented layouts.`}>
        <AeroWorkbench bands={validation.bands as Bands} retained={validation.retained} cases={caseViews()} date="2026-11-23" flightBlend={{ [flight.aircraft]: flight.flight.blend }} />
      </Section>

      <Section eyebrow="Accuracy · real aircraft" title="Checked against the F-106B as NASA flew and trimmed it"
        description="Two published tables, used as they are printed. NASA's approach trim gives weight, speed, angle of attack, elevon and thrust, so the lift the aircraft needs is known exactly. NASA's flight table gives angle of attack, altitude, Mach and load factor for 27 subsonic runs on five flights but not the weight; in steady flight lift equals weight times load factor, so each run gives the weight the model implies, and a correct lift curve gives the same weight for every run of a flight.">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="grid content-start gap-3 p-5">
            <div className="eyebrow">Trim point · α = {flight.trim.alphaDeg}° · lift required {flight.trim.clRequired.toFixed(3)}</div>
            <table className="w-full text-left text-[13px]">
              <thead className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-fg-2"><tr className="border-b border-line"><th className="py-2">Model</th><th className="pl-4 text-right">CL</th><th className="pl-4 text-right">Error</th><th className="pl-4 text-right">Elevon</th></tr></thead>
              <tbody>
                {flight.trim.rows.map((r) => (
                  <tr key={r.label} className="border-b border-line/60 align-top">
                    <td className="py-2 pr-3">{r.label}</td><td className="num pl-4 text-right font-mono">{r.cl.toFixed(3)}</td>
                    <td className={`num pl-4 text-right font-mono ${Math.abs(r.error) <= 0.05 ? "text-good" : "text-warning"}`}>{r.error > 0 ? "+" : ""}{pct(r.error)}</td>
                    <td className="num whitespace-nowrap pl-4 text-right font-mono">{r.elevonDeg === null ? "—" : `${r.elevonDeg.toFixed(2)}°`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[13px] text-fg-2">Published elevon: {flight.trim.publishedElevonDeg}°. The model computes the elevon&apos;s lift and trim from the same vortex lattice and predicts {flight.trim.predictedElevonDeg.fitted.toFixed(2)}°. The trim point was never used to fit anything: it is the independent check. Source: {flight.trim.source}; assumed: {flight.trim.assumed}.</p>
          </Panel>
          <Panel className="grid content-start gap-3 p-5">
            <div className="eyebrow">Flight table · weight each run implies</div>
            <ScatterChart series={weightSeries} refs={[{ y: 27400, label: "NASA simulation weight 27,400 lb" }]} xMin={8} xMax={23} yMin={20000} yMax={55000} xLabel="Angle of attack in flight, degrees →" yLabel="lb" yFormat={(w) => `${Math.round(w / 1000)}k`} aria="Aircraft weight implied by each of 27 F-106B flight points for three leading-edge models" />
            <p className="text-[13px] text-fg-2">A flat line is a correct lift curve. Within a flight the implied weight varies by {pct(fv[0]?.withinFlightCv ?? 0)} with the sharp-edge model, {pct(fv[1]?.withinFlightCv ?? 0)} with attached flow, and {pct(fv[2]?.withinFlightCv ?? 0)} with a rounded edge whose vortex starts at {flight.flight.blend.onsetDeg}° and is fully formed by {flight.flight.blend.fullDeg}° (mean {fv[2]?.meanWeightLb.toLocaleString("en")} lb). Fitted on four flights and scored on the fifth: {pct(flight.flight.heldOutCv)}.</p>
          </Panel>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Object.entries(flight.criteria).map(([id, c]) => (
            <Panel key={id} className="grid content-start gap-2 p-5">
              <div className="flex items-center justify-between"><span className="eyebrow">{id}</span><span className={`tag ${c.pass ? "text-good" : "text-warning"}`}>{c.pass ? "met" : "missed"}</span></div>
              <p className="text-[14px]">{c.text}</p>
              <p className="num font-mono text-[12.5px] text-fg-3">{c.value > 100 ? `${c.value.toLocaleString("en")} lb` : id === "F2" ? `${c.value}°` : pct(c.value)}</p>
            </Panel>
          ))}
        </div>
        <ul className="grid gap-1 text-[13px] text-fg-3">{flight.limits.map((t) => <li key={t}>{t}</li>)}</ul>
      </Section>

      <Section eyebrow="Value review · one criterion: high value" title="What is high value here, and what was cut"
        description={`One rule decides what stays. ${value.criteria.rule} Each item is judged ${value.repeats} times by Compass's judge and the scores averaged (the range is shown); ORION ranks the built work and the candidate next steps; ORION's aftermath shows how each plays out. Work that a high-value item cannot run without is kept and labelled a prerequisite. Everything else is cut from this page. The review is rerun whenever the aerodynamics code changes: a test fails if a module is not covered.`}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
          {["high value", "kept as a prerequisite", "cut", "rejected on evidence"].map((k) => <Stat key={k} value={`${counts[k] ?? 0}`} label={k} />)}
        </div>
        <Panel className="grid gap-2 p-5">
          <div className="eyebrow">Result</div>
          <p className="text-[14px]">{highValue.length === 0 ? "Nothing clears the bar." : <>High value: {highValue.map((i) => `${i.title} (${i.levels.impact.toFixed(2)}${i.status === "next" ? ", not built yet" : ""})`).join("; ")}.</>} {value.items.every((i) => i.verdict !== "high value") && "Nothing built so far clears the bar on its own: what is shown on this page is here because the high-value work needs it."}</p>
          <p className="text-[13px] text-fg-2">Cut from this page (the code stays in the repository): {reviewed.filter((i) => i.verdict === "cut" && i.status === "done").map((i) => `${i.title} (${i.levels.impact.toFixed(2)})`).join("; ")}. Candidate next steps that do not clear the bar: {value.candidates.filter((i) => i.verdict === "cut").map((i) => `${i.title} (${i.levels.impact.toFixed(2)})`).join("; ")}.</p>
        </Panel>
        {([["Built work", value.items], ["Candidate next steps", value.candidates]] as const).map(([heading, group]) => (
          <div key={heading} className="panel overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-[13px]">
              <thead className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-fg-2"><tr className="border-b border-line">
                <th className="p-3">ORION</th><th>{heading} and why</th><th>Verdict</th><th className="text-right">Value (range)</th><th className="text-right">Moat</th><th className="text-right">Quality</th><th className="pl-4 pr-3">Aftermath at a year</th></tr></thead>
              <tbody>
                {group.map((i) => {
                  const year = i.aftermath.reduce((a, st) => (Math.abs(st.days - 365) < Math.abs(a.days - 365) ? st : a), i.aftermath[0] ?? { days: 0, when: "", value: 0, well: 0, mixed: 0, hard: 0, sign: "" });
                  return (
                    <tr key={i.id} className="border-b border-line/60 align-top">
                      <td className="p-3"><div className="num font-mono text-[18px] font-medium">{i.orion.rank}</div><div className="num font-mono text-[11px] text-fg-3">{pct(i.orion.pFirst)} first</div></td>
                      <td className="max-w-[440px] py-3 pr-4">
                        <div className="font-medium">{i.title} <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-3">· {STATUS[i.status]}</span></div>
                        <ul className="mt-1 grid gap-0.5 text-[12.5px] text-fg-2"><li>{i.why.useful}</li><li>Evidence: {i.why.evidence}</li>
                          {i.verdict === "kept as a prerequisite" && <li>Kept because it is needed by: {i.neededBy.map(titleOf).join("; ")}.</li>}</ul>
                      </td>
                      <td className={`py-3 pr-3 font-mono text-[12px] ${VERDICT_TONE[i.verdict] ?? ""}`}>{i.verdict}{i.borderline ? " (borderline)" : ""}</td>
                      <td className={`num whitespace-nowrap py-3 text-right font-mono ${i.levels.impact >= value.criteria.highValueMin ? "text-good" : ""}`}>{i.levels.impact.toFixed(2)}<div className="text-[11px] text-fg-3">{(i.impactRange[0] ?? 0).toFixed(2)}–{(i.impactRange[1] ?? 0).toFixed(2)}</div></td>
                      <td className="num py-3 text-right font-mono text-fg-2">{i.levels.defensibility.toFixed(2)}</td>
                      <td className="num py-3 text-right font-mono text-fg-2">{i.levels.quality.toFixed(2)}</td>
                      <td className="num py-3 pl-4 pr-3 font-mono text-[12px] text-fg-2">well {pct(year.well)}<br />mixed {pct(year.mixed)}<br />hard {pct(year.hard)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
        <p className="text-[13px] text-fg-2">{value.criteria.verdicts} Moat and quality are reported but no longer decide. Agreement between ORION&apos;s ranking methods: {value.agreement.toFixed(2)} (built work), {value.agreementCandidates.toFixed(2)} (candidates). {value.note} Model {value.model}, reviewed {value.generated.slice(0, 10)}, evidence digest {value.evidenceDigest}.</p>
      </Section>

      <Section eyebrow="Validation · wind-tunnel wings" title="Scored on wings the model never saw"
        description="Each wing was left out in turn: the one calibrated parameter (vortex lift kept after a burst, 0.37) and the band were fitted on the others, then the held-out wing was scored. Criteria were written before the first run.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {criteria.map((c) => (
            <Panel key={c.id} className="grid content-start gap-2 p-5">
              <div className="flex items-center justify-between"><span className="eyebrow">{c.id}</span>
                <span className={`tag ${c.pass ? "text-good" : "text-warning"}`}>{c.pass ? "met" : "missed"}</span></div>
              <p className="text-[14px]">{c.text}</p>
              <p className="text-[12.5px] text-fg-3">{c.detail}</p>
            </Panel>
          ))}
        </div>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-fg-2"><tr className="border-b border-line">
              <th className="p-3">Wing</th><th>Source</th><th>Points</th><th>RMS before breakdown</th><th>RMS all</th><th>CLmax data → model</th><th className="pr-3">In band</th></tr></thead>
            <tbody className="num font-mono">
              {validation.inDomain.map((r) => (
                <tr key={r.id} className="border-b border-line/60">
                  <td className="p-3">{`${r.sweepDeg}° delta`}</td><td className="font-sans text-fg-2">{r.figure}</td><td>{r.n}</td>
                  <td className={r.c1 === false ? "text-warning" : ""}>{f3(r.rmsAttached)}</td><td>{f3(r.rmsAll)}</td>
                  <td className={r.c2 === false ? "text-warning" : ""}>{r.clMax ? `${r.clMax.data.toFixed(2)} @ ${r.clMax.dataAlpha}° → ${r.clMax.model.toFixed(2)} @ ${r.clMax.modelAlpha}°` : "not reached in data"}</td>
                  <td className="pr-3">{pct(r.coverage)}</td>
                </tr>
              ))}
              {validation.outOfDomain.map((r) => (
                <tr key={r.id} className="border-b border-line/60 text-fg-3">
                  <td className="p-3">{r.kind === "aircraft" ? "F/A-18 HARV (NASA data)" : `${r.sweepDeg}° delta`}</td><td className="font-sans">{r.figure}</td><td>{r.n}</td>
                  <td>outside</td><td>{f3(r.rmsAll)}</td><td>—</td><td className="pr-3">{`${pct(r.coverage)} (band ×2)`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Panel className="grid content-start gap-2 p-5"><div className="eyebrow">Before breakdown</div><p className="text-[14px] text-fg-2">Polhamus&apos; theory, rebuilt from a vortex lattice, follows the data to 0.012–0.058 CL on every in-domain wing but the 80° one. Kv comes out at 3.15–3.2, the π-to-3.45 range of his Fig. 9.</p></Panel>
          <Panel className="grid content-start gap-2 p-5"><div className="eyebrow">Misses, kept visible</div><p className="text-[14px] text-fg-2">The 80° wing sits 0.13 below the model; Polhamus&apos; own 80° data (Fink) sit on it, so the two tests disagree. After the burst reaches the apex the model holds lift too long on 60–65°: CLmax is late. 50–55° wings separate earlier than the breakdown map implies and stay outside the domain.</p></Panel>
          <Panel className="grid content-start gap-2 p-5"><div className="eyebrow">How the band was fixed</div><p className="text-[14px] text-fg-2">The first band, built from pooled points, covered {pct(validation.coverage.baseline)} on held-out wings: wings differ more from each other than points within a wing. It is now widened by ×{validation.widen.toFixed(2)}, a factor itself chosen by nested leave-one-wing-out, giving {pct(validation.coverage.widened)}.</p></Panel>
        </div>
      </Section>

      <Section eyebrow="Checks" title="How the engine is kept honest">
        <div className="grid gap-4 md:grid-cols-2">
          {[
            ["Invariant tests (83)", "Property-based (fast-check): scale and translation invariance, odd lift, vortex lift ≥ 0, breakdown only removes lift, burst share monotone in α, elliptic bound on span efficiency within a mesh tolerance that shrinks on refinement, conformal coverage by simulation, refusal of invalid geometry and unbounded meshes."],
            ["Verification against theory", "Slender-wing limit Kp → πA/2, lifting-line limit at A = 20, mesh convergence < 1%, Polhamus Kv range, the published F/A-18 reference MAC (11.517 ft) reproduced by the generic layout."],
            ["Static analysis (7 rules)", "A compiler-API gate on lib/aero: pure imports only, no randomness or clocks, no any / non-null / casts, strict equality, angle parameters must be typed Rad or Deg, every export referenced by a test, and the unit proofs must still fail when their guards are removed."],
            ["Compile-time unit proofs (6)", "Degrees, radians and bare numbers are distinct types; six deliberate misuses must fail to compile. Removing a guard was checked to break the build."],
          ].map(([k, v]) => <Panel key={k} className="grid content-start gap-2 p-5"><div className="eyebrow">{k}</div><p className="text-[14px] text-fg-2">{v}</p></Panel>)}
        </div>
      </Section>

      <Section eyebrow="Limits" title="What this does not do">
        <ul className="grid gap-2 text-[14px] text-fg-2">
          <li>The delta wings in the validation table are NASA wind-tunnel test wings, used only to measure the error band; the models offered are real aircraft only.</li>
          <li>Thin flat wings with sharp leading edges at low speed. No thickness, camber, rounded edges, fuselage, tails, flaps, compressibility or Reynolds-number effects.</li>
          <li>Each aircraft is its wing planform from NASA&apos;s published dimensions, not manufacturer geometry. Aerodynamics use the wing only (for the HARV, wing and LEX): no fuselage, tails or scheduled flaps. The HARV and the F-16XL-1 are outside the validated range of wing shapes and are labelled so.</li>
          <li>Steady flight only: lateral and dynamic behaviour (sideslip, rolling, pitching rates, forebody vortices) are not shown. An unsteady-lift model, a flight-path model and a solid 3D model of the HARV exist in the repository but were cut from this page by the value review.</li>
          <li>Scope: analysis and teaching with public NASA research data. No stealth, weapons or manoeuvre optimisation.</li>
        </ul>
      </Section>

      <Section eyebrow="Sources" title="Reports and data">
        <div className="panel divide-y divide-line">
          {SOURCES.map((s) => (
            <div key={s.k} className="grid gap-1 p-4 text-[13.5px] sm:grid-cols-[160px_minmax(0,1fr)_minmax(0,300px)] sm:gap-6">
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-2">{s.k}</span>
              <a className="link" href={s.href} target="_blank" rel="noopener noreferrer">{s.v}</a>
              <span className="text-fg-3">{s.note}</span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
