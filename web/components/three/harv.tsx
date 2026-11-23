"use client";
import { Line } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { HARV_LEX, HARV_WING, harvPlanform } from "@/lib/aero/harv";
import { type MeshPart, buildHarvMesh } from "@/lib/aero/harv-mesh";
import { useThemeColors } from "@/lib/hooks/use-theme-colors";
import { Stage } from "./stage";

/**
 * The NASA F/A-18 HARV built from published dimensions and the traced NASA three-view (lib/aero/harv.ts), pitched
 * to the selected angle of attack about the moment reference (0.25 MAC). LEX vortex cores run from the LEX apex
 * along the edge and burst where the model places breakdown. World units: feet × 0.16; three.js y is up.
 */
const S = 0.16;
const toWorld = (x: number, y: number, z: number): [number, number, number] => [(x - 28) * S, (z - 6.9) * S, y * S];

export function HarvScene({ alphaDeg, burstXi, label }: { alphaDeg: number; burstXi: number; label: string }) {
  const colors = useThemeColors();
  const meshes = useMemo(() => {
    const m = buildHarvMesh(1);
    const byPart = new Map<MeshPart, THREE.BufferGeometry[]>();
    for (const g of m.groups) {
      const geo = new THREE.BufferGeometry();
      const p = new Float32Array(g.positions.length);
      for (let i = 0; i < g.positions.length; i += 3) {
        const [x, y, z] = toWorld(g.positions[i] ?? 0, g.positions[i + 1] ?? 0, g.positions[i + 2] ?? 0);
        p[i] = x; p[i + 1] = y; p[i + 2] = z;
      }
      geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
      geo.setIndex(g.indices);
      // Welded solids: smooth shading across curved skin, hard edges where faces meet at more than 35° (trailing
      // edges, caps, box corners).
      const shaded = toCreasedNormals(geo, (35 * Math.PI) / 180);
      geo.dispose();
      byPart.set(g.part, [...(byPart.get(g.part) ?? []), shaded]);
    }
    return byPart;
  }, []);

  const planform = useMemo(() => harvPlanform(), []);
  const pivot = toWorld(planform.xRef ?? 28, 0, HARV_WING.zFt);
  const a = (alphaDeg * Math.PI) / 180;
  const vortex = useMemo(() => {
    if (alphaDeg < 3) return null;
    const root = planform.stations[0];
    if (!root) return null;
    const xTe = root.xLe + root.chord;
    const xBurst = burstXi >= 0 ? xTe - burstXi * root.chord : xTe + 6;
    const lift = Math.sqrt(Math.max(0, Math.sin(a)) / Math.sin((25 * Math.PI) / 180));
    const tight: [number, number, number][] = [], burst: [number, number, number][] = [];
    const edgeY = (x: number) => {
      for (let k = 0; k + 1 < HARV_LEX.length; k++) {
        const p = HARV_LEX[k], q = HARV_LEX[k + 1];
        if (p && q && x <= q.x) return p.y + ((x - p.x) / (q.x - p.x)) * (q.y - p.y);
      }
      return HARV_LEX[HARV_LEX.length - 1]?.y ?? 4.4;
    };
    for (let x = HARV_LEX[0]?.x ?? 11.3; x <= 52; x += 0.6) {
      const ye = edgeY(Math.min(x, 25));
      const y = 0.82 * ye + (x > 25 ? (x - 25) * 0.06 : 0);
      const z = HARV_WING.zFt + 0.6 + (x - 11) * 0.09 * lift;
      (x <= xBurst ? tight : burst).push(toWorld(x, y, z));
    }
    const last = tight[tight.length - 1];
    if (last) burst.unshift(last);
    return { tight, burst, at: burstXi >= 0 ? toWorld(xBurst, 4, HARV_WING.zFt + 3) : null };
  }, [alphaDeg, burstXi, planform, a]);

  if (!colors) return <div className="aspect-[4/3] w-full sm:aspect-[16/10]" />;
  const mat: Record<MeshPart, THREE.MeshStandardMaterialParameters> = {
    skin: { color: "#d9dee4", roughness: 0.42, metalness: 0.12 },
    glass: { color: "#1b2a3a", roughness: 0.08, metalness: 0.6, transparent: true, opacity: 0.82 },
    dark: { color: "#14181d", roughness: 0.8, metalness: 0.1 },
    metal: { color: "#7d868f", roughness: 0.35, metalness: 0.75 },
  };
  const accent = colors["--accent"], warn = colors["--warning"];
  return (
    <Stage label={label} className="aspect-[4/3] w-full sm:aspect-[16/10]" camera={[8.5, 5.5, 11]} target={[0, 0.4, 0]} fov={34}>
      <group position={pivot}>
        <group rotation={[0, 0, -a]}>
          <group position={[-pivot[0], -pivot[1], -pivot[2]]}>
            {[...meshes.entries()].flatMap(([part, geos]) => geos.map((g, i) => (
              <mesh key={`${part}${i}`} geometry={g}><meshStandardMaterial {...mat[part]} side={THREE.DoubleSide} /></mesh>
            )))}
            {vortex && [1, -1].map((side) => (
              <group key={side} scale={[1, 1, side]}>
                {vortex.tight.length > 1 && <Line points={vortex.tight} color={accent} lineWidth={3} />}
                {vortex.burst.map((p, i) => (i % 2 === 1 ? (
                  <mesh key={i} position={p} rotation={[0, Math.PI / 2, 0]}>
                    <torusGeometry args={[0.05 + i * 0.012, 0.008, 6, 20]} />
                    <meshBasicMaterial color={warn} transparent opacity={Math.max(0.2, 0.8 - i * 0.03)} />
                  </mesh>
                ) : null))}
              </group>
            ))}
          </group>
        </group>
      </group>
      {[-1.2, -0.6, 0, 0.6, 1.2].map((z) => <Line key={z} points={[[-6.5, -0.2, z], [-5.2, -0.2, z]]} color={colors["--fg-3"]} lineWidth={1} />)}
      <gridHelper args={[16, 32, colors["--line-strong"], colors["--line"]]} position={[0, -3.6, 0]} /> {/* below the tail at high α */}
    </Stage>
  );
}
