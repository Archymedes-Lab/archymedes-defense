"use client";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Legend, Panel } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/segmented";
import type { Bands } from "@/lib/aero/error-model";
import { type Planform, deltaWing } from "@/lib/aero/geometry";
import { harvPlanform } from "@/lib/aero/harv";
import { alphaSweep, analyse } from "@/lib/aero/predict";
import { deg } from "@/lib/aero/units";
import { type DataPoint, LiftChart, REGIME_LEGEND } from "./chart";
import { WingDrawing } from "./drawing";
import { HarvDrawing } from "./harv-drawing";

const HarvScene = dynamic(() => import("@/components/three/harv").then((m) => m.HarvScene), { ssr: false, loading: () => <div className="aspect-[4/3] w-full animate-pulse bg-surface sm:aspect-[16/10]" /> });
const WingScene = dynamic(() => import("@/components/three/wing").then((m) => m.WingScene), { ssr: false, loading: () => <div className="aspect-[4/3] w-full animate-pulse bg-surface sm:aspect-[16/10]" /> });

export type PresetId = "harv" | "d60" | "d65" | "d70" | "d75" | "d80" | "custom";
export interface CaseView { id: string; label: string; source: string; points: DataPoint[]; coverage: number | null; rmsAttached: number | null; note: string }

const PRESETS: { value: PresetId; label: string; caseId?: string }[] = [
  { value: "harv", label: "F/A-18 HARV", caseId: "fa18-hatp" },
  { value: "d60", label: "60°", caseId: "wk-60" }, { value: "d65", label: "65°", caseId: "wk-65" }, { value: "d70", label: "70°", caseId: "wk-70" },
  { value: "d75", label: "75°", caseId: "wk-75" }, { value: "d80", label: "80°", caseId: "wk-80" }, { value: "custom", label: "Custom" },
];

function planformFor(p: PresetId, sweep: number): Planform {
  if (p === "harv") return harvPlanform();
  const s = p === "custom" ? sweep : Number(p.slice(1));
  return { ...deltaWing(deg(s)), name: `${s}° delta` };
}

function Readout({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "accent" | "warning" }) {
  return (
    <div className="grid content-start gap-1 border-l border-line-strong pl-3">
      <div className={`num font-mono text-[20px] leading-none tracking-tight sm:text-[24px] ${tone === "accent" ? "text-accent" : tone === "warning" ? "text-warning" : ""}`}>{value}</div>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">{label}</div>
      {hint && <div className="text-[12px] text-fg-3">{hint}</div>}
    </div>
  );
}

export function AeroWorkbench({ bands, retained, cases, date }: { bands: Bands; retained: number; cases: Record<string, CaseView>; date: string }) {
  const [preset, setPreset] = useState<PresetId>("harv");
  const [sweep, setSweep] = useState(68);
  const [alpha, setAlpha] = useState(30);
  const [lattice, setLattice] = useState<"shown" | "hidden">("shown");
  const fighter = preset === "harv";
  const alphaMax = fighter ? 70 : 50;
  const a = Math.min(alpha, alphaMax);
  const planform = useMemo(() => planformFor(preset, sweep), [preset, sweep]);
  const analysis = useMemo(() => analyse(planform, { alphas: alphaSweep(deg(0), deg(alphaMax), deg(1)), bands, retained }), [planform, alphaMax, bands, retained]);
  const at = useMemo(() => analyse(planform, { alphas: [deg(a)], bands, retained }).points[0], [planform, a, bands, retained]);
  const caseId = PRESETS.find((p) => p.value === preset)?.caseId;
  const view = caseId ? cases[caseId] : undefined;
  const unit = fighter ? "ft" : "c₀";
  if (!at) return null;
  const burstPct = at.burstXi >= 0 ? `${Math.round(at.burstXi * 100)}% of c₀ from TE` : "aft of the wing";
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="grid gap-1.5"><span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Planform</span>
          <div className="max-w-full overflow-x-auto"><Segmented label="Planform" value={preset} options={PRESETS} onChange={setPreset} /></div></div>
        {preset === "custom" && (
          <label className="grid min-w-[220px] gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">
            <span className="flex justify-between">Leading-edge sweep<span className="num normal-case tracking-normal text-fg">{sweep}°</span></span>
            <input type="range" min={45} max={85} step={1} value={sweep} onChange={(e) => setSweep(Number(e.target.value))} className="accent-[var(--accent)]" />
          </label>
        )}
        <label className="grid min-w-[240px] flex-1 gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">
          <span className="flex justify-between">Angle of attack<span className="num normal-case tracking-normal text-fg">{a}°</span></span>
          <input type="range" min={0} max={alphaMax} step={1} value={a} onChange={(e) => setAlpha(Number(e.target.value))} className="accent-[var(--accent)]" />
        </label>
      </div>

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
            <Readout label="Lift coefficient" value={at.cl.toFixed(3)} hint={`band ${at.lo.toFixed(2)} to ${at.hi.toFixed(2)}`} tone="accent" />
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
          {!fighter && <Segmented label="Lattice" value={lattice} options={[{ value: "shown", label: "Lattice on" }, { value: "hidden", label: "Lattice off" }]} onChange={setLattice} />}</div>
        <div className="overflow-x-auto"><div className="min-w-[640px]">
          {fighter ? <HarvDrawing at={at} burstXi={at.burstXi} date={date} /> : <WingDrawing s={{
            designation: `AD-AERO-${preset === "custom" ? `D${sweep}` : `D${preset.slice(1)}`}`, planform, props: analysis.vlm.props,
            panels: lattice === "shown" ? analysis.vlm.panels : [], at, kp: analysis.vortex.kp, kv: analysis.vortex.kv, unit, date, burstXi: at.burstXi, domainOk: analysis.domain.ok,
          }} />}
        </div></div>
      </Panel>

      <Panel className="grid gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><div className="eyebrow">3D · loading and leading-edge vortices</div><span className="font-mono text-[11px] text-fg-3">{`wind from the left · α ${a}° · ${at.burstXi >= 0 ? `vortex burst at ${Math.round(at.burstXi * 100)}% of the root chord from the trailing edge` : "vortex intact"} · drag to orbit`}</span></div>
        {fighter ? (
          <HarvScene alphaDeg={a} burstXi={at.burstXi} label={`3D model of the NASA F/A-18 HARV at ${a} degrees angle of attack with LEX vortex cores`} />
        ) : (
          <WingScene planform={planform} panels={analysis.vlm.panels} gamma={analysis.vlm.gamma} alphaDeg={a} burstXi={at.burstXi}
            label={`3D view of the ${planform.name} at ${a} degrees angle of attack, coloured by panel loading, with leading-edge vortex cores`} />
        )}
        <p className="text-[12.5px] text-fg-3">{fighter
          ? "Built from NASA's published dimensions and the traced NASA three-view: lofted fuselage, canopy, NACA-section wing with 4.3° anhedral, LEX, all-moving stabilators, twin tails canted 20°, wingtip research pods. LEX vortex cores are illustrative; the burst point is the model's."
          : "Panel colour: vortex-lattice loading (Γ per panel chord). Vortex cores are placed at measured delta-wing positions (≈ 60% of the local semispan) for illustration; the burst point is the model's."}</p>
      </Panel>
    </div>
  );
}
