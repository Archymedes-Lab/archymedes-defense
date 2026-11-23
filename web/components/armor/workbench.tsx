"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Legend, Panel } from "@/components/ui/primitives";
import { FIBER_VOLUME_FRACTION, FIBERS, NIJ_STEPS_MS, NIST_REFERENCE, THREATS } from "@/lib/armor/data";
import { type Fiber, THETAS, arealDensityFor, cunniffRetention, gamma0, ppRetention, presentedArea, psiMax, screen } from "@/lib/armor/models";
import { type BenchCell, type Method, bench, mulberry32, simulateTest } from "@/lib/armor/planner";
import { ArmorDrawing } from "./drawing";

const ArmorStack = dynamic(() => import("@/components/three/armor-stack").then((m) => m.ArmorStack), { ssr: false, loading: () => <div className="aspect-[4/3] w-full animate-pulse bg-surface sm:aspect-[16/10]" /> });

const FIBER_COLOR: Record<string, string> = { ppta: "var(--c1)", "ppta-hm": "var(--c6)", uhmwpe: "var(--c3)", pbo: "var(--c2)" };
const METHOD: Record<Method, { label: string; color: string }> = {
  nij: { label: "NIJ 0101.07 up-and-down", color: "var(--fg-2)" }, "3pod": { label: "3POD-style", color: "var(--c4)" }, bayes: { label: "Physics prior + D-optimal", color: "var(--accent)" },
};
const BUDGETS = [6, 8, 10, 12, 15, 20, 25, 30];
/** Server (Node) and browser maths differ in the last float digits; rounding plotted coordinates keeps hydration exact. */
const px = (v: number) => Math.round(v * 100) / 100;

function Num({ id, label, value, onChange, step = 1, min, max, unit }: { id: string; label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string }) {
  return (
    <label htmlFor={id} className="grid gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">
      <span className="flex justify-between">{label}{unit && <span className="normal-case tracking-normal text-fg-3">{unit}</span>}</span>
      <input id={id} type="number" inputMode="decimal" step={step} min={min} max={max} value={Number.isFinite(value) ? value : ""}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }} className="field h-9 text-[13px]" />
    </label>
  );
}

function Readout({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "accent" | "warning" }) {
  return (
    <div className="grid content-start gap-1 border-l border-line-strong pl-3">
      <div className={`num font-mono text-[22px] leading-none tracking-tight sm:text-[26px] ${tone === "accent" ? "text-accent" : tone === "warning" ? "text-warning" : ""}`}>{value}</div>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">{label}</div>
      {hint && <div className="text-[12px] text-fg-3">{hint}</div>}
    </div>
  );
}

/** V50 ratio to the reference against areal density for every fibre preset; band = θ 1-2 for the selected fibre. */
function ScreenChart({ reference, candidateFiber, candidateAd, projectile }: { reference: { fiber: Fiber; arealDensity: number }; candidateFiber: Fiber; candidateAd: number; projectile: { massKg: number; diameterM: number } }) {
  const W = 640, H = 300, l = 48, r = 16, t = 16, b = 40, x0 = 1, x1 = 8;
  const x = (v: number) => px(l + ((v - x0) / (x1 - x0)) * (W - l - r));
  const curves = FIBERS.map((f) => ({ f, pts: Array.from({ length: 36 }, (_, i) => { const ad = x0 + (i / 35) * (x1 - x0); return { ad, ...screen({ fiber: f, arealDensity: ad }, reference, projectile) }; }) }));
  const ymax = Math.max(1.6, ...curves.flatMap((c) => c.pts.map((p) => p.high))) * 1.05, ymin = 0;
  const y = (v: number) => px(t + (1 - (v - ymin) / (ymax - ymin)) * (H - t - b));
  const cand = screen({ fiber: candidateFiber, arealDensity: candidateAd }, reference, projectile);
  const sel = curves.find((c) => c.f.id === candidateFiber.id) ?? curves[0]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Screened V50 relative to the reference against areal density for each fibre">
      {[0, 0.5, 1, 1.5, 2, 2.5].filter((v) => v <= ymax).map((v) => (
        <g key={v}><line x1={l} x2={W - r} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={l - 8} y={y(v) + 4} fontSize={10.5} textAnchor="end">{v.toFixed(1)}</text></g>
      ))}
      {[1, 2, 3, 4, 5, 6, 7, 8].map((v) => <text key={v} x={x(v)} y={H - b + 16} fontSize={10.5} textAnchor="middle">{v}</text>)}
      <text x={(l + W - r) / 2} y={H - 6} fontSize={10.5} textAnchor="middle">Areal density, kg/m² →</text>
      <line x1={l} x2={W - r} y1={y(1)} y2={y(1)} stroke="var(--fg-3)" strokeDasharray="4 3" />
      <text x={W - r} y={y(1) - 5} fontSize={10} textAnchor="end">reference = 1.0</text>
      <path d={`M${sel.pts.map((p) => `${x(p.ad)},${y(p.high)}`).join(" L")} L${[...sel.pts].reverse().map((p) => `${x(p.ad)},${y(p.low)}`).join(" L")} Z`} fill={FIBER_COLOR[sel.f.id]} opacity={0.14} />
      {curves.map((c) => (
        <polyline key={c.f.id} points={c.pts.map((p) => `${x(p.ad)},${y(p.ratio)}`).join(" ")} fill="none" stroke={FIBER_COLOR[c.f.id]} strokeWidth={c.f.id === candidateFiber.id ? 2.4 : 1.4} opacity={c.f.id === candidateFiber.id ? 1 : 0.7}>
          <title>{c.f.name}</title>
        </polyline>
      ))}
      <rect x={x(reference.arealDensity) - 5} y={y(1) - 5} width={10} height={10} fill="var(--raised)" stroke="var(--fg)" strokeWidth={1.5}><title>{`Reference: ${reference.fiber.name}, ${reference.arealDensity} kg/m²`}</title></rect>
      {candidateAd >= x0 && candidateAd <= x1 && (
        <rect x={x(candidateAd) - 7} y={y(cand.ratio) - 7} width={14} height={14} fill="var(--accent)" stroke="var(--raised)" strokeWidth={2}><title>{`Candidate: ${(cand.ratio * 100).toFixed(1)}% of reference V50`}</title></rect>
      )}
    </svg>
  );
}

type Curve = Record<Method, { n: number; err: number; est: number }[]>;

function PlannerChart({ curve, sigma }: { curve: Curve; sigma: number }) {
  const W = 640, H = 280, l = 48, r = 16, t = 16, b = 40;
  // Budgets where a design produced no estimate at all have err = NaN; they are drawn as a gap, never as a point.
  const all = Object.values(curve).flat().filter((p) => Number.isFinite(p.err));
  const ymax = Math.max(sigma, ...all.map((p) => p.err)) * 1.1;
  const x = (n: number) => px(l + ((n - 6) / 24) * (W - l - r)), y = (v: number) => px(t + (1 - v / ymax) * (H - t - b));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Median absolute V50 error against number of shots for three test designs">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line x1={l} x2={W - r} y1={y(f * ymax)} y2={y(f * ymax)} stroke="var(--line)" /><text x={l - 8} y={y(f * ymax) + 4} fontSize={10.5} textAnchor="end">{(f * ymax).toFixed(0)}</text></g>)}
      {BUDGETS.map((n) => <text key={n} x={x(n)} y={H - b + 16} fontSize={10.5} textAnchor="middle">{n}</text>)}
      <text x={(l + W - r) / 2} y={H - 6} fontSize={10.5} textAnchor="middle">Shots fired →</text>
      <text x={l} y={t - 4} fontSize={10.5}>median |V50 error|, m/s</text>
      {(Object.keys(curve) as Method[]).map((m) => (
        <g key={m}>
          <polyline points={curve[m].filter((p) => Number.isFinite(p.err)).map((p) => `${x(p.n)},${y(p.err)}`).join(" ")} fill="none" stroke={METHOD[m].color} strokeWidth={m === "bayes" ? 2.4 : 1.6} />
          {curve[m].filter((p) => Number.isFinite(p.err)).map((p) => (
            <rect key={p.n} x={x(p.n) - 3.5} y={y(p.err) - 3.5} width={7} height={7} fill={p.est < 0.95 ? "var(--raised)" : METHOD[m].color} stroke={METHOD[m].color} strokeWidth={1.2}>
              <title>{`${METHOD[m].label}, ${p.n} shots: median error ${p.err.toFixed(1)} m/s; estimate available in ${(p.est * 100).toFixed(0)}% of tests`}</title>
            </rect>
          ))}
        </g>
      ))}
    </svg>
  );
}

function ReplayChart({ method, truth, prior }: { method: Method; truth: { mu: number; sigma: number }; prior: { mu: number; sd: number } }) {
  const run = useMemo(() => simulateTest(method, truth, { mu: prior.mu, sigma: truth.sigma }, mulberry32(42), {
    maxShots: 15, minShots: 15, stop: "fixed", setPointError: 3, nijSteps: NIJ_STEPS_MS, prior: { mu: prior.mu, sd: prior.sd, sigma: truth.sigma, sigmaLogSd: 0.7 } }), [method, truth, prior]);
  const W = 640, H = 220, l = 48, r = 16, t = 14, b = 34;
  const vs = run.history.map((s) => s.v).concat([truth.mu, prior.mu]);
  const lo = Math.min(...vs) - 10, hi = Math.max(...vs) + 10;
  const x = (i: number) => px(l + (i / 14) * (W - l - r)), y = (v: number) => px(t + (1 - (v - lo) / (hi - lo)) * (H - t - b));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Example test sequence: shot velocities and outcomes">
      <line x1={l} x2={W - r} y1={y(truth.mu)} y2={y(truth.mu)} stroke="var(--good)" strokeDasharray="5 3" />
      <text x={W - r} y={y(truth.mu) - 5} fontSize={10} textAnchor="end" style={{ fill: "var(--good)" }}>true V50 {truth.mu} m/s</text>
      <line x1={l} x2={W - r} y1={y(prior.mu)} y2={y(prior.mu)} stroke="var(--accent)" strokeDasharray="2 3" opacity={0.7} />
      <text x={l + 4} y={y(prior.mu) - 5} fontSize={10} style={{ fill: "var(--accent)" }}>prior {prior.mu.toFixed(0)}</text>
      {[lo, (lo + hi) / 2, hi].map((v) => <text key={v} x={l - 8} y={y(v) + 4} fontSize={10.5} textAnchor="end">{v.toFixed(0)}</text>)}
      <polyline points={run.history.map((s, i) => `${x(i)},${y(s.v)}`).join(" ")} fill="none" stroke="var(--fg-3)" strokeWidth={1} />
      {run.history.map((s, i) => (
        <rect key={i} x={x(i) - 5} y={y(s.v) - 5} width={10} height={10} fill={s.perforated ? "var(--critical)" : "var(--raised)"} stroke={s.perforated ? "var(--critical)" : "var(--fg-2)"} strokeWidth={1.5}>
          <title>{`Shot ${i + 1}: ${s.v.toFixed(1)} m/s, ${s.perforated ? "complete penetration" : "partial penetration"}`}</title>
        </rect>
      ))}
      {run.history.map((_, i) => <text key={i} x={x(i)} y={H - b + 16} fontSize={10} textAnchor="middle">{i + 1}</text>)}
      {run.v50 !== null && <text x={W - r} y={H - 4} fontSize={10.5} textAnchor="end" style={{ fill: "var(--fg)" }}>estimate after 15 shots: {run.v50.toFixed(1)} m/s (error {(run.v50 - truth.mu).toFixed(1)})</text>}
    </svg>
  );
}

export function ArmorWorkbench() {
  const [fiberId, setFiberId] = useState("uhmwpe");
  const [custom, setCustom] = useState<Fiber>(FIBERS.find((f) => f.id === "uhmwpe")!);
  const [plies, setPlies] = useState(26);
  const [plyGsm, setPlyGsm] = useState(100);
  const [threatId, setThreatId] = useState("hg1-9");
  const [refFiberId, setRefFiberId] = useState(NIST_REFERENCE.fiberId);
  const [refAd, setRefAd] = useState(NIST_REFERENCE.arealDensity);
  const [refV50, setRefV50] = useState<number>(NaN);
  const [size, setSize] = useState({ w: 300, h: 300, quilt: NIST_REFERENCE.quiltCm * 10 });
  const [explode, setExplode] = useState(0.35);
  const [aging, setAging] = useState({ strength: 85, strainNew: 0.036, strainAged: 0.033 });
  const [sim, setSim] = useState({ mu: 480, sigma: 15, priorOffset: 0, priorSd: 25 });
  const [curve, setCurve] = useState<Curve | null>(null);
  const [running, setRunning] = useState(false);
  const [replayMethod, setReplayMethod] = useState<Method>("bayes");
  const runId = useRef(0);

  useEffect(() => { const f = FIBERS.find((x) => x.id === fiberId); if (f) setCustom(f); }, [fiberId]);

  const threat = THREATS.find((t) => t.id === threatId)!;
  const refFiber = FIBERS.find((f) => f.id === refFiberId)!;
  const reference = { fiber: refFiber, arealDensity: refAd };
  const ad = (plies * plyGsm) / 1000;
  const valid = custom.sigmaGPa > 0 && custom.strain > 0 && custom.modulusGPa > 0 && custom.density > 0 && ad > 0 && plies >= 1 && plies <= 120 && refAd > 0;
  const result = valid ? screen({ fiber: custom, arealDensity: ad }, reference, threat.projectile, Number.isFinite(refV50) ? refV50 : undefined) : null;
  const matchAd = valid && Number.isFinite(refV50) && refV50 > 0 ? arealDensityFor(refV50, custom, reference, threat.projectile, refV50) : null;
  const plyThickness = plyGsm / 1000 / (custom.density * FIBER_VOLUME_FRACTION) * 1000;
  const g0 = valid ? gamma0(ad, presentedArea(threat.projectile), threat.projectile.massKg) : NaN;
  const psi = Number.isFinite(g0) ? psiMax(1.5, g0) : NaN;
  const ageC = cunniffRetention(aging.strength / 100, aging.strainAged / aging.strainNew);
  const agePP = Number.isFinite(psi) ? ppRetention(aging.strength / 100, aging.strainAged, aging.strainNew, psi) : NaN;
  // The simulated truth follows the screened estimate (rounded) until the user edits it; the prior is truth + error.
  const screenedV50 = result?.v50 ? Math.round(result.v50) : null;
  useEffect(() => { if (screenedV50 !== null) setSim((s) => ({ ...s, mu: screenedV50 })); }, [screenedV50]);
  const priorMu = sim.mu + sim.priorOffset;

  function runPlanner() {
    const id = ++runId.current;
    setRunning(true);
    const truth = { mu: sim.mu, sigma: sim.sigma };
    const cells: BenchCell[] = [{ truth, guess: { mu: priorMu, sigma: sim.sigma }, prior: { mu: priorMu, sd: sim.priorSd, sigma: sim.sigma, sigmaLogSd: 0.7 } }];
    const out: Curve = { nij: [], "3pod": [], bayes: [] };
    let i = 0;
    const step = () => {
      if (id !== runId.current) return;
      const n = BUDGETS[i]!;
      for (const m of ["nij", "3pod", "bayes"] as Method[]) {
        const r = bench(m, cells, 300, { maxShots: n, minShots: n, stop: "fixed", setPointError: 3, nijSteps: NIJ_STEPS_MS }, 1000 + n);
        out[m].push({ n, err: r.medianAbsError, est: r.estimated });
      }
      setCurve({ nij: [...out.nij], "3pod": [...out["3pod"]], bayes: [...out.bayes] });
      if (++i < BUDGETS.length) setTimeout(step, 0); else setRunning(false);
    };
    setTimeout(step, 0);
  }

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  return (
    <div className="grid gap-6">
      <Panel className="overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <div className="grid content-start gap-4 border-b border-line p-4 lg:border-r lg:border-b-0">
            <div className="eyebrow">Candidate design</div>
            <label className="grid gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Fibre
              <select value={fiberId} onChange={(e) => setFiberId(e.target.value)} className="field h-9 text-[13px]">{FIBERS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Num id="sig" label="Strength" unit="GPa" step={0.05} value={custom.sigmaGPa} onChange={(v) => setCustom({ ...custom, sigmaGPa: v })} />
              <Num id="eps" label="Strain" unit="–" step={0.001} value={custom.strain} onChange={(v) => setCustom({ ...custom, strain: v })} />
              <Num id="mod" label="Modulus" unit="GPa" step={1} value={custom.modulusGPa} onChange={(v) => setCustom({ ...custom, modulusGPa: v })} />
              <Num id="rho" label="Density" unit="kg/m³" step={5} value={custom.density} onChange={(v) => setCustom({ ...custom, density: v })} />
              <Num id="plies" label="Plies" min={1} max={120} value={plies} onChange={(v) => setPlies(Math.round(v))} />
              <Num id="gsm" label="Per ply" unit="g/m²" step={5} value={plyGsm} onChange={setPlyGsm} />
            </div>
            <label className="grid gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">NIJ 0123.00 threat
              <select value={threatId} onChange={(e) => setThreatId(e.target.value)} className="field h-9 text-[13px]">{THREATS.map((t) => <option key={t.id} value={t.id}>{t.level} · {t.name} · {t.refMs} m/s</option>)}</select>
            </label>
            <div className="eyebrow mt-2">Tested reference</div>
            <label className="grid gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Reference fibre
              <select value={refFiberId} onChange={(e) => setRefFiberId(e.target.value)} className="field h-9 text-[13px]">{FIBERS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Num id="refad" label="Areal density" unit="kg/m²" step={0.05} value={refAd} onChange={setRefAd} />
              <Num id="refv50" label="Measured V50" unit="m/s" step={1} value={refV50} onChange={setRefV50} />
            </div>
            <p className="text-[12px] text-fg-3">Default reference: NIST 2020 PPTA panel, {NIST_REFERENCE.plies} plies, {NIST_REFERENCE.arealDensity} kg/m². Enter your lab&apos;s measured V50 for that reference to get absolute estimates.</p>
          </div>
          <div className="grid content-start gap-5 p-4">
            {!valid && <p role="alert" className="font-mono text-[12px] text-warning">Inputs out of range: every property must be positive, 1-120 plies.</p>}
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 xl:grid-cols-4">
              <Readout label="V50 vs reference" value={result ? pct(result.ratio) : "–"} tone="accent" hint={result ? `θ 1–2: ${pct(result.low)} – ${pct(result.high)}` : undefined} />
              <Readout label="V50 estimate" value={result?.v50 ? `${result.v50.toFixed(0)} m/s` : "–"} hint={result?.v50 ? `${result.v50Low!.toFixed(0)}–${result.v50High!.toFixed(0)} m/s` : "needs measured reference V50"} />
              <Readout label="Areal density" value={`${ad.toFixed(2)} kg/m²`} hint={`${plies} × ${plyGsm} g/m² · Γ0 ${Number.isFinite(g0) ? g0.toFixed(4) : "–"}`} />
              <Readout label="Matches reference at" value={matchAd ? `${matchAd.toFixed(2)} kg/m²` : "–"} hint={matchAd ? `${(1 - matchAd / refAd) >= 0 ? `${((1 - matchAd / refAd) * 100).toFixed(0)}% lighter` : `${((matchAd / refAd - 1) * 100).toFixed(0)}% heavier`} than the reference` : "needs measured reference V50"} />
            </div>
            <ScreenChart reference={reference} candidateFiber={custom} candidateAd={ad} projectile={threat.projectile} />
            <Legend items={[...FIBERS.map((f) => ({ label: f.name, color: FIBER_COLOR[f.id] })), { label: "Reference", swatch: <span className="h-2.5 w-2.5 border-2 border-fg bg-raised" /> }, { label: "Candidate", color: "var(--accent)" }]} />
            <p className="text-[12px] text-fg-3">Phoenix-Porwal V50 ratio to the reference against the same threat, θ = 1.5 (band: θ from {THETAS[0]} to {THETAS[THETAS.length - 1]}). A screening ratio, not a certified rating.</p>
          </div>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line p-4">
          <div><div className="eyebrow">Engineering drawing</div><p className="mt-1 text-[13px] text-fg-2">Generated from the design above. Thickness is estimated, not measured.</p></div>
          <div className="grid grid-cols-3 gap-3">
            <Num id="w" label="Width" unit="mm" value={size.w} onChange={(v) => setSize({ ...size, w: Math.max(50, Math.min(600, v)) })} />
            <Num id="h" label="Height" unit="mm" value={size.h} onChange={(v) => setSize({ ...size, h: Math.max(50, Math.min(600, v)) })} />
            <Num id="q" label="Quilt" unit="mm" value={size.quilt} onChange={(v) => setSize({ ...size, quilt: Math.max(5, Math.min(200, v)) })} />
          </div>
        </div>
        <div className="overflow-x-auto p-2 sm:p-4">
          <div className="min-w-[720px]">
            <ArmorDrawing s={{ designation: `AD-${custom.id.toUpperCase()}-${plies}P`, fiberName: custom.name, plies, arealDensity: ad, plyThicknessMm: plyThickness,
              widthMm: size.w, heightMm: size.h, quiltMm: size.quilt, threat: `NIJ ${threat.level} · ${threat.name.split(" ")[0]} ${threat.grains} gr`,
              ratio: result?.ratio ?? null, band: result ? [result.low, result.high] : null, v50: result?.v50 ? `${result.v50.toFixed(0)} m/s (${result.v50Low!.toFixed(0)}–${result.v50High!.toFixed(0)})` : null, date: "2026-11-19" }} />
          </div>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <ArmorStack plies={plies} widthMm={size.w} heightMm={size.h} quiltMm={size.quilt} explode={explode} />
        <div className="flex flex-wrap items-center gap-4 border-t border-line px-4 py-3">
          <label htmlFor="explode" className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Explode</label>
          <input id="explode" type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => setExplode(Number(e.target.value))} className="w-48 accent-[var(--accent)]" />
          <span className="text-[12px] text-fg-3">Ply thickness exaggerated for legibility. Construction illustration, not an impact simulation.</span>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Panel className="grid content-start gap-4 p-4">
          <div className="eyebrow">Service-life check</div>
          <p className="text-[13px] text-fg-2">NIST 2020&apos;s use of these models: predict how much V50 an aged panel keeps from tensile tests of yarns extracted from it.</p>
          <div className="grid grid-cols-3 gap-3">
            <Num id="as" label="Strength kept" unit="%" value={aging.strength} onChange={(v) => setAging({ ...aging, strength: Math.max(1, Math.min(150, v)) })} />
            <Num id="en" label="Strain new" step={0.001} value={aging.strainNew} onChange={(v) => setAging({ ...aging, strainNew: v })} />
            <Num id="ea" label="Strain aged" step={0.001} value={aging.strainAged} onChange={(v) => setAging({ ...aging, strainAged: v })} />
          </div>
          <div className="grid grid-cols-2 gap-x-6">
            <Readout label="V50 kept, Cunniff" value={Number.isFinite(ageC) ? `${ageC.toFixed(1)}%` : "–"} />
            <Readout label="V50 kept, Phoenix-Porwal" value={Number.isFinite(agePP) ? `${agePP.toFixed(1)}%` : "–"} tone="accent" hint={`ψmax ${Number.isFinite(psi) ? psi.toFixed(2) : "–"} at θ 1.5`} />
          </div>
          <p className="text-[12px] text-fg-3">Phoenix-Porwal is the more conservative when strain falls with age (NIST 2020, Eq. 13).</p>
        </Panel>

        <Panel className="grid content-start gap-4 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><div className="eyebrow">Test planner</div><p className="mt-1 text-[13px] text-fg-2">Monte Carlo of a range test: how close does each design get to the true V50 for a given number of shots?</p></div>
            <button type="button" onClick={runPlanner} disabled={running} className="btn-primary">{running ? "Simulating…" : "Run 7,200 simulated tests"}</button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Num id="tm" label="True V50" unit="m/s" value={sim.mu} onChange={(v) => setSim({ ...sim, mu: v })} />
            <Num id="ts" label="True spread σ" unit="m/s" value={sim.sigma} onChange={(v) => setSim({ ...sim, sigma: Math.max(1, v) })} />
            <Num id="po" label="Prior error" unit="m/s" value={sim.priorOffset} onChange={(v) => setSim({ ...sim, priorOffset: v })} />
            <Num id="ps" label="Prior σ" unit="m/s" value={sim.priorSd} onChange={(v) => setSim({ ...sim, priorSd: Math.max(1, v) })} />
          </div>
          <p className="text-[12px] text-fg-3">True V50 starts at the screened estimate when one exists. Prior = true V50 + prior error = {priorMu.toFixed(0)} m/s: set the error to see what a wrong screen costs. Set-point error ±3 m/s; NIJ steps 30/23/15 m/s per 0101.07 §9.5.</p>
          {curve ? <PlannerChart curve={curve} sigma={sim.sigma} /> : <div className="grid h-[200px] place-items-center border border-dashed border-line text-[13px] text-fg-3">Run the simulation to compare designs.</div>}
          <Legend items={[...(Object.keys(METHOD) as Method[]).map((m) => ({ label: METHOD[m].label, color: METHOD[m].color })),
            { label: "Hollow: an estimate in under 95% of tests", swatch: <span className="h-2.5 w-2.5 border border-fg-2 bg-raised" /> }]} />
        </Panel>
      </div>

      <Panel className="grid gap-3 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><div className="eyebrow">Example test, 15 shots</div><p className="mt-1 text-[13px] text-fg-2">Filled: complete penetration. Hollow: partial penetration. Same random draws for every design.</p></div>
          <div role="radiogroup" aria-label="Design to replay" className="inline-flex border border-line-strong">
            {(Object.keys(METHOD) as Method[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={replayMethod === m} onClick={() => setReplayMethod(m)}
                className={`h-8 border-r border-line-strong px-3 font-mono text-[10.5px] uppercase tracking-[0.08em] last:border-r-0 ${replayMethod === m ? "bg-accent text-accent-ink" : "text-fg-2 hover:text-fg"}`}>{m === "nij" ? "NIJ" : m === "3pod" ? "3POD" : "Prior"}</button>
            ))}
          </div>
        </div>
        <ReplayChart method={replayMethod} truth={{ mu: sim.mu, sigma: sim.sigma }} prior={{ mu: priorMu, sd: sim.priorSd }} />
      </Panel>
    </div>
  );
}
