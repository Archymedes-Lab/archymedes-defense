"use client";
import { Html, RoundedBox } from "@react-three/drei";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Project } from "@/lib/portfolio";
import { fmt2 } from "@/lib/format";
import { useThemeColors } from "@/lib/hooks/use-theme-colors";
import { Stage } from "./stage";

const UNIT = 1.4; // scene height per score point

/** Seven towers: ghost = score after assets are earned, solid core = first-prototype score. 3.0 plane marks "clearly hard to copy". */
export function TowersScene({ projects }: { projects: Project[] }) {
  const colors = useThemeColors();
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  if (!colors) return <div className="aspect-[16/9] w-full" />;
  const spacing = 2.3, offset = ((projects.length - 1) * spacing) / 2;
  return (
    <Stage label="Seven projects as towers: solid core is today's prototype score, ghost is the score after assets are earned"
      className="aspect-[4/3] w-full sm:aspect-[16/8]" camera={[1.2, 5.5, 19]} narrowScale={1.5} target={[0, 2.4, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[18.5, 4]} />
        <meshStandardMaterial color={colors["--surface"]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 3 * UNIT, 0]}>
        <planeGeometry args={[18.5, 3.6]} />
        <meshBasicMaterial color={colors["--accent"]} transparent opacity={0.07} depthWrite={false} />
      </mesh>
      <Html position={[-offset - 1.6, 3 * UNIT, 0]} center>
        <span className="whitespace-nowrap font-mono text-[10.5px] text-accent">3.0 clearly hard to copy</span>
      </Html>
      {projects.map((p, i) => {
        const x = i * spacing - offset, hot = hover === p.slug;
        const gh = p.conditional * UNIT, ph = p.prototype * UNIT;
        return (
          <group key={p.slug} position={[x, 0, 0]}
            onPointerOver={(e) => { e.stopPropagation(); setHover(p.slug); document.body.style.cursor = "pointer"; }}
            onPointerOut={() => { setHover(null); document.body.style.cursor = ""; }}
            onClick={() => router.push(`/${p.slug}`)}>
            <RoundedBox args={[1.3, gh, 1.3]} radius={0.08} position={[0, gh / 2, 0]}>
              <meshStandardMaterial color={colors["--accent"]} transparent opacity={hot ? 0.32 : 0.18} depthWrite={false} />
            </RoundedBox>
            <RoundedBox args={[1.0, ph, 1.0]} radius={0.06} position={[0, ph / 2, 0]}>
              <meshStandardMaterial color={hot ? colors["--accent"] : colors["--fg-2"]} roughness={0.6} />
            </RoundedBox>
            <Html position={[0, gh + 0.4, 0]} center>
              <div className={`pointer-events-none num whitespace-nowrap font-mono text-[11px] group-data-[narrow]/stage:hidden ${hot ? "text-accent" : "text-fg-2"}`}>{fmt2(p.conditional)}</div>
            </Html>
            <Html position={[0, -0.05, 1.25]} center>
              <div className={`pointer-events-none w-[84px] text-center text-[11px] font-medium leading-tight group-data-[narrow]/stage:w-[62px] group-data-[narrow]/stage:text-[9.5px] ${i % 2 ? "group-data-[narrow]/stage:translate-y-[24px]" : ""} ${hot ? "text-accent" : "text-fg"}`}>{p.short}</div>
            </Html>
          </group>
        );
      })}
    </Stage>
  );
}
