/**
 * Engineering drawing of a soft-armor ballistic panel: front view with quilt stitching, section A-A through the ply
 * stack, detail B of the plies, dimensions and a title block. Geometry is derived from the design inputs; thickness is
 * an estimate (ply areal density over fibre density × an assumed fibre volume fraction) and is labelled as such.
 */
export interface DrawingSpec {
  designation: string; fiberName: string; plies: number; arealDensity: number; plyThicknessMm: number;
  widthMm: number; heightMm: number; quiltMm: number; threat: string; ratio: number | null; band: [number, number] | null;
  v50: string | null; date: string;
}

const C = { line: "var(--fg-2)", thin: "var(--fg-3)", dim: "var(--accent)", text: "var(--fg-2)", strong: "var(--fg)" };

function Dim({ x1, y1, x2, y2, label, offset = 18, vertical = false, labelLeft = false }: { x1: number; y1: number; x2: number; y2: number; label: string; offset?: number; vertical?: boolean; labelLeft?: boolean }) {
  const a = 5;
  if (vertical) {
    const x = x1 + offset;
    return (
      <g stroke={C.dim} fill="none" strokeWidth={0.8}>
        <line x1={x1 + 3} y1={y1} x2={x + 4} y2={y1} /><line x1={x2 + 3} y1={y2} x2={x + 4} y2={y2} />
        <line x1={x} y1={y1} x2={x} y2={y2} />
        <path d={`M${x} ${y1} l-2.5 ${a} M${x} ${y1} l2.5 ${a} M${x} ${y2} l-2.5 ${-a} M${x} ${y2} l2.5 ${-a}`} />
        <text x={labelLeft ? x - 6 : x + 6} y={(y1 + y2) / 2 + 3.5} fontSize={10} textAnchor={labelLeft ? "end" : "start"} stroke="none" style={{ fill: C.dim }}>{label}</text>
      </g>
    );
  }
  const y = y1 + offset;
  return (
    <g stroke={C.dim} fill="none" strokeWidth={0.8}>
      <line x1={x1} y1={y1 + 3} x2={x1} y2={y + 4} /><line x1={x2} y1={y2 + 3} x2={x2} y2={y + 4} />
      <line x1={x1} y1={y} x2={x2} y2={y} />
      <path d={`M${x1} ${y} l${a} -2.5 M${x1} ${y} l${a} 2.5 M${x2} ${y} l${-a} -2.5 M${x2} ${y} l${-a} 2.5`} />
      <text x={(x1 + x2) / 2} y={y - 4} fontSize={10} textAnchor="middle" stroke="none" style={{ fill: C.dim }}>{label}</text>
    </g>
  );
}

export function ArmorDrawing({ s }: { s: DrawingSpec }) {
  const W = 1000, H = 640;
  // Front view: fit the panel into a 300 x 300 box.
  const k = 280 / Math.max(s.widthMm, s.heightMm), fw = s.widthMm * k, fh = s.heightMm * k, fx = 60, fy = 70;
  const q = Math.max(6, s.quiltMm * k);
  const stitches: string[] = [];
  for (let d = -fh; d < fw + fh; d += q * Math.SQRT2) {
    stitches.push(`M${fx + d} ${fy} L${fx + d + fh} ${fy + fh}`);
    stitches.push(`M${fx + d} ${fy + fh} L${fx + d + fh} ${fy}`);
  }
  // Section A-A: total thickness drawn with a 6x vertical exaggeration so plies stay legible.
  const thick = s.plies * s.plyThicknessMm, ex = Math.max(6, Math.ceil(70 / Math.max(0.1, thick * k))), sx = 430, sy = 110, sw = 260, sh = Math.min(150, thick * k * ex);
  const plyH = sh / s.plies;
  // Detail B: first 6 plies at a fixed scale.
  const dx = 780, dy = 70, dw = 160, nDetail = Math.min(6, s.plies), dh = 120, dph = dh / nDetail;
  const fmt = (v: number, d = 1) => v.toFixed(d);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`Engineering drawing of ${s.designation}: ${s.plies} plies of ${s.fiberName}, ${fmt(s.arealDensity, 2)} kg/m²`}>
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke={C.thin} strokeWidth={0.7} /></pattern>
        <clipPath id="front"><rect x={fx} y={fy} width={fw} height={fh} /></clipPath>
      </defs>
      <rect x={6} y={6} width={W - 12} height={H - 12} fill="none" stroke={C.thin} strokeWidth={1} />
      <rect x={14} y={14} width={W - 28} height={H - 28} fill="none" stroke={C.line} strokeWidth={1.4} />

      {/* Front view */}
      <text x={fx} y={fy - 22} fontSize={11} style={{ fill: C.strong, letterSpacing: "0.12em" }}>FRONT VIEW</text>
      <rect x={fx} y={fy} width={fw} height={fh} fill="var(--raised)" stroke={C.line} strokeWidth={1.6} />
      <rect x={fx + 8} y={fy + 8} width={fw - 16} height={fh - 16} fill="none" stroke={C.thin} strokeDasharray="4 3" />
      <g clipPath="url(#front)"><path d={stitches.join(" ")} stroke={C.thin} strokeWidth={0.7} strokeDasharray="5 3" fill="none" /></g>
      <circle cx={fx + fw / 2} cy={fy + fh / 2} r={4} fill="none" stroke={C.dim} strokeWidth={1.2} />
      <line x1={fx + fw / 2 - 10} y1={fy + fh / 2} x2={fx + fw / 2 + 10} y2={fy + fh / 2} stroke={C.dim} strokeWidth={0.8} />
      <line x1={fx + fw / 2} y1={fy + fh / 2 - 10} x2={fx + fw / 2} y2={fy + fh / 2 + 10} stroke={C.dim} strokeWidth={0.8} />
      {/* section line A-A */}
      <line x1={fx - 14} y1={fy + fh / 2} x2={fx + fw + 14} y2={fy + fh / 2} stroke={C.strong} strokeWidth={0.9} strokeDasharray="14 3 3 3" />
      <text x={fx - 24} y={fy + fh / 2 + 4} fontSize={11} style={{ fill: C.strong }}>A</text>
      <text x={fx + fw + 18} y={fy + fh / 2 + 4} fontSize={11} style={{ fill: C.strong }}>A</text>
      <Dim x1={fx} y1={fy + fh} x2={fx + fw} y2={fy + fh} label={`${s.widthMm} mm`} offset={22} />
      <Dim x1={fx + fw} y1={fy} x2={fx + fw} y2={fy + fh} label={`${s.heightMm} mm`} offset={30} vertical />
      <text x={fx} y={fy + fh + 58} fontSize={10} style={{ fill: C.text }}>Quilt stitch {s.quiltMm} mm diagonal · impact point at centre</text>

      {/* Section A-A */}
      <text x={sx} y={fy - 22} fontSize={11} style={{ fill: C.strong, letterSpacing: "0.12em" }}>{`SECTION A–A (THICKNESS ×${ex})`}</text>
      {Array.from({ length: s.plies }, (_, i) => (
        <rect key={i} x={sx} y={sy + i * plyH} width={sw} height={plyH} fill={i % 2 ? "url(#hatch)" : "var(--surface)"} stroke={C.thin} strokeWidth={0.4} />
      ))}
      <rect x={sx} y={sy} width={sw} height={sh} fill="none" stroke={C.line} strokeWidth={1.4} />
      <text x={sx + sw / 2} y={sy - 10} fontSize={10} textAnchor="middle" style={{ fill: C.text }}>STRIKE FACE ↓</text>
      <Dim x1={sx + sw} y1={sy} x2={sx + sw} y2={sy + sh} label={`${fmt(thick, 1)} mm est.`} offset={14} vertical />
      <Dim x1={sx} y1={sy + sh} x2={sx + sw} y2={sy + sh} label={`${s.widthMm} mm`} offset={20} />
      <circle cx={sx + 40} cy={sy + Math.min(sh, 3 * plyH) / 2} r={22} fill="none" stroke={C.dim} strokeWidth={1} />
      <text x={sx + 66} y={sy - 2} fontSize={11} style={{ fill: C.dim }}>B</text>

      {/* Detail B */}
      <text x={dx} y={fy - 22} fontSize={11} style={{ fill: C.strong, letterSpacing: "0.12em" }}>DETAIL B</text>
      {Array.from({ length: nDetail }, (_, i) => (
        <g key={i}>
          <rect x={dx} y={dy + i * dph} width={dw} height={dph - 4} fill={i % 2 ? "url(#hatch)" : "var(--surface)"} stroke={C.line} strokeWidth={0.8} />
          <text x={dx + dw + 6} y={dy + i * dph + dph / 2} fontSize={9} style={{ fill: C.text }}>PLY {i + 1}</text>
        </g>
      ))}
      <Dim x1={dx} y1={dy} x2={dx} y2={dy + dph - 4} label={`${fmt(s.plyThicknessMm, 2)} mm`} offset={-10} vertical labelLeft />
      <text x={dx} y={dy + dh + 18} fontSize={9.5} style={{ fill: C.text }}>{fmt(s.arealDensity / s.plies * 1000, 0)} g/m² per ply</text>

      {/* Notes */}
      <g fontSize={10} style={{ fill: C.text }}>
        <text x={430} y={318} style={{ fill: C.strong, letterSpacing: "0.12em" }}>NOTES</text>
        <text x={430} y={336}>{`1. ${s.plies} plies, ${s.fiberName}, ${fmt(s.arealDensity, 2)} kg/m² total.`}</text>
        <text x={430} y={352}>2. Thickness estimated at fibre volume fraction 0.60; verify on the panel.</text>
        <text x={430} y={368}>3. V50 screened relative to a tested reference (Phoenix-Porwal, NIST 2020).</text>
        <text x={430} y={384}>4. Not a certification: NIJ 0101.07 testing at an accredited laboratory.</text>
      </g>

      {/* Title block */}
      <g transform={`translate(${W - 474}, ${H - 178})`}>
        <rect width={460} height={164} fill="var(--raised)" stroke={C.line} strokeWidth={1.4} />
        {[30, 62, 94, 126].map((y) => <line key={y} x1={0} x2={460} y1={y} y2={y} stroke={C.thin} strokeWidth={0.8} />)}
        <line x1={230} y1={30} x2={230} y2={164} stroke={C.thin} strokeWidth={0.8} />
        <text x={12} y={20} fontSize={12} style={{ fill: C.strong, letterSpacing: "0.14em" }}>ARCHYMEDES / DEFENSE · SOFT ARMOR PANEL</text>
        {[
          ["DESIGNATION", s.designation, 0, 30], ["THREAT", s.threat, 230, 30],
          ["MATERIAL", s.fiberName, 0, 62], ["PLIES / AREAL DENSITY", `${s.plies} / ${fmt(s.arealDensity, 2)} kg/m²`, 230, 62],
          ["V50 VS REFERENCE (θ 1.5)", s.ratio === null ? "—" : `${fmt(s.ratio * 100, 1)} %  (${s.band ? `${fmt(s.band[0] * 100, 1)}–${fmt(s.band[1] * 100, 1)}` : ""})`, 0, 94],
          ["V50 ESTIMATE", s.v50 ?? "enter reference V50", 230, 94],
          ["SCALE", `NTS · section ×${ex} thickness`, 0, 126], ["DATE / REV", `${s.date} / A`, 230, 126],
        ].map(([k, v, x, y]) => (
          <g key={k as string} transform={`translate(${(x as number) + 10}, ${y as number})`}>
            <text y={12} fontSize={8} style={{ fill: C.thin, letterSpacing: "0.12em" }}>{k}</text>
            <text y={27} fontSize={11} style={{ fill: C.strong }}>{v}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}
