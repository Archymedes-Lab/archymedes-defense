"use client";
import { Line } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { Planform } from "@/lib/aero/geometry";
import type { Panel } from "@/lib/aero/vlm";
import { useThemeColors } from "@/lib/hooks/use-theme-colors";
import { Stage } from "./stage";

/**
 * The analysed wing in 3D at incidence α: panels coloured by vortex-lattice loading (Γ per panel chord), leading-edge
 * vortex cores drawn tight up to the burst point and as a widening cone after it, and freestream lines.
 * Core position follows measured delta-wing vortices (about 60% of local semispan, rising with α); it is illustrative,
 * not computed by the solver.
 */
export function WingScene({ planform, panels, gamma, alphaDeg, burstXi, label }: {
  planform: Planform; panels: readonly Panel[]; gamma: readonly number[]; alphaDeg: number; burstXi: number; label: string;
}) {
  const colors = useThemeColors();
  const st = planform.stations;
  const root = st[0];
  const xMin = Math.min(...st.map((s) => s.xLe)), xMax = Math.max(...st.map((s) => s.xLe + s.chord));
  const L = xMax - xMin, semi = st[st.length - 1]?.y ?? 1;
  const scale = 8 / Math.max(L, 2 * semi);
  const xMid = (xMin + xMax) / 2;
  const a = (alphaDeg * Math.PI) / 180;

  const geo = useMemo(() => {
    if (!colors) return null;
    const load = panels.map((p, k) => Math.abs(gamma[k] ?? 0) / Math.max(1e-9, p.chord));
    const sorted = [...load].sort((u, v) => u - v);
    const hi = sorted[Math.floor(sorted.length * 0.95)] ?? 1;
    const lo = new THREE.Color(colors["--surface"]), mid = new THREE.Color(colors["--accent"]), top = new THREE.Color("#f4f7fb");
    const pos: number[] = [], col: number[] = [];
    const P = (x: number, y: number): [number, number, number] => [(x - xMid) * scale, 0, y * scale];
    for (const side of [1, -1]) {
      panels.forEach((p, k) => {
        const t = Math.min(1, (load[k] ?? 0) / hi);
        const c = t < 0.6 ? lo.clone().lerp(mid, t / 0.6) : mid.clone().lerp(top, (t - 0.6) / 0.4);
        const [c0, c1, c2, c3] = p.corners.map((q) => P(q.x, side * q.y));
        if (!c0 || !c1 || !c2 || !c3) return;
        for (const v of side > 0 ? [c0, c1, c2, c0, c2, c3] : [c0, c2, c1, c0, c3, c2]) { pos.push(...v); col.push(c.r, c.g, c.b); }
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }, [colors, panels, gamma, xMid, scale]);

  // Vortex cores: follow the swept leading edges (sweep ≥ 45°) at 0.6 of the local semispan.
  const cores = useMemo(() => {
    if (!root) return null;
    const lePts = st.map((s) => ({ x: s.xLe, y: s.y }));
    let reach = 0;
    for (let k = 0; k + 1 < lePts.length; k++) {
      const p0 = lePts[k], p1 = lePts[k + 1];
      if (!p0 || !p1) continue;
      const sw = Math.atan2(p1.x - p0.x, p1.y - p0.y);
      if (sw >= (45 * Math.PI) / 180) reach = k + 1; else break;
    }
    if (reach === 0 || alphaDeg < 2) return null;
    const yLe = (x: number) => {
      for (let k = 0; k < reach; k++) {
        const p0 = lePts[k], p1 = lePts[k + 1];
        if (p0 && p1 && x <= p1.x) return p0.y + ((x - p0.x) / Math.max(1e-9, p1.x - p0.x)) * (p1.y - p0.y);
      }
      return lePts[reach]?.y ?? semi;
    };
    const xTe = root.xLe + root.chord;
    const xBurst = burstXi >= 0 ? xTe - burstXi * root.chord : xTe + 0.4 * root.chord;
    const height = 0.22 * Math.sqrt(Math.max(0, Math.sin(a)) / Math.sin((20 * Math.PI) / 180));
    const n = 40, tight: THREE.Vector3[] = [], burst: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const x = root.xLe + (i / n) * (xTe + 0.35 * root.chord - root.xLe);
      const ys = yLe(Math.min(x, lePts[reach]?.x ?? x));
      const v = new THREE.Vector3((x - xMid) * scale, ys * height * scale, 0.6 * ys * scale);
      (x <= xBurst ? tight : burst).push(v);
    }
    const last = tight[tight.length - 1];
    if (last) burst.unshift(last);
    return { tight, burst, burstAt: burstXi >= 0 ? (xBurst - xMid) * scale : null };
  }, [root, st, alphaDeg, a, burstXi, semi, xMid, scale]);

  if (!colors || !geo) return <div className="aspect-[4/3] w-full sm:aspect-[16/10]" />;
  const accent = colors["--accent"], warn = colors["--warning"];
  return (
    <Stage label={label} className="aspect-[4/3] w-full sm:aspect-[16/10]" camera={[7.5, 10.5, 10.5]} target={[0, 0, 0]}>
      <group rotation={[0, 0, -a]}>
        <mesh geometry={geo}><meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.55} metalness={0.15} /></mesh>
        {cores && [1, -1].map((side) => (
          <group key={side} scale={[1, 1, side]}>
            {cores.tight.length > 1 && <Line points={cores.tight} color={accent} lineWidth={3} />}
            {cores.burst.length > 1 && cores.burst.map((p, i) => (i % 3 === 0 && i > 0 ? (
              <mesh key={i} position={p} rotation={[0, 0, Math.PI / 2]}>
                <torusGeometry args={[0.04 + i * 0.009, 0.01, 6, 20]} />
                <meshBasicMaterial color={warn} transparent opacity={Math.max(0.2, 0.75 - i * 0.025)} />
              </mesh>
            ) : null))}
          </group>
        ))}
      </group>
      {[-2.4, -1.2, 0, 1.2, 2.4].map((z) => <Line key={z} points={[[-7, -0.9, z], [-4.8, -0.9, z]]} color={colors["--fg-3"]} lineWidth={1} />)}
      <gridHelper args={[16, 16, colors["--line-strong"], colors["--line"]]} position={[0, -1.2, 0]} />
    </Stage>
  );
}
