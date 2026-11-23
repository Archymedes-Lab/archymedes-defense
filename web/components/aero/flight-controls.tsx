"use client";
import { type PointerEvent as RPE, useRef } from "react";

/**
 * Cockpit-style controls for the live simulation.
 *  - SideStick: an F-16-style side-stick seen from above. Drag the grip; it springs back to centre when released, so
 *    hands-off flies the trim. Only pitch is live (the simulation is longitudinal): the lateral axis is shown locked.
 *  - TrimHat: the trim switch on the grip, nose-up / nose-down, moves the hands-off reference.
 *  - Throttle: a quadrant from IDLE through the MIL detent into afterburner (AB), with a gate at MIL.
 */
export function SideStick({ deflection, onChange, label }: { deflection: number; onChange: (d: number) => void; label: string }) {
  const ref = useRef<SVGSVGElement>(null), dragging = useRef(false);
  const R = 70, y = deflection * R; // pull (positive) moves the grip toward the pilot: down on screen
  const set = (e: RPE<SVGSVGElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const py = ((e.clientY - r.top) / r.height) * 200 - 100;
    onChange(Math.max(-1, Math.min(1, py / R)));
  };
  return (
    <svg ref={ref} viewBox="-100 -100 200 200" className="h-[200px] w-[200px] touch-none select-none" role="slider" aria-label={label}
      aria-valuemin={-1} aria-valuemax={1} aria-valuenow={Number(deflection.toFixed(2))} tabIndex={-1}
      onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); set(e); }}
      onPointerMove={(e) => { if (dragging.current) set(e); }}
      onPointerUp={() => { dragging.current = false; onChange(0); }} onPointerCancel={() => { dragging.current = false; onChange(0); }}>
      <defs>
        <radialGradient id="boot" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#2a313b" /><stop offset="100%" stopColor="#12161c" /></radialGradient>
        <radialGradient id="grip" cx="40%" cy="35%" r="70%"><stop offset="0%" stopColor="#59626e" /><stop offset="100%" stopColor="#1d2228" /></radialGradient>
      </defs>
      <circle r="92" fill="url(#boot)" stroke="#3b4656" strokeWidth="1.5" />
      {[0.25, 0.5, 0.75, 1].map((k) => <circle key={k} r={R * k} fill="none" stroke="#3b4656" strokeDasharray={k === 1 ? "0" : "2 4"} strokeWidth="0.8" />)}
      <line x1="0" y1={-R} x2="0" y2={R} stroke="#5fb3ff" strokeOpacity="0.5" strokeWidth="1.2" />
      <line x1={-R} y1="0" x2={R} y2="0" stroke="#3b4656" strokeWidth="1" strokeDasharray="3 3" />
      <text x="0" y={-R - 8} textAnchor="middle" fill="#8a95a5" fontSize="9" fontFamily="ui-monospace,monospace">PUSH · NOSE DOWN</text>
      <text x="0" y={R + 15} textAnchor="middle" fill="#8a95a5" fontSize="9" fontFamily="ui-monospace,monospace">PULL · NOSE UP</text>
      <text x={-R - 4} y="3" textAnchor="end" fill="#4a5462" fontSize="8" fontFamily="ui-monospace,monospace">ROLL</text>
      <text x={R + 4} y="3" textAnchor="start" fill="#4a5462" fontSize="8" fontFamily="ui-monospace,monospace">LOCKED</text>
      <line x1="0" y1="0" x2="0" y2={y} stroke="#0b0e12" strokeWidth="9" strokeLinecap="round" />
      <g transform={`translate(0 ${y})`} style={{ cursor: "grab" }}>
        <ellipse rx="22" ry="25" fill="url(#grip)" stroke="#7d8896" strokeWidth="1.2" />
        <rect x="-5" y="-17" width="10" height="9" rx="2" fill="#11151a" stroke="#5f6a78" strokeWidth="0.8" />
        <circle cx="0" cy="-12.5" r="2.2" fill="#9aa5b3" />
        <rect x="9" y="-6" width="6" height="12" rx="2" fill="#a33" opacity="0.85" />
      </g>
      <circle r="2" fill="#5fb3ff" />
    </svg>
  );
}

export function TrimHat({ onTrim, value, unit }: { onTrim: (dir: 1 | -1) => void; value: string; unit: string }) {
  const btn = "border border-line-strong px-2.5 py-1 font-mono text-[11px] text-fg-2 hover:border-accent hover:text-accent";
  return (
    <div className="grid justify-items-center gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-2">Trim</span>
      <button type="button" className={btn} onClick={() => onTrim(-1)} aria-label="Trim nose down">▲ ND</button>
      <span className="num font-mono text-[12px] text-fg">{value}<span className="text-fg-3">{unit}</span></span>
      <button type="button" className={btn} onClick={() => onTrim(1)} aria-label="Trim nose up">▼ NU</button>
    </div>
  );
}

const MIL = 0.5;
export function Throttle({ power, onChange, labels }: { power: number; onChange: (p: number) => void; labels: { idle: string; mil: string; max: string } }) {
  const ref = useRef<SVGSVGElement>(null), dragging = useRef(false);
  const top = -80, bottom = 80, Y = (p: number) => bottom - p * (bottom - top);
  const set = (e: RPE<SVGSVGElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const py = ((e.clientY - r.top) / r.height) * 200 - 100;
    let p = Math.max(0, Math.min(1, (bottom - py) / (bottom - top)));
    if (Math.abs(p - MIL) < 0.035) p = MIL; // the MIL detent: the lever sits in it unless pushed through
    onChange(p);
  };
  const y = Y(power), ab = power > MIL + 1e-6;
  return (
    <svg ref={ref} viewBox="-60 -100 120 200" className="h-[200px] w-[120px] touch-none select-none" role="slider" aria-label="Throttle"
      aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(power.toFixed(2))} tabIndex={-1}
      onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); set(e); }}
      onPointerMove={(e) => { if (dragging.current) set(e); }} onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}>
      <rect x="-14" y={top - 8} width="28" height={bottom - top + 16} rx="6" fill="#12161c" stroke="#3b4656" />
      <rect x="-3" y={top} width="6" height={bottom - top} rx="3" fill="#0b0e12" />
      <rect x="-3" y={Y(1)} width="6" height={Y(MIL) - Y(1)} fill="#f4b860" opacity="0.18" />
      {[[0, labels.idle, "IDLE"], [MIL, labels.mil, "MIL"], [1, labels.max, "MAX AB"]].map(([p, sub, name]) => (
        <g key={String(name)} transform={`translate(0 ${Y(Number(p))})`}>
          <line x1="-20" x2="20" stroke={name === "MIL" ? "#f4b860" : "#5f6a78"} strokeWidth={name === "MIL" ? 2 : 1} />
          <text x="24" y="3" fill="#aab3c0" fontSize="9" fontFamily="ui-monospace,monospace">{String(name)}</text>
          <text x="24" y="13" fill="#6b7685" fontSize="7.5" fontFamily="ui-monospace,monospace">{String(sub)}</text>
        </g>
      ))}
      <text x="-22" y={(Y(1) + Y(MIL)) / 2} fill="#f4b860" fontSize="8" textAnchor="end" fontFamily="ui-monospace,monospace" opacity="0.8">AB</text>
      <g transform={`translate(0 ${y})`} style={{ cursor: "grab" }}>
        <rect x="-26" y="-11" width="52" height="22" rx="6" fill={ab ? "#4a3a1e" : "#2a313b"} stroke={ab ? "#f4b860" : "#7d8896"} strokeWidth="1.2" />
        <rect x="-18" y="-4" width="36" height="8" rx="3" fill="#11151a" />
      </g>
    </svg>
  );
}
