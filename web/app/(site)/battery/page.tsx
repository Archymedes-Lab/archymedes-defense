import type { Metadata } from "next";
import { BatteryExplorer } from "@/components/battery/explorer";
import { Dossier } from "@/components/project/dossier";
import { PageHeader, Panel, Section, Stat, StatusBadge } from "@/components/ui/primitives";
import { battery, median, spearman, summarize } from "@/lib/battery";
import { projectBySlug } from "@/lib/portfolio";

export const metadata: Metadata = { title: "Battery outcomes" };

export default function BatteryPage() {
  const project = projectBySlug("battery")!;
  const conditions = summarize(battery);
  const lives = battery.cells.flatMap((c) => (c.weeksTo80 === null ? [] : [c.weeksTo80]));
  const scored = conditions.filter((c) => c.medianTo80 !== null);
  const life = scored.map((c) => c.medianTo80!);
  const factors = [
    { name: "Depth of discharge", rho: spearman(scored.map((c) => c.dod), life) },
    { name: "Charge rate", rho: spearman(scored.map((c) => c.chargeC), life) },
    { name: "Discharge rate", rho: spearman(scored.map((c) => c.dischargeC), life) },
  ];
  const mid = median(life)!;
  const typical = [...scored].sort((a, b) => Math.abs(a.medianTo80! - mid) - Math.abs(b.medianTo80! - mid))[0]!;
  const s = battery.source;
  return (
    <>
      <PageHeader eyebrow="Battery outcomes · real public data" title="How hard use wears a lithium cell."
        lede={`${battery.cells.length} lithium polymer cells (${s.ratedAh * 1000} mAh rated) were cycled under ${battery.conditions.length} combinations of charge rate, discharge rate and depth of discharge until they wore out. Pick a condition to see how its cells faded.`}>
        <div className="flex flex-wrap gap-2"><StatusBadge status={project.status} /><span className="tag">{s.license} · ISU-ILCC</span></div>
        <div className="mt-4 grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat value={battery.cells.length} label="cells" />
          <Stat value={battery.conditions.length} label="test conditions" />
          <Stat value={`${median(lives)?.toFixed(1)} wk`} label="median time to 80%" />
          <Stat value={`${Math.min(...lives).toFixed(1)}–${Math.max(...lives).toFixed(0)}`} label="weeks to 80%, range" />
        </div>
      </PageHeader>

      <BatteryExplorer conditions={conditions} cells={battery.cells} initial={typical.group} />

      <Section eyebrow="What drives wear here" title="Rank correlation with life"
        description="Spearman correlation between each stress factor and median weeks to 80% across the 63 conditions. Negative means harder use, shorter life. This is an association in this dataset, not a calibrated aging model.">
        <div className="grid gap-4 sm:grid-cols-3">
          {factors.map((f) => (
            <Panel key={f.name} className="grid gap-3 p-5">
              <div className="text-[14px] font-medium">{f.name}</div>
              <div className="num text-[34px] font-semibold leading-none">{f.rho >= 0 ? "+" : "−"}{Math.abs(f.rho).toFixed(2)}</div>
              <div className="relative h-2  bg-surface">
                <span className="absolute top-0 h-2  bg-accent" style={{ left: f.rho < 0 ? `${50 + f.rho * 50}%` : "50%", width: `${Math.abs(f.rho) * 50}%` }} />
                <span className="absolute -top-1 left-1/2 h-4 w-px bg-fg-3" />
              </div>
              <div className="flex justify-between font-mono text-[10.5px] text-fg-3"><span>−1 shorter life</span><span>+1 longer</span></div>
            </Panel>
          ))}
        </div>
        <p className="text-[13px] text-fg-2">For the business, the gap is field data: these are lab cells under fixed cycles. Equipment-specific models need fleet telemetry and reference tests from a partner.</p>
      </Section>

      <Section eyebrow="Safety" title="Thermal-runaway propagation">
        <a href="/battery/runaway" className="panel group grid gap-2 p-5 transition-colors hover:bg-surface sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div><div className="text-[16px] font-medium group-hover:text-accent">Will one failing cell take the pack with it?</div>
          <p className="text-[13.5px] text-fg-2">Pack-layout simulator built on 277 measured abuse tests, calibrated and checked against published propagation experiments.</p></div>
          <span className="btn-ghost">Open simulator →</span>
        </a>
      </Section>

      <Dossier project={project} />

      <Section eyebrow="Data credit" title="Source and licence">
        <Panel className="grid gap-2 p-5 text-[13.5px] text-fg-2">
          <p><span className="text-fg">{s.title}</span> by {s.authors.join(", ")}. DOI <a className="link" href={`https://doi.org/${s.doi}`} target="_blank" rel="noopener noreferrer">{s.doi}</a>. Licensed <a className="link" href={s.licenseUrl} target="_blank" rel="noopener noreferrer">{s.license}</a>.</p>
          <p>{s.modified} Time axis: {s.timeUnit}.</p>
        </Panel>
      </Section>
    </>
  );
}
