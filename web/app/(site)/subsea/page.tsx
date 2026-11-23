import type { Metadata } from "next";
import { Dossier } from "@/components/project/dossier";
import { SubseaExplorer } from "@/components/subsea/explorer";
import { PageHeader, Panel, Section, StatusBadge } from "@/components/ui/primitives";
import { projectBySlug } from "@/lib/portfolio";
import { subsea } from "@/lib/subsea";
import { DEFAULTS, cableRows, sum, tally } from "@/lib/subsea-model";

export const metadata: Metadata = { title: "Subsea monitoring" };

const INCIDENTS = [
  { when: "October 2023", what: "Balticconnector gas pipeline and a Finland–Estonia telecom cable damaged.", note: "Finnish investigators linked it to a container ship that dragged its anchor along the seabed." },
  { when: "December 2024", what: "Estlink 2 power cable and four telecom cables damaged.", note: "Finnish police detained the tanker Eagle S, suspected of dragging its anchor across them." },
  { when: "November 2024", what: "C-Lion1 and BCS East–West Interlink cut, further south in the Baltic.", note: "Outside this AOI; a cargo ship's anchor was the reported suspicion." },
];

const SOURCES = [
  { name: "Undersea asset routes", src: "OpenStreetMap contributors via Overpass", licence: "ODbL 1.0", detail: (osm: string | null) => `Snapshot ${osm?.slice(0, 16).replace("T", " ") ?? "n/a"} UTC. Mapping can be incomplete or approximate.` },
  { name: "Seabed depth", src: "EMODnet Digital Bathymetry (DTM), mean depth, ~115 m grid", licence: "Attribution required; confirm terms before commercial use", detail: () => "Resampled for the map and 3D view." },
  { name: "Ship traffic", src: "EMODnet Human Activities vessel density, 2024 annual average (cargo, tanker, all)", licence: "Attribution required; confirm terms before commercial use", detail: () => "Hours per km² per month on a ~1.4 km grid." },
  { name: "AIS contacts", src: "Fintraffic Digitraffic marine AIS", licence: "CC BY 4.0", detail: () => "Refreshed every minute; positions older than 30 minutes are dropped." },
  { name: "Satellite imagery", src: "Sentinel-2 cloudless 2017 by EOX IT Services (modified Copernicus Sentinel data 2017)", licence: "CC BY 4.0", detail: () => "Later years are non-commercial, so 2017 is used." },
];

export default function SubseaPage() {
  const project = projectBySlug("subsea")!;
  const rows = cableRows(subsea, DEFAULTS);
  const totals = sum(subsea.cables.map((c) => tally(c, DEFAULTS, subsea.trafficP90)));
  return (
    <>
      <PageHeader eyebrow="Undersea infrastructure · Gulf of Finland AOI" title="Threat picture for seabed infrastructure."
        lede="Power interconnectors, telecom cables and gas pipelines cross one of Europe's busiest shipping lanes, almost entirely inside the reach of a dragged anchor. This picture fuses open-source seabed, traffic and asset data with live AIS to locate threat corridors and show how much of them shore-based DAS surveillance could cover.">
        <div className="flex flex-wrap gap-2"><StatusBadge status={project.status} /><span className="tag">Open-source data · decision aid, not an intelligence product</span></div>
      </PageHeader>

      <Section eyebrow="Common operating picture" title="Assets, threat envelope, traffic and AIS contacts">
        <SubseaExplorer initialRows={rows} initialTotals={totals} trafficP90={subsea.trafficP90} />
      </Section>

      <Section eyebrow="Incident history" title="Three events in fourteen months"
        description="Public reporting on recent damage. Dates and suspects are as reported; investigations were ongoing and none of this is modelled data.">
        <div className="panel divide-y divide-line">
          {INCIDENTS.map((i) => (
            <div key={i.when} className="grid gap-1 p-5 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-6">
              <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-fg-2">{i.when}</span>
              <div><p className="text-fg">{i.what}</p><p className="text-[13.5px] text-fg-2">{i.note}</p></div>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="Methodology" title="What the picture does and does not claim">
        <div className="grid gap-4 md:grid-cols-3">
          <Panel className="grid content-start gap-2 p-5"><div className="eyebrow">Threat envelope</div><p className="text-[14px] text-fg-2">A point on an asset is inside the envelope when the seabed there is no deeper than the depth you set, the reach of a dragged anchor. Depth comes from EMODnet bathymetry at the sampled point, every ~1 km along each mapped route.</p></Panel>
          <Panel className="grid content-start gap-2 p-5"><div className="eyebrow">Threat corridor</div><p className="text-[14px] text-fg-2">Inside the envelope and under heavy cargo or tanker traffic: the top 10% of sea cells by 2024 average density. It ranks where an accidental or deliberate anchor drag is most plausible. It is not a probability of attack.</p></Panel>
          <Panel className="grid content-start gap-2 p-5"><div className="eyebrow">Surveillance coverage</div><p className="text-[14px] text-fg-2">Distributed acoustic sensing (DAS) turns the fiber in the cable into a continuous acoustic sensor. We assume an interrogator at every landing station that monitors the set distance outward along the cable. Real range depends on the fiber, the equipment and the operator.</p></Panel>
        </div>
        <p className="text-[13px] text-fg-2">Contact classification is heuristic. A vessel that is not moored, within about 1 km of a mapped asset in 10 to 100 m of water, is a contact over infrastructure. One that also reports being at anchor while making way, or a cargo ship or tanker loitering under 3 knots, is a contact of interest (COI). Both patterns appeared in the public anchor-drag cases; most such contacts are benign.</p>
      </Section>

      <Dossier project={project} />

      <Section eyebrow="Data credit" title="Sources and licences">
        <div className="panel divide-y divide-line">
          {SOURCES.map((s) => (
            <div key={s.name} className="grid gap-1 p-4 text-[13.5px] sm:grid-cols-[180px_minmax(0,1fr)_minmax(0,220px)] sm:gap-6">
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-2">{s.name}</span>
              <div><p className="text-fg">{s.src}</p><p className="text-fg-3">{s.detail(subsea.osmTimestamp)}</p></div>
              <span className="font-mono text-[11.5px] text-fg-2 sm:text-right">{s.licence}</span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
