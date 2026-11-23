import type { Metadata } from "next";
import { type Curve, LineChart, ScatterChart, type Series } from "@/components/aero/dynamics";
import { AeroWorkbench, type CaseView } from "@/components/aero/workbench";
import { PageHeader, Panel, Section, Stat } from "@/components/ui/primitives";
import type { Bands } from "@/lib/aero/error-model";
import { HARV_AIRFRAME, HARV_MASS, simulateFlight, trimLevel } from "@/lib/aero/flight";
import { AIRCRAFT, aircraftById } from "@/lib/aero/aircraft";
import { harvPlanform } from "@/lib/aero/harv";
import { deg, rad } from "@/lib/aero/units";
import { GK_DELTA_ORDER, loopArea, unsteadyPolar } from "@/lib/aero/unsteady";
import { solveVlm } from "@/lib/aero/vlm";
import { vortexModel } from "@/lib/aero/vortex";
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
  { k: "Unsteady vortex lift", v: "Goman & Khrabrov 1994, J. Aircraft 31(5); Goman, Greenwell & Khrabrov, ICAS 2000 paper 223", href: "https://www.icas.org/icas_archive/ICAS2000/PAPERS/ICA0223.PDF", note: "State-space model (eq. 2), linear frequency response (eqs. 4-5) checked exactly in tests; lag ~15 c/V on 65-70° deltas" },
  { k: "F-16XL-1 geometry", v: "NASA TP-2001-210629 (Lamar, Obara, Fisher & Fisher, 2001), Table 3 and Fig. 2", href: "https://www.cs.odu.edu/~mln/ltrs-pdfs/NASA-2001-tp210629.pdf", note: "Reference area, span, chords, 70°/50° sweep, crank at BL 137.096 in" },
  { k: "F-106B geometry and flight", v: "NASA TP-3374 (Lamar et al., 1993), p. 3, Fig. 1 and Table I", href: "https://www.cs.odu.edu/~mln/ltrs-pdfs/tp3374.pdf", note: "Reference geometry; 34 flight points with angle of attack, altitude, Mach and load factor" },
  { k: "F-106B trim and mass", v: "NASA TP-2747 (1987), Tables I and III", href: "https://ntrs.nasa.gov/citations/19870017489", note: "Weight, inertias, and the approach trim: speed, angle of attack, elevon, thrust" },
  { k: "HARV mass", v: "NASA TM-110216 (Messina et al., 1996), Table 2.3", href: "https://ntrs.nasa.gov/citations/19960027892", note: "Weight, c.g. and inertias; fighter escort loading, 60% internal fuel" },
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

const D = Math.PI / 180;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Pitch cycles 15° → 45° → 15° on the F-106B wing: static lift, and lift with the vortex lag at two pitch rates. */
function pitchLoops() {
  const f106 = aircraftById("f106b");
  if (!f106) throw new Error("f106b missing");
  const v = solveVlm(f106.planform()), m = vortexModel(v);
  const loop = (k: number) => {
    const T = (2 * Math.PI) / k;
    const pts = unsteadyPolar(v, m, (t) => rad((30 - 15 * Math.cos(k * t)) * D), 2 * T, T / 600, GK_DELTA_ORDER).filter((p) => p.t >= T - 1e-9);
    return { pts, area: loopArea(pts) };
  };
  const slow = loop(0.0125), fast = loop(0.05);
  const stat = unsteadyPolar(v, m, (t) => rad((15 + t * 0.05) * D), 600, 2, { tau1: 0, tau2: 0 });
  const curves: Curve[] = [
    { label: "static polar", color: "var(--fg-3)", dash: "6 4", pts: stat.map((p) => [r3(p.alpha / D), r3(p.cl)] as const) },
    { label: "slow pitch (k = 0.0125)", color: "var(--c3)", pts: slow.pts.map((p) => [r3(p.alpha / D), r3(p.cl)] as const) },
    { label: "fast pitch (k = 0.05)", color: "var(--accent)", pts: fast.pts.map((p) => [r3(p.alpha / D), r3(p.cl)] as const) },
  ];
  return { curves, slow: slow.area / D, fast: fast.area / D };
}

/** HARV from trimmed level flight: pitch to 35° over 2 s, hold 4 s, back over 2 s; thrust held at trim. */
function harvPitchUp() {
  const v = solveVlm(harvPlanform()), m = vortexModel(v);
  const trim = trimLevel(v, m, 450, 15000);
  const a0 = trim.alpha / D, a1 = 35;
  const alpha = (t: number) => rad((t < 1 ? a0 : t < 3 ? a0 + ((a1 - a0) * (t - 1)) / 2 : t < 7 ? a1 : t < 9 ? a1 - ((a1 - a0) * (t - 7)) / 2 : a0) * D);
  const run = (tau1: number) => simulateFlight(v, m, { v: 450, gamma: 0, h: 15000, x: 0 }, { alpha, thrust: () => trim.thrust }, 12, 0.01, HARV_AIRFRAME, { gk: { tau1, tau2: 0 } });
  const lag = run(GK_DELTA_ORDER.tau1), quasi = run(0);
  const every = (a: typeof lag) => a.filter((_, k) => k % 5 === 0);
  const curves: Curve[] = [
    { label: "lift, quasi-static", color: "var(--fg-3)", dash: "6 4", pts: every(quasi).map((p) => [r3(p.t), r3(p.cl)] as const) },
    { label: "lift with vortex lag", color: "var(--accent)", pts: every(lag).map((p) => [r3(p.t), r3(p.cl)] as const) },
  ];
  const end = lag[lag.length - 1], endQ = quasi[quasi.length - 1];
  const maxDiff = Math.max(...lag.map((p, k) => Math.abs(p.cl - (quasi[k]?.cl ?? p.cl))));
  const peakG = Math.max(...lag.map((p) => p.lift / HARV_AIRFRAME.weightLb));
  return { curves, trimAlpha: a0, end, endQ, maxDiff, peakG, extrapolated: lag.some((p) => p.extrapolated) };
}

const VERDICT_TONE: Record<string, string> = { valuable: "text-good", "useful, easy to copy": "text-accent", "promising, unproven": "text-fg-2", "low value": "text-warning", "rejected on evidence": "text-fg-3" };
const STATUS: Record<string, string> = { done: "built", rejected: "tried, not adopted", next: "not started" };

export default function AeroPage() {
  const loops = pitchLoops();
  const fv = flight.flight.variants;
  const weightSeries: Series[] = [
    { label: "sharp edge (old)", color: "var(--fg-3)", pts: (fv[0]?.points ?? []).map((q) => [q.alphaDeg, q.weightLb] as const) },
    { label: "attached edge", color: "var(--c3)", pts: (fv[1]?.points ?? []).map((q) => [q.alphaDeg, q.weightLb] as const) },
    { label: "rounded edge, fitted", color: "var(--accent)", pts: (fv[2]?.points ?? []).map((q) => [q.alphaDeg, q.weightLb] as const) },
  ];
  const trimFirst = flight.trim.rows[0], trimLast = flight.trim.rows[flight.trim.rows.length - 1];
  const moatClear = value.items.filter((i) => i.levels.defensibility >= value.criteria.moatMin).length;
  const lowValue = value.items.filter((i) => i.verdict === "low value").map((i) => i.title);
  const counts = value.items.reduce<Record<string, number>>((a, i) => ({ ...a, [i.verdict]: (a[i.verdict] ?? 0) + 1 }), {});
  const pu = harvPitchUp();
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
          <Stat value="141" label="engine checks" hint="128 invariant tests · 7 static rules · 6 type proofs" />
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

      <Section eyebrow="Value review · ORION, moat score, aftermath" title="Is each piece of this work actually worth having?"
        description={`Every part of the aerodynamics work is reviewed each time it changes; a test fails if a module is not covered. Compass's judge gives each item a moat score (how hard it would be to copy) and quality and impact scores from 0 to 4; ORION ranks them; ORION's aftermath shows how the net effect plays out. The verdict is a fixed rule, not the model's opinion. ${value.criteria.useful} ${value.criteria.moat} ${value.criteria.proven}`}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
          {["valuable", "useful, easy to copy", "low value", "rejected on evidence"].map((k) => <Stat key={k} value={`${counts[k] ?? 0}`} label={k} />)}
        </div>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-[13px]">
            <thead className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-fg-2"><tr className="border-b border-line">
              <th className="p-3">ORION</th><th>Work and why</th><th>Verdict</th><th className="text-right">Impact</th><th className="text-right">Moat</th><th className="text-right">Quality</th><th className="pl-4 pr-3">Aftermath at a year</th></tr></thead>
            <tbody>
              {value.items.map((i) => {
                const year = i.aftermath.reduce((a, s) => (Math.abs(s.days - 365) < Math.abs(a.days - 365) ? s : a), i.aftermath[0] ?? { days: 0, when: "", value: 0, well: 0, mixed: 0, hard: 0, sign: "" });
                return (
                  <tr key={i.id} className="border-b border-line/60 align-top">
                    <td className="p-3"><div className="num font-mono text-[18px] font-medium">{i.orion.rank}</div><div className="num font-mono text-[11px] text-fg-3">{pct(i.orion.pFirst)} first</div></td>
                    <td className="max-w-[440px] py-3 pr-4">
                      <div className="font-medium">{i.title} <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-3">· {STATUS[i.status]}</span></div>
                      <ul className="mt-1 grid gap-0.5 text-[12.5px] text-fg-2"><li>{i.why.useful}</li><li>{i.why.moat}</li><li>Evidence: {i.why.evidence}</li></ul>
                    </td>
                    <td className={`py-3 pr-3 font-mono text-[12px] ${VERDICT_TONE[i.verdict] ?? ""}`}>{i.verdict}</td>
                    <td className={`num py-3 text-right font-mono ${i.levels.impact >= value.criteria.usefulMin ? "" : "text-warning"}`}>{i.levels.impact.toFixed(2)}</td>
                    <td className={`num py-3 text-right font-mono ${i.levels.defensibility >= value.criteria.moatMin ? "" : "text-warning"}`}>{i.levels.defensibility.toFixed(2)}</td>
                    <td className="num py-3 text-right font-mono">{i.levels.quality.toFixed(2)}</td>
                    <td className="num py-3 pl-4 pr-3 font-mono text-[12px] text-fg-2">well {pct(year.well)}<br />mixed {pct(year.mixed)}<br />hard {pct(year.hard)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[13px] text-fg-2">{value.criteria.verdicts} {moatClear === 0 ? "Nothing here clears the moat threshold" : `${moatClear} of ${value.items.length} items clear the moat threshold`}: the code is open source, so what is hard to copy is the validation record, not the solver. ORION puts first: {value.items[0]?.title}. {lowValue.length > 0 ? `Rated low value until checked against measurements: ${lowValue.join("; ")}.` : ""} Agreement between ORION&apos;s ranking methods: {value.agreement.toFixed(2)}. {value.note} Model {value.model}, reviewed {value.generated.slice(0, 10)}, evidence digest {value.evidenceDigest}.</p>
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

      <Section eyebrow="Dynamics" title="Lift that lags: vortex breakdown in motion"
        description="A leading-edge vortex does not burst the instant the angle passes the static breakdown angle: the burst point moves slowly. The Goman–Khrabrov state-space model carries the share of vortex lift present as one state that relaxes toward its static value with a time constant of about 15 convective units (c/V), the order reported for 65–70° delta wings. At τ = 0 it is exactly the static polar.">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="grid content-start gap-3 p-5">
            <div className="eyebrow">F-106B wing, pitching 15° → 45° → 15°</div>
            <LineChart curves={loops.curves} xMin={15} xMax={45} xLabel="Angle of attack α, degrees →" yLabel="CL" aria="Lift coefficient against angle of attack over one pitch cycle, static and at two pitch rates" />
            <p className="text-[13px] text-fg-2">Going up, the vortex holds on past its static breakdown angle; coming down, it re-forms late. The loop area ∮CL dα is {loops.fast.toFixed(2)} (CL·degrees) at the faster rate and {loops.slow.toFixed(2)} at the slower one, and tends to zero as the motion slows (tested).</p>
          </Panel>
          <Panel className="grid content-start gap-3 p-5">
            <div className="eyebrow">F/A-18 HARV, pitch-up from level flight at 450 ft/s, 15,000 ft</div>
            <LineChart curves={pu.curves} xMin={0} xMax={12} xLabel="Time, seconds →" yLabel="CL" aria="HARV lift coefficient over a pitch-up, quasi-static and with the vortex lag" />
            <p className="text-[13px] text-fg-2">Trimmed at α = {pu.trimAlpha.toFixed(1)}° with the published fighter-escort weight ({HARV_MASS.fighterEscort60pctFuel.weightLb.toLocaleString("en")} lb, NASA TM-110216), pitched to 35° and back, thrust held: peak load {pu.peakG.toFixed(1)} g, and after 12 s {Math.round(pu.end?.h ?? 0).toLocaleString("en")} ft at {Math.round(pu.end?.v ?? 0)} ft/s. Here the lag changes lift by at most {pu.maxDiff.toFixed(3)}: in this model few of the HARV&apos;s leading edges reach their breakdown angle below 35°, and the lag (τ1·c/V, under a second) is short against a 2 s ramp. On the F-106B wing the same model gives the loops on the left. <span className="text-warning">Outside the validated domain:</span> the HARV&apos;s 26.7° wing sweep is below the breakdown map, so its numbers illustrate the method, not the aircraft.</p>
          </Panel>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["Exact mathematics", "The state is stepped with the exact exponential solution, so it can never overshoot; the Goman et al. linear frequency response (gain 1/√(1+τ²ω²), lag atan τω) and their in-phase/quadrature relation are reproduced to 3 decimals in tests."],
            ["Flight-path invariants", "Without drag or thrust, energy h + V²/2g is conserved to 10⁻⁷; with them, its change equals ∫(T−D)V/W dt; trimmed flight stays level; the integrator converges at fourth order where the aerodynamics are smooth."],
            ["Kept visible", "On the HARV the static breakdown model is a staircase (edges swept below the map burst at its 2° floor), which breaks fourth-order convergence at τ = 0. A gradual-breakdown option removes the jumps and, scored out of sample, lowers the error (RMS 0.121 → 0.104), but its fitted width runs to the edge of every grid tried, so it is not adopted: the step model stays the default."],
          ].map(([k, t]) => <Panel key={k} className="grid content-start gap-2 p-5"><div className="eyebrow">{k}</div><p className="text-[14px] text-fg-2">{t}</p></Panel>)}
        </div>
      </Section>

      <Section eyebrow="Checks" title="How the engine is kept honest">
        <div className="grid gap-4 md:grid-cols-2">
          {[
            ["Invariant tests (128)", "Property-based (fast-check): scale and translation invariance, odd lift, vortex lift ≥ 0, breakdown only removes lift, burst share monotone in α, elliptic bound on span efficiency within a mesh tolerance that shrinks on refinement, conformal coverage by simulation, refusal of invalid geometry and unbounded meshes."],
            ["Verification against theory", "Slender-wing limit Kp → πA/2, lifting-line limit at A = 20, mesh convergence < 1%, Polhamus Kv range, the published F/A-18 reference MAC (11.517 ft) reproduced by the generic layout."],
            ["Geometry, checked like a solid modeller", "Every component of the HARV is a closed, consistently oriented solid: each edge shared by exactly two triangles, one shell (Euler characteristic 2), outward normals (positive volume), welded vertices, no degenerate triangles, the left side the exact mirror of the right. The fuselage and canopy follow monotone cubic curves (Fritsch–Carlson) through the traced stations: smooth, exact at every station, never overshooting. Fuselage volume converges to the integral of its exact superellipse sections; the wing's planform matches the analytic trapezoid."],
            ["Static analysis (7 rules)", "A compiler-API gate on lib/aero: pure imports only, no randomness or clocks, no any / non-null / casts, strict equality, angle parameters must be typed Rad or Deg, every export referenced by a test, and the unit proofs must still fail when their guards are removed."],
            ["Compile-time unit proofs (6)", "Degrees, radians and bare numbers are distinct types; six deliberate misuses must fail to compile. Removing a guard was checked to break the build."],
          ].map(([k, v]) => <Panel key={k} className="grid content-start gap-2 p-5"><div className="eyebrow">{k}</div><p className="text-[14px] text-fg-2">{v}</p></Panel>)}
        </div>
      </Section>

      <Section eyebrow="Limits" title="What this does not do">
        <ul className="grid gap-2 text-[14px] text-fg-2">
          <li>The delta wings in the validation table are NASA wind-tunnel test wings, used only to measure the error band; the models offered are real aircraft only.</li>
          <li>Thin flat wings with sharp leading edges at low speed. No thickness, camber, rounded edges, fuselage, tails, flaps, compressibility or Reynolds-number effects.</li>
          <li>The F/A-18 HARV is built from NASA&apos;s published dimensions and outlines traced from the NASA three-view (±0.3 ft), not manufacturer geometry. Its aerodynamics use the wing and LEX only (no fuselage, tails or scheduled flaps); it is labelled outside the validated domain and its band doubled.</li>
          <li>Lateral behaviour (sideslip, rolling, forebody vortices) is not modelled. Pitch dynamics use one vortex state with a time constant of the reported order, not one identified for these wings; the flight path is a point mass with angle of attack prescribed, not a 6-degree-of-freedom aircraft with controls.</li>
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
