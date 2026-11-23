import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { config } from "../proxy";

// Jev flagged "tiles in public/ escape the password gate" as the top hazard (p = 0.89). These keep it closed.
const gated = (path: string) => config.matcher.some((m) => new RegExp(`^${m}$`).test(path));
const BASE = "/world/ch-lauterbrunnen";
// paths are relative to web/, wherever the tests are started from
const at = (p: string) => join(import.meta.dir, "..", p);
const existsSync = (p: string) => fs.existsSync(at(p));
function readFileSync(p: string): Buffer;
function readFileSync(p: string, enc: "utf8"): string;
function readFileSync(p: string, enc?: "utf8") { return enc ? fs.readFileSync(at(p), enc) : fs.readFileSync(at(p)); }

describe("world files", () => {
  test("every published world file is behind sign-in", () => {
    for (const p of ["tileset.json", "tiles/root.glb", "tiles/0_0.glb", "tiles/m_0_0.glb", "tiles/3_3.glb", "buildings.json", "lines.json"]) {
      expect(gated(`${BASE}/${p}`)).toBe(true);
    }
    expect(gated("/login")).toBe(false); // sanity: the matcher does exclude something
  });
  test("site sim files are behind sign-in, present, and marked synthetic", () => {
    for (const f of ["site.json", "replay-approach-on-foot.json", "replay-approach-with-mast-fault.json", "replay-approach-with-drone-down.json"]) {
      expect(gated(`${BASE}/sim/${f}`)).toBe(true);
      expect(existsSync(`public${BASE}/sim/${f}`)).toBe(true);
    }
    const site = JSON.parse(readFileSync(`public${BASE}/sim/site.json`, "utf8"));
    expect(site.notional).toBe(true);
    expect(site.provenance.method).toBe("synthetic");
    const replay = JSON.parse(readFileSync(`public${BASE}/sim/replay-approach-on-foot.json`, "utf8"));
    expect(replay.zone.notional).toBe(true);
    expect(replay.manifest.scope).toContain("no force");
    // nothing in a replay names a weapon or an engagement
    expect(/weapon|munition|engage|lethal|fire_at/i.test(JSON.stringify(replay.events))).toBe(false);
    for (const a of replay.agents) expect(["guard", "dog", "vehicle", "drone", "mast", "person"]).toContain(a.kind);
  });
  test("3D models are behind sign-in and each one carries its licence and source", () => {
    const credits = JSON.parse(readFileSync("public/world/models/CREDITS.json", "utf8"));
    expect(credits.models.map((m: { file: string }) => m.file).sort()).toEqual(["go2.glb", "man.glb", "x2.glb"]);
    for (const m of credits.models) {
      expect(gated(`/world/models/${m.file}`)).toBe(true);
      expect(existsSync(`public/world/models/${m.file}`)).toBe(true);
      expect(["BSD-3-Clause", "Apache-2.0", "CC BY 4.0"]).toContain(m.licence);
      expect(m.source.length).toBeGreaterThan(5);
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(existsSync("public/world/models/licenses/unitree_go2-BSD-3-Clause.txt")).toBe(true);
    expect(existsSync("public/world/models/licenses/skydio_x2-Apache-2.0.txt")).toBe(true);
    // the viewer names the model authors where the models are shown
    const viewer = readFileSync("components/three/world.tsx", "utf8");
    for (const who of ["Unitree", "Skydio X2", "Cesium"]) expect(viewer).toContain(who);
  });
  test("warehouse site scene: extract, assets and licences are present and behind sign-in", () => {
    const yard = JSON.parse(readFileSync(`public${BASE}/yard/yard.json`, "utf8"));
    expect(yard.notional).toBe(true);
    expect(yard.provenance.method).toBe("synthetic");
    expect(yard.height.fit_error_m).toBeLessThan(0.05);
    expect(readFileSync(`public${BASE}/yard/${yard.height.file}`).byteLength).toBe(yard.height.n * yard.height.n * 4);
    for (const f of [...yard.terrain.tiles, yard.buildings.file, "yard.json", yard.height.file]) {
      expect(existsSync(`public${BASE}/yard/${f}`)).toBe(true);
      expect(gated(`${BASE}/yard/${f}`)).toBe(true);
    }
    const credits = JSON.parse(readFileSync("public/world/assets/CREDITS.json", "utf8")).assets as { id: string; kind: string; licence: string; path: string; source: string; sha256: string }[];
    expect(credits.length).toBeGreaterThan(20);
    for (const c of credits) {
      expect(["CC0-1.0", "MIT"]).toContain(c.licence);
      expect(c.source).toMatch(/^https:\/\/(polyhaven\.com|github\.com\/microsoft\/Microsoft-Rocketbox)/);
      expect(c.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(gated(`/world/assets/${c.path}`)).toBe(true);
      // nothing weapon-like is shipped, even though the source libraries contain such items
      expect(/rifle|pistol|gun|ammo|weapon|military|cannon/i.test(c.id)).toBe(false);
    }
    expect(existsSync("public/world/assets/licenses/Microsoft-Rocketbox-MIT.md")).toBe(true);
    expect(existsSync("public/world/assets/licenses/PolyHaven-CC0.txt")).toBe(true);
    const guardFiles = credits.find((c) => c.id === "Security_Male_01") as unknown as { textures: string[] };
    expect(guardFiles.textures.some((t) => /pistol|gun/i.test(t))).toBe(false);
  });
  test("operations: every listed replay exists, stays in scope and names its result", () => {
    const sim = JSON.parse(readFileSync("lib/data/world-sim-ch-lauterbrunnen.json", "utf8"));
    const ids = sim.replays.map((r: { id: string }) => r.id);
    for (const want of ["approach-on-foot", "fence-to-door", "fence-to-door-drone-down", "fence-to-door-during-alarm", "nuisance-alarm-verify-first", "gate-two-hours", "evacuation"]) expect(ids).toContain(want);
    const kinds = new Set<string>();
    for (const id of ids) {
      expect(gated(`${BASE}/sim/replay-${id}.json`)).toBe(true);
      const r = JSON.parse(readFileSync(`public${BASE}/sim/replay-${id}.json`, "utf8"));
      expect(r.zone.notional).toBe(true);
      expect(/weapon|munition|engage|lethal|shoot|fire_at/i.test(JSON.stringify(r.events))).toBe(false);
      for (const a of r.agents) { expect(["guard", "dog", "vehicle", "drone", "mast", "person", "worker", "truck"]).toContain(a.kind); kinds.add(a.kind); }
      expect(r.score !== null || r.ops !== null).toBe(true);
      for (const [aid, track] of Object.entries(r.tracks as Record<string, number[][]>)) expect(track.length, aid).toBeGreaterThan(0);
    }
    expect(kinds.has("truck") && kinds.has("worker")).toBe(true);
    const ops = sim.operations;
    for (const t of [...ops.timeline, ...ops.coupled, ...ops.sensitivity]) expect(t.interrupted).toBeLessThanOrEqual(t.runs);
    expect(ops.sweep.length).toBe(8);
    for (const g of ops.gate) expect(g.stopped + g.lost).toBeLessThanOrEqual(g.runs);
    expect(ops.evacuation.all_mustered).toBe(ops.evacuation.runs);
    // every assumption shown next to the results is in the data file
    for (const k of ["fence_pd", "fence_delay_s", "door_delay_s", "check_s", "callback_s", "p_catch", "trucks_per_hour", "nuisance_per_day"]) expect(ops.assumptions[k]).toBeDefined();
  });
  test("the full simulation road file is not published; viewer lines carry ODbL", () => {
    expect(existsSync(`public${BASE}/roads.json`)).toBe(false);
    const lines = JSON.parse(readFileSync(`public${BASE}/lines.json`, "utf8"));
    expect(lines.licence).toBe("ODbL-1.0");
    const ts = JSON.parse(readFileSync(`public${BASE}/tileset.json`, "utf8"));
    expect(ts.asset.extras.licence).toBe("swisstopo-OGD");
    expect(ts.root.children.length).toBe(16);
    for (const mid of ts.root.children) { // root -> mid -> fine: all three levels must be on disk
      expect(existsSync(`public${BASE}/${mid.content.uri}`)).toBe(true);
      expect(mid.children.length).toBe(1);
      expect(existsSync(`public${BASE}/${mid.children[0].content.uri}`)).toBe(true);
    }
  });
});
