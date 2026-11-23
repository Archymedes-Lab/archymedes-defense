import type { Metadata } from "next";
import { Dossier } from "@/components/project/dossier";
import { SitewatchLab } from "@/components/sitewatch/lab";
import { PageHeader, Panel, Section, StatusBadge } from "@/components/ui/primitives";
import evaluation from "@/lib/data/sitewatch-eval.json";
import { CAUSES, KIND_TO_CAUSE } from "@/lib/causes";
import { projectBySlug } from "@/lib/portfolio";

export const metadata: Metadata = { title: "Sitewatch" };

type Engine = { classified: number; episodes: number; false_alarms: number; alarm_overlap: number; classified_by_kind: Record<string, string> };

export default function SitewatchPage() {
  const project = projectBySlug("sitewatch")!;
  const acc = evaluation.accuracy as Record<"sitewatch" | "naive_2hb" | "naive_3hb", Engine>;
  const other = evaluation.false_alarms_excluding_hum10_frozen as Record<string, number>;
  const rows: [string, Engine, number][] = [["Sitewatch", acc.sitewatch, other.sitewatch ?? 0], ["Naive, 3 heartbeats", acc.naive_3hb, other.naive_3hb ?? 0], ["Naive, 2 heartbeats", acc.naive_2hb, other.naive_2hb ?? 0]];
  return (
    <>
      <PageHeader eyebrow="Sitewatch · sensor reliability" title="Know why a sensor went quiet."
        lede={`Sitewatch reads heartbeat messages from site sensors and names the cause of each failure: a lost link, a buffered link, a power loss, intermittent loss, a clock jump or a frozen reading. ${process.env.NEXT_PUBLIC_ENGINE === "static" ? "Runs shown here were produced ahead of time by the same engine." : "This page runs the real engine on the server."}`}>
        <div className="flex flex-wrap gap-2"><StatusBadge status={project.status} /><span className="tag">Synthetic traces only</span></div>
      </PageHeader>

      <SitewatchLab />

      <Section eyebrow="Evaluation · 50 seeds" title="450 faults, scored"
        description="The same generator wrote both the faults and the test, so this shows the logic is internally consistent. It does not show field accuracy. That needs real device traces.">
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-[14px]">
            <thead className="text-left text-[12px] text-fg-2">
              <tr className="border-b border-line">
                <th className="px-5 py-3 font-medium">Engine</th><th className="px-5 py-3 font-medium">Cause named</th>
                <th className="px-5 py-3 font-medium">Any alarm overlapped</th><th className="px-5 py-3 font-medium">False alarms</th>
                <th className="px-5 py-3 font-medium">Excluding humidity hard case</th>
              </tr>
            </thead>
            <tbody className="num">
              {rows.map(([name, e, rest]) => (
                <tr key={name} className="border-b border-line last:border-0">
                  <td className="px-5 py-3 font-medium">{name}</td><td className="px-5 py-3">{e.classified} / {e.episodes}</td>
                  <td className="px-5 py-3">{e.alarm_overlap} / {e.episodes}</td><td className="px-5 py-3">{e.false_alarms.toLocaleString()}</td>
                  <td className="px-5 py-3">{rest.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <div className="grid gap-3 sm:grid-cols-3">
          {Object.entries(acc.sitewatch.classified_by_kind).map(([kind, v]) => {
            const cause = KIND_TO_CAUSE[kind]!;
            return (
              <Panel key={kind} className="flex items-center justify-between gap-3 p-4">
                <span className="inline-flex items-center gap-2 text-[14px]"><span className="h-2.5 w-2.5 " style={{ background: CAUSES[cause].color }} />{CAUSES[cause].label}</span>
                <span className="num font-mono text-[13px] text-fg-2">{v}</span>
              </Panel>
            );
          })}
        </div>
        <p className="text-[13px] text-fg-2">Cost of the real command-line tool: a 48-hour site trace (17.8 MB) takes {evaluation.cost[1]?.cpu_s} s of CPU and peaks at {evaluation.cost[1]?.max_rss_mb_any_child} MB.</p>
      </Section>

      <Dossier project={project} />
    </>
  );
}
