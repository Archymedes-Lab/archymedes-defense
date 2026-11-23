import type { Metadata } from "next";
import { RunawaySimulator } from "@/components/runaway/simulator";
import { PageHeader, Panel, Section, Stat } from "@/components/ui/primitives";
import cal from "@/lib/data/tr-calibration.json";
import data from "@/lib/data/thermal-runaway.json";
import validation from "@/lib/data/tr-validation.json";
import type { CellType } from "@/lib/battery-tr/model";

export const metadata: Metadata = { title: "Thermal-runaway propagation" };

const VERDICT: Record<string, string> = { match: "text-good", partial: "text-warning", miss: "text-critical" };
const SOURCES = [
  { k: "Heat release data", v: "Battery Failure Databank v2 (NREL, NASA) via Zenodo 10.5281/zenodo.13125063", href: "https://doi.org/10.5281/zenodo.13125063", note: "CC BY 4.0 record; 277 tests at 100% charge used" },
  { k: "Heat paths", v: "Lopez, Jeevarajan & Mukherjee 2015, J. Electrochem. Soc. 162:A1905", href: "https://doi.org/10.1149/2.0921509jes", note: "Eqs. 2-7 and Table III reproduced in tests; spacing results for calibration" },
  { k: "Propagation and barriers", v: "Lee et al. 2020, J. Electrochem. Soc. 167:090524", href: "https://doi.org/10.1149/1945-7111/ab8978", note: "Contact-array speed for calibration; gap and barrier results held out" },
  { k: "Variability", v: "Masalkovaite, Gasper, Finegan 2024, Nature Communications", href: "https://doi.org/10.1038/s41467-024-52653-3", note: "Why heat release must be drawn per cell, not averaged" },
  { k: "ARC conventions", v: "Lamb et al. 2021 (Sandia), J. Electrochem. Soc.", href: "https://doi.org/10.1149/1945-7111/ac0699", note: "Self-heating detection at 0.02 °C/min; not yet used as kinetics" },
];

export default function RunawayPage() {
  const cells = (data.cells as unknown as (CellType & { n: number })[]);
  const v = validation.rows;
  const counts = { match: v.filter((r) => r.verdict === "match").length, partial: v.filter((r) => r.verdict === "partial").length, miss: v.filter((r) => r.verdict === "miss").length };
  return (
    <>
      <PageHeader eyebrow="Battery outcomes · thermal-runaway propagation · prototype" title="Will one failing cell take the pack with it?"
        lede="Design a cell layout, trigger one cell and watch heat spread, using measured heat release from 277 abuse tests on real cells. A screening tool for pack designers, calibrated and checked against published propagation experiments, with its misses shown.">
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
          <Stat value={`${cells.length}`} label="cell models" hint={`${cells.reduce((a, c) => a + c.tests.length, 0)} measured tests`} />
          <Stat value="3" label="calibrated parameters" hint="inside literature bounds" />
          <Stat value={`${counts.match} · ${counts.partial} · ${counts.miss}`} label="match · partial · miss" hint="calibration and held-out checks" />
          <Stat value="12 / 12" label="physics and invariant tests" hint="Lopez Table III, energy closure" />
        </div>
      </PageHeader>

      <Section eyebrow="Simulator" title="Pack layout, trigger and spread">
        <RunawaySimulator cells={cells} calibration={cal} />
      </Section>

      <Section eyebrow="Validation" title="Where the model holds and where it does not"
        description="Calibration rows were used to fit the three parameters; validation rows were held out. A safety tool must say where it is optimistic.">
        <Panel className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13.5px]">
              <thead className="text-left font-mono text-[10.5px] uppercase tracking-[0.1em] text-fg-3">
                <tr className="border-b border-line">{["Use", "Experiment", "Measured", "Model", "Verdict"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {v.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 font-mono text-[11px] uppercase text-fg-3">{r.kind}</td>
                    <td className="px-4 py-2.5 text-fg">{r.source}</td>
                    <td className="px-4 py-2.5 text-fg-2">{r.measured}</td>
                    <td className="px-4 py-2.5 text-fg-2">{r.model}</td>
                    <td className={`px-4 py-2.5 font-mono text-[12px] uppercase ${VERDICT[r.verdict]}`}>{r.verdict}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="grid gap-4 md:grid-cols-3">
          <Panel className="grid content-start gap-2 p-5"><div className="eyebrow">Barriers: optimistic</div><p className="text-[14px] text-fg-2">The model predicts a ceramic board stops propagation; the experiment shows it only slowed it more than 30-fold. Treat any barrier result here as the best case, not a design margin.</p></Panel>
          <Panel className="grid content-start gap-2 p-5"><div className="eyebrow">Variability: under-predicted</div><p className="text-[14px] text-fg-2">Dense arrays propagated in every published test; with measured heat spread the model propagates in about 60% of runs. Its probabilities are lower bounds for dense packs.</p></Panel>
          <Panel className="grid content-start gap-2 p-5"><div className="eyebrow">What is missing</div><p className="text-[14px] text-fg-2">Self-heating kinetics (the critical temperature sits on its 110 °C bound), hot-gas flow around barriers, flame in air and intra-cell gradients. Trigger position is untested: interior triggers spread ejecta heat over more neighbours and propagate less in the model. Each is a named next step, not a hidden fudge.</p></Panel>
        </div>
      </Section>

      <Section eyebrow="Sources" title="Data and papers">
        <div className="panel divide-y divide-line">
          {SOURCES.map((s) => (
            <div key={s.k} className="grid gap-1 p-4 text-[13.5px] sm:grid-cols-[180px_minmax(0,1fr)_minmax(0,300px)] sm:gap-6">
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
