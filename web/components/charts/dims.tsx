import type { Project } from "@/lib/portfolio";
import { DIM_LABEL, DIM_ORDER } from "@/lib/portfolio";

/** Nine Compass dimensions, 0–1: prototype (hollow) vs after assets (solid). */
export function DimensionChart({ project }: { project: Project }) {
  return (
    <>
      <div className="sm:hidden"><Dims project={project} W={340} left={92} /></div>
      <div className="hidden sm:block"><Dims project={project} W={560} left={120} /></div>
    </>
  );
}

function Dims({ project, W, left }: { project: Project; W: number; left: number }) {
  const right = 16, rowH = 30, top = 24, H = top + DIM_ORDER.length * rowH + 4;
  const x = (v: number) => left + v * (W - left - right);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`Compass dimensions for ${project.short}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top - 8} y2={H - 4} stroke="var(--line)" />
            <text x={x(t)} y={12} fontSize={10} textAnchor="middle">{t}</text>
          </g>
        ))}
        {DIM_ORDER.map((d, i) => {
          const y = top + i * rowH + rowH / 2, a = project.dims.prototype[d], b = project.dims.milestone[d];
          return (
            <g key={d}>
              <title>{`${DIM_LABEL[d]}: prototype ${a.toFixed(2)}, after assets ${b.toFixed(2)}`}</title>
              <text x={0} y={y + 4} fontSize={11.5} style={d === "defensibility" ? { fill: "var(--fg)", fontWeight: 500 } : undefined}>{DIM_LABEL[d]}</text>
              <line x1={x(Math.min(a, b))} x2={x(Math.max(a, b))} y1={y} y2={y} stroke="var(--accent)" strokeWidth={2} opacity={0.4} />
              <circle cx={x(a)} cy={y} r={5.5} fill="var(--raised)" stroke="var(--fg-2)" strokeWidth={2} />
              <circle cx={x(b)} cy={y} r={6.5} fill="var(--accent)" stroke="var(--raised)" strokeWidth={2} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
