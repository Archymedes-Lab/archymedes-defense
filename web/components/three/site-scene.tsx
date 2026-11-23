"use client";
import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Height, SUN, type Yard, buildSite, loadAssets } from "./site-build";
import { AgentsLayer, type Clock, EVENT_TEXT, KIND_STYLE, type Replay, opsFacts } from "./world-sim";

/**
 * The warehouse site on its own: a 512 m extract at full source resolution with scanned props, a real sky and
 * shadows. It shares nothing at run time with the 4 km valley view, so it stays light enough for a laptop.
 */

type View = "site" | "gate" | "yard" | "top";
const VIEWS: Record<View, { label: string; pos: [number, number, number]; look: [number, number, number] }> = {
  site: { label: "Whole site", pos: [135, 62, 150], look: [0, 3, 0] },
  yard: { label: "Loading doors", pos: [18, 7, 62], look: [-4, 3, 14] },
  gate: { label: "Gate", pos: [-104, 9, 48], look: [-66, 2, 34] },
  top: { label: "From above", pos: [0.1, 260, 0.1], look: [0, 0, 0] },
};

function useJson<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    fetch(url, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((d) => live && setData(d)).catch(() => {});
    return () => { live = false; };
  }, [url]);
  return data;
}

export type Quality = "full" | "light";

/** Light mode for software renderers and small GPUs: no shadow pass, one pixel per CSS pixel. */
function detectQuality(): Quality {
  try {
    const q = new URLSearchParams(location.search).get("q");
    if (q === "full" || q === "light") return q;
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    const name = String(ext && gl ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "");
    return /swiftshader|llvmpipe|software|basic render/i.test(name) ? "light" : "full";
  } catch { return "light"; }
}

function World({ yard, yardBase, assetsBase, onReady, onHeight, quality }: { yard: Yard; yardBase: string; assetsBase: string; onReady: (msg: string | null) => void; onHeight: (h: Height) => void; quality: Quality }) {
  const { gl, scene, invalidate } = useThree();
  const [root, setRoot] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        onReady("Loading terrain");
        const hb = await (await fetch(`${yardBase}/${yard.height.file}`, { credentials: "same-origin" })).arrayBuffer();
        const H = new Height(new Float32Array(hb), yard.height.n, yard.height.local_to_lattice, yard.half_m);
        const gl2 = new GLTFLoader();
        const [terrain, buildings] = await Promise.all([
          Promise.all(yard.terrain.tiles.map((t) => gl2.loadAsync(`${yardBase}/${t}`))),
          yard.buildings.file ? gl2.loadAsync(`${yardBase}/${yard.buildings.file}`) : Promise.resolve(null),
        ]);
        onReady("Loading the site models");
        const assets = await loadAssets(assetsBase, Math.min(8, gl.capabilities.getMaxAnisotropy()));
        if (!live) return;
        scene.environment = assets.sky; scene.background = assets.sky;
        scene.environmentIntensity = 1.0;
        scene.fog = new THREE.Fog("#c3d0dc", 600, 3200);
        onHeight(H);
        setRoot(buildSite(yard, H, assets, terrain, buildings));
        onReady(null);
        invalidate();
      } catch (e) {
        onReady(`Could not load the site: ${e instanceof Error ? e.message : "unknown error"}`);
      }
    })();
    return () => { live = false; };
  }, [yard, yardBase, assetsBase, gl, scene, invalidate, onReady, onHeight]);
  const sun = useMemo(() => {
    const l = new THREE.DirectionalLight("#fff3df", 3.1);
    l.position.copy(SUN).multiplyScalar(500);
    l.castShadow = quality === "full";
    l.shadow.mapSize.set(4096, 4096);
    const c = l.shadow.camera;
    c.left = -175; c.right = 175; c.top = 175; c.bottom = -175; c.near = 50; c.far = 1100;
    l.shadow.bias = -0.0004; l.shadow.normalBias = 0.06;
    return l;
  }, [quality]);
  return (
    <>
      <primitive object={sun} />
      <primitive object={sun.target} />
      {root && <primitive object={root} />}
    </>
  );
}

function Rig({ view, nonce, base, follow }: { view: View; nonce: number; base: number; follow: boolean }) {
  const { camera, controls, invalidate } = useThree();
  useEffect(() => {
    if (follow) return;
    const v = VIEWS[view];
    camera.position.set(v.pos[0], base + v.pos[1], v.pos[2]);
    const c = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (c) { c.target.set(v.look[0], base + v.look[1], v.look[2]); c.update(); } else camera.lookAt(v.look[0], base + v.look[1], v.look[2]);
    invalidate();
  }, [view, nonce, base, follow, camera, controls, invalidate]);
  return null;
}

function Kick({ n }: { n: number }) {
  const { invalidate } = useThree();
  useEffect(() => { invalidate(); }, [n, invalidate]);
  return null;
}

/** Replay in the scene's local frame: offset by the compound centre, ground agents set on the fine terrain, and
 *  samples outside the extract dropped (an agent appears when it walks in). */
function localise(r: Replay, yard: Yard, H: Height): Replay {
  const [ce, cn, cu] = yard.centre_enu, lim = yard.half_m - 2;
  const kinds = Object.fromEntries(r.agents.map((a) => [a.id, a.kind]));
  const tracks: Replay["tracks"] = {};
  for (const [id, tr] of Object.entries(r.tracks)) {
    const air = kinds[id] === "drone";
    tracks[id] = tr.filter(([, e, n]) => Math.abs(e - ce) < lim && Math.abs(n - cn) < lim)
      .map(([t, e, n, u]) => [t, e - ce, n - cn, air ? Math.max(u - cu, H.at(e - ce, n - cn)) : H.at(e - ce, n - cn) + 0.06]);
  }
  return { ...r, tracks };
}

const clockText = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function SiteScene({ yardBase, assetsBase, modelsBase, simBase, drills }: {
  yardBase: string; assetsBase: string; modelsBase: string; simBase: string; drills: { id: string; title: string }[];
}) {
  const yard = useJson<Yard>(`${yardBase}/yard.json`);
  const [status, setStatus] = useState<string | null>("Loading");
  const [H, setH] = useState<Height | null>(null);
  const [drillId, setDrillId] = useState(drills[0]?.id ?? null);
  const raw = useJson<Replay>(drillId ? `${simBase}/replay-${drillId}.json` : null);
  const replay = useMemo(() => (raw && yard && H ? localise(raw, yard, H) : null), [raw, yard, H]);
  const [view, setView] = useState<{ v: View; n: number }>({ v: "site", n: 0 });
  const [follow, setFollow] = useState<string | null>(null);
  const clock = useRef<Clock>({ t: 0, playing: false, speed: 10, end: 0 });
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [kick, setKick] = useState(0);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [lost, setLost] = useState(false);
  const [quality, setQuality] = useState<Quality | null>(null);
  useEffect(() => { setQuality(detectQuality()); }, []);
  useEffect(() => { try { const c = document.createElement("canvas"); setWebgl(!!c.getContext("webgl2")); } catch { setWebgl(false); } }, []);
  const onTick = useCallback((t: number) => { setNow(t); if (!clock.current.playing) setPlaying(false); }, []);
  const subject = replay?.score ? Object.values(replay.score.subjects)[0] ?? null : null;
  // start when the person is about to walk into the extract, not 4 minutes earlier
  const start = useMemo(() => {
    const first = replay ? Object.entries(replay.tracks).find(([id]) => replay.agents.find((a) => a.id === id)?.role === "unknown")?.[1]?.[0]?.[0] : undefined;
    return Math.max(0, (first ?? (subject ? (subject.appeared_ms ?? 0) / 1000 : (replay?.start_s ?? 0) + 20)) - 20);
  }, [replay, subject]);
  useEffect(() => {
    if (!replay) return;
    clock.current = { t: start, playing: false, speed: clock.current.speed, end: replay.manifest.until_ms / 1000 };
    setNow(start); setPlaying(false); setKick((k) => k + 1);
  }, [replay, start]);
  const seek = (t: number) => { clock.current.t = t; setNow(t); setKick((k) => k + 1); };
  const toggle = () => { const c = clock.current; if (!c.playing && c.t >= c.end) c.t = start; c.playing = !c.playing; setPlaying(c.playing); setKick((k) => k + 1); };
  const name = useCallback((id?: string) => replay?.agents.find((a) => a.id === id)?.label ?? id ?? "", [replay]);
  const feed = useMemo(() => {
    let sent = false;
    return (replay?.events ?? []).filter((e) => {
      if (!EVENT_TEXT[e.type]) return false;
      if (e.type !== "dispatch") return true;
      const first = !sent; sent = true; return first;
    });
  }, [replay]);
  const base = H ? H.at(0, 0) : 0;

  return (
    <div className="grid gap-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden border border-line bg-[#0b1117] sm:aspect-[16/9]" role="img"
        aria-label="3D view of the synthetic warehouse site on measured terrain: steel warehouse, chain-link fence, yard, cameras, guards, robot dog, drone and patrol vehicle">
        {webgl === false ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-[13px] text-fg-2">This 3D view needs WebGL 2, which this browser did not provide.</div>
        ) : lost ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-[13px] text-fg-2">
            <span>The browser dropped the 3D view, usually because graphics memory ran out.{" "}
              <button type="button" className="text-accent underline" onClick={() => location.reload()}>Reload the page</button></span>
          </div>
        ) : yard && quality ? (
          <Canvas key={quality} shadows={quality === "full" ? { type: THREE.PCFShadowMap } : false} frameloop="demand" dpr={quality === "full" ? [1, 1.5] : 1} camera={{ position: [135, 62, 150], fov: 38, near: 0.3, far: 6000 }}
            gl={{ antialias: quality === "full", powerPreference: "high-performance" }}
            onCreated={({ gl }) => {
              gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 0.95;
              gl.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); setLost(true); });
            }}>
            <World yard={yard} yardBase={yardBase} assetsBase={assetsBase} onReady={setStatus} onHeight={setH} quality={quality} />
            {replay && <AgentsLayer key={replay.manifest.digest} replay={replay} clock={clock} onTick={onTick} follow={follow} modelsBase={modelsBase} peopleBase={`${assetsBase}/people`} shadows={quality === "full"} />}
            <OrbitControls makeDefault enabled={!follow} enableDamping={false} minDistance={3} maxDistance={520} maxPolarAngle={1.52} />
            <Rig view={view.v} nonce={view.n} base={base} follow={!!follow} />
            <Kick n={kick} />
          </Canvas>
        ) : <div className="absolute inset-0 animate-pulse bg-surface" />}
        {status && webgl !== false && !lost && <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#0b1117]/70 text-[13px] text-fg-2">{status}…</div>}
        <div className="pointer-events-none absolute bottom-2 left-2 right-2 font-mono text-[10.5px] text-white/80 [text-shadow:0_1px_2px_#000]">
          Terrain, imagery, buildings © swisstopo · Props, materials, sky: Poly Haven (CC0) · People: Microsoft Rocketbox (MIT) · Unitree Go2 (BSD-3) · Skydio X2 (Apache-2.0)
        </div>
      </div>
      <div className="panel grid gap-3 p-4 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow text-fg-3">View</span>
          {(Object.keys(VIEWS) as View[]).map((id) => (
            <button key={id} type="button" aria-pressed={!follow && view.v === id} onClick={() => { setFollow(null); setView((s) => ({ v: id, n: s.n + 1 })); }}
              className={`tag cursor-pointer ${!follow && view.v === id ? "bg-accent-soft text-accent" : ""}`}>{VIEWS[id].label}</button>
          ))}
          <label className="text-fg-2" htmlFor="follow">Close-up</label>
          <select id="follow" value={follow ?? ""} onChange={(e) => { setFollow(e.target.value || null); setKick((k) => k + 1); }} className="border border-line-strong bg-transparent px-2 py-1 text-[13px]">
            <option value="" className="bg-[#0b1117]">Off</option>
            {(replay?.agents ?? []).filter((a) => a.kind !== "mast").map((a) => <option key={a.id} value={a.id} className="bg-[#0b1117]">{a.label}</option>)}
          </select>
          <span className="eyebrow ml-2 text-fg-3">Quality</span>
          {(["full", "light"] as const).map((q) => (
            <button key={q} type="button" aria-pressed={quality === q} onClick={() => { setStatus("Loading"); setQuality(q); }}
              className={`tag cursor-pointer ${quality === q ? "bg-accent-soft text-accent" : ""}`}>{q === "full" ? "Full, with shadows" : "Light"}</button>
          ))}
          <span className="text-fg-3">Drag to orbit, right-drag to pan, scroll to zoom.</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-fg-2" htmlFor="drill">Drill</label>
          <select id="drill" value={drillId ?? ""} onChange={(e) => setDrillId(e.target.value)} className="border border-line-strong bg-transparent px-2 py-1 text-[13px]">
            {drills.map((d) => <option key={d.id} value={d.id} className="bg-[#0b1117]">{d.title}</option>)}
          </select>
          <button type="button" onClick={toggle} disabled={!replay} className="tag cursor-pointer bg-accent-soft text-accent">{playing ? "Pause" : "Play"}</button>
          {[1, 10, 30].map((x) => (
            <button key={x} type="button" aria-pressed={speed === x} onClick={() => { clock.current.speed = x; setSpeed(x); }} className={`tag cursor-pointer ${speed === x ? "bg-accent-soft text-accent" : ""}`}>{x}×</button>
          ))}
          <span className="num font-mono text-[13px]">{clockText(now)}</span>
          <input type="range" aria-label="Drill time" className="min-w-[160px] flex-1" min={start} max={clock.current.end || 1} step={1} value={now} onChange={(e) => seek(Number(e.target.value))} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-fg-2">
          {Object.entries(KIND_STYLE).filter(([k]) => k !== "mast").map(([k, st]) => (
            <span key={k} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: st.color }} />{st.label}</span>
          ))}
        </div>
        {replay && !subject && replay.ops && (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="grid content-start gap-1">
              {opsFacts(replay.ops).map((f) => <span key={f}>{f}</span>)}
              <span className="font-mono text-[11px] text-fg-3">seed {replay.manifest.seed} · {replay.manifest.digest.slice(0, 12)}</span>
            </div>
            <ol className="m-0 grid max-h-[130px] list-none content-start gap-0.5 overflow-y-auto p-0 text-[12.5px]">
              {feed.map((e, i) => (
                <li key={i}><button type="button" onClick={() => seek(Math.max(start, e.t / 1000))} className={`w-full cursor-pointer text-left ${e.t / 1000 <= now ? "text-fg" : "text-fg-3"}`}>
                  <span className="num mr-2 font-mono text-[11px] text-fg-3">{clockText(e.t / 1000)}</span>{EVENT_TEXT[e.type]!(e, name)}</button></li>
              ))}
            </ol>
          </div>
        )}
        {replay && subject && (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="grid content-start gap-1">
              <span>Detected after <span className="num font-medium">{subject.time_to_detect_s ?? "–"} s</span>{subject.detected_by ? ` by ${name(subject.detected_by)}` : ""}</span>
              <span>Met <span className="num font-medium">{subject.detect_to_contact_s ?? "–"} s</span> after detection</span>
              <span className="font-mono text-[11px] text-fg-3">seed {replay.manifest.seed} · median run of the batch · {replay.manifest.digest.slice(0, 12)}</span>
            </div>
            <ol className="m-0 grid max-h-[130px] list-none content-start gap-0.5 overflow-y-auto p-0 text-[12.5px]">
              {feed.map((e, i) => (
                <li key={i}><button type="button" onClick={() => seek(Math.max(start, e.t / 1000))} className={`w-full cursor-pointer text-left ${e.t / 1000 <= now ? "text-fg" : "text-fg-3"}`}>
                  <span className="num mr-2 font-mono text-[11px] text-fg-3">{clockText(e.t / 1000)}</span>{EVENT_TEXT[e.type]!(e, name)}</button></li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
