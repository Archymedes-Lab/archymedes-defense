import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AIRCRAFT, type Aircraft, F16_TRACED_SWEEP_DEG, aircraftById } from "../lib/aero/aircraft";
import { planformProps, validatePlanform } from "../lib/aero/geometry";
import { HARV_MASS } from "../lib/aero/flight";
import { HARV_PUBLISHED } from "../lib/aero/harv";
import { analyse } from "../lib/aero/predict";
import { deg, toDeg } from "../lib/aero/units";
import flightJson from "../lib/data/aero-flight.json";
import validation from "../lib/data/aero-validation.json";
import value from "../lib/data/aero-value.json";

setDefaultTimeout(120_000);
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const get = (id: string): Aircraft => { const a = aircraftById(id); if (!a) throw new Error(id); return a; };

describe("only real aircraft, each tied to its published source", () => {
  test("the registry holds exactly the four aircraft with NASA-published geometry", () => {
    expect(AIRCRAFT.map((a) => a.id)).toEqual(["f16", "harv", "f16xl", "f106b"]);
  });

  test("every aircraft names the real airframe, its NASA programme and at least one NASA report with a table or figure", () => {
    for (const a of AIRCRAFT) {
      expect(a.airframe.length).toBeGreaterThan(8);
      expect(a.programme.length).toBeGreaterThan(8);
      expect(a.sources.length).toBeGreaterThan(0);
      for (const s of a.sources) {
        expect(s.report).toMatch(/^NASA (TM|TP|CR)[- ]/);
        expect(s.where).toMatch(/Table|Fig|p\. /);
        expect(s.url).toMatch(/^https:\/\/(ntrs\.nasa\.gov|www\.cs\.odu\.edu\/~mln\/ltrs-pdfs)\//);
      }
    }
  });

  test("every published number carries the source it was read from, and nothing is published without one", () => {
    for (const a of AIRCRAFT) {
      const reports = new Set(a.sources.map((s) => s.report));
      expect(Object.keys(a.published).length).toBeGreaterThan(4);
      for (const [key, v] of Object.entries(a.published)) {
        expect(Number.isFinite(v.value)).toBe(true);
        expect({ key, known: reports.has(v.report) }).toEqual({ key, known: true });
      }
    }
  });

  test("planforms are valid and use the published reference area and chord", () => {
    for (const a of AIRCRAFT) {
      const p = a.planform();
      expect(validatePlanform(p)).toEqual([]);
      expect(p.sRef).toBe(a.published.referenceAreaFt2?.value);
      expect(p.cRef).toBe(a.published.referenceChordFt?.value);
    }
  });
});

describe("F-106B (NASA TP-3374, TP-2747): the published numbers are mutually consistent and the planform reproduces them", () => {
  const a = get("f106b"), pub = a.published;
  test("published values are carried exactly", () => {
    expect(pub.referenceAreaFt2?.value).toBe(697.83);
    expect(pub.referenceChordFt?.value).toBe(23.75);
    expect(pub.theoreticalRootChordFt?.value).toBe(35.63);
    expect(pub.theoreticalSpanFt?.value).toBe(39.16);
    expect(pub.spanFt?.value).toBe(38.29);
    expect(pub.leadingEdgeSweepDeg?.value).toBe(60);
    expect(pub.weightLb?.value).toBe(27400);
    expect(pub.iyySlugFt2?.value).toBe(174383);
  });
  test("theoretical delta: ½ · span · root chord is the published area, ⅔ root chord the published chord, b²/S the published aspect ratio 2.20", () => {
    const b = pub.theoreticalSpanFt?.value ?? 0, cr = pub.theoreticalRootChordFt?.value ?? 0, s = pub.referenceAreaFt2?.value ?? 1;
    expect(rel(0.5 * b * cr, s)).toBeLessThan(0.001);
    expect(rel((2 / 3) * cr, pub.referenceChordFt?.value ?? 1)).toBeLessThan(0.001);
    expect((b * b) / s).toBeCloseTo(2.2, 2);
  });
  test("the planform has the published 60° leading edge, the actual span, and a trailing edge swept forward about 5°", () => {
    const p = a.planform(), props = planformProps(p);
    expect(toDeg(props.segments[0]?.sweepLe ?? deg(0))).toBeCloseTo(60, 6);
    expect(props.span).toBeCloseTo(38.29, 6);
    const te = toDeg(props.segments[0]?.sweepTe ?? deg(0));
    expect(te).toBeLessThan(-4); expect(te).toBeGreaterThan(-6);
    expect(rel(props.area, 697.83)).toBeLessThan(0.002); // cropping the tips removes 0.05% of the theoretical area
  });
  test("the planform is inside the engine's validated sweep range, but the real wing is not a sharp flat plate, and the page says so", () => {
    const r = analyse(a.planform(), { alphas: [deg(10)] });
    expect(r.domain.ok).toBe(true);
    expect(a.caveats.join(" ")).toMatch(/camber/i);
    expect(a.caveats.join(" ")).toMatch(/round|radius/i);
  });
});

describe("F-16XL-1 (NASA TP-2001-210629): cranked arrow from the published three-view", () => {
  const a = get("f16xl"), pub = a.published;
  test("published values are carried exactly", () => {
    expect(pub.referenceAreaFt2?.value).toBe(600);
    expect(pub.wingAreaFt2?.value).toBe(646.37);
    expect(pub.spanFt?.value).toBe(32.4);
    expect(pub.referenceChordFt?.value).toBe(24.7);
    expect(pub.theoreticalRootChordFt?.value).toBe(41.75);
    expect(pub.crankButtLineIn?.value).toBe(137.096);
    expect(pub.tipChordFt?.value).toBe(5.4);
    expect(pub.aspectRatio?.value).toBe(1.75);
    expect(pub.weightLb?.value).toBe(35000);
  });
  test("published span, area and aspect ratio agree: b² / 600 = 1.75", () => {
    expect((32.4 * 32.4) / 600).toBeCloseTo(1.75, 2);
  });
  test("the planform has 70° inboard and 50° outboard of the crank at butt line 137.096 in, and the published tip chord", () => {
    const p = a.planform(), props = planformProps(p);
    expect(props.span).toBeCloseTo(32.4, 9);
    const crank = p.stations.find((s) => Math.abs(s.y - 137.096 / 12) < 1e-9);
    expect(crank).toBeDefined();
    expect(toDeg(props.segments[0]?.sweepLe ?? deg(0))).toBeCloseTo(70, 6);
    expect(toDeg(props.segments[props.segments.length - 1]?.sweepLe ?? deg(0))).toBeCloseTo(50, 6);
    expect(p.stations[p.stations.length - 1]?.chord).toBeCloseTo(5.4, 9);
    expect(p.stations[0]?.chord).toBeCloseTo(41.75, 9);
  });
  test("known difference, kept visible: the straight-edged planform is larger than the published wing area (S-blend and trailing-edge details are not modelled)", () => {
    const area = planformProps(a.planform()).area;
    expect(area).toBeGreaterThan(646.37);
    expect(rel(area, 646.37)).toBeLessThan(0.06);
    expect(a.caveats.join(" ")).toMatch(/S-blend/);
  });
  test("a cranked wing is outside the validated domain and is labelled", () => {
    const r = analyse(a.planform(), { alphas: [deg(10)] });
    expect(r.domain.ok).toBe(false);
    expect(r.points[0]?.extrapolated).toBe(true);
  });
});

describe("F-16 (NASA TP-1538): published reference wing, taper derived, sweep traced", () => {
  const a = get("f16"), pub = a.published;
  test("published values are carried exactly", () => {
    expect(pub.referenceAreaFt2?.value).toBe(300); expect(pub.spanFt?.value).toBe(30); expect(pub.referenceChordFt?.value).toBe(11.32);
    expect(pub.weightLb?.value).toBe(20500); expect(pub.iyySlugFt2?.value).toBe(55814);
    expect(pub.lengthFt?.value).toBeCloseTo(49.508, 3); expect(pub.heightFt?.value).toBeCloseTo(16.437, 3);
  });
  test("the planform reproduces the published area, span and mean chord exactly, and the taper they imply", () => {
    const props = planformProps(a.planform()), p = a.planform();
    expect(props.area).toBeCloseTo(300, 6); expect(props.span).toBeCloseTo(30, 9); expect(props.mac).toBeCloseTo(11.32, 6);
    expect((p.stations[1]?.chord ?? 0) / (p.stations[0]?.chord ?? 1)).toBeCloseTo(0.2275, 3);
    expect(props.aspectRatio).toBeCloseTo(3, 9);
  });
  test("the traced sweep is recorded as traced, with its tolerance, and used by the planform", () => {
    const t = a.traced.find((x) => x.what.includes("sweep"));
    expect(t?.value).toBe(F16_TRACED_SWEEP_DEG); expect(F16_TRACED_SWEEP_DEG).toBe(40.2); expect(t?.tolerance).toBe(2.5);
    expect(toDeg(planformProps(a.planform()).segments[0]?.sweepLe ?? deg(0))).toBeCloseTo(40.2, 6);
    expect(Object.keys(a.published)).not.toContain("leadingEdgeSweepDeg");
  });
  test("outside the validated sweep range, and labelled", () => {
    const r = analyse(a.planform(), { alphas: [deg(15)] });
    expect(r.domain.ok).toBe(false);
  });
});

describe("F/A-18 HARV stays as it was", () => {
  test("registry values are the published ones used elsewhere", () => {
    const a = get("harv");
    expect(a.published.referenceAreaFt2?.value).toBe(HARV_PUBLISHED.wingAreaFt2);
    expect(a.published.spanFt?.value).toBe(HARV_PUBLISHED.spanFt);
    expect(a.published.weightLb?.value).toBe(HARV_MASS.fighterEscort60pctFuel.weightLb);
    expect(a.dataCaseId).toBe("fa18-hatp");
  });
});

// ---------------------------------------------------------------- the value review covers all the work

const LEVEL_KEYS = ["impact", "defensibility", "quality", "confidence", "effort"] as const;
const sha16 = (f: string) => createHash("sha256").update(readFileSync(join(import.meta.dir, "../lib/data", f))).digest("hex").slice(0, 16);

describe("validation report is generated from the current results", () => {
  const report = readFileSync(join(import.meta.dir, "../../reports/aero-validation-report.md"), "utf8");
  test("it carries the digests of the data files as they are now (regenerate it when the data change)", () => {
    for (const f of ["aero-corpus.json", "aero-validation.json", "aero-flight.json"]) expect({ f, current: report.includes(sha16(f)) }).toEqual({ f, current: true });
  });
  test("every criterion appears with its result, and every miss is named in the summary", () => {
    const all = { ...validation.criteria, ...flightJson.criteria } as Record<string, { pass: boolean }>;
    for (const [id, c] of Object.entries(all)) expect(report).toContain(`| ${id} |`);
    const misses = Object.entries(all).filter(([, c]) => !c.pass).map(([id]) => id);
    expect(report).toContain(`Misses: ${misses.join(", ")}`);
    expect(report).toContain(`**${Object.values(all).filter((c) => c.pass).length} of ${Object.keys(all).length} criteria met.**`);
  });
  test("it names every aircraft, a version, and how to cite it", () => {
    for (const a of AIRCRAFT) expect(report).toContain(a.name);
    expect(report).toMatch(/version \d+\.\d+/);
    expect(report).toContain("## How to cite");
  });
});

describe("value review: every piece of the aero work is judged against the one criterion, high value", () => {
  const items = value.items, candidates = value.candidates, all = [...items, ...candidates];
  test("every module in lib/aero belongs to a reviewed item (new work cannot ship unreviewed)", () => {
    const files = readdirSync(join(import.meta.dir, "../lib/aero")).filter((f) => f.endsWith(".ts")).map((f) => `lib/aero/${f}`);
    const reviewed = new Set(items.flatMap((i) => i.files));
    for (const f of files) expect({ f, reviewed: reviewed.has(f) }).toEqual({ f, reviewed: true });
  });
  test("every item was judged several times, has scores from 0 to 4 with their range, an ORION rank, an aftermath and reasons", () => {
    expect(value.repeats).toBeGreaterThanOrEqual(3);
    for (const group of [items, candidates]) expect(group.map((i) => i.orion.rank).sort((a, b) => a - b)).toEqual(group.map((_, k) => k + 1));
    for (const i of all) {
      for (const k of LEVEL_KEYS) { expect(i.levels[k]).toBeGreaterThanOrEqual(0); expect(i.levels[k]).toBeLessThanOrEqual(4); }
      expect(i.impactRange[0]).toBeLessThanOrEqual(i.levels.impact + 0.006); expect(i.impactRange[1]).toBeGreaterThanOrEqual(i.levels.impact - 0.006);
      expect(i.why.useful.length).toBeGreaterThan(10); expect(i.why.evidence.length).toBeGreaterThan(10);
      expect(i.aftermath.length).toBeGreaterThan(1);
      for (const s of i.aftermath) expect(s.well + s.mixed + s.hard).toBeCloseTo(1, 6);
    }
  });
  test("the verdict is the one rule applied to the scores: high value, kept only if high-value work needs it, otherwise cut", () => {
    const min = value.criteria.highValueMin;
    const high = (id: string) => (all.find((i) => i.id === id)?.levels.impact ?? 0) >= min;
    const needed = new Set<string>();
    const need = (id: string) => { for (const r of all.find((i) => i.id === id)?.requires ?? []) if (!needed.has(r)) { needed.add(r); need(r); } };
    for (const i of all) if (high(i.id) && i.status !== "rejected") need(i.id);
    for (const i of all) {
      const want = i.status === "rejected" ? "rejected on evidence" : high(i.id) ? "high value" : needed.has(i.id) ? "kept as a prerequisite" : "cut";
      expect({ id: i.id, verdict: i.verdict }).toEqual({ id: i.id, verdict: want });
      expect(i.borderline).toBe(i.impactRange[0] < min && i.impactRange[1] >= min);
    }
  });
  test("the review says which model judged, when, and on what evidence", () => {
    expect(value.model).toMatch(/^jev-/);
    expect(value.generated).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(value.evidenceDigest).toMatch(/^[0-9a-f]{12,}$/);
  });
});
