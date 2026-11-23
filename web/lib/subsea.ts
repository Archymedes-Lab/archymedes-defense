import "server-only";
import data from "./data/subsea.json";
import type { SubseaModel } from "./subsea-model";

export const subsea = data as unknown as SubseaModel;

/** Coarse spatial index over cable samples for the live AIS proximity check (cells of 0.05 degrees). */
const CELL = 0.05;
type Hit = { lon: number; lat: number; depth: number | null; name: string | null; kind: string };
const index = new Map<string, Hit[]>();
for (const c of subsea.cables) {
  for (const part of c.parts) {
    for (const s of part) {
      const key = `${Math.floor(s[0] / CELL)}:${Math.floor(s[1] / CELL)}`;
      let bucket = index.get(key);
      if (!bucket) index.set(key, (bucket = []));
      bucket.push({ lon: s[0], lat: s[1], depth: s[2], name: c.name, kind: c.kind });
    }
  }
}

/** Nearest mapped cable sample. Samples are ~1 km apart, so the distance can overstate the true gap by up to ~0.5 km. */
export function nearestCable(lon: number, lat: number): (Hit & { km: number }) | null {
  const cx = Math.floor(lon / CELL), cy = Math.floor(lat / CELL);
  let best: (Hit & { km: number }) | null = null;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const h of index.get(`${cx + dx}:${cy + dy}`) ?? []) {
        const x = (h.lon - lon) * Math.cos((lat * Math.PI) / 180) * 111.32, y = (h.lat - lat) * 110.57;
        const km = Math.hypot(x, y);
        if (!best || km < best.km) best = { ...h, km };
      }
    }
  }
  return best;
}
