/** Pure helpers safe for client components. Never import data files here. */
export const fmt2 = (n: number) => n.toFixed(2);

/** Sequential blue ramp (light = short life, dark = long life). */
export const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
export function rampColor(v: number, lo: number, hi: number): string {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));
  return RAMP[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))]!;
}

export type Status = "built" | "partial" | "data" | "research";
export const STATUS_LABEL: Record<Status, string> = {
  built: "Prototype built", partial: "First pass built", data: "Data in hand", research: "Research only",
};
