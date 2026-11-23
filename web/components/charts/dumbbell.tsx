import Link from "next/link";
import type { Project } from "@/lib/portfolio";
import { fmt2 } from "@/lib/format";

/** Prototype (hollow) → conditional (solid) on the 0–4 Compass scale. One row per project, each a link. */
export function DefensibilityChart({ projects, levels }: { projects: Project[]; levels: string[] }) {
  const W = 1000, left = 210, right = 120, rowH = 52, top = 50, H = top + projects.length * rowH + 8;
  const x = (v: number) => left + (v / 4) * (W - left - right);
  return (
    <>
    <CompactChart projects={projects} />
    <div className="hidden overflow-x-auto sm:block">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[640px]" role="img" aria-label="Defensibility, first prototype versus after assets are earned">
        <rect x={x(3)} y={top - 14} width={x(4) - x(3)} height={H - top + 6} fill="var(--accent-soft)" opacity={0.6} />
        {levels.map((lab, i) => (
          <g key={lab}>
            <line x1={x(i)} x2={x(i)} y1={top - 14} y2={H - 6} stroke="var(--line)" />
            <text x={x(i)} y={16} fontSize={12} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"} style={{ fill: "var(--fg)" }}>{i}</text>
            <text x={x(i)} y={32} fontSize={10.5} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}>{i === 4 ? "Durable moat" : lab}</text>
          </g>
        ))}
        <text x={W - right + 20} y={32} fontSize={10.5}>after · gain</text>
        {projects.map((p, i) => {
          const y = top + i * rowH + rowH / 2;
          return (
            <Link key={p.id} href={`/${p.slug}`} aria-label={`${p.short}: ${fmt2(p.prototype)} to ${fmt2(p.conditional)}`} className="group">
              <rect x={0} y={y - rowH / 2 + 4} width={W} height={rowH - 8} className="fill-transparent transition-colors group-hover:fill-[var(--surface)]" />
              <text x={12} y={y - 2} fontSize={14.5} style={{ fill: "var(--fg)", fontFamily: "var(--font-sans)", fontWeight: 600 }}>{p.short}</text>
              <text x={12} y={y + 15} fontSize={10.5}>{p.statusNote.split(/\.\s/)[0]}</text>
              <line x1={x(p.prototype) + 8} x2={x(p.conditional) - 9} y1={y} y2={y} stroke="var(--accent)" strokeWidth={2} opacity={0.45} />
              <circle cx={x(p.prototype)} cy={y} r={6.5} fill="var(--raised)" stroke="var(--fg-2)" strokeWidth={2} />
              <circle cx={x(p.conditional)} cy={y} r={8} fill="var(--accent)" stroke="var(--raised)" strokeWidth={2} />
              <text x={x(p.prototype)} y={y - 13} fontSize={11} textAnchor="middle">{fmt2(p.prototype)}</text>
              <text x={W - right + 20} y={y + 5} fontSize={16} style={{ fill: "var(--fg)", fontWeight: 500 }}>{fmt2(p.conditional)}</text>
              <text x={W - right + 70} y={y + 5} fontSize={11}>+{fmt2(p.conditional - p.prototype)}</text>
            </Link>
          );
        })}
      </svg>
    </div>
    </>
  );
}

/** Phone layout: name above each row, scale 0-4 full width, value at the right. Same encoding as desktop. */
function CompactChart({ projects }: { projects: Project[] }) {
  const W = 360, left = 10, right = 56, rowH = 56, top = 22, H = top + projects.length * rowH;
  const x = (v: number) => left + (v / 4) * (W - left - right);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full sm:hidden" role="img" aria-label="Defensibility, first prototype versus after assets are earned">
      <rect x={x(3)} y={top - 8} width={x(4) - x(3)} height={H - top + 4} fill="var(--accent-soft)" opacity={0.6} />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line x1={x(i)} x2={x(i)} y1={top - 8} y2={H - 4} stroke="var(--line)" />
          <text x={x(i)} y={12} fontSize={10.5} textAnchor={i === 0 ? "start" : "middle"}>{i}</text>
        </g>
      ))}
      <text x={W} y={12} fontSize={10.5} textAnchor="end">after</text>
      {projects.map((p, i) => {
        const y = top + i * rowH;
        return (
          <Link key={p.id} href={`/${p.slug}`} aria-label={`${p.short}: ${fmt2(p.prototype)} to ${fmt2(p.conditional)}`}>
            <text x={left} y={y + 16} fontSize={13} style={{ fill: "var(--fg)", fontFamily: "var(--font-sans)", fontWeight: 600 }}>{p.short}</text>
            <line x1={x(p.prototype) + 6} x2={x(p.conditional) - 7} y1={y + 34} y2={y + 34} stroke="var(--accent)" strokeWidth={2} opacity={0.45} />
            <circle cx={x(p.prototype)} cy={y + 34} r={5.5} fill="var(--raised)" stroke="var(--fg-2)" strokeWidth={2} />
            <circle cx={x(p.conditional)} cy={y + 34} r={7} fill="var(--accent)" stroke="var(--raised)" strokeWidth={2} />
            <text x={W} y={y + 39} fontSize={15} textAnchor="end" style={{ fill: "var(--fg)", fontWeight: 500 }}>{fmt2(p.conditional)}</text>
          </Link>
        );
      })}
    </svg>
  );
}
