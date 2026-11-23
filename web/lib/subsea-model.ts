/**
 * Subsea exposure model. Pure functions shared by the server render and the interactive explorer.
 *
 * A sample is one point every ~1 km along a mapped cable or pipeline:
 *   [lon, lat, depth m (negative = below sea level), cargo+tanker hours/km²/month, all-ship hours/km²/month,
 *    along-cable km to the nearest shore landing (null if no landing is reachable)]
 *
 * Assumptions (stated on the page, adjustable there):
 *   - an anchor can reach the cable wherever the water is no deeper than `reachM`
 *   - "heavy traffic" means cargo + tanker density at or above the 90th percentile of sea cells in the area
 *   - a fiber-sensing interrogator at each shore landing covers `rangeKm` of cable outward
 * None of this is a measured hazard or a prediction of incidents.
 */
export type Sample = [number, number, number | null, number, number, number | null];
export type Kind = "power" | "telecom" | "pipeline" | "cable";
export interface Cable { id: string; name: string | null; kind: Kind; named: boolean; operator: string | null; lengthKm: number; parts: Sample[][] }
export interface SubseaModel {
  bbox: [number, number, number, number]; built: string; stepKm: number; trafficP90: number; osmTimestamp: string | null;
  terrain: { width: number; height: number; min: number; max: number; satellite: boolean };
  seaDepth: { median: number; p95: number; max: number }; cables: Cable[];
}
export interface Params { reachM: number; rangeKm: number }
export const DEFAULTS: Params = { reachM: 100, rangeKm: 50 };

export type SegState = "exposed" | "reach" | "deep";
export function segState(s: Sample, p: Params, p90: number): SegState {
  const d = s[2];
  if (d === null || d >= 0) return "reach";
  if (-d > p.reachM) return "deep";
  return s[3] >= p90 ? "exposed" : "reach";
}
export const covered = (s: Sample, p: Params) => s[5] !== null && s[5] <= p.rangeKm;

export interface Totals { km: number; reachKm: number; exposedKm: number; exposedCoveredKm: number; coveredKm: number }
export interface CableRow extends Totals { id: string; name: string; kind: Kind; medianDepth: number | null; maxDepth: number | null; peakTraffic: number }

function segments(c: Cable): [Sample, Sample][] {
  return c.parts.flatMap((p) => p.slice(1).map((b, i) => [p[i]!, b] as [Sample, Sample]));
}
function segKm(a: Sample, b: Sample): number {
  const r = Math.PI / 180, x = (b[0] - a[0]) * r * Math.cos(((a[1] + b[1]) / 2) * r), y = (b[1] - a[1]) * r;
  return Math.hypot(x, y) * 6371.0088;
}

/** Each segment takes the state of its worse end, so a short exposed crossing is never averaged away. */
export function tally(c: Cable, p: Params, p90: number): Totals {
  const t: Totals = { km: 0, reachKm: 0, exposedKm: 0, exposedCoveredKm: 0, coveredKm: 0 };
  for (const [a, b] of segments(c)) {
    const km = segKm(a, b), sa = segState(a, p, p90), sb = segState(b, p, p90);
    const exposed = sa === "exposed" || sb === "exposed", reach = exposed || sa === "reach" || sb === "reach";
    const cov = covered(a, p) && covered(b, p);
    t.km += km; if (reach) t.reachKm += km; if (exposed) t.exposedKm += km; if (cov) t.coveredKm += km; if (exposed && cov) t.exposedCoveredKm += km;
  }
  return t;
}

export function sum(rows: Totals[]): Totals {
  return rows.reduce((a, r) => ({ km: a.km + r.km, reachKm: a.reachKm + r.reachKm, exposedKm: a.exposedKm + r.exposedKm,
    exposedCoveredKm: a.exposedCoveredKm + r.exposedCoveredKm, coveredKm: a.coveredKm + r.coveredKm }),
  { km: 0, reachKm: 0, exposedKm: 0, exposedCoveredKm: 0, coveredKm: 0 });
}

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

export function cableRows(m: SubseaModel, p: Params): CableRow[] {
  return m.cables.filter((c) => c.named && c.lengthKm >= 5).map((c) => {
    const pts = c.parts.flat(), depths = pts.flatMap((s) => (s[2] !== null && s[2] < 0 ? [-s[2]] : []));
    return { id: c.id, name: c.name!, kind: c.kind, ...tally(c, p, m.trafficP90), medianDepth: median(depths),
      maxDepth: depths.length ? Math.max(...depths) : null, peakTraffic: Math.max(...pts.map((s) => s[3])) };
  });
}

export const KIND_LABEL: Record<Kind, string> = { power: "Power", telecom: "Telecom", pipeline: "Pipeline", cable: "Cable" };
