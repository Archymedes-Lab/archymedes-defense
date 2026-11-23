import { describe, expect, setDefaultTimeout, test } from "bun:test";
import fc from "fast-check";
import { pchip } from "../lib/aero/curves";
import { HARV_BODY, HARV_CANOPY, HARV_PUBLISHED, bodyAt, canopyAt, harvWingGeometry } from "../lib/aero/harv";
import { SUPERELLIPSE_N, buildHarvMesh, superellipseArea } from "../lib/aero/harv-mesh";
import { meshTopology, projectedArea } from "../lib/aero/mesh-check";

setDefaultTimeout(120_000);

// ---------------------------------------------------------------- smooth curves through traced stations

describe("monotone cubic interpolation (Fritsch–Carlson)", () => {
  const knots = fc.uniqueArray(fc.double({ min: -50, max: 50, noNaN: true }), { minLength: 3, maxLength: 12 })
    .map((xs) => [...xs].sort((a, b) => a - b)).filter((xs) => xs.every((x, i) => i === 0 || x - (xs[i - 1] ?? 0) > 1e-3));

  test("passes exactly through every knot", () => {
    fc.assert(fc.property(knots, fc.array(fc.double({ min: -10, max: 10, noNaN: true }), { minLength: 12, maxLength: 12 }), (xs, ys0) => {
      const ys = xs.map((_, i) => ys0[i] ?? 0), f = pchip(xs, ys);
      xs.forEach((x, i) => expect(f(x)).toBeCloseTo(ys[i] ?? 0, 10));
    }), { numRuns: 200 });
  });

  test("never overshoots: between two knots the curve stays between their values", () => {
    fc.assert(fc.property(knots, fc.array(fc.double({ min: -10, max: 10, noNaN: true }), { minLength: 12, maxLength: 12 }), fc.double({ min: 0, max: 1, noNaN: true }), (xs, ys0, t) => {
      const ys = xs.map((_, i) => ys0[i] ?? 0), f = pchip(xs, ys);
      for (let i = 0; i + 1 < xs.length; i++) {
        const x = (xs[i] ?? 0) + t * ((xs[i + 1] ?? 0) - (xs[i] ?? 0)), lo = Math.min(ys[i] ?? 0, ys[i + 1] ?? 0), hi = Math.max(ys[i] ?? 0, ys[i + 1] ?? 0);
        expect(f(x)).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(f(x)).toBeLessThanOrEqual(hi + 1e-9);
      }
    }), { numRuns: 200 });
  });

  test("monotone data give a monotone curve, and straight data a straight line", () => {
    const f = pchip([0, 1, 2, 5, 9], [0, 0.5, 2, 2.1, 7]);
    let prev = -Infinity;
    for (let x = 0; x <= 9; x += 0.01) { const y = f(x); expect(y).toBeGreaterThanOrEqual(prev - 1e-12); prev = y; }
    const g = pchip([0, 1, 3, 7], [1, 3, 7, 15]);
    for (let x = 0; x <= 7; x += 0.1) expect(g(x)).toBeCloseTo(1 + 2 * x, 10);
  });

  test("slope is continuous at every knot (C1): left and right difference quotients agree", () => {
    const xs = HARV_BODY.map((b) => b.x);
    for (const key of ["halfWidth", "top", "bottom"] as const) {
      const f = pchip(xs, HARV_BODY.map((b) => b[key]));
      for (const x of xs.slice(1, -1)) {
        const h = 1e-5, left = (f(x) - f(x - h)) / h, right = (f(x + h) - f(x)) / h;
        expect(Math.abs(left - right)).toBeLessThan(1e-3);
      }
    }
  });

  test("refuses unsorted or mismatched knots", () => {
    expect(() => pchip([0, 2, 1], [0, 1, 2])).toThrow(RangeError);
    expect(() => pchip([0, 1], [0])).toThrow(RangeError);
  });
});

describe("HARV body and canopy curves", () => {
  test("the body passes through every traced station and stays within the table's range", () => {
    for (const b of HARV_BODY) {
      const s = bodyAt(b.x);
      expect(s.halfWidth).toBeCloseTo(b.halfWidth, 9); expect(s.top).toBeCloseTo(b.top, 9); expect(s.bottom).toBeCloseTo(b.bottom, 9);
    }
    const maxW = Math.max(...HARV_BODY.map((b) => b.halfWidth)), maxT = Math.max(...HARV_BODY.map((b) => b.top));
    for (let x = 0; x <= 55.2; x += 0.05) { const s = bodyAt(x); expect(s.halfWidth).toBeLessThanOrEqual(maxW + 1e-9); expect(s.top).toBeLessThanOrEqual(maxT + 1e-9); expect(s.top).toBeGreaterThan(s.bottom); }
  });
  test("the canopy passes through its traced stations", () => {
    for (const c of HARV_CANOPY) { const s = canopyAt(c.x); expect(s.top).toBeCloseTo(c.top, 9); expect(s.halfWidth).toBeCloseTo(c.halfWidth, 9); }
  });
});

// ---------------------------------------------------------------- solid, watertight, well-formed mesh

describe("HARV mesh is a set of closed, consistently oriented solids", () => {
  const mesh = buildHarvMesh(1);

  test("every component is a closed 2-manifold: each edge in exactly two triangles, once in each direction", () => {
    for (const g of mesh.groups) {
      const t = meshTopology(g);
      expect({ name: g.name, boundary: t.boundaryEdges, nonManifold: t.nonManifoldEdges, misoriented: t.misorientedEdges })
        .toEqual({ name: g.name, boundary: 0, nonManifold: 0, misoriented: 0 });
    }
  });

  test("every component is one shell without holes: Euler characteristic V − E + F = 2", () => {
    for (const g of mesh.groups) expect({ name: g.name, chi: meshTopology(g).euler }).toEqual({ name: g.name, chi: 2 });
  });

  test("normals point outward: every component encloses a positive volume", () => {
    for (const g of mesh.groups) expect({ name: g.name, positive: meshTopology(g).signedVolume > 0 }).toEqual({ name: g.name, positive: true });
  });

  test("no degenerate triangles and no duplicate vertices (welded)", () => {
    for (const g of mesh.groups) {
      const t = meshTopology(g);
      expect({ name: g.name, ok: t.minTriangleArea > 1e-7 }).toEqual({ name: g.name, ok: true });
      expect({ name: g.name, ok: t.minVertexDistance > 1e-6 }).toEqual({ name: g.name, ok: true });
    }
  });

  test("mirror symmetric: every right-side component has a left twin with y negated exactly", () => {
    const byName = new Map(mesh.groups.map((g) => [g.name, g]));
    for (const g of mesh.groups) {
      if (!g.name.endsWith(" (right)")) continue;
      const twin = byName.get(g.name.replace(" (right)", " (left)"));
      expect(twin).toBeDefined();
      if (!twin) continue;
      expect(twin.positions.length).toBe(g.positions.length);
      for (let i = 0; i < g.positions.length; i += 3) {
        expect(twin.positions[i]).toBe(g.positions[i]); expect(twin.positions[i + 1]).toBe(-(g.positions[i + 1] ?? 0)); expect(twin.positions[i + 2]).toBe(g.positions[i + 2]);
      }
    }
    const fus = byName.get("fuselage");
    expect(fus).toBeDefined();
    if (fus) {
      const r9 = (v: number) => Math.round(v * 1e9) + 0; // nanometre grid; "+ 0" turns −0 into 0
      const key = (x: number, y: number, z: number) => `${r9(x)},${r9(y)},${r9(z)}`;
      const set = new Set<string>();
      for (let i = 0; i < fus.positions.length; i += 3) set.add(key(fus.positions[i] ?? 0, fus.positions[i + 1] ?? 0, fus.positions[i + 2] ?? 0));
      for (let i = 0; i < fus.positions.length; i += 3) expect(set.has(key(fus.positions[i] ?? 0, -(fus.positions[i + 1] ?? 0), fus.positions[i + 2] ?? 0))).toBe(true);
    }
  });

  test("the nose is a single apex vertex, not a collapsed ring", () => {
    const fus = mesh.groups.find((g) => g.name === "fuselage");
    const atNose = [];
    for (let i = 0; i < (fus?.positions.length ?? 0); i += 3) if ((fus?.positions[i] ?? 1) === 0) atNose.push(i);
    expect(atNose.length).toBe(1);
  });

  test("fuselage volume converges under refinement to the integral of its superellipse sections", () => {
    // Exact section area of |y/a|^n + |z/b|^n = 1 is 4ab Γ(1+1/n)² / Γ(1+2/n); integrate it along x (Simpson, fine).
    let exact = 0;
    const N = 4000, L = 55.2;
    for (let i = 0; i <= N; i++) {
      const x = (L * i) / N, b = bodyAt(x), w = i === 0 || i === N ? 1 : i % 2 === 1 ? 4 : 2;
      exact += w * superellipseArea(b.halfWidth, 0.5 * (b.top - b.bottom), SUPERELLIPSE_N);
    }
    exact *= L / N / 3;
    const vol = (d: number) => meshTopology(buildHarvMesh(d).groups.find((g) => g.name === "fuselage") ?? { name: "", part: "skin", positions: [], indices: [] }).signedVolume;
    const e1 = Math.abs(vol(1) - exact), e2 = Math.abs(vol(2) - exact), e4 = Math.abs(vol(4) - exact);
    expect(e2).toBeLessThan(e1);
    expect(e4).toBeLessThan(e2);
    expect(e4 / exact).toBeLessThan(0.01);
  });

  test("superellipse area: n = 2 is the ellipse πab, large n tends to the box 4ab", () => {
    expect(superellipseArea(2, 3, 2)).toBeCloseTo(Math.PI * 6, 9);
    expect(superellipseArea(2, 3, 200) / 24).toBeGreaterThan(0.99);
  });

  test("the wing's upward-facing area equals its analytic planform outboard of the root rib", () => {
    const wing = mesh.groups.find((g) => g.name === "wing (right)");
    expect(wing).toBeDefined();
    const w = harvWingGeometry(), yRoot = 2.4;
    const analytic = 0.5 * ((w.xTe(yRoot) - w.xLe(yRoot)) + w.ct) * (w.semi - yRoot);
    if (wing) expect(Math.abs(projectedArea(wing, 2) - analytic) / analytic).toBeLessThan(0.005);
  });

  test("still matches the published length, height and span", () => {
    const b = mesh.bounds;
    expect(Math.abs(b.max[0] - HARV_PUBLISHED.lengthFt)).toBeLessThan(0.15);
    expect(Math.abs(b.max[2] - HARV_PUBLISHED.heightFt)).toBeLessThan(0.2);
    expect(b.max[1]).toBeGreaterThan(HARV_PUBLISHED.spanFt / 2);
    expect(b.max[1]).toBeLessThan(HARV_PUBLISHED.spanFt / 2 + 0.8);
  });

  test("component names are unique and every part is used", () => {
    const names = mesh.groups.map((g) => g.name);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(mesh.groups.map((g) => g.part))).toEqual(new Set(["skin", "glass", "dark", "metal"]));
  });
});

describe("mesh checks catch broken meshes (the checker is tested too)", () => {
  const tet = { name: "tet", part: "skin" as const, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3] };
  test("a tetrahedron is closed, oriented, χ = 2, volume 1/6", () => {
    const t = meshTopology(tet);
    expect([t.boundaryEdges, t.nonManifoldEdges, t.misorientedEdges, t.euler]).toEqual([0, 0, 0, 2]);
    expect(t.signedVolume).toBeCloseTo(1 / 6, 12);
  });
  test("a missing face, a flipped face and an inside-out solid are all detected", () => {
    expect(meshTopology({ ...tet, indices: tet.indices.slice(0, 9) }).boundaryEdges).toBe(3);
    expect(meshTopology({ ...tet, indices: [0, 1, 2, ...tet.indices.slice(3)] }).misorientedEdges).toBeGreaterThan(0);
    const inside = tet.indices.slice(); for (let i = 0; i < inside.length; i += 3) { const a = inside[i + 1] ?? 0; inside[i + 1] = inside[i + 2] ?? 0; inside[i + 2] = a; }
    expect(meshTopology({ ...tet, indices: inside }).signedVolume).toBeCloseTo(-1 / 6, 12);
  });
  test("projected area of a unit cube's top is 1", () => {
    const p = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
    const idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
    const cube = { name: "cube", part: "skin" as const, positions: p, indices: idx };
    expect(projectedArea(cube, 2)).toBeCloseTo(1, 12);
    expect(meshTopology(cube).signedVolume).toBeCloseTo(1, 12);
    expect(meshTopology(cube).euler).toBe(2);
  });
});
