"use client";
import { Html, Line } from "@react-three/drei";
import { useState } from "react";
import type { ConditionSummary } from "@/lib/battery";
import { rampColor } from "@/lib/format";
import { useThemeColors } from "@/lib/hooks/use-theme-colors";
import { Stage } from "./stage";

const SX = 3, SY = 6, SZ = 3; // charge C → x, depth of discharge → y, discharge C → z
const X = (c: number) => (c - 1.75) * SX, Y = (d: number) => d * SY, Z = (c: number) => (c - 1.5) * SZ;

/** The 63 test conditions in stress space. Color and size: median weeks until cells fell to 80% capacity. */
export function ConditionSpace({ conditions, selected, onSelect, lo, hi }: {
  conditions: ConditionSummary[]; selected: number | null; onSelect: (g: number) => void; lo: number; hi: number;
}) {
  const colors = useThemeColors();
  const [hover, setHover] = useState<number | null>(null);
  if (!colors) return <div className="aspect-[4/3] w-full" />;
  const axis = colors["--fg-3"];
  const box: [number, number, number][][] = [
    [[X(0.5), 0, Z(0.5)], [X(3), 0, Z(0.5)]], [[X(0.5), 0, Z(0.5)], [X(0.5), 0, Z(2.5)]], [[X(0.5), 0, Z(0.5)], [X(0.5), Y(1), Z(0.5)]],
    [[X(3), 0, Z(0.5)], [X(3), 0, Z(2.5)]], [[X(0.5), 0, Z(2.5)], [X(3), 0, Z(2.5)]],
  ];
  return (
    <Stage label="Test conditions plotted by charge rate, discharge rate and depth of discharge, colored by weeks to 80% capacity"
      className="aspect-[4/3] w-full" camera={[11, 8, 12]} target={[0, 2.6, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[SX * 2.5 + 1, SZ * 2 + 1]} />
        <meshStandardMaterial color={colors["--surface"]} />
      </mesh>
      {box.map((seg, i) => <Line key={i} points={seg} color={axis} lineWidth={1} />)}
      <Html position={[0, -0.2, Z(0.5) - 0.9]} center><span className="whitespace-nowrap font-mono text-[10.5px] text-fg-2">charge rate 0.5C → 3C</span></Html>
      <Html position={[X(3) + 1.1, -0.2, 0]} center><span className="whitespace-nowrap font-mono text-[10.5px] text-fg-2">discharge 0.5C → 2.5C</span></Html>
      <Html position={[X(0.5) - 0.6, Y(1), Z(0.5)]} center><span className="whitespace-nowrap font-mono text-[10.5px] text-fg-2">100% depth</span></Html>
      <Html position={[X(0.5) - 0.6, Y(0.04), Z(0.5)]} center><span className="whitespace-nowrap font-mono text-[10.5px] text-fg-2">0%</span></Html>
      {conditions.map((c) => {
        const life = c.medianTo80 ?? lo, sel = selected === c.group, hot = hover === c.group;
        const r = 0.16 + 0.26 * ((life - lo) / (hi - lo || 1));
        return (
          <group key={c.group} position={[X(c.chargeC), Y(c.dod), Z(c.dischargeC)]}>
            <Line points={[[0, 0, 0], [0, -Y(c.dod), 0]]} color={axis} lineWidth={0.5} transparent opacity={0.35} />
            <mesh onPointerOver={(e) => { e.stopPropagation(); setHover(c.group); document.body.style.cursor = "pointer"; }}
              onPointerOut={() => { setHover(null); document.body.style.cursor = ""; }} onClick={(e) => { e.stopPropagation(); onSelect(c.group); }}>
              <sphereGeometry args={[sel ? r * 1.35 : r, 24, 16]} />
              <meshStandardMaterial color={rampColor(life, lo, hi)} roughness={0.4} emissive={sel ? colors["--accent"] : "#000000"} emissiveIntensity={sel ? 0.4 : 0} />
            </mesh>
            {(hot || sel) && (
              <Html position={[0, r + 0.45, 0]} center>
                <div className="pointer-events-none whitespace-nowrap  border border-line bg-raised px-2 py-1 font-mono text-[10.5px] text-fg">
                  G{c.group} · {c.chargeC}C / {c.dischargeC}C · {Math.round(c.dod * 100)}% · {c.medianTo80?.toFixed(1) ?? "n/a"} wk
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </Stage>
  );
}
