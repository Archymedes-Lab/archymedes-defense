"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Legend, Panel } from "@/components/ui/primitives";
import { type Barrier, type CellType, type Layout, type MonteCarlo, PHYSICS, meanDraws, monteCarlo, simulate } from "@/lib/battery-tr/model";

const PackScene = dynamic(() => import("@/components/three/pack").then((m) => m.PackScene), { ssr: false, loading: () => <div className="aspect-[4/3] w-full animate-pulse bg-surface sm:aspect-[16/10]" /> });

const BARRIERS: Record<string, Barrier | null> = {
  none: null,
  ceramic: { name: "Ceramic fibre board 3.2 mm (k 0.049)", k: 0.049, thicknessMm: 3.2 },
  mica: { name: "Generic mica sheet 1 mm (k 0.5, illustrative)", k: 0.5, thicknessMm: 1 },
};
const px = (v: number) => Math.round(v * 100) / 100;

function Num({ id, label, value, onChange, min, max, step = 1, unit }: { id: string; label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string }) {
  return (
    <label htmlFor={id} className="grid gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">
      <span className="flex justify-between">{label}{unit && <span className="normal-case tracking-normal text-fg-3">{unit}</span>}</span>
      <input id={id} type="number" min={min} max={max} step={step} value={value} className="field h-9 text-[13px]"
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v))); }} />
    </label>
  );
}

function Readout({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "critical" | "accent" | "good" }) {
  return (
    <div className="grid content-start gap-1 border-l border-line-strong pl-3">
      <div className={`num font-mono text-[22px] leading-none tracking-tight sm:text-[26px] ${tone === "critical" ? "text-critical" : tone === "accent" ? "text-accent" : tone === "good" ? "text-good" : ""}`}>{value}</div>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">{label}</div>
      {hint && <div className="text-[12px] text-fg-3">{hint}</div>}
    </div>
  );
}

/** Top view in the drawing style of the armor page: pitch dimensions, barrier positions, trigger and cell index. */
function TopView({ lay, cell, failed, onPick }: { lay: Layout; cell: CellType; failed: (number | null)[]; onPick: (i: number) => void }) {
  const dMm = cell.diameter * 1000, pitch = dMm + lay.gapMm, bp = dMm + (lay.barrierGapMm ?? lay.gapMm);
  const xs: number[] = [], zs: number[] = [];
  let x = 0; for (let c = 0; c < lay.cols; c++) { xs.push(x); x += (lay.barrierAfterCols ?? []).includes(c) ? bp : pitch; }
  let z = 0; for (let r = 0; r < lay.rows; r++) { zs.push(z); z += (lay.barrierAfterRows ?? []).includes(r) ? bp : pitch; }
  const wMm = xs[lay.cols - 1]! + dMm, hMm = zs[lay.rows - 1]! + dMm, k = Math.min(420 / wMm, 300 / hMm), ox = 60, oy = 40;
  const W = ox + wMm * k + 80, H = oy + hMm * k + 70;
  return (
    <svg viewBox={`0 0 ${px(W)} ${px(H)}`} className="block w-full max-w-[640px]" role="img" aria-label="Top view of the cell layout; select a cell to make it the trigger">
      <text x={ox} y={18} fontSize={10.5} style={{ fill: "var(--fg)", letterSpacing: "0.12em" }}>TOP VIEW · SELECT TRIGGER</text>
      {xs.map((cx, c) => zs.map((cz, r) => {
        const i = r * lay.cols + c, trig = i === lay.trigger[0] * lay.cols + lay.trigger[1], f = failed[i] ?? null;
        return (
          <g key={i} role="button" tabIndex={0} aria-label={`Cell row ${r + 1} column ${c + 1}${trig ? ", trigger" : ""}`} className="cursor-pointer"
            onClick={() => onPick(i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onPick(i); }}>
            <circle cx={px(ox + (cx + dMm / 2) * k)} cy={px(oy + (cz + dMm / 2) * k)} r={px((dMm / 2) * k)} fill={trig ? "var(--critical)" : f !== null ? "var(--warning)" : "var(--raised)"} stroke="var(--fg-2)" strokeWidth={1.2} />
            <text x={px(ox + (cx + dMm / 2) * k)} y={px(oy + (cz + dMm / 2) * k + 3.5)} fontSize={9.5} textAnchor="middle" style={{ fill: trig || f !== null ? "var(--accent-ink)" : "var(--fg-2)" }}>{f !== null && !trig ? `${f.toFixed(0)}s` : i + 1}</text>
          </g>
        );
      }))}
      {(lay.barrierAfterRows ?? []).filter((r) => r < lay.rows - 1).map((r) => { const y = oy + (zs[r]! + dMm + (zs[r + 1]! - zs[r]! - dMm) / 2) * k; return <line key={`r${r}`} x1={ox - 6} x2={px(ox + wMm * k + 6)} y1={px(y)} y2={px(y)} stroke="var(--accent)" strokeWidth={lay.barrier ? 3 : 1} strokeDasharray={lay.barrier ? undefined : "4 3"} />; })}
      {(lay.barrierAfterCols ?? []).filter((c) => c < lay.cols - 1).map((c) => { const xx = ox + (xs[c]! + dMm + (xs[c + 1]! - xs[c]! - dMm) / 2) * k; return <line key={`c${c}`} y1={oy - 6} y2={px(oy + hMm * k + 6)} x1={px(xx)} x2={px(xx)} stroke="var(--accent)" strokeWidth={lay.barrier ? 3 : 1} strokeDasharray={lay.barrier ? undefined : "4 3"} />; })}
      <g stroke="var(--accent)" strokeWidth={0.8} fill="none">
        <line x1={ox} x2={px(ox + wMm * k)} y1={px(oy + hMm * k + 20)} y2={px(oy + hMm * k + 20)} />
        <line x1={ox} x2={ox} y1={px(oy + hMm * k + 14)} y2={px(oy + hMm * k + 26)} /><line x1={px(ox + wMm * k)} x2={px(ox + wMm * k)} y1={px(oy + hMm * k + 14)} y2={px(oy + hMm * k + 26)} />
      </g>
      <text x={px(ox + (wMm * k) / 2)} y={px(oy + hMm * k + 36)} fontSize={10} textAnchor="middle" style={{ fill: "var(--accent)" }}>{`${wMm.toFixed(1)} mm · pitch ${pitch.toFixed(1)} mm · Ø${dMm.toFixed(0)} × ${(cell.length * 1000).toFixed(0)} mm`}</text>
    </svg>
  );
}

/** Each measured test of the chosen cell model: total heat (x) and the share kept by the cell body (y). */
function HeatStrip({ cell }: { cell: CellType }) {
  const W = 360, H = 150, l = 40, r = 10, t = 10, b = 30;
  const kj = cell.tests.map((x) => x[0]), lo = Math.min(...kj) * 0.9, hi = Math.max(...kj) * 1.05;
  const x = (v: number) => px(l + ((v - lo) / (hi - lo)) * (W - l - r)), y = (v: number) => px(t + (1 - v / 60) * (H - t - b));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`Measured heat release of ${cell.tests.length} tests for ${cell.name}`}>
      {[0, 20, 40, 60].map((v) => <g key={v}><line x1={l} x2={W - r} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={l - 6} y={y(v) + 3.5} fontSize={9.5} textAnchor="end">{v}%</text></g>)}
      {[lo, (lo + hi) / 2, hi].map((v) => <text key={v} x={x(v)} y={H - 12} fontSize={9.5} textAnchor="middle">{v.toFixed(0)}</text>)}
      <text x={W - r} y={H - 1} fontSize={9.5} textAnchor="end">total heat, kJ →</text>
      {cell.tests.map((tt, i) => <rect key={i} x={x(tt[0]) - 3} y={y(tt[1]) - 3} width={6} height={6} fill="var(--accent)" opacity={0.8}><title>{`${tt[0]} kJ, ${tt[1]}% in the cell body, τ ${tt[2]} s`}</title></rect>)}
    </svg>
  );
}

export function RunawaySimulator({ cells, calibration }: { cells: (CellType & { n?: number })[]; calibration: { criticalC: number; ejectaToNeighbours: number; contactG: number } }) {
  const [cellName, setCellName] = useState("Samsung 18650-26J");
  const [rows, setRows] = useState(4), [cols, setCols] = useState(4), [gap, setGap] = useState(0);
  const [trigger, setTrigger] = useState(1);
  const [barrierKey, setBarrierKey] = useState("ceramic");
  const [barrierRow, setBarrierRow] = useState(2), [barrierCol, setBarrierCol] = useState(-1), [barrierGap, setBarrierGap] = useState(5);
  const [tabs, setTabs] = useState(false);
  const [ejecta, setEjecta] = useState(calibration.ejectaToNeighbours);
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false);
  const [mc, setMc] = useState<MonteCarlo | null>(null), [mcBusy, setMcBusy] = useState(false);
  const raf = useRef(0);

  const cell = cells.find((c) => c.name === cellName) ?? cells[0]!;
  const n = rows * cols, trig = Math.min(trigger, n - 1);
  const physics = { ...PHYSICS, onsetOverrideC: calibration.criticalC, ejectaToNeighbours: ejecta, contactG: calibration.contactG, horizonS: 900 };
  const layout: Layout = useMemo(() => ({ rows, cols, gapMm: gap, trigger: [Math.floor(trig / cols), trig % cols],
    barrierAfterRows: barrierRow >= 0 && barrierRow < rows - 1 ? [barrierRow] : [], barrierAfterCols: barrierCol >= 0 && barrierCol < cols - 1 ? [barrierCol] : [],
    barrierGapMm: barrierGap, barrier: BARRIERS[barrierKey] ?? null, tabs }), [rows, cols, gap, trig, barrierRow, barrierCol, barrierGap, barrierKey, tabs]);
  const run = useMemo(() => simulate(cell, layout, physics, meanDraws(cell, n), { trace: true }), [cell, layout, ejecta, calibration]); // eslint-disable-line react-hooks/exhaustive-deps
  const frames = run.trace!;
  const fi = Math.min(frames.t.length - 1, Math.max(0, frames.t.findIndex((t) => t >= time)));
  const temps = Array.from(frames.T[fi] ?? []), failedNow = run.failed.map((f) => f !== null && f <= (frames.t[fi] ?? 0));
  const lastFail = Math.max(...run.failed.filter((x): x is number => x !== null));

  useEffect(() => { setMc(null); setTime(Math.min(lastFail + 30, 900)); }, [layout, cellName, ejecta]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => { setTime((t) => { const nt = t + ((now - last) / 1000) * 30; last = now; if (nt >= 900) { setPlaying(false); return 900; } return nt; }); raf.current = requestAnimationFrame(tick); };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing]);

  function runMc() {
    setMcBusy(true);
    setTimeout(() => { setMc(monteCarlo(cell, layout, physics, 200, 11)); setMcBusy(false); }, 20);
  }

  return (
    <div className="grid gap-6">
      <Panel className="overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <div className="grid content-start gap-4 border-b border-line p-4 lg:border-r lg:border-b-0">
            <div className="eyebrow">Pack design</div>
            <label className="grid gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Cell (Battery Failure Databank)
              <select value={cellName} onChange={(e) => setCellName(e.target.value)} className="field h-9 text-[13px]">
                {cells.map((c) => <option key={c.name} value={c.name}>{`${c.name} · ${c.tests.length} tests`}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-3 gap-3">
              <Num id="rows" label="Rows" value={rows} min={2} max={8} onChange={setRows} />
              <Num id="cols" label="Cols" value={cols} min={2} max={8} onChange={setCols} />
              <Num id="gap" label="Gap" unit="mm" value={gap} min={0} max={8} step={0.5} onChange={setGap} />
            </div>
            <label className="grid gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Barrier
              <select value={barrierKey} onChange={(e) => setBarrierKey(e.target.value)} className="field h-9 text-[13px]">
                {Object.entries(BARRIERS).map(([k, b]) => <option key={k} value={k}>{b ? b.name : "None (gap only)"}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-3 gap-3">
              <Num id="brow" label="After row" value={barrierRow + 1} min={0} max={rows - 1} onChange={(v) => setBarrierRow(v - 1)} />
              <Num id="bcol" label="After col" value={barrierCol + 1} min={0} max={cols - 1} onChange={(v) => setBarrierCol(v - 1)} />
              <Num id="bgap" label="Its gap" unit="mm" value={barrierGap} min={1} max={15} onChange={setBarrierGap} />
            </div>
            <label className="flex items-center gap-2 text-[13px] text-fg-2"><input type="checkbox" checked={tabs} onChange={(e) => setTabs(e.target.checked)} className="accent-[var(--accent)]" />Parallel tabs between neighbours (Lopez modules)</label>
            <label htmlFor="ej" className="grid gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">
              <span className="flex justify-between">Ejecta heat to neighbours<span className="normal-case tracking-normal text-fg">{Math.round(ejecta * 100)}%</span></span>
              <input id="ej" type="range" min={0} max={0.5} step={0.05} value={ejecta} onChange={(e) => setEjecta(Number(e.target.value))} className="accent-[var(--accent)]" />
            </label>
            <p className="text-[12px] text-fg-3">Calibrated: critical temperature {calibration.criticalC} °C, contact conductance {calibration.contactG} W/K, ejecta share {Math.round(calibration.ejectaToNeighbours * 100)}%. Row 0 / col 0 = no barrier.</p>
          </div>
          <div className="grid content-start gap-5 p-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 xl:grid-cols-4">
              <Readout label="Cells in runaway" value={`${run.propagated + 1} / ${n}`} tone={run.propagated > 0 ? "critical" : "good"} hint="mean measured heat, deterministic" />
              <Readout label="Last failure" value={run.propagated > 0 ? `${lastFail.toFixed(0)} s` : "—"} hint="after the trigger" />
              <Readout label="P(any propagation)" value={mc ? `${Math.round(mc.pAny * 100)}%` : "—"} tone="accent" hint={mc ? `${mc.runs} runs, ${mc.meanFailed.toFixed(1)} cells on average` : "run Monte Carlo"} />
              <Readout label="Heat per cell" value={`${(cell.tests.reduce((a, t) => a + t[0], 0) / cell.tests.length).toFixed(0)} kJ`} hint={`${(cell.tests.reduce((a, t) => a + t[1], 0) / cell.tests.length).toFixed(0)}% stays in the body`} />
            </div>
            {(() => { const r = Math.floor(trig / cols), c = trig % cols; return r > 0 && r < rows - 1 && c > 0 && c < cols - 1; })() && (
              <p role="note" className="border border-warning/50 bg-warning/10 px-3 py-2 text-[12.5px] text-fg">Interior trigger: the model shares the ejecta heat among all eight neighbours, so interior cells propagate less readily than edge cells. No experiment used here checks this case; treat a "contained" result as unverified.</p>
            )}
            <TopView lay={layout} cell={cell} failed={run.failed} onPick={setTrigger} />
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={runMc} disabled={mcBusy} className="btn-primary">{mcBusy ? "Running…" : "Monte Carlo · 200 runs"}</button>
              <span className="text-[12px] text-fg-3">Each run draws every cell&apos;s heat, body share and release time from that cell model&apos;s measured tests.</span>
            </div>
            {mc && (
              <div className="grid gap-2">
                <div className="eyebrow">Probability each cell enters runaway</div>
                <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, maxWidth: cols * 64 }}>
                  {mc.failProb.map((p, i) => (
                    <div key={i} className="grid aspect-square place-items-center border border-line font-mono text-[11px]" style={{ background: `color-mix(in srgb, var(--critical) ${Math.round(p * 85)}%, var(--raised))`, color: p > 0.5 ? "var(--fg)" : "var(--fg-2)" }}
                      title={`Cell ${i + 1}: ${(p * 100).toFixed(0)}%`}>{(p * 100).toFixed(0)}%</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <PackScene rows={rows} cols={cols} diameterMm={cell.diameter * 1000} lengthMm={cell.length * 1000} gapMm={gap} temps={temps} failed={failedNow} critical={calibration.criticalC}
          barrierAfterRows={layout.barrierAfterRows ?? []} barrierAfterCols={layout.barrierAfterCols ?? []} barrierGapMm={barrierGap} trigger={trig} />
        <div className="flex flex-wrap items-center gap-4 border-t border-line px-4 py-3">
          <button type="button" onClick={() => { if (time >= 899) setTime(0); setPlaying((p) => !p); }} className="btn-ghost h-8 w-20 px-0">{playing ? "Pause" : "Play"}</button>
          <label htmlFor="time" className="sr-only">Time after trigger</label>
          <input id="time" type="range" min={0} max={900} step={1} value={time} onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }} className="min-w-0 flex-1 accent-[var(--accent)]" />
          <span className="num w-20 text-right font-mono text-[13px]">{`T+${Math.round(frames.t[fi] ?? 0)} s`}</span>
        </div>
        <div className="border-t border-line px-4 py-3">
          <Legend items={[{ label: "Near ambient", color: "var(--fg-3)" }, { label: "Heating", color: "var(--warning)" }, { label: `Runaway (≥ ${calibration.criticalC} °C)`, color: "var(--critical)" }, { label: "Barrier", color: "var(--accent)" }]} />
        </div>
      </Panel>

      <Panel className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="grid content-start gap-2">
          <div className="eyebrow">Measured heat release · {cell.name}</div>
          <p className="text-[13px] text-fg-2">{cell.tests.length} fractional-calorimetry tests at 100% charge. The spread is why one design can propagate in one run and not the next.</p>
        </div>
        <HeatStrip cell={cell} />
      </Panel>
    </div>
  );
}
