"use client";
import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

/** One consistent 3D stage: soft light, orbit without zoom (never steals page scroll), demand rendering by default. */
/** Moves the camera when the frame crosses the phone breakpoint, without remounting the canvas. */
function CameraDistance({ position }: { position: [number, number, number] }) {
  const { camera, controls, invalidate } = useThree();
  const [x, y, z] = position;
  useEffect(() => {
    camera.position.set(x, y, z);
    (controls as { update?: () => void } | null)?.update?.();
    invalidate();
  }, [camera, controls, invalidate, x, y, z]);
  return null;
}

export function Stage({ children, camera = [14, 11, 16], target = [0, 0.5, 0], animate = false, label, className = "", fov = 36, narrowScale = 1.35 }: {
  children: ReactNode; camera?: [number, number, number]; target?: [number, number, number]; animate?: boolean;
  label: string; className?: string; fov?: number; narrowScale?: number;
}) {
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setNarrow((e?.contentRect.width ?? 1000) < 560));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // HTML labels keep their pixel size, so on a phone the camera backs off to keep them inside the frame.
  const k = narrow ? narrowScale : 1;
  const cam: [number, number, number] = [0, 1, 2].map((i) => target[i]! + (camera[i]! - target[i]!) * k) as [number, number, number];
  useEffect(() => {
    try {
      const c = document.createElement("canvas");
      if (box.current) setNarrow(box.current.clientWidth < 560);
      setWebgl(!!(c.getContext("webgl2") || c.getContext("webgl")));
    } catch {
      setWebgl(false);
    }
  }, []);
  return (
    <div ref={box} data-narrow={narrow || undefined} className={`group/stage relative min-w-0 overflow-hidden ${className}`} role="img" aria-label={label}>
      {webgl === false ? (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-[13px] text-fg-2">
          This 3D view needs WebGL, which this browser did not provide. The charts on this page show the same data.
        </div>
      ) : webgl ? (
        <Canvas frameloop={animate ? "always" : "demand"} dpr={[1, 2]} camera={{ position: cam, fov }} gl={{ antialias: true, alpha: true }}>
          <hemisphereLight args={["#ffffff", "#8899aa", 1.1]} />
          <directionalLight position={[10, 18, 8]} intensity={1.1} />
          {children}
          <CameraDistance position={cam} />
          <OrbitControls target={target} enableZoom={false} enablePan={false} minPolarAngle={0.25} maxPolarAngle={1.35} makeDefault />
        </Canvas>
      ) : null}
      <div className="pointer-events-none absolute bottom-3 left-4 font-mono text-[10.5px] text-fg-3">Drag to orbit</div>
    </div>
  );
}
