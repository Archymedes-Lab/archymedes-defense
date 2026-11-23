"use client";
import { Html, RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Mesh } from "three";
import { resolveVar, useReducedMotion, useThemeColors } from "@/lib/hooks/use-theme-colors";
import { Stage } from "./stage";

const KNOWN: Record<string, [number, number]> = {
  "env-01": [-7, -5], "env-02": [-2, -6.2], "env-03": [4, -5.6], "env-04": [7.4, -1], "env-05": [7, 4.4],
  "env-06": [1.5, 6.2], "env-07": [-4.5, 5.6], "env-08": [-7.6, 1.2], "door-09": [0.6, -2.9], "hum-10": [-1.6, 1.4],
};

export interface SensorState { color: string | null; label: string | null }

function positions(devices: string[]): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  const unknown = devices.filter((d) => !KNOWN[d]);
  devices.forEach((d) => { if (KNOWN[d]) out[d] = KNOWN[d]; });
  unknown.forEach((d, i) => {
    const a = (i / Math.max(unknown.length, 1)) * Math.PI * 2;
    out[d] = [Math.cos(a) * 6.8, Math.sin(a) * 5.4];
  });
  return out;
}

function Pulse({ color, active, reduce }: { color: string; active: boolean; reduce: boolean }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const k = active && !reduce ? 1 + 0.35 * Math.sin(clock.elapsedTime * 4) : 1;
    ref.current.scale.set(k, k, k);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} visible={active}>
      <ringGeometry args={[0.55, 0.72, 40]} />
      <meshBasicMaterial color={color} transparent opacity={0.6} />
    </mesh>
  );
}

/** A small facility with ten sensors, colored by the selected engine's state at the playhead. */
export function SiteScene({ devices, states, animate }: { devices: string[]; states: Record<string, SensorState>; animate: boolean }) {
  const colors = useThemeColors();
  const reduce = useReducedMotion();
  const pos = useMemo(() => positions(devices), [devices]);
  if (!colors) return <div className="aspect-[4/3] w-full" />;
  const fence: [number, number][] = [[-9, -7], [9, -7], [9, 7], [-9, 7]];
  return (
    <Stage label="3D site model, sensors colored by diagnosis at the playhead" className="aspect-[4/3] w-full" camera={[13, 13, 17]} animate={animate && !reduce}>
      <RoundedBox args={[20, 0.4, 16]} radius={0.15} position={[0, -0.2, 0]}><meshStandardMaterial color={colors["--line"]} /></RoundedBox>
      <RoundedBox args={[6.4, 2.6, 4.2]} radius={0.08} position={[-1.2, 1.3, -0.2]}><meshStandardMaterial color={colors["--fg-3"]} /></RoundedBox>
      <RoundedBox args={[2.6, 1.5, 2.2]} radius={0.06} position={[4.6, 0.75, 1.4]}><meshStandardMaterial color={colors["--fg-3"]} /></RoundedBox>
      {fence.map(([x1, z1], i) => {
        const [x2, z2] = fence[(i + 1) % fence.length]!;
        const len = Math.hypot(x2 - x1, z2 - z1);
        return (
          <mesh key={i} position={[(x1 + x2) / 2, 0.45, (z1 + z2) / 2]} rotation={[0, -Math.atan2(z2 - z1, x2 - x1), 0]}>
            <boxGeometry args={[len, 0.9, 0.04]} />
            <meshStandardMaterial color={colors["--fg-3"]} transparent opacity={0.25} />
          </mesh>
        );
      })}
      {devices.map((d) => {
        const [x, z] = pos[d]!;
        const s = states[d];
        const c = s?.color ? resolveVar(colors, s.color) : colors["--neutral"];
        return (
          <group key={d} position={[x, 0, z]}>
            <mesh position={[0, 0.8, 0]}><cylinderGeometry args={[0.07, 0.07, 1.6, 10]} /><meshStandardMaterial color={colors["--fg-2"]} /></mesh>
            <RoundedBox args={[0.55, 0.38, 0.38]} radius={0.06} position={[0, 1.75, 0]}>
              <meshStandardMaterial color={c} emissive={s?.color ? c : "#000000"} emissiveIntensity={s?.color ? 0.35 : 0} roughness={0.45} />
            </RoundedBox>
            <Pulse color={c} active={!!s?.color} reduce={reduce} />
            <Html position={[0, 2.35, 0]} center>
              <div className="pointer-events-none whitespace-nowrap  border bg-raised/90 px-1.5 py-0.5 font-mono text-[10.5px] text-fg backdrop-blur"
                style={{ borderColor: s?.color ? c : "var(--line)" }}>
                {d}{s?.label ? ` · ${s.label}` : ""}
              </div>
            </Html>
          </group>
        );
      })}
    </Stage>
  );
}
