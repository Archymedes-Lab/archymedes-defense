import type { Cause } from "./causes";

export interface Alarm { device: string; cause: Cause; onset: number; raised: number; cleared: number | null; evidence: Record<string, unknown>; }
export interface TruthEpisode { device: string; kind: string; start: number; end: number; }
export interface ScoreSummary { episodes: number; classified: number; alarm_overlap: number; false_alarms: number; false_alarm_minutes: number; duplicate_alarms: number; median_detect_latency_s: number | null; }
export interface RunResult {
  ok: true; mode: "synthetic" | "uploaded"; seed: number | null; receipts: number;
  status: { sitewatch: string; naive: string }; deviceStates: Record<string, string>; outsideScope: number;
  timeline: { minutes: number; devices: string[]; heartbeatS: Record<string, number>; value: Record<string, (number | null)[]>; count: Record<string, number[]> };
  sitewatch: Alarm[]; naive: Alarm[]; truth?: TruthEpisode[]; score?: { sitewatch: ScoreSummary; naive: ScoreSummary };
}
export interface RunError { ok: false; error: string; line?: number | null }
export type View = "sitewatch" | "naive" | "truth";
