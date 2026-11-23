import type { Prediction } from "@/lib/aero/predict";

/** Server (Node) and browser maths differ in the last float digits; rounding plotted coordinates keeps hydration exact. */
const px = (v: number) => Math.round(v * 100) / 100;

export interface DataPoint { alphaDeg: number; cl: number; series?: string }

const REGIME_FILL: Record<Prediction["regime"], string> = { attached: "var(--c3)", bursting: "var(--c4)", burst: "var(--c2)" };

/** CL against α: physics estimate, measured band, theory without breakdown, potential lift, and published data. */
export function LiftChart({ points, data, alpha, alphaMax, dataLabel }: { points: readonly Prediction[]; data: readonly DataPoint[]; alpha: number; alphaMax: number; dataLabel: string }) {
  const W = 680, H = 350, l = 50, r = 18, t = 24, b = 60;
  const ymax = Math.max(1.0, ...points.map((p) => Math.min(p.hi, 3)), ...data.map((d) => d.cl)) * 1.08;
  const ymin = Math.min(0, ...points.map((p) => p.lo), ...data.map((d) => d.cl));
  const x = (a: number) => px(l + (a / alphaMax) * (W - l - r));
  const y = (v: number) => px(t + (1 - (v - ymin) / (ymax - ymin)) * (H - t - b));
  const line = (f: (p: Prediction) => number) => points.map((p) => `${x(p.alpha)},${y(f(p))}`).join(" ");
  const band = `M${points.map((p) => `${x(p.alpha)},${y(Math.min(p.hi, ymax))}`).join(" L")} L${[...points].reverse().map((p) => `${x(p.alpha)},${y(Math.max(p.lo, ymin))}`).join(" L")} Z`;
  const step = ymax > 2 ? 0.5 : 0.2;
  const ticks = Array.from({ length: Math.floor((ymax - ymin) / step) + 1 }, (_, k) => Math.round((Math.ceil(ymin / step) + k) * step * 10) / 10).filter((v) => v <= ymax);
  // Regime strip along the axis: consecutive points share a regime segment.
  const segs: { a0: number; a1: number; g: Prediction["regime"] }[] = [];
  points.forEach((p, k) => {
    const prev = segs[segs.length - 1];
    const a1 = points[k + 1]?.alpha ?? p.alpha;
    if (prev && prev.g === p.regime) prev.a1 = a1; else segs.push({ a0: p.alpha, a1, g: p.regime });
  });
  const series = [...new Set(data.map((d) => d.series ?? dataLabel))];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Lift coefficient against angle of attack with measured error band and published data">
      {ticks.map((v) => (
        <g key={v}><line x1={l} x2={W - r} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={l - 8} y={y(v) + 4} fontSize={10.5} textAnchor="end">{v.toFixed(1)}</text></g>
      ))}
      {Array.from({ length: Math.floor(alphaMax / 10) + 1 }, (_, k) => k * 10).map((v) => (
        <g key={v}><line x1={x(v)} x2={x(v)} y1={t} y2={H - b} stroke="var(--line)" strokeDasharray="2 4" /><text x={x(v)} y={H - b + 16} fontSize={10.5} textAnchor="middle">{v}</text></g>
      ))}
      <text x={(l + W - r) / 2} y={H - 4} fontSize={10.5} textAnchor="middle">Angle of attack α, degrees →</text>
      <text x={l - 8} y={t - 10} fontSize={10.5} textAnchor="end">CL</text>
      <path d={band} fill="var(--accent)" opacity={0.16} />
      <polyline points={line((p) => p.clNoBreakdown)} fill="none" stroke="var(--fg-3)" strokeWidth={1.2} strokeDasharray="6 4" />
      <polyline points={line((p) => p.clPotential)} fill="none" stroke="var(--fg-3)" strokeWidth={1} strokeDasharray="2 3" />
      <polyline points={line((p) => p.cl)} fill="none" stroke="var(--accent)" strokeWidth={2.2} />
      {data.map((d, k) => {
        const s = series.indexOf(d.series ?? dataLabel);
        return s === 0
          ? <rect key={k} x={x(d.alphaDeg) - 3.5} y={y(d.cl) - 3.5} width={7} height={7} fill="var(--raised)" stroke="var(--fg)" strokeWidth={1.3}><title>{`${d.series ?? dataLabel}: α ${d.alphaDeg}°, CL ${d.cl}`}</title></rect>
          : <path key={k} d={`M${x(d.alphaDeg)} ${y(d.cl) - 5} l5 5 l-5 5 l-5 -5 Z`} fill="var(--raised)" stroke="var(--fg-2)" strokeWidth={1.3}><title>{`${d.series ?? dataLabel}: α ${d.alphaDeg}°, CL ${d.cl}`}</title></path>;
      })}
      <line x1={x(alpha)} x2={x(alpha)} y1={t} y2={H - b} stroke="var(--accent)" strokeWidth={1} />
      {segs.map((s) => <rect key={`${s.g}${s.a0}`} x={x(s.a0)} y={H - b + 24} width={Math.max(1, x(s.a1) - x(s.a0))} height={4} fill={REGIME_FILL[s.g]} opacity={0.85}><title>{`${s.g}: ${s.a0}–${s.a1}°`}</title></rect>)}
    </svg>
  );
}

export const REGIME_LEGEND = [
  { label: "Vortex intact", color: REGIME_FILL.attached },
  { label: "Vortex bursting over the wing", color: REGIME_FILL.bursting },
  { label: "Burst at the apex (stalled)", color: REGIME_FILL.burst },
];
