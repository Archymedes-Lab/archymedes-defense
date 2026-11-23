"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Legend, Panel } from "@/components/ui/primitives";
import type { CableRow, Params, SubseaModel, Totals } from "@/lib/subsea-model";
import { DEFAULTS, KIND_LABEL, cableRows, sum, tally } from "@/lib/subsea-model";
import type { Layers, Vessel } from "./map";

const SubseaMap = dynamic(() => import("./map").then((m) => m.SubseaMap), { ssr: false, loading: () => <div className="h-[440px] w-full animate-pulse bg-surface sm:h-[560px]" /> });
const SeabedScene = dynamic(() => import("@/components/three/seabed").then((m) => m.SeabedScene), { ssr: false, loading: () => <div className="aspect-[4/3] w-full animate-pulse bg-surface sm:aspect-[16/8]" /> });

type Ais = { state: "loading" | "ok" | "error"; vessels: Vessel[]; fetchedAt?: string; counts?: { total: number; over: number; attention: number } };
const LAYER_LABEL: Record<keyof Layers, string> = { satellite: "Satellite", depth: "Depth", traffic: "Traffic density", cables: "Cables", fiber: "DAS coverage", ships: "AIS contacts" };
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");
const km = (v: number) => `${Math.round(v).toLocaleString("en-US")} km`;

function Readout({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "critical" | "accent" }) {
  return (
    <div className="grid content-start gap-1 border-l border-line-strong pl-3">
      <div className={`num font-mono text-[24px] leading-none tracking-tight sm:text-[28px] ${tone === "critical" ? "text-critical" : tone === "accent" ? "text-accent" : ""}`}>{value}</div>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">{label}</div>
      {hint && <div className="text-[12px] text-fg-3">{hint}</div>}
    </div>
  );
}

function Slider({ id, label, value, min, max, step, unit, onChange, note }: { id: string; label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; note: string }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="flex items-baseline justify-between font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">
        {label}<span className="num text-[14px] normal-case tracking-normal text-fg">{value} {unit}</span>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
      <p className="text-[12px] text-fg-3">{note}</p>
    </div>
  );
}

export function SubseaExplorer({ initialRows, initialTotals, trafficP90 }: { initialRows: CableRow[]; initialTotals: Totals; trafficP90: number }) {
  const [model, setModel] = useState<SubseaModel | null>(null);
  const [params, setParams] = useState<Params>(DEFAULTS);
  const [layers, setLayers] = useState<Layers>({ satellite: true, depth: true, traffic: false, cables: true, fiber: false, ships: true });
  const [ais, setAis] = useState<Ais>({ state: "loading", vessels: [] });

  useEffect(() => {
    let live = true;
    fetch("/subsea/model.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((m) => { if (live) setModel(m); }).catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch("/api/subsea/ais", { cache: "no-store" });
          const j = await r.json();
          if (!live) return;
          setAis(j.ok ? { state: "ok", vessels: j.vessels, fetchedAt: j.fetchedAt, counts: j.counts } : (a) => ({ ...a, state: "error" }));
        } catch { if (live) setAis((a) => ({ ...a, state: "error" })); }
      }
      if (live) timer = setTimeout(poll, 60_000);
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, []);

  const rows = useMemo(() => (model ? cableRows(model, params) : initialRows), [model, params, initialRows]);
  const totals = useMemo(() => (model ? sum(model.cables.map((c) => tally(c, params, model.trafficP90))) : initialTotals), [model, params, initialTotals]);
  const sorted = [...rows].sort((a, b) => b.exposedKm - a.exposedKm || b.km - a.km);

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-5">
        <Readout label="Undersea assets mapped" value={km(totals.km)} hint="cable and pipeline in the AOI, OpenStreetMap" />
        <Readout label="Inside threat envelope" value={pct(totals.reachKm, totals.km)} hint={`seabed ≤ ${params.reachM} m, reachable by a dragged anchor`} />
        <Readout label="Threat corridor" value={km(totals.exposedKm)} tone="critical" hint="inside the envelope and under heavy cargo or tanker traffic" />
        <Readout label="Corridor under surveillance" value={pct(totals.exposedCoveredKm, totals.exposedKm)} tone="accent" hint={`DAS range ${params.rangeKm} km per landing station`} />
        <Readout label="Contacts over infrastructure" value={ais.counts ? `${ais.counts.over} / ${ais.counts.total}` : ais.state === "error" ? "offline" : "…"}
          hint={ais.counts ? `${ais.counts.attention} contacts of interest · ${ais.fetchedAt ? new Date(ais.fetchedAt).toISOString().slice(11, 16) : ""} UTC` : "AIS feed, Digitraffic"} />
      </div>

      <Panel className="overflow-hidden">
        <div className="grid border-b border-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-wrap gap-0 border-b border-line p-4 lg:border-r lg:border-b-0">
            <div className="mb-2 w-full font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Layers</div>
            <div className="grid w-full grid-cols-3 border border-line-strong sm:grid-cols-6 lg:grid-cols-3">
              {(Object.keys(LAYER_LABEL) as (keyof Layers)[]).map((k) => (
                <button key={k} type="button" aria-pressed={layers[k]} onClick={() => setLayers((l) => ({ ...l, [k]: !l[k] }))}
                  className={`h-9 border-r border-b border-line-strong px-2 font-mono text-[10.5px] uppercase tracking-[0.08em] transition-colors ${layers[k] ? "bg-accent-soft text-accent" : "text-fg-3 hover:text-fg"}`}>
                  <span className={`mr-1.5 inline-block h-1.5 w-1.5 align-middle ${layers[k] ? "bg-accent" : "border border-fg-3"}`} />{LAYER_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Slider id="reach" label="Threat envelope depth" value={params.reachM} min={20} max={150} step={5} unit="m" onChange={(v) => setParams((p) => ({ ...p, reachM: v }))}
              note={`Median sea depth here is ${model ? Math.round(-model.seaDepth.median) : "…"} m. Large merchant ships carry anchor chain for far deeper water.`} />
            <Slider id="range" label="DAS sensor range" value={params.rangeKm} min={10} max={150} step={5} unit="km" onChange={(v) => setParams((p) => ({ ...p, rangeKm: v }))}
              note="Distributed acoustic sensing: distance along the cable an interrogator at each landing station can monitor. Vendors quote tens of km; amplified systems go further." />
          </div>
        </div>
        {model ? <SubseaMap model={model} params={params} layers={layers} vessels={ais.vessels} /> : <div className="h-[440px] w-full animate-pulse bg-surface sm:h-[560px]" />}
        <div className="grid gap-2 border-t border-line p-4">
          <Legend items={[
            { label: "Inside threat envelope", color: "var(--accent)" },
            { label: "Threat corridor: envelope and heavy traffic", color: "var(--critical)" },
            { label: "Below threat envelope", color: "var(--fg-3)" },
            { label: "DAS surveillance coverage", swatch: <span className="h-2.5 w-4 opacity-50" style={{ background: "var(--good)" }} /> },
            { label: "Contact over infrastructure", color: "var(--warning)" },
            { label: "Contact of interest (COI)", color: "var(--critical)" },
          ]} />
          <p className="text-[12px] text-fg-3">Heavy traffic: cargo and tanker density at or above {trafficP90.toFixed(1)} hours per km² per month, the top 10% of sea cells in the AOI (EMODnet, 2024 average). Two-finger drag or Ctrl+scroll to move the map.</p>
          {ais.state === "error" && <p className="font-mono text-[12px] text-warning">AIS feed unavailable. Asset, envelope and traffic layers are unaffected.</p>}
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        {model ? <SeabedScene model={model} params={params} vessels={ais.vessels} /> : <div className="aspect-[4/3] w-full animate-pulse bg-surface sm:aspect-[16/8]" />}
        <p className="border-t border-line px-4 py-3 text-[12px] text-fg-3">Seabed from EMODnet bathymetry, depth exaggerated about 100× and lightly smoothed; land from Sentinel-2 cloudless 2017. Named assets only. Bars mark AIS contacts over infrastructure.</p>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13.5px]">
            <thead className="text-left font-mono text-[10.5px] uppercase tracking-[0.1em] text-fg-3">
              <tr className="border-b border-line">
                {["Asset", "Class", "Km in AOI", "Median depth", "Peak traffic", "Threat corridor", "Under surveillance"].map((h, i) => (
                  <th key={h} className={`px-4 py-3 font-medium ${i > 1 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="num">
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface">
                  <td className="px-4 py-2.5 text-fg">{r.name}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] uppercase text-fg-2">{KIND_LABEL[r.kind]}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{Math.round(r.km)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{r.medianDepth === null ? "–" : `${Math.round(r.medianDepth)} m`}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{r.peakTraffic.toFixed(1)}</td>
                  <td className={`px-4 py-2.5 text-right font-mono ${r.exposedKm > 0 ? "text-critical" : "text-fg-3"}`}>{r.exposedKm.toFixed(0)} km</td>
                  <td className="px-4 py-2.5 text-right font-mono">{r.exposedKm > 0 ? pct(r.exposedCoveredKm, r.exposedKm) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-3 text-[12px] text-fg-3">Named assets of 5 km or more. Peak traffic in cargo and tanker hours per km² per month. Lengths are the part inside the AOI.</p>
      </Panel>
    </div>
  );
}
