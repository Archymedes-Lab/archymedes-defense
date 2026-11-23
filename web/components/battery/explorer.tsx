"use client";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Legend, Panel } from "@/components/ui/primitives";
import type { Cell, ConditionSummary } from "@/lib/battery";
import { RAMP, rampColor } from "@/lib/format";

const ConditionSpace = dynamic(() => import("@/components/three/conditions").then((m) => m.ConditionSpace), {
  ssr: false, loading: () => <div className="aspect-[4/3] w-full animate-pulse bg-surface" />,
});

function FadeChart({ cells, highlight }: { cells: Cell[]; highlight: Set<string> }) {
  const W = 760, H = 380, l = 52, r = 16, t = 16, b = 40;
  const maxT = Math.max(...cells.map((c) => c.t[c.t.length - 1] ?? 0));
  const minR = Math.max(0.3, Math.floor(Math.min(...cells.flatMap((c) => c.q.map((q) => q / c.q0))) * 10) / 10);
  const x = (w: number) => l + (w / maxT) * (W - l - r);
  const y = (v: number) => t + ((1.02 - v) / (1.02 - minR)) * (H - t - b);
  const path = (c: Cell) => c.t.map((w, i) => `${i ? "L" : "M"}${x(w).toFixed(1)},${y(Math.max(minR, c.q[i]! / c.q0)).toFixed(1)}`).join("");
  const yTicks = [];
  for (let v = 1; v >= minR - 1e-9; v -= 0.1) yTicks.push(Math.round(v * 10) / 10);
  const xTicks = Array.from({ length: Math.floor(maxT / 10) + 1 }, (_, i) => i * 10);
  const sel = cells.filter((c) => highlight.has(c.id));
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[520px]" role="img" aria-label="Capacity retention over weeks on test for all cells, selected condition highlighted">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={l} x2={W - r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={l - 8} y={y(v) + 4} fontSize={10.5} textAnchor="end">{Math.round(v * 100)}%</text>
          </g>
        ))}
        {xTicks.map((w) => <text key={w} x={x(w)} y={H - 22} fontSize={10.5} textAnchor="middle">{w}</text>)}
        <text x={W - r} y={H - 4} fontSize={10.5} textAnchor="end">weeks on test</text>
        <line x1={l} x2={W - r} y1={y(0.8)} y2={y(0.8)} stroke="var(--critical)" strokeDasharray="5 4" strokeWidth={1.5} />
        <text x={W - r - 4} y={y(0.8) - 6} fontSize={10.5} textAnchor="end">80% end-of-life line</text>
        {cells.filter((c) => !highlight.has(c.id)).map((c) => <path key={c.id} d={path(c)} fill="none" stroke="var(--fg-3)" strokeWidth={1} opacity={0.22} />)}
        {sel.map((c) => (
          <g key={c.id}>
            <title>{`${c.id}: ${Math.round(c.retention * 100)}% after ${c.weeks} weeks; 80% reached at ${c.weeksTo80 ?? "n/a"} weeks`}</title>
            <path d={path(c)} fill="none" stroke="var(--raised)" strokeWidth={4} />
            <path d={path(c)} fill="none" stroke="var(--accent)" strokeWidth={2} />
            {c.weeksTo80 !== null && <circle cx={x(c.weeksTo80)} cy={y(0.8)} r={4.5} fill="var(--accent)" stroke="var(--raised)" strokeWidth={2} />}
          </g>
        ))}
      </svg>
    </div>
  );
}

export function BatteryExplorer({ conditions, cells, initial }: { conditions: ConditionSummary[]; cells: Cell[]; initial: number }) {
  const [group, setGroup] = useState(initial);
  const lives = conditions.flatMap((c) => (c.medianTo80 === null ? [] : [c.medianTo80]));
  const lo = Math.min(...lives), hi = Math.max(...lives);
  const current = conditions.find((c) => c.group === group)!;
  const highlight = useMemo(() => new Set(current.cells), [current]);
  const sorted = useMemo(() => [...conditions].sort((a, b) => (a.medianTo80 ?? 0) - (b.medianTo80 ?? 0)), [conditions]);
  const groupCells = cells.filter((c) => highlight.has(c.id));
  return (
    <div className="grid gap-6">
      <Panel className="overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="border-b border-line lg:border-r lg:border-b-0">
            <ConditionSpace conditions={conditions} selected={group} onSelect={setGroup} lo={lo} hi={hi} />
          </div>
          <div className="grid content-start gap-5 p-5">
            <div>
              <div className="eyebrow">Selected condition</div>
              <div className="mt-1 text-[28px] font-semibold tracking-tight">Group {current.group}</div>
            </div>
            <dl className="m-0 grid grid-cols-3 gap-4">
              {[["Charge", `${current.chargeC}C`], ["Discharge", `${current.dischargeC}C`], ["Depth", `${(current.dod * 100).toFixed(0)}%`]].map(([k, v]) => (
                <div key={k}><dt className="text-[12px] text-fg-2">{k}</dt><dd className="num m-0 text-[18px] font-medium sm:text-[20px]">{v}</dd></div>
              ))}
            </dl>
            <div className="bg-surface p-4">
              <div className="num text-[34px] font-semibold leading-none">{current.medianTo80?.toFixed(1) ?? "n/a"} <span className="text-[15px] font-normal text-fg-2">weeks</span></div>
              <div className="mt-1 text-[13px] text-fg-2">median time for its {current.cells.length} cells to fall to 80% capacity</div>
            </div>
            <div className="grid gap-1.5">
              {groupCells.map((c) => (
                <div key={c.id} className="flex justify-between font-mono text-[12px]">
                  <span>{c.id}</span><span className="num text-fg-2">{c.weeksTo80?.toFixed(1) ?? "n/a"} wk to 80%<span className="hidden sm:inline"> · {(c.q0 * 1000).toFixed(0)} mAh start</span></span>
                </div>
              ))}
            </div>
            <div className="grid gap-2">
              <div className="flex h-2.5 overflow-hidden ">{RAMP.map((c) => <span key={c} className="flex-1" style={{ background: c }} />)}</div>
              <div className="flex justify-between font-mono text-[10.5px] text-fg-2"><span>{lo.toFixed(0)} wk, short life</span><span>{hi.toFixed(0)} wk, long life</span></div>
            </div>
          </div>
        </div>
        <div className="border-t border-line p-5">
          <FadeChart cells={cells} highlight={highlight} />
          <div className="mt-3"><Legend items={[{ label: `Group ${current.group} cells`, color: "var(--accent)" }, { label: "All other cells", color: "var(--fg-3)" }, { label: "80% capacity", color: "var(--critical)" }]} /></div>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full min-w-[560px] text-[13.5px]">
            <thead className="sticky top-0 bg-raised text-left text-[12px] text-fg-2">
              <tr className="border-b border-line">
                <th className="px-5 py-3 font-medium">Group</th><th className="px-5 py-3 font-medium">Charge</th><th className="px-5 py-3 font-medium">Discharge</th>
                <th className="px-5 py-3 font-medium">Depth</th><th className="px-5 py-3 font-medium">Cells</th><th className="px-5 py-3 font-medium">Median weeks to 80%</th>
              </tr>
            </thead>
            <tbody className="num">
              {sorted.map((c) => (
                <tr key={c.group} onClick={() => setGroup(c.group)} aria-selected={c.group === group}
                  className={`cursor-pointer border-b border-line last:border-0 ${c.group === group ? "bg-accent-soft" : "hover:bg-surface"}`}>
                  <td className="px-5 py-2.5"><button type="button" className="font-medium" onClick={() => setGroup(c.group)}>G{c.group}</button></td>
                  <td className="px-5 py-2.5">{c.chargeC}C</td><td className="px-5 py-2.5">{c.dischargeC}C</td><td className="px-5 py-2.5">{(c.dod * 100).toFixed(1)}%</td>
                  <td className="px-5 py-2.5">{c.cells.length}</td>
                  <td className="px-5 py-2.5"><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 " style={{ background: rampColor(c.medianTo80 ?? lo, lo, hi) }} />{c.medianTo80?.toFixed(1) ?? "n/a"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
