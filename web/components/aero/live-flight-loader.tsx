"use client";
import dynamic from "next/dynamic";

/** Client-only: the live simulation needs WebGL and requestAnimationFrame. */
export const LiveFlightLoader = dynamic(() => import("./live-flight").then((m) => m.LiveFlight), {
  ssr: false, loading: () => <div className="aspect-[16/10] w-full animate-pulse bg-surface" />,
});
