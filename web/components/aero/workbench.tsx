"use client";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Legend, Panel } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/segmented";
import type { Bands } from "@/lib/aero/error-model";
import { AIRCRAFT, aircraftById } from "@/lib/aero/aircraft";
import { alphaSweep, analyse } from "@/lib/aero/predict";
import { type EdgeBlend, trimModel, trimmedLiftBlend } from "@/lib/aero/trim";
import { deg, toDeg, toRad } from "@/lib/aero/units";
import { type DataPoint, LiftChart, REGIME_LEGEND } from "./chart";
import { WingDrawing } from "./drawing";

const WingScene = dynamic(() => import("@/components/three/wing").then((m) => m.WingScene), { ssr: false, loading: () => <div className="aspect-[4/3] w-full animate-pulse bg-surface sm:aspect-[16/10]" /> });

export type PresetId = "harv" | "f16xl" | "f106b";
export interface CaseView { id: string; label: string; source: string; points: DataPoint[]; coverage: number | null; rmsAttached: number | null; note: string }

/** Real aircraft only (lib/aero/aircraft.ts): every one a NASA research aircraft with published geometry. */
const PRESETS: { value: PresetId; label: string }[] = AIRCRAFT.map((a) => ({ value: a.id as PresetId, label: a.name }));

function Readout({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "accent" | "warning" }) {
  return (
    <div className="grid content-start gap-1 border-l border-line-strong pl-3">
      <div className={`num font-mono text-[20px] leading-none tracking-tight sm:text-[24px] ${tone === "accent" ? "text-accent" : tone === "warning" ? "text-warning" : ""}`}>{value}</div>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">{label}</div>
      {hint && <div className="text-[12px] text-fg-3">{hint}</div>}
    </div>
  );
}

export function AeroWorkbench({ bands, retained, cases, date, flightBlend }: { bands: Bands; retained: number; cases: Record<string, CaseView>; date: string; flightBlend: Record<string, EdgeBlend> }) {
  const [preset, setPreset] = useState<PresetId>("harv");
  const [alpha, setAlpha] = useState(30);
  const [lattice, setLattice] = useState<"shown" | "hidden">("shown");
  const alphaMax = preset === "harv" ? 70 : 50; // the HARV wind-tunnel data run to 70°
  const a = Math.min(alpha, alphaMax);
  const aircraft = aircraftById(preset) ?? AIRCRAFT[0];
  const planform = useMemo(() => (aircraftById(preset) ?? AIRCRAFT[0])?.planform() ?? { name: "", stations: [] }, [preset]);
  const analysis = useMemo(() => analyse(planform, { alphas: alphaSweep(deg(0), deg(alphaMax), deg(1)), bands, retained }), [planform, alphaMax, bands, retained]);
  const at = useMemo(() => analyse(planform, { alphas: [deg(a)], bands, retained }).points[0], [planform, a, bands, retained]);
  const view = aircraft?.dataCaseId ? cases[aircraft.dataCaseId] : undefined;
  // Aircraft with an elevon and a flight-fitted leading edge: lift trimmed for zero pitching moment, as it flies.
  const trimmed = useMemo(() => {
    const blend = aircraft ? flightBlend[aircraft.id] : undefined;
    if (!aircraft?.elevon || !blend) return null;
    const t = trimmedLiftBlend(analysis.vlm, analysis.vortex, trimModel(analysis.vlm, aircraft), toRad(deg(a)), blend);
    return { cl: t.cl, elevonDeg: toDeg(t.elevon), share: t.share };
  }, [aircraft, flightBlend, analysis, a]);
  const unit = "ft";
  if (!at || !aircraft) return null;
  const burstPct = at.burstXi >= 0 ? `${Math.round(at.burstXi * 100)}% of c₀ from TE` : "aft of the wing";
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="grid gap-1.5"><span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Aircraft</span>
          <div className="max-w-full overflow-x-auto"><Segmented label="Aircraft" value={preset} options={PRESETS} onChange={setPreset} /></div></div>
        <label className="grid min-w-[240px] flex-1 gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">
          <span className="flex justify-between">Angle of attack<span className="num normal-case tracking-normal text-fg">{a}°</span></span>
          <input type="range" min={0} max={alphaMax} step={1} value={a} onChange={(e) => setAlpha(Number(e.target.value))} className="accent-[var(--accent)]" />
        </label>
      </div>

      <Panel className="grid gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><div className="eyebrow">{aircraft.airframe}</div><span className="font-mono text-[11px] text-fg-3">{aircraft.programme}</span></div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3 lg:grid-cols-4">
          {Object.entries(aircraft.published).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2 border-b border-line/60 pb-1">
              <span className="text-fg-2">{k.replace(/(Ft2|Ft|Deg|Lb|In|Pct|SlugFt2)$/, "").replace(/([A-Z])/g, " $1").toLowerCase()}</span>
              <span className="num font-mono">{v.value.toLocaleString("en", { maximumFractionDigits: 3 })}{v.unit === "°" || v.unit === "%" ? v.unit : v.unit ? ` ${v.unit}` : ""}</span>
            </div>
          ))}
        </div>
        <div className="text-[12.5px] text-fg-3">Published values, read from: {aircraft.sources.map((src, i) => (
          <span key={src.report}>{i > 0 ? "; " : ""}<a className="link" href={src.url} target="_blank" rel="noopener noreferrer">{src.report}</a> ({src.where})</span>
        ))}.{aircraft.traced.length > 0 && <> Traced from a drawing, not a table: {aircraft.traced.map((t) => `${t.what}${t.value ? ` ${t.value} ${t.unit}` : ""} (±${t.tolerance} ${t.unit})`).join("; ")}.</>}</div>
        <ul className="list-disc pl-5 text-[12.5px] text-fg-2">{aircraft.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
      </Panel>

      {!analysis.domain.ok && (
        <div className="border border-warning/50 bg-warning/5 px-4 py-3 text-[13.5px] text-fg-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-warning">Outside the validated domain · band doubled</span>
          <ul className="mt-1 list-disc pl-5">{analysis.domain.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel className="grid gap-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><div className="eyebrow">Lift curve with measured band</div><span className="font-mono text-[11px] text-fg-3">{view ? view.source : "no published data for this planform"}</span></div>
          <LiftChart points={analysis.points} data={view?.points ?? []} alpha={a} alphaMax={alphaMax} dataLabel={view?.label ?? ""} />
          <Legend items={[
            { label: "Estimate", color: "var(--accent)" },
            { label: "Measured 90% band", swatch: <span className="h-2.5 w-4 bg-accent/20" /> },
            { label: "Polhamus, no breakdown", swatch: <span className="h-0 w-4 border-t border-dashed border-fg-3" /> },
            { label: "Potential lift only", swatch: <span className="h-0 w-4 border-t border-dotted border-fg-3" /> },
            ...(view ? [{ label: view.label, swatch: <span className="h-2 w-2 border border-fg" /> }] : []),
          ]} />
          <Legend items={REGIME_LEGEND} />
        </Panel>
        <Panel className="grid content-start gap-5 p-4 sm:p-5">
          <div className="eyebrow">At α = {a}°</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <Readout label={trimmed ? "Lift, sharp flat plate" : "Lift coefficient"} value={at.cl.toFixed(3)} hint={`band ${at.lo.toFixed(2)} to ${at.hi.toFixed(2)}`} tone={trimmed ? undefined : "accent"} />
            {trimmed && <Readout label="Lift as flown (trimmed)" value={trimmed.cl.toFixed(3)} hint={`elevon ${trimmed.elevonDeg.toFixed(1)}° · vortex ${Math.round(trimmed.share * 100)}% formed · ${a >= 8.5 && a <= 22.5 ? "inside the flight data (8.5–22.5°)" : "beyond the flight data (8.5–22.5°): extrapolated"}`} tone={a >= 8.5 && a <= 22.5 ? "accent" : "warning"} />}
            <Readout label="Flow regime" value={at.regime} hint={`vortex lift lost ${Math.round(at.lost * 100)}%`} tone={at.regime === "attached" ? undefined : "warning"} />
            <Readout label="Vortex burst" value={at.burstXi >= 0 ? `${Math.round(at.burstXi * 100)}%` : "—"} hint={burstPct} />
            <Readout label="Pitching moment" value={at.cm.toFixed(3)} hint="about 0.25 MAC" />
            <Readout label="Drag coefficient" value={at.cd.toFixed(3)} hint="CD0 + CL tan α, sharp edges" />
            <Readout label="Kp / Kv" value={`${analysis.vortex.kp.toFixed(2)} / ${analysis.vortex.kv.toFixed(2)}`} hint={`e ${analysis.vlm.e.toFixed(2)} · ${analysis.vlm.panels.length * 2} panels`} />
          </div>
          {view && (
            <div className="grid gap-1 border-t border-line pt-3 text-[12.5px] text-fg-2">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-3">Held-out score for this wing</span>
              <span>{view.note}</span>
            </div>
          )}
        </Panel>
      </div>

      <Panel className="grid gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="eyebrow">Engineering drawing</div>
          <Segmented label="Lattice" value={lattice} options={[{ value: "shown", label: "Lattice on" }, { value: "hidden", label: "Lattice off" }]} onChange={setLattice} /></div>
        <div className="overflow-x-auto"><div className="min-w-[640px]">
          <WingDrawing s={{
            designation: `AD-AERO-${aircraft.name.replace(/[^A-Z0-9]/gi, "").toUpperCase()}`, planform, props: analysis.vlm.props,
            panels: lattice === "shown" ? analysis.vlm.panels : [], at, kp: analysis.vortex.kp, kv: analysis.vortex.kv, unit, date, burstXi: at.burstXi, domainOk: analysis.domain.ok,
          }} />
        </div></div>
      </Panel>

      <Panel className="grid gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><div className="eyebrow">3D · loading and leading-edge vortices</div><span className="font-mono text-[11px] text-fg-3">{`wind from the left · α ${a}° · ${at.burstXi >= 0 ? `vortex burst at ${Math.round(at.burstXi * 100)}% of the root chord from the trailing edge` : "vortex intact"} · drag to orbit`}</span></div>
        {(
          <WingScene planform={planform} panels={analysis.vlm.panels} gamma={analysis.vlm.gamma} alphaDeg={a} burstXi={at.burstXi}
            label={`3D view of the ${planform.name} at ${a} degrees angle of attack, coloured by panel loading, with leading-edge vortex cores`} />
        )}
        <p className="text-[12.5px] text-fg-3">{"Wing planform from NASA's published dimensions (the fuselage and tails of this aircraft are not modelled in 3D). Panel colour: vortex-lattice loading (Γ per panel chord). Vortex cores are placed at measured delta-wing positions (≈ 60% of the local semispan) for illustration; the burst point is the model's."}</p>
      </Panel>
    </div>
  );
}
