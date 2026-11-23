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

export interface Series { readonly label: string; readonly color: string; readonly pts: readonly (readonly [number, number])[] }

/** Points by series with optional horizontal reference lines: used for the weight each flight point implies. */
export function ScatterChart({ series, refs, xLabel, yLabel, aria, xMin, xMax, yMin, yMax, yFormat }: {
  series: readonly Series[]; refs: readonly { y: number; label: string }[]; xLabel: string; yLabel: string; aria: string;
  xMin: number; xMax: number; yMin: number; yMax: number; yFormat: (v: number) => string;
}) {
  const W = 680, H = 320, l = 62, r = 18, t = 24, b = 62;
  const x = (v: number) => px(l + ((v - xMin) / (xMax - xMin)) * (W - l - r));
  const y = (v: number) => px(t + (1 - (v - yMin) / (yMax - yMin)) * (H - t - b));
  const yTicks = Array.from({ length: 6 }, (_, k) => yMin + (k * (yMax - yMin)) / 5);
  const xTicks = Array.from({ length: 7 }, (_, k) => xMin + (k * (xMax - xMin)) / 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={aria}>
      {yTicks.map((v) => (
        <g key={`y${v}`}><line x1={l} x2={W - r} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={l - 8} y={y(v) + 4} fontSize={10.5} textAnchor="end">{yFormat(v)}</text></g>
      ))}
      {xTicks.map((v) => (
        <g key={`x${v}`}><line x1={x(v)} x2={x(v)} y1={t} y2={H - b} stroke="var(--line)" strokeDasharray="2 4" /><text x={x(v)} y={H - b + 16} fontSize={10.5} textAnchor="middle">{Math.round(v)}</text></g>
      ))}
      {refs.map((f) => (
        <g key={f.label}><line x1={l} x2={W - r} y1={y(f.y)} y2={y(f.y)} stroke="var(--fg-3)" strokeDasharray="6 4" /><text x={W - r - 4} y={y(f.y) - 5} fontSize={10.5} textAnchor="end">{f.label}</text></g>
      ))}
      <text x={(l + W - r) / 2} y={H - 28} fontSize={10.5} textAnchor="middle">{xLabel}</text>
      <text x={l - 8} y={t - 10} fontSize={10.5} textAnchor="end">{yLabel}</text>
      {series.map((s, k) => s.pts.map(([a, v], i) => (k === 0
        ? <rect key={`${s.label}${i}`} x={x(a) - 3} y={y(v) - 3} width={6} height={6} fill="none" stroke={s.color} strokeWidth={1.4} />
        : k === 1 ? <path key={`${s.label}${i}`} d={`M${x(a)},${px(y(v) - 4)} L${px(x(a) + 4)},${px(y(v) + 3)} L${px(x(a) - 4)},${px(y(v) + 3)} Z`} fill="none" stroke={s.color} strokeWidth={1.4} />
          : <circle key={`${s.label}${i}`} cx={x(a)} cy={y(v)} r={3.6} fill={s.color} />)))}
      {series.map((s, k) => (
        <g key={`k${s.label}`} transform={`translate(${l + k * 205},${H - 8})`}>
          {k === 0 ? <rect x={3} y={-9} width={7} height={7} fill="none" stroke={s.color} strokeWidth={1.4} /> : k === 1 ? <path d="M7,-10 L11,-3 L3,-3 Z" fill="none" stroke={s.color} strokeWidth={1.4} /> : <circle cx={7} cy={-5} r={3.6} fill={s.color} />}
          <text x={18} y={0} fontSize={10.5}>{s.label}</text>
        </g>
      ))}
    </svg>
  );
}
