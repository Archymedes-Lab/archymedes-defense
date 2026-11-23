export type Cause = "link_lost" | "intermittent_loss" | "link_buffered" | "clock_step" | "frozen_reading" | "power_loss_reboot" | "silent" | "never_seen" | "offline";

/** Fixed categorical order (validated palette slots 1-6); silence uses the critical status color. */
export const CAUSES: Record<Cause, { label: string; color: string }> = {
  link_lost: { label: "Link lost", color: "var(--c1)" },
  intermittent_loss: { label: "Intermittent loss", color: "var(--c2)" },
  link_buffered: { label: "Link buffered", color: "var(--c3)" },
  clock_step: { label: "Clock step", color: "var(--c4)" },
  frozen_reading: { label: "Frozen reading", color: "var(--c5)" },
  power_loss_reboot: { label: "Power loss, reboot", color: "var(--c6)" },
  silent: { label: "Silent, cause pending", color: "var(--critical)" },
  never_seen: { label: "Never seen", color: "var(--critical)" },
  offline: { label: "Offline (naive)", color: "var(--neutral)" },
};
export const KIND_TO_CAUSE: Record<string, Cause> = {
  outage_lost: "link_lost", outage_buffered: "link_buffered", power_loss: "power_loss_reboot",
  flapping: "intermittent_loss", clock_step: "clock_step", stuck: "frozen_reading",
};
/** Causes Sitewatch can only name once messages resume (sequence/boot evidence arrives after the gap). */
export const RETROSPECTIVE = new Set<Cause>(["link_lost", "link_buffered", "power_loss_reboot"]);

/** Resolve a CSS custom property to a concrete color (three.js needs real values). */
export function cssColor(value: string): string {
  if (typeof window === "undefined") return "#888888";
  const m = value.match(/^var\((--[\w-]+)\)$/);
  return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]!).trim() || "#888888" : value;
}
