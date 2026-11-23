import "server-only";
import data from "./data/portfolio.json";

export type Dims = Record<"defensibility" | "leverage" | "impact" | "quality" | "confidence" | "urgency" | "reach" | "reversibility" | "effort", number>;
import type { Status } from "./format";
export type { Status };
export interface Project {
  id: string; slug: string; short: string; name: string; moat: string; status: Status; statusNote: string;
  prototype: number; conditional: number; effort: number; milestone: string; gate: string; buyer: string;
  offer: string; sources: string[]; dims: { prototype: Dims; milestone: Dims };
}
export interface Portfolio {
  levels: string[]; criteria: string[]; question: string;
  agreement: { prototype: number; milestone: number }; projects: Project[];
}

export const portfolio = data as Portfolio;
export const projects = portfolio.projects;
export const projectBySlug = (slug: string) => projects.find((p) => p.slug === slug);
export const DIM_ORDER: (keyof Dims)[] = ["defensibility", "leverage", "impact", "quality", "confidence", "urgency", "reach", "reversibility", "effort"];
export const DIM_LABEL: Record<keyof Dims, string> = {
  defensibility: "Defensibility", leverage: "Leverage", impact: "Impact", quality: "Quality", confidence: "Confidence",
  urgency: "Urgency", reach: "Reach", reversibility: "Reversibility", effort: "Effort (cost)",
};
export { fmt2, STATUS_LABEL } from "./format";
