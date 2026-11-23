"use client";
import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type MutableRefObject, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Stage } from "@/components/three/stage";
import { Panel } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/segmented";
import { AIRCRAFT, type Aircraft, aircraftById } from "@/lib/aero/aircraft";
import { F16_LENGTH_M, F16_SHAPE_SOURCE, f16ShapeParts } from "@/lib/aero/f16shape";
import { FIXED_DT } from "@/lib/aero/live";
import { type SimMode, type SimView, START, liveSimFor, stickCommand } from "@/lib/aero/sim";
import { SideStick, Throttle, TrimHat } from "./flight-controls";

/**
 * Fly the aircraft live. The simulation runs at a fixed 120 Hz step inside requestAnimationFrame; the 3D view reads
 * the state every frame without re-rendering React; readouts refresh at 10 Hz and the strip charts draw to a canvas.
 * The F-16 flies NASA's measured whole-aircraft data with a pitching-moment model (lib/aero/f16live.ts); the others
 * fly the engine's estimate (lib/aero/live.ts). Keyboard when the panel has focus: ↑/↓ stick (↑ pulls), +/− throttle,
 * space pause, R reset.
 */
const D = Math.PI / 180;
const FT = 0.1; // scene units per foot
const HISTORY_S = 40;

interface Sample { t: number; alpha: number; alphaCmd: number; cl: number; n: number; v: number; h: number; dh: number }

// ---------------------------------------------------------------- 3D

/** The F-16 traced from NASA's three-view (metres: x aft, y starboard, z up) as scene geometry (x forward, y up). */
function f16Traced(): THREE.Group {
  const S = FT / 0.3048, g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: "#b9c2cc", roughness: 0.5, metalness: 0.25, side: THREE.DoubleSide });
  const canopyMat = new THREE.MeshStandardMaterial({ color: "#3a4656", roughness: 0.15, metalness: 0.6, side: THREE.DoubleSide });
  for (const p of f16ShapeParts()) {
    const pos = new Float32Array(p.positions.length);
    for (let i = 0; i < p.positions.length; i += 3) {
      pos[i] = (F16_LENGTH_M / 2 - (p.positions[i] ?? 0)) * S; pos[i + 1] = ((p.positions[i + 2] ?? 0) - 0.4) * S; pos[i + 2] = (p.positions[i + 1] ?? 0) * S;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setIndex(new THREE.BufferAttribute(p.indices, 1)); geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, p.name === "canopy" ? canopyMat : mat));
  }
  return g;
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

function Aircraft3D({ a, stateRef }: { a: Aircraft; stateRef: MutableRefObject<SimView | null> }) {
  const grid = useRef<THREE.Group>(null), body = useRef<THREE.Group>(null), vel = useRef<THREE.Group>(null);
  const base = useMemo(() => (a.id === "f16" ? f16Traced() : planformMesh(a)), [a]);
  const [mesh, setMesh] = useState<THREE.Object3D>(base);
  useEffect(() => {
    setMesh(base);
    if (a.id !== "f16") return;
    // The same traced geometry, finished in Blender (scripts/blender/f16_finish.py): metres, x forward, y up.
    let live = true;
    new GLTFLoader().load("/aero/models/f16-traced.glb", (gltf) => {
      if (!live) return;
      const g = new THREE.Group(); g.add(gltf.scene); g.scale.setScalar(FT / 0.3048); setMesh(g);
    }, undefined, () => undefined); // keep the built-in shape if the file is missing
    return () => { live = false; };
  }, [a, base]);
  useFrame(() => {
    const s = stateRef.current;
    if (!s || !body.current || !grid.current || !vel.current) return;
    body.current.rotation.z = s.theta; // pitch attitude
    vel.current.rotation.z = s.gamma;
    grid.current.position.x = -((s.x * FT * 0.02) % 2);
    grid.current.position.y = -2.2 - Math.min(1.2, (s.h - START.alt) * 0.00004);
  });
  return (
    <group>
      <group ref={grid}><gridHelper args={[40, 20, "#3b4656", "#232a34"]} /></group>
      <group ref={body}><primitive object={mesh} /></group>
      <group ref={vel}><Line points={[[0, 0, 0], [4.2, 0, 0]]} color="#5fb3ff" lineWidth={2} dashed dashSize={0.2} gapSize={0.12} /></group>
    </group>
  );
}

// ---------------------------------------------------------------- strip charts (canvas, redrawn on demand)

const SERIES: { key: keyof Sample; label: string; color: string; lo: number; hi: number; scale?: number }[] = [
  { key: "alpha", label: "α flown (°)", color: "#5fb3ff", lo: -10, hi: 70, scale: 1 / D },
  { key: "cl", label: "CL", color: "#f4b860", lo: -0.2, hi: 2 },
  { key: "dh", label: "stabilator (°, − nose up)", color: "#9ad0c2", lo: -25, hi: 25 },
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
      let on = false; hist.forEach((p) => { if (!Number.isFinite(p.alphaCmd)) { on = false; return; } const x = ((p.t - t0) / HISTORY_S) * w, y = Y(p.alphaCmd * sc); on ? g.lineTo(x, y) : g.moveTo(x, y); on = true; }); g.stroke(); g.setLineDash([]);
    }
    g.strokeStyle = s.color; g.lineWidth = 1.6; g.beginPath();
    let on = false; hist.forEach((p) => { const v = p[s.key] as number; if (!Number.isFinite(v)) { on = false; return; } const x = ((p.t - t0) / HISTORY_S) * w, y = Math.max(y0 + 14, Math.min(y0 + rowH - 4, Y(v * sc))); on ? g.lineTo(x, y) : g.moveTo(x, y); on = true; });
    g.stroke();
    const last = hist[hist.length - 1];
    if (last && Number.isFinite(last[s.key] as number)) { g.fillStyle = s.color; g.textAlign = "right"; g.fillText(((last[s.key] as number) * sc).toFixed(s.key === "cl" || s.key === "n" ? 2 : 1), w - 6, y0 + 12); g.textAlign = "left"; }
  });
}

function Readout({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: "warn" | "ok" }) {
  return (
    <div className="grid gap-0.5 border-l border-line-strong pl-3">
      <div className={`num font-mono text-[19px] leading-none ${tone === "warn" ? "text-warning" : ""}`}>{value}<span className="ml-1 text-[11px] text-fg-3">{unit}</span></div>
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-2">{label}</div>
    </div>
  );
}

const STATUS: Record<string, string> = {
  ground: "hit the ground",
  "out of envelope": "left the envelope (speed below 100 ft/s or α outside the data)",
  blackout: "pilot blackout (NASA's g-tolerance rule)",
  "over-g": "over-stressed: above 9 g (USAF F-16 limit)",
};

export function LiveFlight() {
  const [id, setId] = useState("f16");
  const a = aircraftById(id) ?? AIRCRAFT[0];
  if (!a) throw new Error("no aircraft");
  const sim = useMemo(() => liveSimFor(a), [a]);
  const [mode, setMode] = useState<SimMode>(sim.modes[0]?.value ?? "estimate");
  const modeInfo = sim.modes.find((m) => m.value === mode) ?? sim.modes[0];
  const [running, setRunning] = useState(false);
  const [scale, setScale] = useState<"1" | "2" | "4">("1");
  const [stick, setStick] = useState(0); // the trim reference: what hands-off flies
  const [defl, setDefl] = useState(0); // side-stick deflection, −1 push … +1 pull
  const deflRef = useRef(0), pointerOn = useRef(false), keys = useRef({ up: false, down: false });
  const [power, setPower] = useState(0.5);
  const [view, setView] = useState<SimView | null>(null);
  const [stab, setStab] = useState<{ name: string; text: string; unstable: boolean }[]>([]);
  const run = useRef<{ s: unknown; carry: number }>({ s: null, carry: 0 });
  const tel = useRef<SimView | null>(null);
  const hist = useRef<Sample[]>([]);
  const lim = (sim.modes.find((m) => m.value === mode) ?? sim.modes[0])?.stick ?? { min: -5, max: 40, label: "Stick", pullIsUp: true };
  const command = stickCommand(defl, stick, lim);
  const controls = useRef({ mode, stick: command, power, stickTrim: stick, lim });
  const canvas = useRef<HTMLCanvasElement>(null);
  controls.current = { mode, stick: stickCommand(deflRef.current, stick, lim), power, stickTrim: stick, lim };
  const deflect = useCallback((d: number) => { deflRef.current = d; setDefl(d); }, []);

  const reset = useCallback((m?: SimMode) => {
    const st = sim.start, md = m ?? sim.modes[0]?.value ?? "estimate";
    if (!st) { run.current = { s: null, carry: 0 }; tel.current = null; setView(null); return; }
    run.current = { s: st.state, carry: 0 }; tel.current = sim.view(st.state); hist.current = [];
    setMode(md); setStick(st.stick[md] ?? 0); setPower(st.power); deflRef.current = 0; setDefl(0); setView(tel.current); setStab(sim.stability?.(st.state) ?? []);
  }, [sim]);
  useEffect(() => { reset(); setRunning(false); }, [reset]);

  const changeMode = (m: SimMode) => {
    // switching mid-flight keeps the stabilator where it is: the direct stick picks up the current deflection
    setMode(m);
    const v = tel.current;
    if (m === "direct" && v?.dhDeg !== null && v?.dhDeg !== undefined) setStick(v.dhDeg);
    else if (m === "law" && v) setStick(v.alpha / D);
  };

  useEffect(() => {
    let raf = 0, last = performance.now(), lastUi = 0, lastStab = 0, lastSample = -1;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      // Inputs: held keys and a gamepad move the stick; released, it springs back to centre (hands off = trim).
      if (!pointerOn.current) {
        const pad = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads()[0] : null;
        const axis = pad?.axes[1] ?? 0, k = keys.current;
        const target = Math.abs(axis) > 0.06 ? axis : k.up ? 1 : k.down ? -1 : 0;
        const d0 = deflRef.current, rate = target === 0 ? 4 : 1.6; // per second: deliberate in, quick spring back
        const d1 = Math.abs(axis) > 0.06 ? target : d0 + Math.max(-rate * dt, Math.min(rate * dt, target - d0));
        if (d1 !== d0) { deflRef.current = d1; controls.current = { ...controls.current, stick: stickCommand(d1, controls.current.stickTrim, controls.current.lim) }; if (Math.abs(d1 - d0) > 0.004 || d1 === 0) setDefl(d1); }
      }
      const cur = run.current;
      if (running && cur.s && tel.current?.status === "flying") {
        const r = sim.advance(cur.s, controls.current, dt * Number(scale), cur.carry);
        run.current = { s: r.state, carry: r.carry };
        const t = sim.view(r.state); tel.current = t;
        if (t.t - lastSample >= 0.05) {
          lastSample = t.t;
          const c = controls.current, alphaCmd = c.mode === "direct" ? Number.NaN : c.stick * D;
          hist.current.push({ t: t.t, alpha: t.alpha, alphaCmd, cl: t.cl, n: t.n, v: t.v, h: t.h, dh: t.dhDeg ?? Number.NaN });
          while ((hist.current[0]?.t ?? 0) < t.t - HISTORY_S) hist.current.shift();
        }
        if (t.status !== "flying") setRunning(false);
      }
      if (now - lastUi > 100) { lastUi = now; setView(tel.current); if (canvas.current) drawCharts(canvas.current, hist.current); }
      if (sim.stability && run.current.s && now - lastStab > 500) { lastStab = now; setStab(sim.stability(run.current.s)); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sim, running, scale]);

  const trimBy = (dir: 1 | -1) => setStick((s) => Math.max(lim.min, Math.min(lim.max, s + 0.5 * dir * (lim.pullIsUp ? 1 : -1))));
  const onKey = (e: React.KeyboardEvent, down: boolean) => {
    const k = e.key;
    if (k === "ArrowUp" || k === "ArrowDown") { e.preventDefault(); keys.current = { ...keys.current, [k === "ArrowDown" ? "up" : "down"]: down }; return; } // ↓ pulls (stick back), ↑ pushes
    if (!down) return;
    if (k === "]" || k === "[") { e.preventDefault(); trimBy(k === "]" ? 1 : -1); }
    else if (k === "+" || k === "=" || k === "-" || k === "_") { e.preventDefault(); setPower((p) => { const n = Math.max(0, Math.min(1, p + (k === "-" || k === "_" ? -0.02 : 0.02))); return Math.abs(n - 0.5) < 0.011 ? 0.5 : n; }); }
    else if (k === " ") { e.preventDefault(); setRunning((r) => !r); }
    else if (k === "r" || k === "R") { e.preventDefault(); reset(); }
  };

  const t = view;
  const nasa = sim.kind === "nasa";
  const stalled = t?.vortex !== null && t?.vortex !== undefined ? t.vortex < 0.9 : false;
  const powerLabel = a.id === "f16" ? (power <= 0.001 ? "idle" : power < 0.5 ? "part power" : power < 0.501 ? "military" : "afterburner") : `${Math.round(power * 100)}%`;
  return (
    <div className="grid gap-4 outline-none" tabIndex={0} onKeyDown={(e) => onKey(e, true)} onKeyUp={(e) => onKey(e, false)} onBlur={() => { keys.current = { up: false, down: false }; }} aria-label="Live flight simulation; hold the down arrow to pull and the up arrow to push, brackets to trim, plus and minus for throttle, space to pause">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="grid gap-1.5"><span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Aircraft</span>
          <Segmented label="Aircraft" value={id} options={AIRCRAFT.map((x) => ({ value: x.id, label: x.name }))} onChange={(v) => setId(v)} /></div>
        <div className="grid gap-1.5"><span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Mode</span>
          <Segmented label="Pilot mode" value={mode} options={sim.modes.map((m) => ({ value: m.value, label: m.label }))} onChange={(v) => changeMode(v as SimMode)} /></div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setRunning((r) => !r)} disabled={!sim.start || (t !== null && t.status !== "flying")} className="border border-accent bg-accent/15 px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-accent hover:bg-accent/25 disabled:opacity-40">{running ? "Pause" : t && t.t > 0 ? "Resume" : "Fly"}</button>
          <button type="button" onClick={() => reset(mode)} className="border border-line-strong px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-fg-2 hover:text-fg">Reset to trim</button>
        </div>
        <div className="grid gap-1.5"><span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Time</span>
          <Segmented label="Time scale" value={scale} options={[{ value: "1", label: "1×" }, { value: "2", label: "2×" }, { value: "4", label: "4×" }]} onChange={setScale} /></div>
      </div>
      {!sim.start && <p className="text-[13px] text-warning">No level-flight trim for this aircraft at {START.speed} ft/s and {START.alt.toLocaleString("en")} ft with its thrust.</p>}
      {mode === "direct" && <p className="text-[12.5px] text-warning">Direct mode: no flight-control system. At this centre of gravity the F-16 airframe is unstable in pitch (NASA: static margin about −4%); only the leading-edge flap schedule still runs. Inputs must be caught by hand, and large pulls can end in NASA&apos;s deep stall.</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel className="relative grid gap-2 overflow-hidden p-0">
          <Stage label={`Live view of the ${a.name}`} camera={[3.5, 1.6, 7.5]} target={[0, 0, 0]} fov={34} animate className="aspect-[16/10] w-full">
            <Suspense fallback={null}><Aircraft3D a={a} stateRef={tel} /></Suspense>
          </Stage>
          {t && (
            <div className="pointer-events-none absolute left-3 top-3 grid gap-1 font-mono text-[11px] text-fg-2">
              <span>{a.name} · t {t.t.toFixed(1)} s · {t.status === "flying" ? (running ? "flying" : "paused") : <span className="text-warning">{STATUS[t.status] ?? t.status}</span>}</span>
              {stalled && <span className="text-warning">vortex lift breaking down: {Math.round((1 - (t.vortex ?? 1)) * 100)}% lost</span>}
              {t.grey !== null && t.grey > 0.02 && <span className="text-warning">grey-out {Math.round(t.grey * 100)}% toward blackout</span>}
              {t.beyondData && <span className="text-warning">Mach {t.mach.toFixed(2)}: beyond the data (valid below Mach 0.6), extrapolated, no compressibility</span>}
            </div>
          )}
          {t?.grey !== null && t?.grey !== undefined && t.grey > 0 && <div className="pointer-events-none absolute inset-0" style={{ boxShadow: `inset 0 0 ${Math.round(40 + 260 * t.grey)}px ${Math.round(20 + 200 * t.grey)}px rgba(0,0,0,${Math.min(0.95, 0.2 + t.grey)})` }} />}
          <p className="px-4 pb-3 text-[11.5px] text-fg-3">{a.id === "f16" ? `Shape traced from ${F16_SHAPE_SOURCE}; length 15.09 m, span over the wingtip launchers 9.45 m. Display only: the physics use NASA's tables.` : "Published wing planform (no traced shape for this aircraft)."}</p>
        </Panel>
        <Panel className="grid content-start gap-4 p-4">
          <div className="grid grid-cols-3 gap-x-3 gap-y-4">
            <Readout label="Speed" value={t ? (t.v / 1.6878).toFixed(0) : "—"} unit="kt" />
            <Readout label="Mach" value={t ? t.mach.toFixed(2) : "—"} tone={t?.beyondData ? "warn" : undefined} />
            <Readout label="Altitude" value={t ? Math.round(t.h).toLocaleString("en") : "—"} unit="ft" />
            <Readout label="Angle of attack" value={t ? (t.alpha / D).toFixed(1) : "—"} unit="°" tone={t && t.alpha / D > 25 ? "warn" : undefined} />
            <Readout label="Climb angle" value={t ? (t.gamma / D).toFixed(1) : "—"} unit="°" />
            <Readout label="Load factor" value={t ? t.n.toFixed(2) : "—"} unit="g" tone={t && t.n > 5 ? "warn" : undefined} />
            <Readout label="CL" value={t ? t.cl.toFixed(3) : "—"} />
            <Readout label="CD" value={t ? t.cd.toFixed(3) : "—"} />
            <Readout label="Thrust" value={t ? Math.round(t.thrust).toLocaleString("en") : "—"} unit="lbf" />
            {nasa ? <>
              <Readout label="Stabilator" value={t?.dhDeg != null ? t.dhDeg.toFixed(1) : "—"} unit="°" tone={t?.dhDeg != null && Math.abs(t.dhDeg) > 24 ? "warn" : undefined} />
              <Readout label="LE flap" value={t?.lefDeg != null ? t.lefDeg.toFixed(1) : "—"} unit="°" />
              <Readout label="Blackout" value={t?.grey != null ? `${Math.round(t.grey * 100)}%` : "—"} tone={t?.grey ? "warn" : undefined} />
            </> : <Readout label="Vortex lift" value={t?.vortex != null ? `${Math.round(t.vortex * 100)}%` : "—"} tone={stalled ? "warn" : undefined} />}
          </div>
          <div className="grid gap-2 border-t border-line pt-3">
            <div className="flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">
              <span>{lim.label}</span><span className="num normal-case tracking-normal text-fg">{command.toFixed(1)}°</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <div onPointerDown={() => { pointerOn.current = true; }} onPointerUp={() => { pointerOn.current = false; }} onPointerCancel={() => { pointerOn.current = false; }}>
                <SideStick deflection={defl} onChange={deflect} label={`Side-stick: ${lim.label}`} />
              </div>
              <TrimHat onTrim={trimBy} value={stick.toFixed(1)} unit="°" />
              <Throttle power={power} onChange={setPower} labels={a.id === "f16" ? { idle: "NASA idle", mil: "full dry", max: "full AB" } : { idle: "0%", mil: "50%", max: "100%" }} />
            </div>
            <p className="text-center font-mono text-[11px] text-fg-3">{powerLabel} · stick {defl > 0.02 ? `pull ${Math.round(defl * 100)}%` : defl < -0.02 ? `push ${Math.round(-defl * 100)}%` : "centred (flies the trim)"}</p>
          </div>
          {stab.length > 0 && (
            <div className="grid gap-1 border-t border-line pt-3">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Modes of motion here (linearised, stick and throttle held)</span>
              {stab.map((m, k) => <span key={`${k}-${m.name}`} className={`font-mono text-[11.5px] ${m.unstable ? "text-warning" : "text-fg-2"}`}>{m.name}: {m.text}</span>)}
            </div>
          )}
          <p className="text-[11.5px] text-fg-3">Drag the grip (it springs back when released), or click the panel and hold ↓ to pull, ↑ to push; [ ] trim, +/− throttle, space pause, R reset; a gamepad's left stick also pitches. Fixed {Math.round(1 / FIXED_DT)} Hz step: the same inputs give the same flight on any screen.</p>
        </Panel>
      </div>
      <Panel className="p-3"><canvas ref={canvas} className="block h-[340px] w-full" aria-label="Strip charts of angle of attack, lift coefficient, stabilator, load factor, speed and altitude over the last 40 seconds" /></Panel>
      <ul className="grid gap-1 text-[12px] text-fg-3">
        {!nasa && a.caveats.map((c) => <li key={c} className="text-fg-2">{c}</li>)}
        {sim.notes.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </div>
  );
}
