import type { Planform, PlanformProps } from "@/lib/aero/geometry";
import type { Prediction } from "@/lib/aero/predict";
import type { Panel as VlmPanel } from "@/lib/aero/vlm";

/**
 * Engineering drawing of the analysed planform (third-angle projection): plan view with the vortex lattice, MAC,
 * moment reference, centre of pressure and the vortex burst line at the selected angle; side view at incidence;
 * front view; dimensions, notes and a title block. Geometry comes from the same model the solver uses.
 */
const C = { line: "var(--fg-2)", thin: "var(--fg-3)", dim: "var(--accent)", text: "var(--fg-2)", strong: "var(--fg)", warn: "var(--warning)" };
const r2 = (v: number) => Math.round(v * 100) / 100;

function Dim({ x1, y1, x2, y2, label, offset = 18, vertical = false, labelLeft = false }: { x1: number; y1: number; x2: number; y2: number; label: string; offset?: number; vertical?: boolean; labelLeft?: boolean }) {
  const a = 5;
  if (vertical) {
    const x = r2(x1 + offset);
    return (
      <g stroke={C.dim} fill="none" strokeWidth={0.8}>
        <line x1={r2(x1 + Math.sign(offset) * 3)} y1={y1} x2={r2(x + Math.sign(offset) * 4)} y2={y1} /><line x1={r2(x2 + Math.sign(offset) * 3)} y1={y2} x2={r2(x + Math.sign(offset) * 4)} y2={y2} />
        <line x1={x} y1={y1} x2={x} y2={y2} />
        <path d={`M${x} ${y1} l-2.5 ${a} M${x} ${y1} l2.5 ${a} M${x} ${y2} l-2.5 ${-a} M${x} ${y2} l2.5 ${-a}`} />
        <text x={labelLeft ? x - 6 : x + 6} y={r2((y1 + y2) / 2 + 3.5)} fontSize={10} textAnchor={labelLeft ? "end" : "start"} stroke="none" style={{ fill: C.dim }}>{label}</text>
      </g>
    );
  }
  const y = r2(y1 + offset);
  return (
    <g stroke={C.dim} fill="none" strokeWidth={0.8}>
      <line x1={x1} y1={r2(y1 + 3)} x2={x1} y2={r2(y + 4)} /><line x1={x2} y1={r2(y2 + 3)} x2={x2} y2={r2(y + 4)} />
      <line x1={x1} y1={y} x2={x2} y2={y} />
      <path d={`M${x1} ${y} l${a} -2.5 M${x1} ${y} l${a} 2.5 M${x2} ${y} l${-a} -2.5 M${x2} ${y} l${-a} 2.5`} />
      <text x={r2((x1 + x2) / 2)} y={r2(y - 4)} fontSize={10} textAnchor="middle" stroke="none" style={{ fill: C.dim }}>{label}</text>
    </g>
  );
}

export interface WingDrawingSpec {
  designation: string; planform: Planform; props: PlanformProps; panels: readonly VlmPanel[]; at: Prediction;
  kp: number; kv: number; unit: string; date: string; burstXi: number; domainOk: boolean;
}

export function WingDrawing({ s }: { s: WingDrawingSpec }) {
  const W = 1000, H = 700;
  const st = s.planform.stations, p = s.props;
  const xs = st.flatMap((q) => [q.xLe, q.xLe + q.chord]);
  const xMin = Math.min(...xs), xMax = Math.max(...xs), semi = p.span / 2;
  // Plan view box (nose up): page x ← span, page y ← streamwise x.
  const box = { x: 100, y: 86, w: 400, h: 400 };
  const k = Math.min(box.w / p.span, box.h / (xMax - xMin));
  const cx = box.x + box.w / 2, X = (x: number) => r2(box.y + (x - xMin) * k), Y = (y: number) => r2(cx + y * k);
  const outlineR = [...st.map((q) => [q.y, q.xLe] as const), ...[...st].reverse().map((q) => [q.y, q.xLe + q.chord] as const)];
  const outline = [...outlineR, ...[...outlineR].reverse().map(([y, x]) => [-y, x] as const)].map(([y, x]) => `${Y(y)},${X(x)}`).join(" ");
  const lattice = s.panels.map((pn) => `M${pn.corners.map((c) => `${Y(c.y)} ${X(c.x)}`).join(" L")} Z`).join(" ");
  const root = st[0], tipSt = st[st.length - 1];
  const xTe = (root?.xLe ?? 0) + (root?.chord ?? 0);
  const burstX = s.burstXi >= 0 ? xTe - s.burstXi * (root?.chord ?? 0) : null;
  const xCp = Math.abs(s.at.cl) > 1e-6 ? p.xRef - (s.at.cm * p.cRef) / s.at.cl : null;
  const sweepDeg = (Math.atan2((st[1]?.xLe ?? 0) - (root?.xLe ?? 0), (st[1]?.y ?? 1) - (root?.y ?? 0)) * 180) / Math.PI;
  const fmt = (v: number, d = 2) => v.toFixed(d);
  // Side view: flat plate at incidence α, wind from the left.
  const sv = { x: 600, y: 120, w: 340 }, a = (s.at.alpha * Math.PI) / 180;
  const sk = (sv.w * 0.78) / (xMax - xMin), half = ((xMax - xMin) * sk) / 2, pcx = sv.x + sv.w / 2, pcy = sv.y + 70;
  const sx1 = r2(pcx - half * Math.cos(a)), sy1 = r2(pcy - half * Math.sin(a)), sx2 = r2(pcx + half * Math.cos(a)), sy2 = r2(pcy + half * Math.sin(a));
  // Front view: span line with the planform's thickness drawn as a thin plate.
  const fv = { x: 600, y: 300, w: 340 }, fk = fv.w / p.span;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`Engineering drawing of ${s.designation}: span ${fmt(p.span)} ${s.unit}, area ${fmt(p.area)} ${s.unit}², aspect ratio ${fmt(p.aspectRatio)}`}>
      <defs><marker id="arw" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill={C.thin} /></marker></defs>
      <rect x={6} y={6} width={W - 12} height={H - 12} fill="none" stroke={C.thin} strokeWidth={1} />
      <rect x={14} y={14} width={W - 28} height={H - 28} fill="none" stroke={C.line} strokeWidth={1.4} />

      {/* Plan view */}
      <text x={box.x} y={52} fontSize={11} style={{ fill: C.strong, letterSpacing: "0.12em" }}>PLAN VIEW · VORTEX LATTICE {s.panels.length * 2} PANELS</text>
      <path d={lattice} fill="none" stroke={C.thin} strokeWidth={0.35} opacity={0.75} />
      <polygon points={outline} fill="var(--raised)" fillOpacity={0.35} stroke={C.line} strokeWidth={1.6} />
      <line x1={cx} y1={box.y - 16} x2={cx} y2={X(xMax) + 16} stroke={C.strong} strokeWidth={0.8} strokeDasharray="16 3 3 3" />
      <text x={cx + 4} y={box.y - 20} fontSize={9.5} style={{ fill: C.text }}>℄</text>
      {/* MAC */}
      <line x1={Y(p.yMac)} y1={X(p.xMacLe)} x2={Y(p.yMac)} y2={X(p.xMacLe + p.mac)} stroke={C.dim} strokeWidth={1.4} />
      <text x={Y(p.yMac) + 5} y={X(p.xMacLe + p.mac / 2)} fontSize={9.5} style={{ fill: C.dim }}>MAC</text>
      {/* Reference point and centre of pressure */}
      <g stroke={C.strong} strokeWidth={0.9} fill="none">
        <circle cx={cx} cy={X(p.xRef)} r={5} /><line x1={cx - 9} x2={cx + 9} y1={X(p.xRef)} y2={X(p.xRef)} /><line x1={cx} x2={cx} y1={X(p.xRef) - 9} y2={X(p.xRef) + 9} />
      </g>
      <text x={cx - 12} y={X(p.xRef) + 4} fontSize={9.5} textAnchor="end" style={{ fill: C.text }}>REF</text>
      {xCp !== null && xCp > xMin - (xMax - xMin) && xCp < xMax + (xMax - xMin) && (
        <g><path d={`M${cx} ${r2(X(xCp) - 7)} l7 7 l-7 7 l-7 -7 Z`} fill={C.dim} /><text x={cx + 12} y={X(xCp) + 4} fontSize={9.5} style={{ fill: C.dim }}>{`CP α ${s.at.alpha}°`}</text></g>
      )}
      {burstX !== null && (
        <g><line x1={box.x - 4} x2={box.x + box.w + 4} y1={X(burstX)} y2={X(burstX)} stroke={C.warn} strokeWidth={1.1} strokeDasharray="7 4" />
          <text x={box.x + box.w + 4} y={X(burstX) - 5} fontSize={9.5} textAnchor="end" style={{ fill: C.warn }}>{`VORTEX BURST · α ${s.at.alpha}°`}</text></g>
      )}
      {/* Sweep angle arc at the apex */}
      {root && st[1] && (
        <g stroke={C.dim} fill="none" strokeWidth={0.8}>
          {/* Sweep is measured from the spanwise line through the apex to the leading edge. */}
          <line x1={Y(root.y)} y1={X(root.xLe)} x2={Y(root.y) + 76} y2={X(root.xLe)} strokeDasharray="3 3" />
          <path d={`M${r2(Y(root.y) + 64)} ${X(root.xLe)} A64 64 0 0 1 ${r2(Y(root.y) + 64 * Math.cos((sweepDeg * Math.PI) / 180))} ${r2(X(root.xLe) + 64 * Math.sin((sweepDeg * Math.PI) / 180))}`} />
          <text x={Y(root.y) + 70} y={X(root.xLe) + 18} fontSize={10} stroke="none" style={{ fill: C.dim }}>{`Λ ${fmt(sweepDeg, 1)}°`}</text>
        </g>
      )}
      <Dim x1={Y(-semi)} y1={X(xMax)} x2={Y(semi)} y2={X(xMax)} label={`b ${fmt(p.span)} ${s.unit}`} offset={26} />
      <Dim x1={Y(-semi)} y1={X(root?.xLe ?? 0)} x2={Y(-semi)} y2={X(xTe)} label={`c₀ ${fmt(root?.chord ?? 0)} ${s.unit}`} offset={-22} vertical labelLeft />
      {tipSt && tipSt.chord > 0 && <Dim x1={Y(semi)} y1={X(tipSt.xLe)} x2={Y(semi)} y2={X(tipSt.xLe + tipSt.chord)} label={`cₜ ${fmt(tipSt.chord)}`} offset={22} vertical />}

      {/* Side view */}
      <text x={sv.x} y={52} fontSize={11} style={{ fill: C.strong, letterSpacing: "0.12em" }}>SIDE VIEW · AT INCIDENCE</text>
      {[0, 1, 2].map((i) => <line key={i} x1={sv.x} x2={sv.x + 64} y1={pcy - 26 + i * 26} y2={pcy - 26 + i * 26} stroke={C.thin} strokeWidth={0.9} markerEnd="url(#arw)" />)}
      <text x={sv.x} y={pcy + 46} fontSize={9.5} style={{ fill: C.text }}>V∞</text>
      <line x1={sx1} y1={sy1} x2={sx2} y2={sy2} stroke={C.strong} strokeWidth={2.4} />
      <line x1={sx1} y1={sy1} x2={r2(pcx + half)} y2={sy1} stroke={C.thin} strokeDasharray="4 3" strokeWidth={0.8} />
      <path d={`M${r2(sx1 + 54)} ${sy1} A54 54 0 0 1 ${r2(sx1 + 54 * Math.cos(a))} ${r2(sy1 + 54 * Math.sin(a))}`} fill="none" stroke={C.dim} strokeWidth={0.9} />
      <text x={r2(sx1 + 60)} y={r2(sy1 + 16)} fontSize={10} style={{ fill: C.dim }}>{`α ${s.at.alpha}°`}</text>

      {/* Front view */}
      <text x={fv.x} y={fv.y - 34} fontSize={11} style={{ fill: C.strong, letterSpacing: "0.12em" }}>FRONT VIEW</text>
      <rect x={fv.x} y={fv.y - 1.5} width={fv.w} height={3} fill={C.strong} />
      <line x1={r2(fv.x + fv.w / 2)} x2={r2(fv.x + fv.w / 2)} y1={fv.y - 22} y2={fv.y + 22} stroke={C.strong} strokeWidth={0.8} strokeDasharray="12 3 3 3" />
      <Dim x1={fv.x} y1={fv.y} x2={r2(fv.x + p.span * fk)} y2={fv.y} label="flat plate · sharp edges" offset={22} />

      {/* Notes */}
      <g fontSize={10} style={{ fill: C.text }}>
        <text x={600} y={398} style={{ fill: C.strong, letterSpacing: "0.12em" }}>NOTES</text>
        <text x={600} y={416}>1. Thin flat plate, sharp edges, M &lt; 0.3.</text>
        <text x={600} y={432}>2. Vortex lattice + Polhamus suction analogy.</text>
        <text x={600} y={448}>3. Burst line: Wentz &amp; Kohlman 1968, Fig. 4.1.1.</text>
        <text x={600} y={464}>{s.domainOk ? "4. Band measured on held-out NASA wings." : "4. OUTSIDE validated domain: band ×2."}</text>
        <text x={600} y={480}>5. Analysis and teaching only.</text>
      </g>

      {/* Title block */}
      <g transform={`translate(${W - 474}, ${H - 182})`}>
        <rect width={460} height={168} fill="var(--raised)" stroke={C.line} strokeWidth={1.4} />
        {[30, 64, 98, 132].map((y) => <line key={y} x1={0} x2={460} y1={y} y2={y} stroke={C.thin} strokeWidth={0.8} />)}
        <line x1={230} y1={30} x2={230} y2={168} stroke={C.thin} strokeWidth={0.8} />
        <text x={12} y={20} fontSize={12} style={{ fill: C.strong, letterSpacing: "0.14em" }}>ARCHYMEDES / DEFENSE · WING AERODYNAMICS</text>
        {[
          ["DESIGNATION", s.designation, 0, 30], ["PLANFORM", `S ${fmt(p.area)} · b ${fmt(p.span)} · AR ${fmt(p.aspectRatio)}`, 230, 30],
          ["REFERENCE", `Sref ${fmt(p.sRef)} · MAC ${fmt(p.cRef)} ${s.unit}`, 0, 64], ["Kp / Kv", `${fmt(s.kp, 3)} / ${fmt(s.kv, 2)}`, 230, 64],
          [`CL AT α ${s.at.alpha}° (BAND)`, `${fmt(s.at.cl, 3)}  (${fmt(s.at.lo, 2)}–${fmt(s.at.hi, 2)})`, 0, 98], ["REGIME / CM", `${s.at.regime} / ${fmt(s.at.cm, 3)}`, 230, 98],
          ["SCALE / UNITS", `NTS · ${s.unit}`, 0, 132], ["PROJECTION / DATE", `third angle · ${s.date}`, 230, 132],
        ].map(([kk, v, x, y]) => (
          <g key={kk as string} transform={`translate(${(x as number) + 10}, ${y as number})`}>
            <text y={12} fontSize={8} style={{ fill: C.thin, letterSpacing: "0.12em" }}>{kk}</text>
            <text y={28} fontSize={11} style={{ fill: C.strong }}>{v}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}
