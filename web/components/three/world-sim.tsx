"use client";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { loadModels, makeRig, mastObject, type Models, type Rig } from "./world-models";

/**
 * Site sim layer for the world viewer: the synthetic warehouse compound, equipment models at true size, and drill
 * playback. Everything is in the tiles' frame: ENU [east, north, up] metres -> three.js (east, up, -north).
 * The compound is placed by rule and marked synthetic; nothing here is a real facility.
 */

export type Vec3 = [number, number, number];
export type Site = {
  centre: Vec3; fence: Vec3[]; fence_height: number; gate: { at: Vec3; width: number };
  warehouse: { corners: [number, number][]; base: number; floor: number; eave: number; ridge: number };
  roads: Vec3[][]; drone_pad: { at: Vec3; size: number }; dog_dock: { at: Vec3 }; vehicle_bay: { at: Vec3 };
  guard_post: { at: Vec3; facing_deg: number };
  masts: { id: string; at: Vec3; facing_deg: number; height: number; fov_deg: number; range_m: number }[];
  zone: { centre: Vec3; radius: number };
};
export type SimEvent = {
  t: number; type: string; agent?: string; subject?: string; agents?: string[]; by?: string; alarm?: string; id?: string;
  cause?: { observer: string; range_m: number; by?: string } | string; waited_s?: number; after_s?: number; position?: number; workers?: number; barrier?: string;
};
export type Replay = {
  manifest: { seed: number; until_ms: number; digest: string };
  agents: { id: string; kind: string; role: string; label: string }[];
  tracks: Record<string, [number, number, number, number][]>;
  events: SimEvent[];
  title?: string | null; start_s?: number;
  ops?: { kind: string; result: Record<string, number | string | boolean | null> } | null;
  score: { subjects: Record<string, { appeared_ms: number | null; detected_ms: number | null; contact_ms: number | null; entered_zone_ms: number | null; time_to_detect_s: number | null; detect_to_contact_s: number | null; detected_by: string | null }> } | null;
};

export const KIND_STYLE: Record<string, { color: string; label: string }> = {
  guard: { color: "#4da3ff", label: "Guard" },
  dog: { color: "#f2c200", label: "Robot dog" },
  vehicle: { color: "#e8eaed", label: "Vehicle" },
  drone: { color: "#7ee0c0", label: "Drone" },
  mast: { color: "#b08cff", label: "Camera mast" },
  person: { color: "#ff6b4a", label: "Unknown person" },
  worker: { color: "#ffa94d", label: "Site worker" },
  truck: { color: "#c9ced6", label: "Visiting truck" },
};

const cause = (e: SimEvent) => (typeof e.cause === "object" ? e.cause : undefined);
/** One line per event for the drill feed, shared by the valley view and the site view. */
export const EVENT_TEXT: Record<string, (e: SimEvent, name: (id?: string) => string) => string> = {
  appear: (e, n) => `${n(e.agent)} appears`,
  detected: (e, n) => `Detected by ${n(cause(e)?.observer)} at ${cause(e)?.range_m} m${cause(e)?.by ? ` (${cause(e)!.by})` : ""}`,
  dispatch: (e, n) => `Sent: ${(e.agents ?? []).map((a) => n(a)).join(", ")}`,
  contact: (e, n) => `${n(e.agent)} meets the person`,
  reached_goal: () => "Person reaches the fence line",
  sensor_fault: (e, n) => `${n(e.agent)} camera out of service`,
  low_battery: (e, n) => `${n(e.agent)} low battery, returns to charge`,
  at_barrier: (e) => `Person at the ${e.barrier ?? "fence"}`,
  alarm: (e) => `Fence alarm (${e.cause === "person" ? "a person" : "nuisance"})`,
  verify_sent: (e, n) => `${n(e.agent)} sent to check the alarm`,
  verify_arrived: (e, n) => `${n(e.agent)} over the alarm point`,
  verify_unavailable: () => "Nobody free to check the alarm",
  cleared: (e, n) => `Alarm cleared by ${n(e.by)}`,
  at_door: () => "Person at the building door",
  task_complete: () => "Person through the door: not stopped in time",
  truck_inbound: (e, n) => `${n(e.agent)} on the access road`,
  queued: (e, n) => `${n(e.agent)} joins the queue, place ${e.position}`,
  gate_check: (e, n) => `Gate check of ${n(e.agent)} starts after ${e.waited_s} s waiting`,
  admitted: (e, n) => `${n(e.agent)} admitted`,
  refused: (e, n) => `${n(e.agent)} turned away: booking not confirmed`,
  loading: (e, n) => `${n(e.agent)} at the door`,
  loss: (e, n) => `${n(e.agent)} left with goods on a fictitious booking`,
  departed: (e, n) => `${n(e.agent)} leaves the site`,
  evacuation_start: (e) => `Evacuation alarm: ${e.workers} workers on site`,
  mustered: (e, n) => `${n(e.agent)} at the muster point after ${e.after_s} s`,
  all_mustered: (e) => `Everyone accounted for after ${e.after_s} s`,
};

/** The result of an operations replay as short lines. */
export function opsFacts(ops: NonNullable<Replay["ops"]>): string[] {
  const r = ops.result, s = (k: string) => (r[k] === null || r[k] === undefined ? "–" : `${Math.round(Number(r[k]))} s`);
  if (ops.kind === "timeline") return [r.interrupted ? "Met before the task was done" : "Not met in time", `Detected after ${s("time_to_detect_s")}`, `Met after ${s("contact_s")}`, r.fence_alarm ? "Fence sensor alarmed" : "No fence alarm"];
  if (ops.kind === "alarm") return [r.cleared_by ? `Cleared after ${s("cleared_after_s")}` : "No clear call: people went to look", `Guards sent: ${r.guards_sent}`];
  if (ops.kind === "gate") return [`${r.trucks} trucks, mean wait ${s("mean_wait_s")}`, `Longest wait ${s("max_wait_s")}, longest queue ${r.max_queue}`, r.fictitious ? `Fictitious pickup: ${r.fictitious}` : "No fictitious pickup"];
  if (ops.kind === "evacuation") return [`${r.mustered} of ${r.workers} at the muster point`, `Half there after ${s("median_s")}`, `Last person after ${s("last_s")}`];
  return [];
}
const v = (p: Vec3 | number[], lift = 0) => new THREE.Vector3(p[0]!, p[2]! + lift, -p[1]!);

function quad(out: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
  for (const p of [a, b, c, a, c, d]) out.push(p.x, p.y, p.z);
}
function geom(pos: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function SiteObjects({ site }: { site: Site }) {
  const g = useMemo(() => {
    const w = site.warehouse;
    const c = w.corners.map(([e, n]) => (u: number) => new THREE.Vector3(e, u, -n));
    const walls: number[] = [], roof: number[] = [];
    for (let k = 0; k < 4; k++) quad(walls, c[k]!(w.base), c[(k + 1) % 4]!(w.base), c[(k + 1) % 4]!(w.eave), c[k]!(w.eave));
    const mid = (a: THREE.Vector3, b: THREE.Vector3) => a.clone().add(b).multiplyScalar(0.5).setY(w.ridge);
    const m03 = mid(c[0]!(w.eave), c[3]!(w.eave)), m12 = mid(c[1]!(w.eave), c[2]!(w.eave));
    quad(roof, c[0]!(w.eave), c[1]!(w.eave), m12, m03);
    quad(roof, c[2]!(w.eave), c[3]!(w.eave), m03, m12);
    for (const p of [c[3]!(w.eave), c[0]!(w.eave), m03, c[1]!(w.eave), c[2]!(w.eave), m12]) walls.push(p.x, p.y, p.z);
    // details on the long side facing south: three roller doors, a personnel door, a plinth band all round
    const doors: number[] = [], plinth: number[] = [], frames: number[] = [];
    const out = (a: THREE.Vector3, b: THREE.Vector3) => new THREE.Vector3(b.z - a.z, 0, -(b.x - a.x)).normalize();
    for (let k = 0; k < 4; k++) {
      const a = c[k]!(w.floor), b = c[(k + 1) % 4]!(w.floor);
      const n = out(a, b).multiplyScalar(0.04), up = new THREE.Vector3(0, 0.5, 0);
      quad(plinth, a.clone().add(n).setY(w.base), b.clone().add(n).setY(w.base), b.clone().add(n).add(up), a.clone().add(n).add(up));
    }
    {
      const a = c[0]!(w.floor), b = c[1]!(w.floor), dir = b.clone().sub(a), len = dir.length();
      dir.normalize();
      const n = out(a, b);
      const panel = (into: number[], along: number, width: number, height: number, off: number) => {
        const p0 = a.clone().addScaledVector(dir, along - width / 2).addScaledVector(n, off), p1 = a.clone().addScaledVector(dir, along + width / 2).addScaledVector(n, off);
        quad(into, p0, p1, p1.clone().setY(w.floor + height), p0.clone().setY(w.floor + height));
      };
      for (const f of [0.2, 0.5, 0.8]) { panel(frames, f * len, 5.4, 5.2, 0.05); panel(doors, f * len, 5.0, 5.0, 0.08); }
      panel(frames, 0.35 * len, 1.3, 2.3, 0.05); panel(doors, 0.35 * len, 1.0, 2.1, 0.08);
    }
    const fence: number[] = [], top: number[] = [];
    const gate = v(site.gate.at);
    for (let i = 0; i + 1 < site.fence.length; i++) {
      const a = v(site.fence[i]!), b = v(site.fence[i + 1]!);
      if (a.clone().add(b).multiplyScalar(0.5).setY(gate.y).distanceTo(gate) < site.gate.width / 2 + 1) continue;
      const up = new THREE.Vector3(0, site.fence_height, 0);
      quad(fence, a, b, b.clone().add(up), a.clone().add(up));
      top.push(a.x, a.y + up.y, a.z, b.x, b.y + up.y, b.z);
    }
    const road: number[] = [];
    for (const line of site.roads) {
      for (let i = 0; i + 1 < line.length; i++) {
        const a = v(line[i]!), b = v(line[i + 1]!);
        const side = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x).normalize().multiplyScalar(2);
        quad(road, a.clone().sub(side), b.clone().sub(side), b.clone().add(side), a.clone().add(side));
      }
    }
    const zone: number[] = [];
    const zc = v(site.zone.centre, 1.5);
    for (let k = 0; k <= 96; k++) {
      const a = (k / 96) * Math.PI * 2;
      zone.push(zc.x + Math.cos(a) * site.zone.radius, zc.y, zc.z + Math.sin(a) * site.zone.radius);
    }
    const topG = new THREE.BufferGeometry();
    topG.setAttribute("position", new THREE.Float32BufferAttribute(top, 3));
    const zoneG = new THREE.BufferGeometry();
    zoneG.setAttribute("position", new THREE.Float32BufferAttribute(zone, 3));
    return { walls: geom(walls), roof: geom(roof), fence: geom(fence), top: topG, road: geom(road), zone: zoneG, doors: geom(doors), plinth: geom(plinth), frames: geom(frames) };
  }, [site]);
  useEffect(() => () => Object.values(g).forEach((x) => x.dispose()), [g]);
  const masts = useMemo(() => Object.fromEntries(site.masts.map((m) => [m.id, mastObject(m.height, KIND_STYLE.mast!.color)])), [site]);
  const pad = v(site.drone_pad.at, 0.12);
  return (
    <group>
      <mesh geometry={g.walls}><meshStandardMaterial color="#c3c8ce" side={THREE.DoubleSide} roughness={0.9} /></mesh>
      <mesh geometry={g.roof}><meshStandardMaterial color="#5c6975" side={THREE.DoubleSide} roughness={0.55} metalness={0.4} /></mesh>
      <mesh geometry={g.plinth}><meshStandardMaterial color="#7d858d" side={THREE.DoubleSide} roughness={1} /></mesh>
      <mesh geometry={g.frames}><meshStandardMaterial color="#3d4650" side={THREE.DoubleSide} /></mesh>
      <mesh geometry={g.doors}><meshStandardMaterial color="#8f98a2" side={THREE.DoubleSide} roughness={0.5} metalness={0.5} /></mesh>
      <mesh geometry={g.road}><meshStandardMaterial color="#6f747b" roughness={1} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} /></mesh>
      <mesh geometry={g.fence}><meshBasicMaterial color="#dfe6ee" transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <lineSegments geometry={g.top}><lineBasicMaterial color="#dfe6ee" /></lineSegments>
      <line>
        <primitive object={g.zone} attach="geometry" />
        <lineBasicMaterial color="#ff6b4a" transparent opacity={0.7} />
      </line>
      <mesh position={pad}><cylinderGeometry args={[site.drone_pad.size / 2, site.drone_pad.size / 2, 0.2, 32]} /><meshStandardMaterial color="#27313b" /></mesh>
      <mesh position={pad.clone().setY(pad.y + 0.12)} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[site.drone_pad.size / 2 - 0.5, site.drone_pad.size / 2 - 0.2, 32]} /><meshBasicMaterial color="#7ee0c0" /></mesh>
      <mesh position={v(site.dog_dock.at, 0.4)}><boxGeometry args={[1.4, 0.8, 1.0]} /><meshStandardMaterial color="#3a444f" /></mesh>
      <mesh position={v(site.vehicle_bay.at, 0.06)}><boxGeometry args={[6.5, 0.1, 3.4]} /><meshStandardMaterial color="#3a444f" /></mesh>
      <mesh position={v(site.guard_post.at, 1.25)}><boxGeometry args={[2.2, 2.5, 2.2]} /><meshStandardMaterial color="#8f99a3" transparent opacity={0.55} /></mesh>
      {site.masts.map((m) => {
        const p = v(m.at);
        const yaw = Math.atan2(Math.cos((m.facing_deg * Math.PI) / 180), Math.sin((m.facing_deg * Math.PI) / 180));
        return (
          <group key={m.id} position={p}>
            <group rotation={[0, yaw, 0]}>
              <primitive object={masts[m.id]!} />
              {/* a short wedge showing where the camera looks; its real range is in the page text */}
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.6, 0]}>
                <circleGeometry args={[35, 24, -(m.fov_deg * Math.PI) / 360, (m.fov_deg * Math.PI) / 180]} />
                <meshBasicMaterial color={KIND_STYLE.mast!.color} transparent opacity={0.13} side={THREE.DoubleSide} depthWrite={false} />
              </mesh>
            </group>
          </group>
        );
      })}
    </group>
  );
}

/** Stand-in shapes shown until the real models (world-models.ts) have loaded. Local +X is forward. */
function Model({ kind }: { kind: string }) {
  const c = KIND_STYLE[kind]?.color ?? "#ffffff";
  if (kind === "vehicle") {
    return (
      <group>
        <mesh position={[0, 0.85, 0]}><boxGeometry args={[4.6, 0.9, 1.85]} /><meshStandardMaterial color={c} roughness={0.5} /></mesh>
        <mesh position={[-0.3, 1.55, 0]}><boxGeometry args={[2.6, 0.7, 1.7]} /><meshStandardMaterial color="#1c232b" roughness={0.3} /></mesh>
        {[[1.45, 0.95], [1.45, -0.95], [-1.45, 0.95], [-1.45, -0.95]].map(([x, z]) => (
          <mesh key={`${x}${z}`} position={[x!, 0.36, z!]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.36, 0.36, 0.26, 16]} /><meshStandardMaterial color="#111418" /></mesh>
        ))}
      </group>
    );
  }
  if (kind === "dog") {
    return (
      <group>
        <mesh position={[0, 0.42, 0]}><boxGeometry args={[0.72, 0.2, 0.3]} /><meshStandardMaterial color={c} roughness={0.5} /></mesh>
        <mesh position={[0.42, 0.5, 0]}><boxGeometry args={[0.2, 0.16, 0.2]} /><meshStandardMaterial color="#1c232b" /></mesh>
        {[[0.28, 0.14], [0.28, -0.14], [-0.28, 0.14], [-0.28, -0.14]].map(([x, z]) => (
          <mesh key={`${x}${z}`} position={[x!, 0.17, z!]}><boxGeometry args={[0.07, 0.34, 0.07]} /><meshStandardMaterial color="#2a323b" /></mesh>
        ))}
      </group>
    );
  }
  if (kind === "drone") {
    return (
      <group>
        <mesh><boxGeometry args={[0.36, 0.14, 0.36]} /><meshStandardMaterial color="#1c232b" /></mesh>
        {[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z]) => (
          <group key={`${x}${z}`}>
            <mesh position={[x! * 0.21, 0, z! * 0.21]} rotation={[0, (x! * z! * Math.PI) / 4, 0]}><boxGeometry args={[0.6, 0.04, 0.05]} /><meshStandardMaterial color="#2a323b" /></mesh>
            <mesh position={[x! * 0.4, 0.06, z! * 0.4]}><cylinderGeometry args={[0.2, 0.2, 0.015, 20]} /><meshStandardMaterial color={c} transparent opacity={0.75} /></mesh>
          </group>
        ))}
        <mesh position={[0.1, -0.12, 0]}><sphereGeometry args={[0.07, 12, 12]} /><meshStandardMaterial color="#0d1014" /></mesh>
      </group>
    );
  }
  return (
    <group>
      <mesh position={[0, 0.78, 0]}><capsuleGeometry args={[0.21, 0.9, 6, 12]} /><meshStandardMaterial color={c} roughness={0.7} /></mesh>
      <mesh position={[0, 1.6, 0]}><sphereGeometry args={[0.13, 14, 14]} /><meshStandardMaterial color="#e9c9a8" /></mesh>
    </group>
  );
}

function dot(color: string) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(32, 32, 20, 0, Math.PI * 2); ctx.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Position and heading on a track at time t (seconds). Tracks collapse standing still, so this is a search. */
export function sample(track: [number, number, number, number][], t: number): { p: THREE.Vector3; yaw: number | null; present: boolean } {
  if (!track.length || t < track[0]![0]) return { p: new THREE.Vector3(), yaw: null, present: false };
  let lo = 0, hi = track.length - 1;
  while (lo < hi - 1) { const m = (lo + hi) >> 1; if (track[m]![0] <= t) lo = m; else hi = m; }
  const a = track[lo]!, b = track[Math.min(lo + 1, track.length - 1)]!;
  const f = b[0] > a[0] ? Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))) : 0;
  const e = a[1] + (b[1] - a[1]) * f, n = a[2] + (b[2] - a[2]) * f, u = a[3] + (b[3] - a[3]) * f;
  const de = b[1] - a[1], dn = b[2] - a[2];
  return { p: new THREE.Vector3(e, u, -n), yaw: Math.abs(de) + Math.abs(dn) > 0.05 ? Math.atan2(dn, de) : null, present: true };
}

export type Clock = { t: number; playing: boolean; speed: number; end: number };

/** Close-up camera offset per kind (metres east, up, south of the agent), so each model fills the view. */
const FOLLOW: Record<string, [number, number, number]> = { truck: [14, 6, 14], worker: [4, 2.2, 4], vehicle: [9, 4.5, 9], drone: [3.2, 1.4, 3.2], dog: [2.6, 1.3, 2.6], guard: [4, 2.2, 4], person: [4, 2.2, 4] };

export function AgentsLayer({ replay, clock, onTick, follow, modelsBase, peopleBase, shadows = false }: {
  replay: Replay; clock: React.RefObject<Clock>; onTick: (t: number) => void; follow: string | null; modelsBase: string; peopleBase?: string; shadows?: boolean;
}) {
  const [models, setModels] = useState<Models | null>(null);
  useEffect(() => { let live = true; loadModels(modelsBase, peopleBase).then((m) => { if (live) setModels(m); }).catch(() => {}); return () => { live = false; }; }, [modelsBase, peopleBase]);
  const prev = useRef<Record<string, THREE.Vector3>>({});
  const groups = useRef<Record<string, THREE.Group | null>>({});
  const bodies = useRef<Record<string, THREE.Group | null>>({});
  const last = useRef(0);
  const { invalidate, camera } = useThree();
  const movers = useMemo(() => replay.agents.filter((a) => a.kind !== "mast"), [replay]);
  const dots = useMemo(() => Object.fromEntries(Object.entries(KIND_STYLE).map(([k, s]) => [k, dot(s.color)])), []);
  // real models once they have loaded; the simple shapes stand in until then
  const rigs = useMemo(() => {
    if (!models) return null;
    const out: Record<string, Rig> = {};
    for (const a of movers) {
      const r = makeRig(a.kind, models);
      if (shadows) r.object.traverse((c) => { if ((c as THREE.Mesh).isMesh) c.castShadow = true; });
      out[a.id] = r;
    }
    return out;
  }, [models, movers, shadows]);
  useEffect(() => () => { if (rigs) Object.values(rigs).forEach((r) => r.dispose()); }, [rigs]);
  useEffect(() => { invalidate(); }, [rigs, invalidate]);
  const trails = useMemo(() => movers.map((a) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute((replay.tracks[a.id] ?? []).flatMap(([, e, n, u]) => [e, u + 0.4, -n]), 3));
    return g;
  }), [movers, replay]);
  useEffect(() => () => { trails.forEach((g) => g.dispose()); }, [trails]);
  useEffect(() => () => { Object.values(dots).forEach((t) => t.dispose()); }, [dots]);
  useFrame((_, dt) => {
    const c = clock.current;
    if (c.playing) {
      c.t = Math.min(c.end, c.t + Math.min(dt, 0.1) * c.speed);
      if (c.t >= c.end) c.playing = false;
      invalidate();
    }
    for (const a of movers) {
      const g = groups.current[a.id];
      if (!g) continue;
      const s = sample(replay.tracks[a.id] ?? [], c.t);
      g.visible = s.present;
      if (!s.present) continue;
      g.position.copy(s.p);
      const body = bodies.current[a.id];
      if (body && s.yaw !== null) body.rotation.y = s.yaw;
      const was = prev.current[a.id];
      const d = was ? was.distanceTo(s.p) : 0;
      (prev.current[a.id] ??= new THREE.Vector3()).copy(s.p);
      // legs, wheels and the walk cycle advance with the distance covered; a seek is a jump, not a sprint
      rigs?.[a.id]?.update(d > 6 ? 0 : d, d > 1e-4 && d <= 6);
      if (follow === a.id) {
        const o = FOLLOW[a.kind] ?? FOLLOW.person!;
        camera.position.set(s.p.x + o[0], s.p.y + o[1], s.p.z + o[2]);
        camera.lookAt(s.p.x, s.p.y + (a.kind === "vehicle" ? 1 : a.kind === "drone" ? 0 : 0.8), s.p.z);
      }
    }
    if (Math.abs(c.t - last.current) > 0.25 || !c.playing) { last.current = c.t; onTick(c.t); }
  });
  return (
    <group>
      {movers.map((a, i) => (
        <group key={a.id}>
          <line>
            <primitive object={trails[i]!} attach="geometry" />
            <lineBasicMaterial color={KIND_STYLE[a.kind]?.color ?? "#fff"} transparent opacity={a.role === "unknown" ? 0.9 : 0.3} />
          </line>
          <group ref={(g) => { groups.current[a.id] = g; }} visible={false}>
            <group ref={(g) => { bodies.current[a.id] = g; }}>{rigs?.[a.id] ? <primitive object={rigs[a.id]!.object} /> : <Model kind={a.kind} />}</group>
            {/* a marker of constant screen size, so an agent can be found from the whole-valley view */}
            <sprite scale={[0.022, 0.022, 1]} position={[0, a.kind === "truck" ? 4.4 : a.kind === "vehicle" ? 2.6 : a.kind === "drone" ? 0.8 : 2.2, 0]}>
              <spriteMaterial map={dots[a.kind] ?? dots.person} sizeAttenuation={false} depthTest={false} transparent />
            </sprite>
          </group>
        </group>
      ))}
    </group>
  );
}

export type View = "valley" | "site" | "top";

export function CameraRig({ view, nonce, site }: { view: View; nonce: number; site: Site | null }) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    if (nonce === 0) return; // the first render keeps the canvas's own starting view
    if (view === "valley" || !site) {
      camera.position.set(-1900, 2700, 2300);
      camera.lookAt(0, 900, 0);
    } else {
      const c = v(site.centre);
      if (view === "top") camera.position.set(c.x, c.y + 330, c.z + 1);
      else camera.position.set(c.x + 150, c.y + 95, c.z + 175);
      camera.lookAt(c.x, c.y + 4, c.z);
    }
    camera.updateMatrixWorld();
    invalidate();
  }, [view, nonce, site, camera, invalidate]);
  return null;
}
