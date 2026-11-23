"use client";
import { Html, Line } from "@react-three/drei";
import { useMemo } from "react";
import { useThemeColors } from "@/lib/hooks/use-theme-colors";
import { Stage } from "./stage";

/**
 * Exploded 3D view of the ply stack. Plies are drawn to the panel's aspect ratio; thickness is exaggerated so each ply
 * reads, and the explode factor separates them. Stitch lines sit on the strike face; the dashed axis marks the impact
 * point used by the drawing. Illustration of the construction, not a simulation of impact.
 */
export function ArmorStack({ plies, widthMm, heightMm, quiltMm, explode }: { plies: number; widthMm: number; heightMm: number; quiltMm: number; explode: number }) {
  const colors = useThemeColors();
  const W = 6, D = (W * heightMm) / widthMm, t = 0.05, gap = 0.04 + explode * 0.22;
  const n = Math.min(plies, 60);
  const stitches = useMemo(() => {
    const q = Math.max(0.25, (quiltMm / widthMm) * W * Math.SQRT2), out: [number, number, number][][] = [];
    for (let d = -D; d < W + D; d += q) {
      const seg = (sx: number, sz: number, ex: number, ez: number) => {
        // clip a diagonal to the panel rectangle
        const pts: [number, number][] = [];
        for (let s = 0; s <= 1.0001; s += 0.01) { const x = sx + (ex - sx) * s, z = sz + (ez - sz) * s; if (x >= 0 && x <= W && z >= 0 && z <= D) pts.push([x, z]); }
        if (pts.length > 1) out.push([[pts[0]![0] - W / 2, 0, pts[0]![1] - D / 2], [pts[pts.length - 1]![0] - W / 2, 0, pts[pts.length - 1]![1] - D / 2]]);
      };
      seg(d, 0, d + D, D); seg(d, D, d + D, 0);
    }
    return out;
  }, [quiltMm, widthMm, D]);
  if (!colors) return <div className="aspect-[16/10] w-full" />;
  const top = (n - 1) * (t + gap);
  return (
    <Stage label={`Exploded view of ${plies} plies`} className="aspect-[4/3] w-full sm:aspect-[16/10]" camera={[9.5, 7 + top * 0.5, 11]} target={[0, top / 2 - 0.3, 0]}>
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} position={[0, i * (t + gap), 0]}>
          <boxGeometry args={[W, t, D]} />
          <meshStandardMaterial color={i === n - 1 ? colors["--accent"] : i % 2 ? colors["--fg-3"] : colors["--surface"]} roughness={0.9} transparent opacity={i === n - 1 ? 0.95 : 0.85} />
        </mesh>
      ))}
      <group position={[0, top + t / 2 + 0.005, 0]}>
        {stitches.map((p, i) => <Line key={i} points={p} color={colors["--bg"]} lineWidth={1} dashed dashSize={0.12} gapSize={0.06} />)}
      </group>
      <Line points={[[0, top + 2.4, 0], [0, -0.6, 0]]} color={colors["--accent"]} lineWidth={1.5} dashed dashSize={0.2} gapSize={0.1} />
      <mesh position={[0, top + t / 2 + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.12, 0.17, 32]} /><meshBasicMaterial color={colors["--accent"]} /></mesh>
      <Html position={[0, top + 2.6, 0]} center>
        <div className="pointer-events-none whitespace-nowrap border border-line bg-bg/80 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-accent">Impact axis · strike face</div>
      </Html>
      <Html position={[W / 2 + 0.4, 0, D / 2]} center>
        <div className="pointer-events-none whitespace-nowrap border border-line bg-bg/80 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-fg-2">{plies} plies{plies > n ? ` (first ${n} shown)` : ""}</div>
      </Html>
    </Stage>
  );
}
