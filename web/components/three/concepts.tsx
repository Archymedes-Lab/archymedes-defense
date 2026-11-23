"use client";
import { Html, Line, RoundedBox } from "@react-three/drei";
import { useMemo } from "react";
import { CatmullRomCurve3, Vector3 } from "three";
import type { Palette } from "@/lib/hooks/use-theme-colors";
import { useThemeColors } from "@/lib/hooks/use-theme-colors";
import { Stage } from "./stage";

export type ConceptKind = "ai-evaluation" | "subsea" | "provenance" | "qualification" | "fleet";

function Label({ at, children, tone = "fg" }: { at: [number, number, number]; children: React.ReactNode; tone?: "fg" | "accent" }) {
  return (
    <Html position={at} center>
      <div className={`pointer-events-none whitespace-nowrap  border border-line bg-raised/90 px-1.5 py-0.5 font-mono text-[10.5px] backdrop-blur group-data-[narrow]/stage:px-1 group-data-[narrow]/stage:text-[9px] ${tone === "accent" ? "text-accent" : "text-fg"}`}>{children}</div>
    </Html>
  );
}

/** Deterministic pseudo-random so the illustration is stable between renders. */
const rnd = (i: number) => { const x = Math.sin(i * 9301 + 49297) * 233280; return x - Math.floor(x); };

function Evaluation({ c }: { c: Palette }) {
  const tiles = Array.from({ length: 6 * 5 }, (_, i) => ({ i, x: (i % 6) - 2.5, z: Math.floor(i / 6) - 2, h: 0.4 + rnd(i) * 1.6, flag: [7, 16, 23].includes(i) }));
  return (
    <>
      <RoundedBox args={[8.4, 0.3, 7.2]} radius={0.12} position={[0, -0.15, 0]}><meshStandardMaterial color={c["--line"]} /></RoundedBox>
      {tiles.map((t) => (
        <RoundedBox key={t.i} args={[1.05, t.h, 1.05]} radius={0.06} position={[t.x * 1.25, t.h / 2, t.z * 1.25]}>
          <meshStandardMaterial color={t.flag ? c["--critical"] : t.h > 1.2 ? c["--accent"] : c["--fg-3"]} roughness={0.5} />
        </RoundedBox>
      ))}
      <Label at={[0, 3, -3.6]}>private benchmark suite · each block one task</Label>
      <Label at={[tiles[16]!.x * 1.25, tiles[16]!.h + 0.6, tiles[16]!.z * 1.25]} tone="accent">regression vs last release</Label>
    </>
  );
}

function Subsea({ c }: { c: Palette }) {
  const curve = useMemo(() => new CatmullRomCurve3([new Vector3(-9, 0.6, -2), new Vector3(-4, 0.25, 1.5), new Vector3(0, 0.2, -0.5), new Vector3(4, 0.3, 2), new Vector3(9, 0.5, 0)]), []);
  const pts = useMemo(() => curve.getPoints(120).map((p) => [p.x, p.y, p.z] as [number, number, number]), [curve]);
  const sensing = [0.22, 0.48, 0.71].map((u) => curve.getPointAt(u));
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[22, 12, 40, 20]} /><meshStandardMaterial color={c["--surface"]} wireframe={false} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 4, 0]}><planeGeometry args={[22, 12]} /><meshBasicMaterial color={c["--c1"]} transparent opacity={0.06} depthWrite={false} /></mesh>
      <Line points={pts} color={c["--fg"]} lineWidth={3} />
      <RoundedBox args={[1.6, 1.4, 1.6]} radius={0.08} position={[-9.6, 0.7, -2]}><meshStandardMaterial color={c["--fg-3"]} /></RoundedBox>
      <Label at={[-9.6, 2, -2]}>landing station</Label>
      {sensing.map((p, i) => (
        <group key={i} position={[p.x, p.y, p.z]}>
          <mesh><sphereGeometry args={[0.28, 20, 14]} /><meshStandardMaterial color={c["--c2"]} emissive={c["--c2"]} emissiveIntensity={0.3} /></mesh>
          <Label at={[0, 0.9, 0]}>{["vibration event", "strain change", "anchor drag"][i]}</Label>
        </group>
      ))}
      <Label at={[0, 4.4, 0]} tone="accent">sea surface · fiber sensing along the cable</Label>
    </>
  );
}

function Provenance({ c }: { c: Palette }) {
  const chips: [number, number, number, number][] = [[-2.5, -1, 1.6, 1.2], [0, -1.2, 1.2, 1.2], [2.4, -0.8, 1.4, 0.9], [-1.8, 1.4, 0.8, 0.8], [0.6, 1.3, 2, 0.9], [2.8, 1.5, 0.7, 0.7]];
  const chain: { at: [number, number, number]; label: string }[] = [
    { at: [-4.5, 3.2, -2.5], label: "manufacturer lot" }, { at: [-1.5, 3.8, -2.5], label: "distributor" },
    { at: [1.5, 3.8, -2.5], label: "inspection lab" }, { at: [4.5, 3.2, -2.5], label: "defense supplier" },
  ];
  return (
    <>
      <RoundedBox args={[8, 0.16, 5]} radius={0.06} position={[0, 0.08, 0]}><meshStandardMaterial color={c["--c3"]} roughness={0.7} /></RoundedBox>
      {chips.map(([x, z, w, d], i) => (
        <RoundedBox key={i} args={[w, 0.28, d]} radius={0.04} position={[x, 0.3, z]}><meshStandardMaterial color={i === 1 ? c["--accent"] : c["--fg-2"]} /></RoundedBox>
      ))}
      <Line points={chain.map((n) => n.at)} color={c["--accent"]} lineWidth={2} />
      <Line points={[chain[2]!.at, [0, 0.5, -1.2]]} color={c["--accent"]} lineWidth={1} dashed dashSize={0.2} gapSize={0.15} />
      {chain.map((n) => (
        <group key={n.label} position={n.at}>
          <mesh><sphereGeometry args={[0.22, 20, 14]} /><meshStandardMaterial color={c["--accent"]} /></mesh>
          <Label at={[0, 0.6, 0]}>{n.label}</Label>
        </group>
      ))}
      <Label at={[0, 1.1, -1.2]} tone="accent">part under verification</Label>
    </>
  );
}

function Qualification({ c }: { c: Palette }) {
  const nodes: { id: string; at: [number, number, number]; tone: string }[] = [
    { id: "process spec", at: [-5, 1, 0], tone: c["--fg-2"] }, { id: "build lot A", at: [-1.8, 2.4, -1.6], tone: c["--fg-2"] },
    { id: "build lot B", at: [-1.8, 0.6, 1.8], tone: c["--fg-2"] }, { id: "CT scan", at: [1.6, 3, -2], tone: c["--c1"] },
    { id: "tensile test", at: [1.6, 1.2, 0], tone: c["--c1"] }, { id: "fatigue test", at: [1.6, 0.4, 2.4], tone: c["--c1"] },
    { id: "accepted", at: [5, 2.2, -0.8], tone: c["--good"] }, { id: "rejected", at: [5, 0.6, 1.8], tone: c["--critical"] },
  ];
  const edges: [number, number][] = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 4], [2, 5], [3, 6], [4, 6], [5, 7]];
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 0]}><planeGeometry args={[14, 9]} /><meshStandardMaterial color={c["--surface"]} /></mesh>
      {edges.map(([a, b], i) => <Line key={i} points={[nodes[a]!.at, nodes[b]!.at]} color={c["--fg-3"]} lineWidth={1.5} />)}
      {nodes.map((n) => (
        <group key={n.id} position={n.at}>
          <mesh><icosahedronGeometry args={[0.32, 1]} /><meshStandardMaterial color={n.tone} flatShading /></mesh>
          <Label at={[0, 0.65, 0]}>{n.id}</Label>
        </group>
      ))}
    </>
  );
}

function Fleet({ c }: { c: Palette }) {
  const units = Array.from({ length: 12 }, (_, i) => ({ i, x: (i % 4) * 2.6 - 3.9, z: Math.floor(i / 4) * 2.6 - 2.6 }));
  const due = new Set([2, 7]), repaired = new Set([5]);
  return (
    <>
      <RoundedBox args={[12, 0.3, 8.6]} radius={0.12} position={[0, -0.15, 0]}><meshStandardMaterial color={c["--line"]} /></RoundedBox>
      {units.map((u) => {
        const tone = due.has(u.i) ? c["--critical"] : repaired.has(u.i) ? c["--good"] : c["--fg-3"];
        return (
          <group key={u.i} position={[u.x, 0, u.z]}>
            <RoundedBox args={[1.8, 1.1, 1.2]} radius={0.08} position={[0, 0.55, 0]}><meshStandardMaterial color={c["--fg-2"]} /></RoundedBox>
            <mesh position={[0.6, 1.25, 0]}><cylinderGeometry args={[0.09, 0.09, 0.4, 10]} /><meshStandardMaterial color={c["--fg-3"]} /></mesh>
            <mesh position={[-0.5, 1.16, 0]}><sphereGeometry args={[0.13, 16, 12]} /><meshStandardMaterial color={tone} emissive={tone} emissiveIntensity={0.3} /></mesh>
          </group>
        );
      })}
      <Label at={[units[2]!.x, 2, units[2]!.z]} tone="accent">predicted failure</Label>
      <Label at={[units[5]!.x, 2, units[5]!.z]}>repair confirmed</Label>
      <Label at={[0, 2.6, -4.6]}>auxiliary generators · one equipment class</Label>
    </>
  );
}

const SCENES: Record<ConceptKind, { el: (c: Palette) => React.ReactNode; camera: [number, number, number]; target: [number, number, number] }> = {
  "ai-evaluation": { el: (c) => <Evaluation c={c} />, camera: [9, 9, 11], target: [0, 0.8, 0] },
  subsea: { el: (c) => <Subsea c={c} />, camera: [5, 11, 19], target: [0, 1, 0] },
  provenance: { el: (c) => <Provenance c={c} />, camera: [7, 8, 10], target: [0, 1.6, 0] },
  qualification: { el: (c) => <Qualification c={c} />, camera: [5, 6, 12], target: [0, 1.4, 0] },
  fleet: { el: (c) => <Fleet c={c} />, camera: [9, 9, 11], target: [0, 0.6, 0] },
};

export function ConceptScene({ kind, label }: { kind: ConceptKind; label: string }) {
  const colors = useThemeColors();
  if (!colors) return <div className="aspect-[4/3] w-full" />;
  const s = SCENES[kind];
  return (
    <Stage label={label} className="aspect-[16/10] w-full" camera={s.camera} target={s.target}>
      {s.el(colors)}
    </Stage>
  );
}
