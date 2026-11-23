"use client";
import dynamic from "next/dynamic";

const box = (cls: string) => () => <div className={`${cls} w-full animate-pulse  bg-surface`} />;

export const TowersScene = dynamic(() => import("./towers").then((m) => m.TowersScene), { ssr: false, loading: box("aspect-[16/8]") });
export const ConceptScene = dynamic(() => import("./concepts").then((m) => m.ConceptScene), { ssr: false, loading: box("aspect-[4/3]") });
export const WorldScene = dynamic(() => import("./world").then((m) => m.WorldScene), { ssr: false, loading: box("aspect-[16/9]") });
export const SiteScene = dynamic(() => import("./site-scene").then((m) => m.SiteScene), { ssr: false, loading: box("aspect-[16/9]") });
