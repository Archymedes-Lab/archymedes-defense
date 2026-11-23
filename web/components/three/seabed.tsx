"use client";
import { Html, Line } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import { DoubleSide, PlaneGeometry, SRGBColorSpace, type Texture, TextureLoader } from "three";
import { useThemeColors } from "@/lib/hooks/use-theme-colors";
import type { Params, SubseaModel } from "@/lib/subsea-model";
import { segState } from "@/lib/subsea-model";
import type { Vessel } from "@/components/subsea/map";
import { Stage } from "./stage";

const W = 40;
const SEA_K = 0.011;   // scene units per metre of water depth (about 100x vertical exaggeration)
const LAND_K = 0.006;  // land is flattened so relief reads as seabed, not hills
const R = 6378137;
const mx = (lon: number) => (lon * Math.PI / 180) * R;
const my = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
const lift = (d: number) => (d < 0 ? d * SEA_K : Math.min(d, 120) * LAND_K);

export function SeabedScene({ model, params, vessels }: { model: SubseaModel; params: Params; vessels: Vessel[] }) {
  const colors = useThemeColors();
  const [heights, setHeights] = useState<Float32Array | null>(null);
  const [tex, setTex] = useState<Texture | null>(null);
  const { width: tw, height: th } = model.terrain;
  const H = (W * th) / tw;
  const [x0, y0, x1, y1] = model.bbox;
  const project = useMemo(() => {
    const X0 = mx(x0), X1 = mx(x1), Y0 = my(y0), Y1 = my(y1);
    return (lon: number, lat: number) => [((mx(lon) - X0) / (X1 - X0)) * W - W / 2, ((Y1 - my(lat)) / (Y1 - Y0)) * H - H / 2] as const;
  }, [x0, x1, y0, y1, H]);

  useEffect(() => {
    let live = true;
    fetch("/subsea/terrain.bin").then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => { if (live && b.byteLength === tw * th * 4) setHeights(new Float32Array(b)); }).catch(() => {});
    new TextureLoader().load("/subsea/terrain.jpg", (t) => { t.colorSpace = SRGBColorSpace; t.anisotropy = 4; if (live) setTex(t); });
    return () => { live = false; };
  }, [tw, th]);

  const geometry = useMemo(() => {
    if (!heights) return null;
    const g = new PlaneGeometry(W, H, tw - 1, th - 1);
    g.rotateX(-Math.PI / 2);
    // Two passes of a 3x3 box blur: keeps the basin shape, drops single-cell spikes that exaggeration magnifies.
    let h = heights;
    for (let pass = 0; pass < 2; pass++) {
      const o = new Float32Array(h.length);
      for (let r = 0; r < th; r++) for (let c = 0; c < tw; c++) {
        let s = 0, n = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < th && cc >= 0 && cc < tw) { s += h[rr * tw + cc]!; n++; }
        }
        o[r * tw + c] = s / n;
      }
      h = o;
    }
    const pos = g.attributes.position!;
    for (let i = 0; i < pos.count; i++) pos.setY(i, lift(h[i]!));
    g.computeVertexNormals();
    return g;
  }, [heights, H, tw, th]);

  const lines = useMemo(() => {
    if (!colors) return [];
    const tone = { exposed: colors["--critical"], reach: colors["--accent"], deep: colors["--fg-3"] };
    const out: { key: string; pts: [number, number, number][]; color: string; width: number }[] = [];
    for (const c of model.cables) {
      if (!c.named || c.lengthKm < 5) continue;
      c.parts.forEach((part, pi) => {
        let run: [number, number, number][] = [], state: keyof typeof tone | null = null;
        const flush = () => { if (run.length > 1 && state) out.push({ key: `${c.id}-${pi}-${out.length}`, pts: run, color: tone[state], width: state === "exposed" ? 3 : 1.6 }); };
        part.forEach((s) => {
          const st = segState(s, params, model.trafficP90);
          const [x, z] = project(s[0], s[1]);
          const p: [number, number, number] = [x, lift(s[2] ?? 0) + 0.05, z];
          if (st !== state) { if (run.length) { run.push(p); flush(); } run = [p]; state = st; } else run.push(p);
        });
        flush();
      });
    }
    return out;
  }, [model, params, colors, project]);

  if (!colors) return <div className="aspect-[16/9] w-full" />;
  const flagged = vessels.filter((v) => v.flag);
  return (
    <Stage label="3D seabed of the Gulf of Finland from EMODnet bathymetry with Sentinel-2 land, undersea assets coloured by threat corridor and AIS contacts over infrastructure"
      className="aspect-[4/3] w-full sm:aspect-[16/8]" camera={[0, 15, 17]} target={[0, -0.6, 0]}>
      {geometry && (
        <mesh geometry={geometry}>
          {tex ? <meshStandardMaterial map={tex} roughness={0.95} metalness={0} side={DoubleSide} /> : <meshStandardMaterial color={colors["--surface"]} />}
        </mesh>
      )}
      {lines.map((l) => <Line key={l.key} points={l.pts} color={l.color} lineWidth={l.width} />)}
      {flagged.map((v) => {
        const [x, z] = project(v.lon, v.lat);
        return (
          <mesh key={v.mmsi} position={[x, 0.35, z]}>
            <boxGeometry args={[0.16, 0.7, 0.16]} />
            <meshBasicMaterial color={v.flag === "attention" ? colors["--critical"] : colors["--warning"]} />
          </mesh>
        );
      })}
      {[["Helsinki", 24.94, 60.17], ["Tallinn", 24.75, 59.44], ["Kotka", 26.94, 60.47], ["Narva-Jõesuu", 28.04, 59.46]].map(([n, lon, lat]) => {
        const [x, z] = project(lon as number, lat as number);
        return (
          <Html key={n as string} position={[x, 0.5, z]} center>
            <div className="pointer-events-none whitespace-nowrap border border-line bg-bg/80 px-1 py-px font-mono text-[9.5px] uppercase tracking-[0.08em] text-fg-2">{n}</div>
          </Html>
        );
      })}
    </Stage>
  );
}
