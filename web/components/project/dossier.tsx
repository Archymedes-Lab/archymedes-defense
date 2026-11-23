import { DimensionChart } from "@/components/charts/dims";
import { KV, Panel, Section } from "@/components/ui/primitives";
import type { Project } from "@/lib/portfolio";
import { fmt2, portfolio } from "@/lib/portfolio";

export function Dossier({ project }: { project: Project }) {
  return (
    <Section eyebrow="Dossier" title="What makes it hard to copy"
      description={`Scored ${fmt2(project.prototype)} as a first prototype and ${fmt2(project.conditional)} once the assets below exist. Agreement across Jev runs was ${portfolio.agreement.prototype} and ${portfolio.agreement.milestone} for the two scenarios.`}>
      <Panel className="grid lg:grid-cols-2">
        <dl className="m-0 grid content-start gap-5 p-6 lg:border-r lg:border-line">
          <KV label="Assets that create the moat">{project.moat}.</KV>
          <KV label="Milestone the score assumes">{project.milestone}</KV>
          <KV label="Gate we have not passed">{project.gate}</KV>
          <KV label="Likely buyer">{project.buyer}</KV>
          <KV label="Offer">{project.offer}</KV>
          <KV label="Sources">
            <span className="grid gap-1 font-mono text-[12px]">
              {project.sources.map((s) => (
                <a key={s} href={s} target="_blank" rel="noopener noreferrer" className="link break-all">{s.replace(/^https?:\/\/(www\.)?/, "")}</a>
              ))}
            </span>
          </KV>
        </dl>
        <div className="grid content-start gap-3 border-t border-line p-6 lg:border-t-0">
          <div className="eyebrow">Nine Compass dimensions, 0 to 1</div>
          <DimensionChart project={project} />
          <p className="text-[12.5px] text-fg-2">Hollow: first prototype. Solid: after assets are earned. Effort is a cost, so higher means more work.</p>
        </div>
      </Panel>
    </Section>
  );
}
