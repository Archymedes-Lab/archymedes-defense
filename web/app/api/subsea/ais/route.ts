import { nearestCable, subsea } from "@/lib/subsea";

/**
 * Live vessel positions over the study area from Fintraffic Digitraffic (open data, CC BY 4.0),
 * annotated with distance to the nearest mapped cable. Sign-in is enforced by proxy.ts.
 *
 * Invariants: one upstream request per minute per instance at most (shared in-flight promise),
 * bounded response size and timeout, positions older than 30 minutes dropped, failures reported
 * as AIS_UNAVAILABLE rather than stale data dressed up as live.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://meri.digitraffic.fi/api/ais/v1";
const HEADERS = { "Digitraffic-User": "archymedes-defense/0.1", "Accept-Encoding": "gzip" };
const POS_TTL_MS = 60_000, META_TTL_MS = 30 * 60_000, MAX_AGE_MS = 30 * 60_000, TIMEOUT_MS = 10_000, MAX_BYTES = 8 * 1024 * 1024;
const NEAR_KM = 1.0;
const [LON0, LAT0, LON1, LAT1] = subsea.bbox;

type Vessel = { mmsi: number; name: string | null; type: number | null; lon: number; lat: number; sog: number | null; cog: number | null;
  navStat: number | null; ageS: number; cableKm: number | null; cable: string | null; depthM: number | null; flag: "attention" | "over" | null };
type Payload = { ok: true; fetchedAt: string; sourceUpdated: string | null; vessels: Vessel[]; counts: { total: number; over: number; attention: number } };

let cache: { at: number; body: Payload } | null = null;
let meta: { at: number; byMmsi: Map<number, { name: string | null; type: number | null }> } | null = null;
let inflight: Promise<Payload> | null = null;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error("upstream too large");
  return JSON.parse(text);
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

async function vesselMeta() {
  if (meta && Date.now() - meta.at < META_TTL_MS) return meta.byMmsi;
  const list = await getJson(`${BASE}/vessels`);
  const byMmsi = new Map<number, { name: string | null; type: number | null }>();
  if (Array.isArray(list)) {
    for (const v of list.slice(0, 20_000)) {
      const m = num((v as { mmsi?: unknown }).mmsi);
      if (m === null) continue;
      const name = (v as { name?: unknown }).name;
      byMmsi.set(m, { name: typeof name === "string" ? name.trim().slice(0, 40) || null : null, type: num((v as { shipType?: unknown }).shipType) });
    }
  }
  meta = { at: Date.now(), byMmsi };
  return byMmsi;
}

/**
 * Heuristic only. "over": within ~1 km of a mapped cable in 10-100 m of water (anchor reach, but not a quay;
 * moored ships are excluded because cable landings sit next to harbours).
 * "attention": over a cable and either reporting "at anchor" while moving 1.5-8 kn, or a cargo/tanker
 * creeping at 0.3-3 kn. Both patterns preceded public anchor-drag cases; both also happen innocently.
 */
function flagFor(navStat: number | null, sog: number | null, type: number | null, near: { km: number; depth: number | null } | null): Vessel["flag"] {
  if (!near || near.km > NEAR_KM || navStat === 5 || near.depth === null || near.depth > -10 || near.depth < -100) return null;
  const heavy = type !== null && type >= 70 && type <= 89;
  if (sog !== null && ((navStat === 1 && sog >= 1.5 && sog <= 8) || (heavy && sog >= 0.3 && sog <= 3))) return "attention";
  return "over";
}

async function refresh(): Promise<Payload> {
  const [loc, byMmsi] = await Promise.all([getJson(`${BASE}/locations`), vesselMeta().catch(() => new Map())]);
  const feats = (loc as { features?: unknown[] }).features;
  if (!Array.isArray(feats)) throw new Error("unexpected upstream shape");
  const now = Date.now(), vessels: Vessel[] = [];
  for (const f of feats.slice(0, 20_000)) {
    const g = (f as { geometry?: { coordinates?: unknown[] } }).geometry?.coordinates, pr = (f as { properties?: Record<string, unknown> }).properties ?? {};
    const lon = num(g?.[0]), lat = num(g?.[1]), mmsi = num(pr.mmsi), ts = num(pr.timestampExternal);
    if (lon === null || lat === null || mmsi === null || lon < LON0 || lon > LON1 || lat < LAT0 || lat > LAT1) continue;
    if (ts === null || now - ts > MAX_AGE_MS) continue;
    const sogRaw = num(pr.sog), cogRaw = num(pr.cog), navStat = num(pr.navStat);
    const sog = sogRaw !== null && sogRaw < 102.3 ? sogRaw : null, cog = cogRaw !== null && cogRaw < 360 ? cogRaw : null;
    const m = byMmsi.get(mmsi) ?? { name: null, type: null };
    const near = nearestCable(lon, lat);
    vessels.push({ mmsi, name: m.name, type: m.type, lon: +lon.toFixed(5), lat: +lat.toFixed(5), sog, cog, navStat,
      ageS: Math.round((now - ts) / 1000), cableKm: near ? +near.km.toFixed(2) : null, cable: near?.name ?? null,
      depthM: near?.depth ?? null, flag: flagFor(navStat, sog, m.type, near) });
  }
  const sourceUpdated = typeof (loc as { dataUpdatedTime?: unknown }).dataUpdatedTime === "string" ? (loc as { dataUpdatedTime: string }).dataUpdatedTime : null;
  return { ok: true, fetchedAt: new Date(now).toISOString(), sourceUpdated, vessels,
    counts: { total: vessels.length, over: vessels.filter((v) => v.flag).length, attention: vessels.filter((v) => v.flag === "attention").length } };
}

export async function GET() {
  if (cache && Date.now() - cache.at < POS_TTL_MS) return Response.json(cache.body, { headers: { "Cache-Control": "private, no-store" } });
  inflight ??= refresh().finally(() => { inflight = null; });
  try {
    const body = await inflight;
    cache = { at: Date.now(), body };
    return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ ok: false, error: "AIS_UNAVAILABLE" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
