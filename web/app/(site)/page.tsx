import Link from "next/link";
import { DefensibilityChart } from "@/components/charts/dumbbell";
import { TowersScene } from "@/components/three/client";
import { PageHeader, Panel, Section, Stat, StatusBadge } from "@/components/ui/primitives";
import { fmt2, portfolio, projects } from "@/lib/portfolio";

export default function Overview() {
  const above3 = projects.filter((p) => p.conditional >= 3).length;
  const lo = Math.min(...projects.map((p) => p.prototype)), hi = Math.max(...projects.map((p) => p.prototype));
  return (
    <>
      <PageHeader eyebrow="Portfolio · 18 November 2026" title="Seven defense businesses. Where each moat comes from."
        lede="Every project starts near 1 out of 4 on defensibility. It climbs past 3 only after it earns specific assets: integrations, partners and confirmed field outcomes. Two prototypes run today.">
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
          <Stat value={`${above3} of 7`} label="clear 3.0 once assets exist" />
          <Stat value={`${fmt2(lo)}–${fmt2(hi)}`} label="as first prototypes" />
          <Stat value="2" label="working prototypes" hint="Sitewatch, Battery" />
          <Stat value="0" label="partners or contracts" />
        </div>
      </PageHeader>

      <Panel className="overflow-hidden"><TowersScene projects={projects} /></Panel>
      <p className="mt-3 text-[13px] text-fg-2">Solid core: score of a 90-day prototype with no partners. Ghost: score once the listed assets are earned, over roughly 18 to 36 months. Select a tower to open its project.</p>

      <Section eyebrow="Defensibility" title="The gap is the work"
        description="Compass defensibility on a 0 to 4 scale, judged by Jev over 14 runs in both presentation orders. The conditional score assumes the assets exist. It is not a forecast that we will get them.">
        <Panel className="p-4 sm:p-6"><DefensibilityChart projects={projects} levels={portfolio.levels} /></Panel>
      </Section>

      <Section eyebrow="Projects" title="What each one needs">
        <div className="panel divide-y divide-line">
          <div className="hidden grid-cols-[48px_200px_minmax(0,1fr)_132px] gap-6 px-5 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-fg-3 sm:grid">
            <span>ID</span><span>Project</span><span>Assets that create the moat</span><span className="text-right">Proto → Assets</span>
          </div>
          {projects.map((p, i) => (
            <Link key={p.slug} href={`/${p.slug}`} className="group grid gap-3 p-5 transition-colors hover:bg-surface sm:grid-cols-[48px_200px_minmax(0,1fr)_132px] sm:items-center sm:gap-6">
              <span className="font-mono text-[12px] text-fg-3 group-hover:text-accent">{String(i + 1).padStart(2, "0")}</span>
              <div className="grid gap-2">
                <span className="text-[16px] font-medium">{p.short}</span>
                <StatusBadge status={p.status} />
              </div>
              <p className="text-[14px] text-fg-2">{p.moat}.</p>
              <div className="num font-mono text-[13px] sm:text-right"><span className="text-fg-3">{fmt2(p.prototype)} →</span> <span className="text-[17px] text-fg group-hover:text-accent">{fmt2(p.conditional)}</span></div>
            </Link>
          ))}
        </div>
      </Section>
    </>
  );
}
