import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Dossier } from "@/components/project/dossier";
import { ConceptScene } from "@/components/three/client";
import type { ConceptKind } from "@/components/three/concepts";
import { PageHeader, Panel, Section, StatusBadge } from "@/components/ui/primitives";
import { CONCEPT_SLUGS, CONCEPTS } from "@/lib/concepts";
import { projectBySlug } from "@/lib/portfolio";

export const dynamicParams = false;
export function generateStaticParams() {
  return CONCEPT_SLUGS.filter((slug) => slug !== "subsea").map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: projectBySlug(slug)?.short ?? "Project" };
}

export default async function ConceptPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = projectBySlug(slug);
  if (!project || !(slug in CONCEPTS)) notFound();
  const c = CONCEPTS[slug as ConceptKind];
  return (
    <>
      <PageHeader eyebrow={`${project.short} · concept`} title={c.headline} lede={c.lede}>
        <div className="flex flex-wrap gap-2"><StatusBadge status={project.status} /><span className="tag">{c.dataNote}</span></div>
      </PageHeader>
      <Panel className="overflow-hidden">
        <ConceptScene kind={slug as ConceptKind} label={c.scene} />
        <p className="border-t border-line px-5 py-3 text-[13px] text-fg-2">{c.scene}</p>
      </Panel>
      <Section eyebrow="Where it stands" title="First step">
        <Panel className="p-6 text-[15px] leading-relaxed">{c.firstStep}</Panel>
      </Section>
      <Dossier project={project} />
    </>
  );
}
