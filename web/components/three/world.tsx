"use client";
import { Canvas, useThree } from "@react-three/fiber";
import { EnvironmentControls, TilesRenderer } from "3d-tiles-renderer/r3f";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { AgentsLayer, CameraRig, type Clock, EVENT_TEXT, KIND_STYLE, type Replay, type Site, SiteObjects, type View, opsFacts } from "./world-sim";

/**
 * World viewer. The tileset root carries ENU -> ECEF; the tiles group gets the inverse plus z-up -> y-up, so three.js
 * world space is exactly the simulation frame: x = east, y = up, z = -north (metres from the site centre).
 * OSM lines (ODbL) come from a separate file and are drawn in the same frame.
 */

type Rec = { value: number | string; source: string; licence: string; method: string; confidence: number };
type Feature = { fid: number; id: string; attrs: Record<string, string | number | null>; base_z: number; top_z: number; height: Rec; footprint: Rec };
type Lines = { kinds: string[]; ways: { k: number; c: string; n: string; w: number; wm: string; p: number[] }[]; attribution: string };

const KIND_COLOR = ["#f2c36b", "#d9d9d9", "#5fb3e8"];
const KIND_LABEL = ["Roads and paths", "Rail and rack railway", "Rivers and streams"];

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

function LinesLayer({ lines, visible }: { lines: Lines; visible: boolean[] }) {
  const geoms = useMemo(() => lines.kinds.map((_, k) => {
    const pos: number[] = [];
    for (const w of lines.ways) {
      if (w.k !== k) continue;
      const p = w.p;
      for (let i = 0; i + 5 < p.length; i += 3) {
        pos.push(p[i]! / 10, p[i + 2]! / 10, -p[i + 1]! / 10, p[i + 3]! / 10, p[i + 5]! / 10, -p[i + 4]! / 10);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }), [lines]);
  useEffect(() => () => geoms.forEach((g) => g.dispose()), [geoms]);
  return <>{geoms.map((g, k) => (
    <lineSegments key={k} geometry={g} visible={visible[k]} renderOrder={2}>
      <lineBasicMaterial color={KIND_COLOR[k]} depthTest transparent opacity={0.95} />
    </lineSegments>
  ))}</>;
}

function Picker({ group, onPick }: { group: THREE.Object3D | null; onPick: (fid: number | null) => void }) {
  const { gl, camera, invalidate } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    let down: [number, number] | null = null;
    const ray = new THREE.Raycaster();
    const onDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
    const onUp = (e: PointerEvent) => {
      if (!down || !group || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const r = el.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObject(group, true).find((h) => h.object.visible);
      const attr = hit && (hit.object as THREE.Mesh).geometry?.getAttribute("_feature_id_0");
      onPick(hit && attr && hit.face ? Math.round(attr.getX(hit.face.a)) : null);
      invalidate();
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    return () => { el.removeEventListener("pointerdown", onDown); el.removeEventListener("pointerup", onUp); };
  }, [gl, camera, group, onPick, invalidate]);
  return null;
}

type TilesLike = {
  group: THREE.Group;
  addEventListener: (t: string, f: (e: { scene: THREE.Object3D }) => void) => void;
  removeEventListener: (t: string, f: (e: { scene: THREE.Object3D }) => void) => void;
  lruCache: { minBytesSize: number; maxBytesSize: number; minSize: number; maxSize: number };
  downloadQueue: { maxJobs: number };
  parseQueue: { maxJobs: number };
};

/**
 * Memory budget. Three levels: the root (whole site), 16 mid tiles (1024 px textures, about 6 MB each on the GPU)
 * and 16 fine tiles (2048 px, about 22 MB each). The overview needs root + mid, roughly 110 MB. Fine tiles load only
 * near the camera and the byte limit keeps about six of them; older ones are released. The limit is in bytes, not
 * in tile count: a count limit below 17 would stop fine tiles from ever loading. Textures decode one at a time.
 */
const CACHE_MIN_BYTES = 180e6;
const CACHE_MAX_BYTES = 260e6;

/** Asks for one frame when playback state changes while the render loop is idle. */
function Kick({ n }: { n: number }) {
  const { invalidate } = useThree();
  useEffect(() => { invalidate(); }, [n, invalidate]);
  return null;
}

function Tiles({ base, enuToEcef, showBuildings, onGroup }: { base: string; enuToEcef: number[]; showBuildings: boolean; onGroup: (g: THREE.Object3D) => void }) {
  // The renderer instance appears after this component's first effects, so it is captured with a callback ref.
  const [tiles, setTiles] = useState<TilesLike | null>(null);
  const setRef = useCallback((t: TilesLike | null) => { if (t) setTiles((prev) => prev ?? t); }, []);
  const show = useRef(showBuildings);
  const { invalidate } = useThree();
  const apply = useCallback((o: THREE.Object3D) => o.traverse((c) => { if (c.name === "buildings") c.visible = show.current; }), []);
  useEffect(() => {
    if (!tiles) return;
    const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2).multiply(new THREE.Matrix4().fromArray(enuToEcef).invert());
    tiles.group.matrixAutoUpdate = false;
    tiles.group.matrix.copy(m);
    tiles.group.updateMatrixWorld(true);
    tiles.lruCache.minBytesSize = CACHE_MIN_BYTES;
    tiles.lruCache.maxBytesSize = CACHE_MAX_BYTES;
    tiles.lruCache.minSize = 20;
    tiles.lruCache.maxSize = 40;
    const dq = tiles.downloadQueue as { maxJobs: number; maxJobsPerOrigin?: number };
    if ("maxJobsPerOrigin" in dq) dq.maxJobsPerOrigin = 3; else dq.maxJobs = 3;
    tiles.parseQueue.maxJobs = 1;
    onGroup(tiles.group);
    const onLoad = (e: { scene: THREE.Object3D }) => { apply(e.scene); invalidate(); };
    tiles.addEventListener("load-model", onLoad);
    invalidate();
    return () => tiles.removeEventListener("load-model", onLoad);
  }, [tiles, enuToEcef, onGroup, apply, invalidate]);
  useEffect(() => { show.current = showBuildings; if (tiles) apply(tiles.group); invalidate(); }, [tiles, showBuildings, apply, invalidate]);
  return <TilesRenderer ref={setRef as never} url={`${base}/tileset.json`} errorTarget={8} />;
}

const clockText = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function WorldScene({ base, buildingsUrl, linesUrl, sim }: {
  base: string; buildingsUrl: string; linesUrl: string; sim?: { base: string; drills: { id: string; title: string }[] };
}) {
  const tileset = useJson<{ root: { transform: number[] } }>(`${base}/tileset.json`);
  const lines = useJson<Lines>(linesUrl);
  const [pickedFid, setPickedFid] = useState<number | null>(null);
  const [wantBuildings, setWantBuildings] = useState(false);
  const buildings = useJson<{ features: Feature[] }>(wantBuildings ? buildingsUrl : null);
  const [group, setGroup] = useState<THREE.Object3D | null>(null);
  const [showB, setShowB] = useState(true);
  const [kinds, setKinds] = useState([true, true, true]);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [lost, setLost] = useState(false);
  useEffect(() => {
    try { const c = document.createElement("canvas"); setWebgl(!!(c.getContext("webgl2") || c.getContext("webgl"))); } catch { setWebgl(false); }
  }, []);
  const onPick = useCallback((fid: number | null) => { setPickedFid(fid); if (fid !== null) setWantBuildings(true); }, []);
  // ---- site sim: compound, drill replay, playback clock
  const site = useJson<Site>(sim ? `${sim.base}/site.json` : null);
  const [drillId, setDrillId] = useState(sim?.drills[0]?.id ?? null);
  const replay = useJson<Replay>(sim && drillId ? `${sim.base}/replay-${drillId}.json` : null);
  const [view, setView] = useState<{ v: View; n: number }>({ v: "valley", n: 0 });
  const clock = useRef<Clock>({ t: 0, playing: false, speed: 10, end: 0 });
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [kick, setKick] = useState(0);
  const [follow, setFollow] = useState<string | null>(null);
  const onTick = useCallback((t: number) => { setNow(t); if (!clock.current.playing) setPlaying(false); }, []);
  const subject = replay?.score ? Object.values(replay.score.subjects)[0] ?? null : null;
  const start = subject?.appeared_ms != null ? Math.max(0, subject.appeared_ms / 1000 - 30) : replay?.start_s ?? 0;
  useEffect(() => {
    if (!replay) return;
    clock.current = { t: start, playing: false, speed: clock.current.speed, end: replay.manifest.until_ms / 1000 };
    setNow(start); setPlaying(false); setKick((k) => k + 1);
  }, [replay, start]);
  const seek = (t: number) => { clock.current.t = t; setNow(t); setKick((k) => k + 1); };
  const toggle = () => {
    const c = clock.current;
    if (!c.playing && c.t >= c.end) c.t = start;
    c.playing = !c.playing; setPlaying(c.playing); setKick((k) => k + 1);
  };
  const name = useCallback((id?: string) => replay?.agents.find((a) => a.id === id)?.label ?? id ?? "", [replay]);
  // the feed keeps the first dispatch only: later ones are the same responders following a moving position
  const feed = useMemo(() => {
    let sent = false;
    return (replay?.events ?? []).filter((e) => {
      if (!EVENT_TEXT[e.type] || e.t / 1000 < start) return false;
      if (e.type !== "dispatch") return true;
      const first = !sent;
      sent = true;
      return first;
    });
  }, [replay, start]);
  const picked = pickedFid === null ? null : buildings?.features[pickedFid] ?? null;

  return (
    <div className="grid gap-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden border border-line bg-[#0b1117] sm:aspect-[16/9]" role="img"
        aria-label="3D view of the Lauterbrunnen valley rebuilt from swisstopo terrain, imagery and buildings, with OpenStreetMap roads, rail and rivers">
        {webgl === false ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-[13px] text-fg-2">This 3D view needs WebGL, which this browser did not provide.</div>
        ) : lost ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-[13px] text-fg-2">
            <span>The browser dropped the 3D view, usually because graphics memory ran out.{" "}
              <button type="button" className="text-accent underline" onClick={() => location.reload()}>Reload the page</button></span>
          </div>
        ) : tileset ? (
          <Canvas frameloop="demand" camera={{ position: [-1900, 2700, 2300], fov: 45, near: 2, far: 60000 }} dpr={[1, 1.5]}
            gl={{ antialias: true, logarithmicDepthBuffer: true, powerPreference: "high-performance" }}
            onCreated={({ camera, gl }) => {
              camera.lookAt(0, 900, 0);
              gl.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); setLost(true); });
            }}>
            <color attach="background" args={["#0b1117"]} />
            <hemisphereLight args={["#dfe8f2", "#4a4036", 1.6]} />
            <directionalLight position={[-3000, 5000, 2000]} intensity={2.2} />
            <Tiles base={base} enuToEcef={tileset.root.transform} showBuildings={showB} onGroup={setGroup} />
            {lines && <LinesLayer lines={lines} visible={kinds} />}
            {site && <SiteObjects site={site} />}
            {replay && <AgentsLayer key={replay.manifest.digest} replay={replay} clock={clock} onTick={onTick} follow={follow} modelsBase="/world/models" />}
            <CameraRig view={view.v} nonce={view.n} site={site} />
            <Kick n={kick} />
            <EnvironmentControls enableDamping minDistance={20} maxDistance={20000} />
            <Picker group={group} onPick={onPick} />
          </Canvas>
        ) : <div className="absolute inset-0 animate-pulse bg-surface" />}
        <div className="pointer-events-none absolute bottom-2 left-2 right-2 font-mono text-[10.5px] text-white/75 [text-shadow:0_1px_2px_#000]">
          Terrain, imagery, buildings © swisstopo · Lines © OpenStreetMap contributors (ODbL){sim ? " · Models: Unitree Go2 © Unitree Robotics (BSD-3), Skydio X2 (Apache-2.0), CesiumMan © Cesium (CC BY 4.0)" : ""}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <button type="button" onClick={() => setShowB((v) => !v)} aria-pressed={showB}
          className={`tag cursor-pointer ${showB ? "bg-accent-soft text-accent" : ""}`}>Buildings (LoD2)</button>
        {KIND_LABEL.map((l, k) => (
          <button key={l} type="button" aria-pressed={kinds[k]} onClick={() => setKinds((ks) => ks.map((v, i) => (i === k ? !v : v)))}
            className={`tag cursor-pointer ${kinds[k] ? "bg-accent-soft text-accent" : ""}`}>
            <span className="inline-block h-2 w-2" style={{ background: KIND_COLOR[k] }} />{l}
          </button>
        ))}
        <span className="text-fg-3">Drag to pan, right-drag to orbit, scroll to zoom. Click a building to see where its numbers come from.</span>
      </div>
      {sim && (
        <div className="panel grid gap-3 p-4 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow text-fg-3">Site sim</span>
            {([["valley", "Whole valley"], ["site", "Warehouse site"], ["top", "Site from above"]] as const).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={!follow && view.v === id} onClick={() => { setFollow(null); setView((s) => ({ v: id, n: s.n + 1 })); }}
                className={`tag cursor-pointer ${!follow && view.v === id ? "bg-accent-soft text-accent" : ""}`}>{label}</button>
            ))}
            <label className="text-fg-2" htmlFor="follow">Close-up</label>
            <select id="follow" value={follow ?? ""} onChange={(e) => { setFollow(e.target.value || null); setKick((k) => k + 1); }}
              className="border border-line-strong bg-transparent px-2 py-1 text-[13px]">
              <option value="" className="bg-[#0b1117]">Off</option>
              {(replay?.agents ?? []).filter((a) => a.kind !== "mast").map((a) => <option key={a.id} value={a.id} className="bg-[#0b1117]">{a.label}</option>)}
            </select>
            <span className="text-fg-3">The warehouse compound is synthetic: placed by rule on real terrain, not a real facility.</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-fg-2" htmlFor="drill">Drill</label>
            <select id="drill" value={drillId ?? ""} onChange={(e) => setDrillId(e.target.value)} className="border border-line-strong bg-transparent px-2 py-1 text-[13px]">
              {sim.drills.map((d) => <option key={d.id} value={d.id} className="bg-[#0b1117]">{d.title}</option>)}
            </select>
            <button type="button" onClick={toggle} disabled={!replay} className="tag cursor-pointer bg-accent-soft text-accent">{playing ? "Pause" : "Play"}</button>
            {[1, 10, 30].map((x) => (
              <button key={x} type="button" aria-pressed={speed === x} onClick={() => { clock.current.speed = x; setSpeed(x); }}
                className={`tag cursor-pointer ${speed === x ? "bg-accent-soft text-accent" : ""}`}>{x}×</button>
            ))}
            <span className="num font-mono text-[13px]">{clockText(now)}</span>
            <input type="range" aria-label="Drill time" className="min-w-[160px] flex-1" min={start} max={clock.current.end || 1} step={1}
              value={now} onChange={(e) => seek(Number(e.target.value))} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-fg-2">
            {Object.entries(KIND_STYLE).map(([k, st]) => (
              <span key={k} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: st.color }} />{st.label}</span>
            ))}
          </div>
          {replay && !subject && replay.ops && (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <div className="grid content-start gap-1 text-[13px]">
                {opsFacts(replay.ops).map((f) => <span key={f}>{f}</span>)}
                <span className="font-mono text-[11px] text-fg-3">seed {replay.manifest.seed} · {replay.manifest.digest.slice(0, 12)}</span>
              </div>
              <ol className="m-0 grid max-h-[150px] list-none content-start gap-0.5 overflow-y-auto p-0 text-[12.5px]">
                {feed.map((e, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => seek(e.t / 1000)} className={`w-full cursor-pointer text-left ${e.t / 1000 <= now ? "text-fg" : "text-fg-3"}`}>
                      <span className="num mr-2 font-mono text-[11px] text-fg-3">{clockText(e.t / 1000)}</span>{EVENT_TEXT[e.type]!(e, name)}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {replay && subject && (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <div className="grid content-start gap-1 text-[13px]">
                <span>Detected after <span className="num font-medium">{subject.time_to_detect_s ?? "–"} s</span>{subject.detected_by ? ` by ${name(subject.detected_by)}` : ""}</span>
                <span>Met <span className="num font-medium">{subject.detect_to_contact_s ?? "–"} s</span> after detection</span>
                <span>{subject.entered_zone_ms === null ? "Stopped outside the alarm zone" : subject.contact_ms !== null && subject.entered_zone_ms > subject.contact_ms ? "Stopped outside the alarm zone" : "Reached the alarm zone before being met"}</span>
                <span className="font-mono text-[11px] text-fg-3">seed {replay.manifest.seed} · the median run of the batch · {replay.manifest.digest.slice(0, 12)}</span>
              </div>
              <ol className="m-0 grid max-h-[150px] list-none content-start gap-0.5 overflow-y-auto p-0 text-[12.5px]">
                {feed.map((e, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => seek(e.t / 1000)} className={`w-full cursor-pointer text-left ${e.t / 1000 <= now ? "text-fg" : "text-fg-3"}`}>
                      <span className="num mr-2 font-mono text-[11px] text-fg-3">{clockText(e.t / 1000)}</span>{EVENT_TEXT[e.type]!(e, name)}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
      {pickedFid !== null && (
        <div className="panel grid gap-2 p-4 text-[13px]">
          {!picked ? <span className="text-fg-3">Loading building record…</span> : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[15px] font-medium">{String(picked.attrs.OBJEKTART ?? "Building")}{picked.attrs.NAME_KOMPLETT ? ` · ${picked.attrs.NAME_KOMPLETT}` : ""}</span>
                <span className="font-mono text-[11px] text-fg-3">EGID {picked.attrs.EGID ?? "–"} · {picked.id}</span>
              </div>
              <div className="grid gap-1 sm:grid-cols-2">
                {([["Height", picked.height, "m"], ["Footprint", picked.footprint, "m²"]] as const).map(([k, r, u]) => (
                  <div key={k} className="grid gap-0.5">
                    <span><span className="text-fg-2">{k}</span> <span className="num font-medium">{r.value} {u}</span></span>
                    <span className="font-mono text-[11px] text-fg-3">{r.method} · confidence {r.confidence} · {r.source} · {r.licence}</span>
                  </div>
                ))}
              </div>
              <span className="font-mono text-[11px] text-fg-3">Base {picked.base_z} m, roof top {picked.top_z} m (LN02). Captured {picked.attrs.HERKUNFT_JAHR ?? "–"}.</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
