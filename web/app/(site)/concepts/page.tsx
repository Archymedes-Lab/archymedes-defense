import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, StatusBadge } from "@/components/ui/primitives";
import { CONCEPT_SLUGS, CONCEPTS } from "@/lib/concepts";
import { fmt2, projectBySlug } from "@/lib/portfolio";

export const metadata: Metadata = { title: "Concepts" };

export default function ConceptsPage() {
  return (
    <>
      <PageHeader eyebrow="Concepts" title="Five more businesses, scored."
        lede="None has a partner yet. Subsea monitoring now runs on public cable, seabed, traffic and live ship data; the other four are still illustrated concepts." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CONCEPT_SLUGS.map((slug) => {
          const p = projectBySlug(slug)!;
          return (
            <Link key={slug} href={`/${slug}`} className="panel grid content-start gap-3 p-5 transition-colors hover:bg-surface">
              <div className="flex items-center justify-between gap-2"><span className="text-[16px] font-semibold">{p.short}</span><StatusBadge status={p.status} /></div>
              <p className="text-[14px] text-fg-2">{CONCEPTS[slug].headline}</p>
              <div className="num font-mono text-[13px]"><span className="text-fg-3">{fmt2(p.prototype)} →</span> <span className="text-fg">{fmt2(p.conditional)}</span></div>
            </Link>
          );
        })}
        <Link href="/" className="panel grid content-center gap-2 p-5 text-[14px] text-fg-2 transition-colors hover:bg-surface">
          <span className="font-semibold text-fg">All seven projects</span>Compare every score on the overview.
        </Link>
      </div>
    </>
  );
}
