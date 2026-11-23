"use client";
import { useEffect, useState } from "react";

const TOKENS = ["--bg", "--surface", "--raised", "--fg", "--fg-2", "--fg-3", "--line", "--line-strong", "--accent",
  "--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--critical", "--neutral", "--good", "--warning"] as const;
export type Token = (typeof TOKENS)[number];
export type Palette = Record<Token, string>;

function read(): Palette {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(TOKENS.map((t) => [t, style.getPropertyValue(t).trim() || "#888888"])) as Palette;
}

/** Resolved design tokens for three.js materials; re-reads when the OS theme flips. */
export function useThemeColors(): Palette | null {
  const [palette, setPalette] = useState<Palette | null>(null);
  useEffect(() => {
    setPalette(read());
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setPalette(read());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return palette;
}

export function resolveVar(palette: Palette, value: string): string {
  const m = value.match(/^var\((--[\w-]+)\)$/);
  return m && m[1] && m[1] in palette ? palette[m[1] as Token] : value;
}

export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}
