"use client";
import { Html } from "@react-three/drei";
import { useThemeColors } from "@/lib/hooks/use-theme-colors";
import { Stage } from "./stage";

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  if (A.some(Number.isNaN) || B.some(Number.isNaN)) return t < 0.5 ? a : b;
  return "#" + A.map((x, i) => Math.round(x + (B[i]! - x) * t).toString(16).padStart(2, "0")).join("");
}

/**
 * Cells as cylinders on a plate, coloured by temperature at the chosen time, with barrier boards where placed.
 * Cell height is drawn to scale with the diameter; spacing is exaggerated ×3 so 1-2 mm gaps stay visible.
 */
export function PackScene({ rows, cols, diameterMm, lengthMm, gapMm, temps, failed, critical, barrierAfterRows, barrierAfterCols, barrierGapMm, trigger }: {
  rows: number; cols: number; diameterMm: number; lengthMm: number; gapMm: number; temps: number[]; failed: boolean[]; critical: number;
  barrierAfterRows: number[]; barrierAfterCols: number[]; barrierGapMm: number; trigger: number;
}) {
  const colors = useThemeColors();
  if (!colors) return <div className="aspect-[16/10] w-full" />;
  const s = 0.1, d = diameterMm * s, h = lengthMm * s, g = gapMm * 3 * s, bg = barrierGapMm * 3 * s;
  const xs: number[] = [], zs: number[] = [];
  let x = 0; for (let c = 0; c < cols; c++) { xs.push(x); x += d + (barrierAfterCols.includes(c) ? bg : g); }
  let z = 0; for (let r = 0; r < rows; r++) { zs.push(z); z += d + (barrierAfterRows.includes(r) ? bg : g); }
  const cx = (xs[cols - 1]! + 0) / 2, cz = (zs[rows - 1]! + 0) / 2, span = Math.max(xs[cols - 1]!, zs[rows - 1]!) + d;
  const color = (t: number) => {
    if (t <= 60) return mix(colors["--fg-3"], colors["--warning"], Math.max(0, (t - 25) / 35) * 0.4);
    if (t < critical) return mix(colors["--warning"], colors["--critical"], (t - 60) / Math.max(1, critical - 60) * 0.5);
    return mix(colors["--critical"], "#ffd7a8", Math.min(1, (t - critical) / 500));
  };
  return (
    <Stage label="3D pack: cells coloured by temperature" className="aspect-[4/3] w-full sm:aspect-[16/10]" camera={[span * 0.9 + h * 0.5, span * 0.9 + h * 1.4, span * 1.3 + h * 1.1]} target={[0, h * 0.4, 0]}>
      <mesh position={[0, -0.05, 0]}><boxGeometry args={[span + 2, 0.1, span + 2]} /><meshStandardMaterial color={colors["--surface"]} /></mesh>
      {Array.from({ length: rows * cols }, (_, i) => {
        const r = Math.floor(i / cols), c = i % cols, t = temps[i] ?? 25;
        return (
          <group key={i} position={[xs[c]! - cx, h / 2, zs[r]! - cz]}>
            <mesh><cylinderGeometry args={[d / 2, d / 2, h, 28]} /><meshStandardMaterial color={color(t)} emissive={failed[i] ? colors["--critical"] : "#000000"} emissiveIntensity={failed[i] ? 0.35 : 0} roughness={0.5} metalness={0.3} /></mesh>
          </group>
        );
      })}
      {/* One always-mounted label that moves to the trigger: mounting/unmounting drei Html per cell breaks the DOM portal. */}
      <Html position={[xs[trigger % cols]! - cx, h + 0.6, zs[Math.floor(trigger / cols)]! - cz]} center>
        <div className="pointer-events-none whitespace-nowrap border border-line bg-bg/80 px-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-critical">trigger</div>
      </Html>
      {barrierAfterRows.map((r) => r < rows - 1 && (
        <mesh key={`r${r}`} position={[0, h / 2, (zs[r]! + d + zs[r + 1]!) / 2 - cz]}><boxGeometry args={[span + 0.6, h * 1.05, bg * 0.35]} /><meshStandardMaterial color={colors["--accent"]} transparent opacity={0.55} /></mesh>
      ))}
      {barrierAfterCols.map((c) => c < cols - 1 && (
        <mesh key={`c${c}`} position={[(xs[c]! + d + xs[c + 1]!) / 2 - cx, h / 2, 0]}><boxGeometry args={[bg * 0.35, h * 1.05, span + 0.6]} /><meshStandardMaterial color={colors["--accent"]} transparent opacity={0.55} /></mesh>
      ))}
    </Stage>
  );
}
