"use client";
import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type MutableRefObject, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { Stage } from "@/components/three/stage";
import { Panel } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/segmented";
import { AIRCRAFT, type Aircraft, aircraftById } from "@/lib/aero/aircraft";
import { FIXED_DT, type LiveModel, type LiveState, type Telemetry, advance, liveAirframe, liveModel, telemetry, trimStart } from "@/lib/aero/live";
import { solveVlm } from "@/lib/aero/vlm";
import { vortexModel } from "@/lib/aero/vortex";

/**
 * Fly the aircraft live. The simulation (lib/aero/live.ts) runs at a fixed 120 Hz step inside requestAnimationFrame;
 * the 3D view reads the state every frame without re-rendering React; readouts refresh at 10 Hz and the strip charts
 * draw to a canvas. Keyboard when the panel has focus: ↑/↓ stick, +/− throttle, space pause, R reset.
 */
const D = Math.PI / 180;
const FT = 0.1; // scene units per foot
const START = { speed: 500, alt: 15000 };
const HISTORY_S = 40;

interface Sample { t: number; alpha: number; alphaCmd: number; cl: number; n: number; v: number; h: number; vortex: number }

function useModel(a: Aircraft): { L: LiveModel; trim: ReturnType<typeof trimStart> } {
  return useMemo(() => {
    const v = solveVlm(a.planform(), { nSpan: 16, nChord: 8 }), m = vortexModel(v), L = liveModel(v, m, liveAirframe(a));
    return { L, trim: trimStart(L, START.speed, START.alt) };
  }, [a]);
}

// ---------------------------------------------------------------- 3D

function f16Mesh(onReady: (g: THREE.Group, note: string) => void, onFail: () => void) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load("/aero/models/f16.glb", (gltf) => {
    const g = gltf.scene, box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    g.position.sub(centre);
    const wrap = new THREE.Group(); wrap.add(g);
    // NASA TP-1538 Fig. 2: length 15.09 m, height 5.01 m, span over the wingtip launchers 9.45 m (feet × FT here)
    const L = (15.09 / 0.3048) * FT, H = (5.01 / 0.3048) * FT, B = (9.45 / 0.3048) * FT;
    const sx = L / size.x, sy = H / size.y, sz = B / size.z;
    wrap.scale.set(sx, sy, sz);
    g.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = false; const mat = mesh.material as THREE.MeshStandardMaterial; if (mat) mat.envMapIntensity = 1; } });
    onReady(wrap, `3D model generated with Tripo from an F-16 three-view, then scaled to NASA TP-1538's length (15.09 m), height (5.01 m) and span over the wingtip launchers (9.45 m): relative to the length scale, height ×${(sy / sx).toFixed(2)} and span ×${(sz / sx).toFixed(2)} (the source views are drawn at different scales). Shape for display only: the aerodynamics use the published wing planform.`);
  }, undefined, onFail);
}

function planformMesh(a: Aircraft): THREE.Group {
  const p = a.planform(), s = p.stations;
  const shape = new THREE.Shape();
  const pts = [...s.map((q) => [-q.xLe, q.y] as const), ...[...s].reverse().map((q) => [-(q.xLe + q.chord), q.y] as const)];
  const full = [...pts, ...[...pts].reverse().map(([x, y]) => [x, -y] as const)];
  full.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x * FT, y * FT) : shape.lineTo(x * FT, y * FT)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.25 * FT * 3, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox();
  const c = geo.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  geo.translate(-c.x, -c.y, -c.z);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: "#c9d0d8", roughness: 0.45, metalness: 0.2 })));
  return g;
}

function Aircraft3D({ a, stateRef, onNote }: { a: Aircraft; stateRef: MutableRefObject<Telemetry | null>; onNote: (s: string) => void }) {
  const root = useRef<THREE.Group>(null), grid = useRef<THREE.Group>(null), body = useRef<THREE.Group>(null);
  const [mesh, setMesh] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let live = true;
    if (a.id === "f16") f16Mesh((g, note) => { if (live) { setMesh(g); onNote(note); } }, () => { if (live) { setMesh(planformMesh(a)); onNote("Generated model not available here: showing the published planform."); } });
    else { setMesh(planformMesh(a)); onNote("Published wing planform (no 3D model for this aircraft)."); }
    return () => { live = false; };
  }, [a, onNote]);
  const vel = useRef<THREE.Group>(null);
  useFrame(() => {
    const s = stateRef.current;
    if (!s || !root.current || !body.current || !grid.current || !vel.current) return;
    body.current.rotation.z = s.alpha + s.gamma; // pitch attitude θ = α + γ
    vel.current.rotation.z = s.gamma;
    const cell = 2;
    grid.current.position.x = -((s.x * FT * 0.02) % cell);
    grid.current.position.y = -2.2 - Math.min(1.2, (s.h - START.alt) * 0.00004);
  });
  return (
    <group ref={root}>
      <group ref={grid}><gridHelper args={[40, 20, "#3b4656", "#232a34"]} /></group>
      <group ref={body}>{mesh && <primitive object={mesh} />}</group>
      <group ref={vel}><Line points={[[0, 0, 0], [4.2, 0, 0]]} color="#5fb3ff" lineWidth={2} dashed dashSize={0.2} gapSize={0.12} /></group>
    </group>
  );
}

// ---------------------------------------------------------------- strip charts (canvas, redrawn on demand)

const SERIES: { key: keyof Sample; label: string; color: string; lo: number; hi: number; scale?: number }[] = [
  { key: "alpha", label: "α flown (°)", color: "#5fb3ff", lo: -5, hi: 40, scale: 1 / D },
  { key: "cl", label: "CL", color: "#f4b860", lo: -0.2, hi: 2 },
  { key: "n", label: "load factor n (g)", color: "#7ee0a8", lo: -1, hi: 9 },
  { key: "v", label: "speed (kt)", color: "#d8a7ff", lo: 100, hi: 900, scale: 1 / 1.6878 },
  { key: "h", label: "altitude (kft)", color: "#ff8a8a", lo: 0, hi: 50, scale: 1 / 1000 },
];

function drawCharts(c: HTMLCanvasElement, hist: Sample[]) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const rowH = h / SERIES.length, t1 = hist[hist.length - 1]?.t ?? 0, t0 = t1 - HISTORY_S;
  g.font = "10.5px ui-monospace, monospace";
  SERIES.forEach((s, r) => {
    const y0 = r * rowH, sc = s.scale ?? 1, Y = (v: number) => y0 + rowH - 6 - ((v - s.lo) / (s.hi - s.lo)) * (rowH - 18);
    g.strokeStyle = "rgba(127,140,160,0.18)"; g.beginPath(); g.moveTo(0, y0 + rowH - 0.5); g.lineTo(w, y0 + rowH - 0.5); g.stroke();
    g.fillStyle = "rgba(170,180,195,0.85)"; g.fillText(s.label, 6, y0 + 12);
    if (s.key === "alpha") { // commanded α as a dashed line under the flown one
      g.setLineDash([4, 3]); g.strokeStyle = "rgba(95,179,255,0.45)"; g.beginPath();
      hist.forEach((p, i) => { const x = ((p.t - t0) / HISTORY_S) * w, y = Y(p.alphaCmd * sc); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.setLineDash([]);
    }
    g.strokeStyle = s.color; g.lineWidth = 1.6; g.beginPath();
    hist.forEach((p, i) => { const x = ((p.t - t0) / HISTORY_S) * w, y = Math.max(y0 + 14, Math.min(y0 + rowH - 4, Y((p[s.key] as number) * sc))); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    const last = hist[hist.length - 1];
    if (last) { g.fillStyle = s.color; g.textAlign = "right"; g.fillText(((last[s.key] as number) * sc).toFixed(s.key === "cl" || s.key === "n" ? 2 : 1), w - 6, y0 + 12); g.textAlign = "left"; }
  });
}

// ---------------------------------------------------------------- the panel

function Readout({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: "warn" | "ok" }) {
  return (
    <div className="grid gap-0.5 border-l border-line-strong pl-3">
      <div className={`num font-mono text-[19px] leading-none ${tone === "warn" ? "text-warning" : ""}`}>{value}<span className="ml-1 text-[11px] text-fg-3">{unit}</span></div>
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-2">{label}</div>
    </div>
  );
}

export function LiveFlight() {
  const [id, setId] = useState("f16");
  const a = aircraftById(id) ?? AIRCRAFT[0];
  if (!a) throw new Error("no aircraft");
  const { L, trim } = useModel(a);
  const [running, setRunning] = useState(false);
  const [scale, setScale] = useState<"1" | "2" | "4">("1");
  const [stick, setStick] = useState(trim?.controls.alphaCmdDeg ?? 5);
  const [power, setPower] = useState(trim?.controls.power ?? 0.5);
  const [view, setView] = useState<Telemetry | null>(null);
  const [note, setNote] = useState("");
  const sim = useRef<{ s: LiveState | null; carry: number }>({ s: trim?.state ?? null, carry: 0 });
  const tel = useRef<Telemetry | null>(trim ? telemetry(L, trim.state) : null);
  const hist = useRef<Sample[]>([]);
  const controls = useRef({ alphaCmdDeg: stick, power });
  const canvas = useRef<HTMLCanvasElement>(null);
  controls.current = { alphaCmdDeg: stick, power };

  const reset = useCallback(() => {
    if (!trim) return;
    sim.current = { s: trim.state, carry: 0 }; tel.current = telemetry(L, trim.state); hist.current = [];
    setStick(trim.controls.alphaCmdDeg); setPower(trim.controls.power); setView(tel.current);
  }, [L, trim]);
  useEffect(() => { reset(); setRunning(false); }, [reset]);

  useEffect(() => {
    let raf = 0, last = performance.now(), lastUi = 0, lastSample = -1;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const cur = sim.current;
      if (running && cur.s && cur.s.status === "flying") {
        const r = advance(L, cur.s, controls.current, dt * Number(scale), cur.carry);
        sim.current = { s: r.state, carry: r.carry };
        const t = telemetry(L, r.state); tel.current = t;
        if (t.t - lastSample >= 0.05) {
          lastSample = t.t;
          hist.current.push({ t: t.t, alpha: t.alpha, alphaCmd: controls.current.alphaCmdDeg * D, cl: t.cl, n: t.n, v: t.v, h: t.h, vortex: t.vortex });
          while ((hist.current[0]?.t ?? 0) < t.t - HISTORY_S) hist.current.shift();
        }
        if (r.state.status !== "flying") setRunning(false);
      }
      if (now - lastUi > 100) { lastUi = now; setView(tel.current); if (canvas.current) drawCharts(canvas.current, hist.current); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [L, running, scale]);

  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === "ArrowUp" || k === "ArrowDown") { e.preventDefault(); setStick((s) => Math.max(-5, Math.min(40, s + (k === "ArrowUp" ? 0.5 : -0.5)))); }
    else if (k === "+" || k === "=" || k === "-" || k === "_") { e.preventDefault(); setPower((p) => Math.max(0, Math.min(1, p + (k === "-" || k === "_" ? -0.02 : 0.02)))); }
    else if (k === " ") { e.preventDefault(); setRunning((r) => !r); }
    else if (k === "r" || k === "R") { e.preventDefault(); reset(); }
  };

  const t = view;
  const stalled = t ? t.vortex < 0.9 : false;
  const powerLabel = a.id === "f16" ? (power <= 0.001 ? "idle" : power < 0.5 ? "part power" : power < 0.501 ? "military" : "afterburner") : `${Math.round(power * 100)}%`;
  return (
    <div className="grid gap-4 outline-none" tabIndex={0} onKeyDown={onKey} aria-label="Live flight simulation; use arrow keys for the stick, plus and minus for throttle, space to pause">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="grid gap-1.5"><span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Aircraft</span>
          <Segmented label="Aircraft" value={id} options={AIRCRAFT.map((x) => ({ value: x.id, label: x.name }))} onChange={(v) => setId(v)} /></div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setRunning((r) => !r)} disabled={!trim} className="border border-accent bg-accent/15 px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-accent hover:bg-accent/25 disabled:opacity-40">{running ? "Pause" : t && t.t > 0 ? "Resume" : "Fly"}</button>
          <button type="button" onClick={reset} className="border border-line-strong px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-fg-2 hover:text-fg">Reset to trim</button>
        </div>
        <div className="grid gap-1.5"><span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Time</span>
          <Segmented label="Time scale" value={scale} options={[{ value: "1", label: "1×" }, { value: "2", label: "2×" }, { value: "4", label: "4×" }]} onChange={setScale} /></div>
      </div>
      {!trim && <p className="text-[13px] text-warning">No level-flight trim for this aircraft at {START.speed} ft/s and {START.alt.toLocaleString("en")} ft with its thrust.</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel className="relative grid gap-2 overflow-hidden p-0">
          <Stage label={`Live view of the ${a.name}`} camera={[3.5, 1.6, 7.5]} target={[0, 0, 0]} fov={34} animate className="aspect-[16/10] w-full">
            <Suspense fallback={null}><Aircraft3D a={a} stateRef={tel} onNote={setNote} /></Suspense>
          </Stage>
          {t && (
            <div className="pointer-events-none absolute left-3 top-3 grid gap-1 font-mono text-[11px] text-fg-2">
              <span>{a.name} · t {t.t.toFixed(1)} s · {t.status === "flying" ? (running ? "flying" : "paused") : t.status}</span>
              {stalled && <span className="text-warning">vortex lift breaking down: {Math.round((1 - t.vortex) * 100)}% lost</span>}
            </div>
          )}
          <p className="px-4 pb-3 text-[11.5px] text-fg-3">{note}</p>
        </Panel>
        <Panel className="grid content-start gap-4 p-4">
          <div className="grid grid-cols-3 gap-x-3 gap-y-4">
            <Readout label="Speed" value={t ? (t.v / 1.6878).toFixed(0) : "—"} unit="kt" />
            <Readout label="Mach" value={t ? t.mach.toFixed(2) : "—"} tone={t && t.mach > 0.6 ? "warn" : undefined} />
            <Readout label="Altitude" value={t ? Math.round(t.h).toLocaleString("en") : "—"} unit="ft" />
            <Readout label="α flown" value={t ? (t.alpha / D).toFixed(1) : "—"} unit="°" />
            <Readout label="Climb angle" value={t ? (t.gamma / D).toFixed(1) : "—"} unit="°" />
            <Readout label="Load factor" value={t ? t.n.toFixed(2) : "—"} unit="g" tone={t && t.n > 9 ? "warn" : undefined} />
            <Readout label="CL" value={t ? t.cl.toFixed(3) : "—"} />
            <Readout label="Thrust" value={t ? Math.round(t.thrust).toLocaleString("en") : "—"} unit="lbf" />
            <Readout label="Vortex lift" value={t ? `${Math.round(t.vortex * 100)}%` : "—"} tone={stalled ? "warn" : undefined} />
          </div>
          <label className="grid gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">
            <span className="flex justify-between">Stick · commanded α<span className="num normal-case tracking-normal text-fg">{stick.toFixed(1)}°</span></span>
            <input type="range" min={-5} max={40} step={0.25} value={stick} onChange={(e) => setStick(Number(e.target.value))} className="accent-[var(--accent)]" />
          </label>
          <label className="grid gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">
            <span className="flex justify-between">Throttle<span className="num normal-case tracking-normal text-fg">{powerLabel}</span></span>
            <input type="range" min={0} max={1} step={0.005} value={power} onChange={(e) => setPower(Number(e.target.value))} className="accent-[var(--accent)]" />
          </label>
          <p className="text-[11.5px] text-fg-3">Click the panel, then ↑/↓ stick, +/− throttle, space pause, R reset. Fixed {Math.round(1 / FIXED_DT)} Hz step: the same inputs give the same flight on any screen.</p>
        </Panel>
      </div>
      <Panel className="p-3"><canvas ref={canvas} className="block h-[300px] w-full" aria-label="Strip charts of angle of attack, lift coefficient, load factor, speed and altitude over the last 40 seconds" /></Panel>
      <ul className="grid gap-1 text-[12px] text-fg-3">
        {a.caveats.map((c) => <li key={c} className="text-fg-2">{c}</li>)}
        <li>Weight {L.frame.weightLb.toLocaleString("en")} lb and wing reference {L.frame.areaFt2} ft² as published. Thrust: {L.frame.thrustSource}. Drag: {L.frame.cd0Source}.</li>
        <li>Lift: the engine&apos;s wing estimate with the vortex lag; angle of attack follows the stick with a 0.35 s lag and a 25°/s rate limit (assumed: no pitching-moment or control-law model). Above Mach 0.6 the lift model is outside its range.</li>
      </ul>
    </div>
  );
}
