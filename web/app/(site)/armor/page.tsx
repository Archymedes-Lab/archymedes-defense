import type { Metadata } from "next";
import { ArmorWorkbench } from "@/components/armor/workbench";
import { PageHeader, Panel, Section, Stat } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Soft armor screening" };

const SOURCES = [
  { k: "Models", v: "Phoenix-Porwal and Cunniff as restated in NIST 2020, J. Res. NIST 125:026", href: "https://doi.org/10.6028/jres.125.026", note: "Equations 1-13, Tables 1-2 reproduced in unit tests" },
  { k: "Original model", v: "Phoenix & Porwal 2003, Int. J. Solids Struct. 40:6723", href: "https://doi.org/10.1016/s0020-7683(03)00329-9", note: "Membrane model of multi-ply fibrous armor" },
  { k: "Test planning", v: "Johnson et al. 2014, IEEE Access 2:1442", href: "https://doi.org/10.1109/access.2014.2377633", note: "DoD comparison of sequential V50 designs; benchmark reproduced" },
  { k: "Threats", v: "NIJ Standard 0123.00, Table 1", href: "https://www.ojp.gov/pdffiles1/nij/307347.pdf", note: "HG1 and HG2 test threats and reference velocities" },
  { k: "Test procedure", v: "NIJ Standard 0101.07, §9.5", href: "https://www.ojp.gov/pdffiles1/nij/307346.pdf", note: "Ballistic-limit series: up-and-down steps, at least 60 PP and 30 CP" },
  { k: "Validation data", v: "NIST data, doi 10.18434/M32179", href: "https://doi.org/10.18434/M32179", note: "Aged-armor yarn and V50 data; repository unreachable on 2026-11-19, not yet used" },
];

export default function ArmorPage() {
  return (
    <>
      <PageHeader eyebrow="Armor outcomes · soft armor · prototype" title="Screen a panel before the range, then plan the test."
        lede="Predict a soft-armor design's V50 relative to a panel you have already tested, draw it, and plan the ballistic-limit test. Protective armor against the published NIJ handgun levels only; screening supports design, it never replaces certification.">
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
          <Stat value="16 / 16" label="model and planner tests" hint="NIST tables, NIJ steps, DoD benchmark, prior robustness" />
          <Stat value="5.8 ft/s" label="3POD bias on the DoD grid" hint="paper ≈ 12.5 ft/s; 30 cells × 1,000 tests" />
          <Stat value="100%" label="tests with an estimate at 6 shots" hint="physics prior; NIJ up-and-down 57-63%" />
          <Stat value="≥ 90" label="shots in a NIJ 0101.07 V50 series" hint="60 partial + 30 complete penetrations" />
        </div>
      </PageHeader>

      <Section eyebrow="Workbench" title="Design, drawing and test plan">
        <ArmorWorkbench />
      </Section>

      <Section eyebrow="What the benchmark showed" title="Honest results"
        description="Measured with the same simulator the planner uses, before any claim was written into a test.">
        <div className="grid gap-4 md:grid-cols-3">
          <Panel className="grid content-start gap-2 p-5"><div className="eyebrow">Reproduced</div><p className="text-[14px] text-fg-2">3POD with probit and break separation on the DoD grid: median 10 shots and a mean median bias of about 5.8 ft/s, inside the paper&apos;s ≈ 12.5. A first version with a fixed search window scored 16.4; widening the search when outcomes repeat fixed it.</p></Panel>
          <Panel className="grid content-start gap-2 p-5"><div className="eyebrow">What the prior buys</div><p className="text-[14px] text-fg-2">A V50 estimate after six shots in every test, where the NIJ up-and-down has one in 57-63% of tests (91-94% by ten), and better accuracy than the 3POD-style design at every budget. Where the NIJ procedure does have an estimate it is as accurate or better: its fixed steps suit these spreads. The gain is an earlier, always-available estimate with stated uncertainty, not fewer shots than the standard.</p></Panel>
          <Panel className="grid content-start gap-2 p-5"><div className="eyebrow">When the prior is wrong</div><p className="text-[14px] text-fg-2">The reported V50 is the plain likelihood estimate once results overlap, and until they do the data, not the prior, place the shots: outward steps that double while outcomes repeat, then splitting the gap. A prior two spreads off leaves under 0.1σ of bias by 20 shots; ten spreads off, under 0.25σ. Two earlier versions failed these checks and were changed.</p></Panel>
        </div>
      </Section>

      <Section eyebrow="Limits" title="What this does not do">
        <ul className="grid gap-2 text-[14px] text-fg-2">
          <li>Absolute V50 needs a measured reference: NIST states these models are for relative behaviour, and Cunniff&apos;s empirical curve is not open.</li>
          <li>Fibre presets are typical datasheet values. Real panels depend on weave, stitching, moisture and yarn damage; extracted-yarn tests should replace them.</li>
          <li>No backface deformation or blunt-trauma prediction yet; the 2023 systematic review shows that needs finite-element calibration.</li>
          <li>The planner is for development and lot checks. NIJ certification still requires the standard&apos;s full series at an accredited laboratory.</li>
        </ul>
      </Section>

      <Section eyebrow="Sources" title="Papers and standards">
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
