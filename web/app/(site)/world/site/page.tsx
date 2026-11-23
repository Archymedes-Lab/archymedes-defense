import { readFileSync } from "node:fs";
import type { Metadata } from "next";
import Link from "next/link";
import { SiteScene } from "@/components/three/client";
import { PageHeader, Panel, Section, Stat } from "@/components/ui/primitives";
import { swissSim } from "@/lib/world";

export const metadata: Metadata = { title: "Warehouse site" };

const SITE = "/world/ch-lauterbrunnen";
type Credit = { id: string; kind: string; licence: string; source: string; copyright?: string };
type YardInfo = { half_m: number; terrain: { tex_m_per_px: number; step_m: number }; buildings: { count: number }; trees: { count: number } };

export default function WarehouseSitePage() {
  // read at build time from the generated files; both sit behind sign-in like the rest of /world
  const credits = (JSON.parse(readFileSync("public/world/assets/CREDITS.json", "utf8")) as { assets: Credit[] }).assets;
  const yard = JSON.parse(readFileSync(`public${SITE}/yard/yard.json`, "utf8")) as YardInfo;
  const sim = swissSim;
  const by = (k: string) => credits.filter((c) => c.kind === k);
  return (
    <>
      <PageHeader eyebrow="Site sim · warehouse site" title="One site, close up."
        lede={`The warehouse site cut out of the valley as its own scene: ${yard.half_m * 2} m across, terrain every ${yard.terrain.step_m} m and imagery at ${(yard.terrain.tex_m_per_px * 100).toFixed(1)} cm, both measured. The compound on it is synthetic, built from scanned props and materials under a real sky. The same drills play here, with every guard and machine at true size.`}>
        <div className="flex flex-wrap gap-2"><span className="tag">Synthetic compound · measured ground</span><span className="tag">No weapons or targeting</span>
          <Link href="/world" className="tag hover:text-accent">← Whole valley</Link></div>
        <div className="mt-4 grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat value={`${(yard.terrain.tex_m_per_px * 100).toFixed(1)} cm`} label="imagery per pixel" hint="valley view: 49 cm" />
          <Stat value={`${yard.terrain.step_m} m`} label="terrain mesh" hint="valley view: 4 m" />
          <Stat value={yard.buildings.count} label="measured buildings" hint={`${yard.trees.count} trees from canopy data`} />
          <Stat value={by("model").length + by("person").length} label="scanned models" hint="all openly licensed" />
        </div>
      </PageHeader>

      <SiteScene yardBase={`${SITE}/yard`} assetsBase="/world/assets" modelsBase="/world/models" simBase={`${SITE}/sim`}
        drills={sim.replays} />

      <Section eyebrow="What is real here" title="Measured, placed and assumed"
        description="The scene mixes three kinds of thing, and they are kept apart.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Panel className="grid content-start gap-1.5 p-4">
            <div className="text-[14.5px] font-medium">Measured</div>
            <p className="text-[13px] text-fg-2">Ground shape, aerial imagery and the {yard.buildings.count} surrounding buildings come from swisstopo data. Each tree stands where the surface model shows a canopy peak, at the measured height; its shape is a generic conifer.</p>
          </Panel>
          <Panel className="grid content-start gap-1.5 p-4">
            <div className="text-[14.5px] font-medium">Placed</div>
            <p className="text-[13px] text-fg-2">The warehouse, yard, fence, gate, lights, cameras and stock are synthetic. They are scanned real objects, but nobody built this compound: it is placed by rule on open ground and marked as such.</p>
          </Panel>
          <Panel className="grid content-start gap-1.5 p-4">
            <div className="text-[14.5px] font-medium">Assumed</div>
            <p className="text-[13px] text-fg-2">The models are looks only. How fast each machine moves, how long its battery lasts and how far it sees are round class figures in the simulation, not the data of the products shown.</p>
          </Panel>
        </div>
      </Section>

      <Section eyebrow="Sources" title="Where the models come from"
        description="Every downloaded asset is recorded with its licence, source and checksum. Nothing downloaded is executed: these are model, texture and animation files.">
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-[14px]">
            <thead><tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">
              <th className="p-3 font-normal">Asset</th><th className="p-3 font-normal">Kind</th><th className="p-3 font-normal">Licence</th><th className="p-3 font-normal">Source</th>
            </tr></thead>
            <tbody>
              {credits.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="p-3 font-mono text-[12.5px]">{c.id.replace(".max.fbx", "")}</td>
                  <td className="p-3 text-fg-2">{c.kind}</td>
                  <td className="p-3">{c.licence}{c.copyright ? <span className="text-fg-3"> · {c.copyright}</span> : null}</td>
                  <td className="p-3 text-fg-2">{c.source.includes("polyhaven") ? "Poly Haven" : "Microsoft Rocketbox"}</td>
                </tr>
              ))}
              <tr className="border-b border-line"><td className="p-3 font-mono text-[12.5px]">Unitree Go2</td><td className="p-3 text-fg-2">model</td><td className="p-3">BSD-3-Clause<span className="text-fg-3"> · (c) Unitree Robotics</span></td><td className="p-3 text-fg-2">MuJoCo Menagerie</td></tr>
              <tr><td className="p-3 font-mono text-[12.5px]">Skydio X2</td><td className="p-3 text-fg-2">model</td><td className="p-3">Apache-2.0</td><td className="p-3 text-fg-2">MuJoCo Menagerie</td></tr>
            </tbody>
          </table>
        </Panel>
        <p className="text-[13px] text-fg-2">The patrol vehicle and camera masts are modelled in code: no openly licensed realistic pickup was found. Drill results and the 30-day equipment run are on the <Link href="/world" className="text-accent underline">valley page</Link>.</p>
      </Section>
    </>
  );
}
