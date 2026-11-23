import { harvOutlines } from "@/lib/aero/harv-mesh";
import type { Prediction } from "@/lib/aero/predict";

/**
 * Three-view engineering drawing of the NASA F/A-18 HARV (third-angle projection: plan above, side below it,
 * front at right), generated from the same tables as the 3D model. Dimensions are the published NASA values;
 * outlines are traced from the NASA three-view (TP-1999-206573 Fig. 2) and scaled to them.
 */
const C = { line: "var(--fg-2)", thin: "var(--fg-3)", dim: "var(--accent)", text: "var(--fg-2)", strong: "var(--fg)", warn: "var(--warning)", fill: "var(--raised)" };
const r2 = (v: number) => Math.round(v * 100) / 100;

function DimH({ x1, x2, y, label }: { x1: number; x2: number; y: number; label: string }) {
  return (
    <g stroke={C.dim} fill="none" strokeWidth={0.8}>
      <line x1={x1} x2={x2} y1={y} y2={y} />
      <path d={`M${x1} ${y} l5 -2.5 M${x1} ${y} l5 2.5 M${x2} ${y} l-5 -2.5 M${x2} ${y} l-5 2.5`} />
      <text x={r2((x1 + x2) / 2)} y={y - 4} fontSize={10} textAnchor="middle" stroke="none" style={{ fill: C.dim }}>{label}</text>
    </g>
  );
}
function DimV({ x, y1, y2, label }: { x: number; y1: number; y2: number; label: string }) {
  return (
    <g stroke={C.dim} fill="none" strokeWidth={0.8}>
      <line x1={x} x2={x} y1={y1} y2={y2} />
      <path d={`M${x} ${y1} l-2.5 5 M${x} ${y1} l2.5 5 M${x} ${y2} l-2.5 -5 M${x} ${y2} l2.5 -5`} />
      <text x={x + 6} y={r2((y1 + y2) / 2 + 3)} fontSize={10} stroke="none" style={{ fill: C.dim }}>{label}</text>
    </g>
  );
}

export function HarvDrawing({ at, burstXi, date }: { at: Prediction; burstXi: number; date: string }) {
  const o = harvOutlines(), P = o.published, wg = o.wingGeometry;
  const W = 1000, H = 800, k = 9.2; // px per foot
  // Plan view: nose left, span vertical.
  const px0 = 60, pyc = 218;
  const PX = (x: number) => r2(px0 + x * k), PY = (y: number) => r2(pyc + y * k);
  const bodyPlan = [...o.body.map((b) => `${PX(b.x)},${PY(b.halfWidth)}`), ...[...o.body].reverse().map((b) => `${PX(b.x)},${PY(-b.halfWidth)}`)].join(" ");
  const quad = (q: [number, number][], s: 1 | -1) => q.map(([x, y]) => `${PX(x)},${PY(s * y)}`).join(" ");
  const lexPath = (s: 1 | -1) => `${o.lex.map((p) => `${PX(p.x)},${PY(s * p.y)}`).join(" ")} ${PX(28.32)},${PY(s * 4.49)} ${PX(28.32)},${PY(s * 1.5)} ${PX(11.3)},${PY(s * 1.5)}`;
  // Side view below the plan, sharing the x scale (projection lines align).
  const syGround = 600, SZ = (z: number) => r2(syGround - z * k);
  const sideTop = o.body.map((b) => `${PX(b.x)},${SZ(b.top)}`).join(" "), sideBot = [...o.body].reverse().map((b) => `${PX(b.x)},${SZ(b.bottom)}`).join(" ");
  const canopy = o.canopy.map((c) => `${PX(c.x)},${SZ(c.top)}`).join(" ");
  // Front view at right.
  const fx = 800, FY = (y: number) => r2(fx + y * k * 0.72), FZ = (z: number) => r2(syGround - z * k * 0.72);
  const maxB = o.body.reduce((m, b) => (b.halfWidth > m.halfWidth ? b : m));
  const ell = Array.from({ length: 41 }, (_, i) => { const t = (2 * Math.PI * i) / 40; const c = Math.cos(t), s = Math.sin(t); return `${FY(Math.sign(c) * maxB.halfWidth * Math.abs(c) ** (2 / 2.6))},${FZ(0.5 * (maxB.top + maxB.bottom) + Math.sign(s) * 0.5 * (maxB.top - maxB.bottom) * Math.abs(s) ** (2 / 2.6))}`; }).join(" ");
  const root = { x: 11.3, chord: 41.9 - 11.3 };
  const burstX = burstXi >= 0 ? root.x + root.chord * (1 - burstXi) : null;
  const xRef = wg.xMacLe + 0.25 * wg.mac;
  const fmt = (v: number, d = 2) => v.toFixed(d);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`Three-view engineering drawing of the NASA F/A-18 HARV: length ${P.lengthFt} ft, span ${P.spanFt} ft, height ${P.heightFt} ft`}>
      <rect x={6} y={6} width={W - 12} height={H - 12} fill="none" stroke={C.thin} />
      <rect x={14} y={14} width={W - 28} height={H - 28} fill="none" stroke={C.line} strokeWidth={1.4} />
      <text x={px0} y={34} fontSize={11} style={{ fill: C.strong, letterSpacing: "0.12em" }}>PLAN VIEW</text>
      {/* Plan: stab, wing, LEX, body, canopy (draw order hides internal edges). */}
      {([1, -1] as const).map((s) => <polygon key={`st${s}`} points={quad(o.stab, s)} fill={C.fill} stroke={C.line} strokeWidth={1.2} />)}
      {([1, -1] as const).map((s) => <polygon key={`w${s}`} points={quad(o.wing, s)} fill={C.fill} stroke={C.line} strokeWidth={1.4} />)}
      {([1, -1] as const).map((s) => <polygon key={`l${s}`} points={lexPath(s)} fill={C.fill} stroke={C.line} strokeWidth={1.2} />)}
      <polygon points={bodyPlan} fill={C.fill} stroke={C.line} strokeWidth={1.4} />
      {([1, -1] as const).map((s) => <rect key={`pod${s}`} x={PX(30.6)} y={PY(s * (wg.semi + 0.3)) - 3} width={r2(10.2 * k)} height={6} fill={C.fill} stroke={C.line} />)}
      <polygon points={o.canopy.map((c) => `${PX(c.x)},${PY(c.halfWidth)}`).concat([...o.canopy].reverse().map((c) => `${PX(c.x)},${PY(-c.halfWidth)}`)).join(" ")} fill="none" stroke={C.thin} />
      <line x1={PX(-1)} x2={PX(57)} y1={pyc} y2={pyc} stroke={C.strong} strokeWidth={0.7} strokeDasharray="16 3 3 3" />
      <line x1={PX(wg.xMacLe)} x2={PX(wg.xMacLe + wg.mac)} y1={PY(wg.yMac)} y2={PY(wg.yMac)} stroke={C.dim} strokeWidth={1.4} />
      <text x={PX(wg.xMacLe + wg.mac) + 4} y={PY(wg.yMac) + 3} fontSize={9.5} style={{ fill: C.dim }}>MAC 11.52</text>
      <g stroke={C.strong} fill="none" strokeWidth={0.9}><circle cx={PX(xRef)} cy={pyc} r={4.5} /><line x1={PX(xRef) - 8} x2={PX(xRef) + 8} y1={pyc} y2={pyc} /><line x1={PX(xRef)} x2={PX(xRef)} y1={pyc - 8} y2={pyc + 8} /></g>
      {burstX !== null && <g><line x1={PX(burstX)} x2={PX(burstX)} y1={PY(-6)} y2={PY(6)} stroke={C.warn} strokeDasharray="6 4" strokeWidth={1.1} /><text x={PX(burstX) + 4} y={PY(-6)} fontSize={9.5} style={{ fill: C.warn }}>{`LEX VORTEX BURST · α ${at.alpha}°`}</text></g>}
      <DimH x1={PX(0)} x2={PX(P.lengthFt)} y={PY(wg.semi) + 30} label={`${P.lengthFt} ft`} />
      <DimV x={PX(P.lengthFt) + 46} y1={PY(-wg.semi)} y2={PY(wg.semi)} label={`${fmt(P.spanFt, 1)} ft`} />
      <DimV x={PX(o.stab[2]?.[0] ?? 56) + 8} y1={PY(-(o.stabZ.tipY))} y2={PY(o.stabZ.tipY)} label="" />
      <text x={PX(o.stab[2]?.[0] ?? 56) + 12} y={PY(o.stabZ.tipY) + 14} fontSize={10} style={{ fill: C.dim }}>{`${P.stabSpanFt} ft`}</text>

      {/* Side view */}
      <text x={px0} y={syGround - 150} fontSize={11} style={{ fill: C.strong, letterSpacing: "0.12em" }}>SIDE VIEW (GEAR OMITTED)</text>
      <polygon points={o.vtailSide.map(([x, z]) => `${PX(x)},${SZ(z)}`).join(" ")} fill={C.fill} stroke={C.line} strokeWidth={1.3} />
      <polygon points={`${sideTop} ${sideBot}`} fill={C.fill} stroke={C.line} strokeWidth={1.4} />
      <polyline points={canopy} fill="none" stroke={C.line} strokeWidth={1.2} />
      <line x1={PX(o.wing[0]?.[0] ?? 27)} x2={PX(o.wing[3]?.[0] ?? 41)} y1={SZ(o.wingZ.root)} y2={SZ(o.wingZ.root)} stroke={C.thin} strokeWidth={1.6} />
      <circle cx={PX(o.nozzles.x + o.nozzles.length)} cy={SZ(o.nozzles.z)} r={r2(o.nozzles.radius * k * 0.25)} fill="none" stroke={C.thin} />
      <line x1={PX(-1)} x2={PX(57)} y1={syGround} y2={syGround} stroke={C.thin} strokeDasharray="10 4" />
      <text x={PX(-1)} y={syGround + 14} fontSize={9.5} style={{ fill: C.text }}>GROUND (gear down)</text>
      <DimV x={PX(P.lengthFt) + 18} y1={SZ(P.heightFt)} y2={syGround} label={`${P.heightFt} ft`} />

      {/* Front view */}
      <text x={fx - 110} y={syGround - 150} fontSize={11} style={{ fill: C.strong, letterSpacing: "0.12em" }}>FRONT VIEW</text>
      {([1, -1] as const).map((s) => (
        <g key={s} stroke={C.line} fill="none">
          <line x1={FY(s * o.wingZ.yRoot)} y1={FZ(o.wingZ.root)} x2={FY(s * o.wingZ.tipY)} y2={FZ(o.wingZ.tip)} strokeWidth={2.2} />
          <line x1={FY(s * o.stabZ.yRoot)} y1={FZ(o.stabZ.root)} x2={FY(s * o.stabZ.tipY)} y2={FZ(o.stabZ.tip)} strokeWidth={1.6} />
          <line x1={FY(s * o.vtailFront.yRoot)} y1={FZ(o.vtailFront.zRoot)} x2={FY(s * o.vtailFront.yTip)} y2={FZ(o.vtailFront.zTip)} strokeWidth={1.8} />
          <circle cx={FY(s * (wg.semi + 0.3))} cy={FZ(o.wingZ.tip)} r={2.5} />
        </g>
      ))}
      <polygon points={ell} fill={C.fill} stroke={C.line} strokeWidth={1.3} />
      <path d={`M${FY(-1.25)} ${FZ(9)} Q${FY(0)} ${FZ(11.2)} ${FY(1.25)} ${FZ(9)}`} fill="none" stroke={C.line} />
      <line x1={FY(-20)} x2={FY(20)} y1={syGround} y2={syGround} stroke={C.thin} strokeDasharray="10 4" />
      <text x={FY(o.vtailFront.yTip) + 6} y={FZ(o.vtailFront.zTip) + 4} fontSize={9.5} style={{ fill: C.dim }}>{`${P.verticalTailCantDeg}° cant`}</text>

      {/* Notes and title block */}
      <g fontSize={10} style={{ fill: C.text }}>
        <text x={40} y={652} style={{ fill: C.strong, letterSpacing: "0.12em" }}>NOTES</text>
        <text x={40} y={670}>1. Dimensions: NASA TP-1999-206573, TM-4786, TM-112360 (published).</text>
        <text x={40} y={686}>2. Outlines traced from the NASA three-view, scaled to them (±0.3 ft).</text>
        <text x={40} y={702}>3. Wing 400 ft², AR 3.5, taper 0.35, Λ LE 26.7°, t/c 5 → 3.5 %.</text>
        <text x={40} y={718}>4. Stabilator 86.48 ft²; root extended inboard to meet it.</text>
        <text x={40} y={734}>5. Research aircraft, unarmed. Analysis and teaching only.</text>
      </g>
      <g transform={`translate(${W - 474}, ${H - 182})`}>
        <rect width={460} height={168} fill={C.fill} stroke={C.line} strokeWidth={1.4} />
        {[30, 64, 98, 132].map((y) => <line key={y} x1={0} x2={460} y1={y} y2={y} stroke={C.thin} strokeWidth={0.8} />)}
        <line x1={230} y1={30} x2={230} y2={168} stroke={C.thin} strokeWidth={0.8} />
        <text x={12} y={20} fontSize={12} style={{ fill: C.strong, letterSpacing: "0.14em" }}>ARCHYMEDES / DEFENSE · NASA F/A-18 HARV</text>
        {[
          ["DESIGNATION", "AD-AERO-HARV · three-view", 0, 30], ["REFERENCE", `S ${P.wingAreaFt2} ft² · c̄ ${P.macFt} ft · b ${P.spanFt}`, 230, 30],
          ["MOMENT REF / CG", "0.25 MAC (NASA)", 0, 64], ["MESH", "lofted body · NACA sections", 230, 64],
          [`CL AT α ${at.alpha}° (BAND ×2)`, `${fmt(at.cl, 3)}  (${fmt(at.lo, 2)}–${fmt(at.hi, 2)})`, 0, 98], ["REGIME / CM", `${at.regime} / ${fmt(at.cm, 3)}`, 230, 98],
          ["SCALE / UNITS", "NTS · ft", 0, 132], ["PROJECTION / DATE", `third angle · ${date}`, 230, 132],
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
