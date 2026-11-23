import { describe, expect, test } from "bun:test";
import type { Cable, Sample } from "../lib/subsea-model";
import { covered, segState, sum, tally } from "../lib/subsea-model";

const P90 = 5;
const s = (lon: number, depth: number | null, traffic: number, shore: number | null): Sample => [lon, 60, depth, traffic, traffic, shore];
const cable = (parts: Sample[][]): Cable => ({ id: "t", name: "T", kind: "power", named: true, operator: null, lengthKm: 0, parts });

describe("segment state", () => {
  test("depth beyond reach is deep regardless of traffic", () => {
    expect(segState(s(0, -120, 50, 0), { reachM: 100, rangeKm: 50 }, P90)).toBe("deep");
  });
  test("in reach with heavy traffic is exposed; light traffic is reach", () => {
    expect(segState(s(0, -60, 5, 0), { reachM: 100, rangeKm: 50 }, P90)).toBe("exposed");
    expect(segState(s(0, -60, 4.9, 0), { reachM: 100, rangeKm: 50 }, P90)).toBe("reach");
  });
  test("unknown or on-land depth is treated as reachable, never silently safe", () => {
    expect(segState(s(0, null, 0, 0), { reachM: 20, rangeKm: 50 }, P90)).toBe("reach");
    expect(segState(s(0, 2, 0, 0), { reachM: 20, rangeKm: 50 }, P90)).toBe("reach");
  });
  test("coverage needs a reachable landing within range", () => {
    expect(covered(s(0, -50, 0, 49.9), { reachM: 100, rangeKm: 50 })).toBe(true);
    expect(covered(s(0, -50, 0, 50.1), { reachM: 100, rangeKm: 50 })).toBe(false);
    expect(covered(s(0, -50, 0, null), { reachM: 100, rangeKm: 500 })).toBe(false);
  });
});

describe("tally", () => {
  // three ~0.5 km segments along 60N: heavy-traffic middle point, far end beyond fiber range
  const c = cable([[s(24.0, -40, 0, 0), s(24.009, -60, 9, 0.5), s(24.018, -60, 0, 1.0), s(24.027, -130, 0, 60)]]);
  const t = tally(c, { reachM: 100, rangeKm: 50 }, P90);
  test("lengths add up and a short exposed crossing is not averaged away", () => {
    expect(t.km).toBeCloseTo(1.5, 1);
    expect(t.exposedKm).toBeCloseTo(1.0, 1);      // both segments touching the heavy point
    expect(t.reachKm).toBeCloseTo(1.5, 1);        // last segment has one reachable end
    expect(t.coveredKm).toBeCloseTo(1.0, 1);      // last segment's far end is 60 km out
    expect(t.exposedCoveredKm).toBeCloseTo(1.0, 1);
  });
  test("shrinking reach removes exposure; sum combines cables", () => {
    const shallow = tally(c, { reachM: 30, rangeKm: 50 }, P90);
    expect(shallow.exposedKm).toBe(0);
    expect(sum([t, t]).km).toBeCloseTo(3.0, 1);
  });
});
