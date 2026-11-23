/** Server-rendered charts for the unsteady vortex lift and the HARV flight path. Coordinates are rounded for exact hydration. */
const px = (v: number) => Math.round(v * 100) / 100;

export interface Curve { readonly label: string; readonly color: string; readonly dash?: string; readonly pts: readonly (readonly [number, number])[] }

export function LineChart({ curves, xLabel, yLabel, aria, xMin, xMax }: {
  curves: readonly Curve[]; xLabel: string; yLabel: string; aria: string; xMin: number; xMax: number;
}) {
  const W = 680, H = 300, l = 50, r = 18, t = 24, b = 58;
  const ys = curves.flatMap((c) => c.pts.map((p) => p[1]));
  const ymin = Math.min(0, ...ys), ymax = Math.max(...ys) * 1.08;
  const x = (v: number) => px(l + ((v - xMin) / (xMax - xMin)) * (W - l - r));
  const y = (v: number) => px(t + (1 - (v - ymin) / (ymax - ymin)) * (H - t - b));
  const yStep = ymax - ymin > 2 ? 0.5 : 0.2;
  const yTicks = Array.from({ length: Math.floor((ymax - ymin) / yStep) + 1 }, (_, k) => Math.round((Math.ceil(ymin / yStep) + k) * yStep * 10) / 10).filter((v) => v <= ymax);
  const xStep = (xMax - xMin) / 6;
  const xTicks = Array.from({ length: 7 }, (_, k) => xMin + k * xStep);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={aria}>
      {yTicks.map((v) => (
        <g key={`y${v}`}><line x1={l} x2={W - r} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={l - 8} y={y(v) + 4} fontSize={10.5} textAnchor="end">{v.toFixed(1)}</text></g>
      ))}
      {xTicks.map((v) => (
        <g key={`x${v}`}><line x1={x(v)} x2={x(v)} y1={t} y2={H - b} stroke="var(--line)" strokeDasharray="2 4" /><text x={x(v)} y={H - b + 16} fontSize={10.5} textAnchor="middle">{Math.round(v)}</text></g>
      ))}
      <text x={(l + W - r) / 2} y={H - 26} fontSize={10.5} textAnchor="middle">{xLabel}</text>
      <text x={l - 8} y={t - 10} fontSize={10.5} textAnchor="end">{yLabel}</text>
      {curves.map((c) => (
        <polyline key={c.label} points={c.pts.map(([a, v]) => `${x(a)},${y(v)}`).join(" ")} fill="none" stroke={c.color} strokeWidth={c.dash ? 1.3 : 2} strokeDasharray={c.dash} />
      ))}
      {curves.map((c, k) => (
        <g key={`k${c.label}`} transform={`translate(${l + k * 200},${H - 8})`}>
          <line x1={0} x2={18} y1={-4} y2={-4} stroke={c.color} strokeWidth={2} strokeDasharray={c.dash} />
          <text x={24} y={0} fontSize={10.5}>{c.label}</text>
        </g>
      ))}
    </svg>
  );
}
