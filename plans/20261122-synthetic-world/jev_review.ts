// Jev hazard review of the milestone-1 world design: one narrow noul per hazard. Run from ~/orion (key from .env, never printed).
import { readFileSync, writeFileSync } from "node:fs";
import { systemOne, type SystemOneQuestion } from "/home/chris/orion/server/typesafe.ts";
const dir = "/home/chris/archymedes-defense/plans/20261122-synthetic-world";
const state = {
  context: readFileSync(`${dir}/context.txt`, "utf8"),
  design: [
    "Python pipeline (uv) converts swisstopo LV95 rasters/vectors to OGC 3D Tiles 1.1: one glTF per 1 km tile, terrain as a regular grid mesh decimated from the 0.5 m DTM to 4 m, ortho texture 0.25 m JPEG per tile, LoD2 buildings as separate meshes, OSM roads draped as ribbons 0.3 m above terrain.",
    "Vertices stored relative to a local ENU origin at the site centre in float32; tileset root transform carries ENU->ECEF in float64; heights converted from LN02 to ellipsoidal via a constant geoid offset for the 4 km site.",
    "Every building, road and terrain tile carries a provenance record {value, source, licence, method, confidence}; deduced values never overwrite measured ones; a coverage report counts measured vs deduced per layer.",
    "Viewer: three.js + 3DTilesRendererJS in the existing Next.js app behind the shared password, tiles served from the app's public folder.",
    "Invariant tests first: provenance completeness, measured-over-deduced, ECEF<->ENU round trip < 1 mm, no gaps at tile seams, buildings within DTM bounds, deterministic output digests.",
  ],
};
const hazards: Record<string, string> = {
  seam_gaps: "Adjacent terrain tiles decimated independently will show cracks or T-junctions at their shared edges unless edge vertices are shared exactly.",
  float_jitter: "float32 vertices relative to an ENU origin 2-3 km away will cause visible jitter or z-fighting at the scales used.",
  geoid_const: "Using one constant geoid offset over a 4 km alpine site introduces height errors larger than 10 cm.",
  building_float: "LoD2 buildings placed on a 4 m decimated terrain will float above or sink into the ground by more than 1 m on steep slopes.",
  road_drape: "Road ribbons draped at 0.3 m over a 4 m terrain mesh will cut into or hover over the terrain on cliffs and embankments.",
  odbl: "Mixing ODbL OpenStreetMap data into the same derived tiles as swisstopo data creates share-alike obligations for the combined database.",
  public_leak: "Serving tiles from the Next.js public folder risks exposing them without the password gate.",
  texture_mem: "Sixteen 4000x4000 JPEG textures will exceed typical browser GPU memory budgets on laptops.",
  determinism: "Pipeline output digests will not be deterministic across runs because of floating-point or library ordering differences.",
  truth_leak: "Using swissBUILDINGS3D as the measured building layer in milestone 1 makes it harder to keep it hidden from the deduction engine in milestone 2.",
};
const questions: Record<string, SystemOneQuestion> = Object.fromEntries(Object.entries(hazards).map(([k, v]) => [k, {
  type: "noul", instructions: `Given the design in the state, is this hazard real and likely to bite unless addressed? Hazard: ${v}` }]));
const r = await systemOne(state, questions, { timeoutMs: 60_000 });
const out = Object.fromEntries(Object.entries(r.answers).map(([k, a]: [string, any]) => [k, { p: +a.noul.toFixed(3), hazard: hazards[k] }]));
writeFileSync(`${dir}/jev-review.json`, JSON.stringify({ model: r.model, answers: out }, null, 1) + "\n");
console.log(r.model, Object.entries(out).sort((a, b) => b[1].p - a[1].p).map(([k, v]) => `${k}=${v.p}`).join(" "));
