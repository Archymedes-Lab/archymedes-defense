# Plan: synthetic 3D world from open data, for testing autonomous systems (2026-11-22)

Owner request: one synthetic 3D environment that comes close to reality. Real places, buildings and routes are
rebuilt from public open data of every kind (the "deduction" approach). Drones, robot dogs, ground vehicles and other
automated equipment run inside it.

**Scope rule (same as the aero and armor plans).** The world is used to test autonomy, sensing and robustness:
perimeter and site security, inspection, search and rescue, convoy and logistics routing, GPS-denied navigation,
sensor faults. It does not model weapon effects, targeting or engagement. Military installations and other
sensitive real sites are not rebuilt; scenario sites are civil or our own.

## The idea in one line

Every fact in the world has a source. A missing fact is **deduced** from the facts around it and keeps a confidence
value. A synthetic world that records how far it is from reality is what sets this apart from a game map. That
follows the "measured error bars" pattern already used in battery and aero.

## Constraint that drives the engine choice

This machine has 4 cores, 7 GB RAM and no GPU. Isaac Sim, Unreal and Omniverse cannot run here. So:

- **World format is engine-neutral:** OGC 3D Tiles 1.1 (glTF) for geometry, with a USD export later. Coordinates
  are ECEF/WGS84 with a local ENU frame per scenario.
- **The simulation runs headless:** deterministic physics and autonomy in Python, plus WASM in the browser. It runs
  on CPU and replays from a seed.
- **The viewer is web-based:** three.js + 3d-tiles-renderer inside the existing Next.js app. The same tiles load in
  Cesium, or in Unreal/Isaac on a rented GPU when we need photoreal sensors.

## Layers and open sources

| Layer | Primary open source | Fallback / deduction |
|---|---|---|
| Terrain | National lidar DTM where it exists (USGS 3DEP, IGN, AHN…) | Copernicus GLO-30 DEM (global, 30 m) |
| Surface imagery | Sentinel-2 L2A (10 m), NAIP (US), Maxar Open Data (event areas) | Seasonal composite; colour from land cover |
| Land cover / vegetation | ESA WorldCover 10 m; Meta/WRI 1 m canopy height | Tree instancing from canopy raster |
| Building footprints | Overture Maps (OSM + Microsoft + Google merged) | Google Open Buildings 2.5D (heights, Africa/Asia) |
| Building height / roof | OSM `height`, `building:levels`, `roof:shape`; lidar DSM−DTM | levels × 3 m; median of neighbours of the same class; flat roof, low confidence |
| Roads, paths, routes | OSM + Overture transportation | Width from road class; surface from tags |
| Street-level appearance | Mapillary / KartaView imagery (CC BY-SA) | Facade textures chosen from a procedural library by building type |
| Hero sites (very high detail) | Our own capture: phone lidar / drone photogrammetry → Gaussian splats + mesh | — |
| Interiors | Almost no open data | Procedural floor plans from footprint + use, marked synthetic |
| Weather, light | ERA5 / Open-Meteo; solar ephemeris | Climatology for the date |

Excluded: Google Photorealistic 3D Tiles and similar commercial meshes. Their terms do not allow storing or deriving
data for simulation. They may only be used as a visual reference.

## Deduction and provenance (the core)

Each world feature stores `{value, source, licence, method, confidence}`. Methods are ranked: measured > tagged >
inferred-from-neighbours > class default. A tile-level report states how much of the world is measured and how much
is deduced. This reuses the DataScope provenance contracts already in this repo.

## Agents

| Agent | Dynamics / autonomy | Why |
|---|---|---|
| Multirotor drone | PX4 SITL (real autopilot firmware) + our 6-DoF model; MAVLink | Real flight stack. Validated against public PX4 Flight Review logs |
| Fixed-wing drone | PX4/ArduPilot SITL + vortex-lattice aero from the aero plan | Reuses milestone work |
| Quadruped (robot dog) | MuJoCo with MuJoCo Menagerie models (Unitree Go2, ANYmal); public locomotion policies | Open, CPU-capable, accurate contact |
| Ground vehicle | Ackermann / skid-steer model; ROS 2 Nav2 | Standard stack |
| Static sensors | Cameras, radar/lidar sweeps, Sitewatch heartbeat devices | Ties Sitewatch faults into the world |

Sensors: camera (rasterised from tiles), depth, lidar (ray cast against the tile BVH), GNSS with multipath and
denial, IMU, all with noise models. ROS 2 bridge so external autonomy stacks can plug in.

## How "approaches reality" is measured

1. Geometry: held-out lidar points vs world surface (RMSE, by deduction method).
2. Appearance: held-out Mapillary/Sentinel views vs renders (SSIM/LPIPS).
3. Dynamics: PX4 SITL vs real flight logs on the same commanded inputs.
4. Sim-to-real gap per agent, published as an error band, like aero.

## Milestones

Order after the ORION run (see Decisions). Numbers are kept as ids.

1. **Done 2026-11-22.** Swiss tile: terrain + imagery + buildings + roads as 3D Tiles with a provenance report; `/world`.
1b. **US variant: Boulder foothills** (`us-boulder`, UTM 13N, 474000/4427000, 4 × 4 km) through the same pipeline.
   Sources verified through the USGS TNM API on 2026-11-22: DRCOG 2020 classified lidar (37 LPC tiles, ~200–280 MB each),
   USGS 1 m DEM (DRCOG 2020 and ArapahoRooseveltPikeNF 2023 projects), NAIP 0.6 m, Overture/OSM buildings. No open LoD2
   in the US, so lidar class-6 points are the held-out building truth. Needs a TNM fetcher and a NAVD88 (GEOID18) frame;
   the frame code already accepts `NAVD88`.
3. Headless sim core: clock, ENU frame (the one in `world/archworld/frames.py`), collision BVH, replay files.
2. Deduction engine for heights/roofs/widths/vegetation, scored against hidden LoD2 and lidar.
7. Validation report: lidar, imagery and flight-log error bands.
5. Sensors + ROS 2 bridge.
4. Agents: PX4 SITL drone, Nav2 ground vehicle, MuJoCo quadruped.
6. Missions in one world: patrol, search and rescue, convoy (the one-way door, so last).

## Owner decisions (2026-11-22)

**Area: data-rich site.** Proposed: a 4 × 4 km tile in the Lauterbrunnen–Interlaken valley (Switzerland). swisstopo
data is all open (OGD since 2021): swissALTI3D 0.5 m DTM, swissSURFACE3D classified lidar, SWISSIMAGE 10 cm, swissTLM3D
roads/paths/land cover, and **swissBUILDINGS3D LoD2 roofs for every building**. Real LoD2 geometry is ground truth for
the deduction engine: we hide it, deduce from OSM-level facts, and measure the error. The terrain is varied
(cliffs, forest, valley floor, town, roads, rail, river), so patrol, search and rescue and convoy all fit in one tile.
Alternative: a Netherlands tile (AHN lidar + 3DBAG LoD2). Equally rich but flat.

**Scenarios: all of them, in one world.** There is no per-scenario map. Scenarios are *missions* run against a single
persistent world state. Missions share agents, sensors, weather and faults, so a drone held up on a search mission
is missing from patrol.
Missions at launch: perimeter patrol (GNSS-denied segment + Sitewatch fault), search and rescue (terrain + canopy),
convoy/logistics (road network with blockages + drone overwatch). Later missions plug in through the same contract.

**Usefulness and defensibility first.** Each mission produces a measured result a customer could not get from a game
engine: sim-to-real error bands, provenance coverage, deterministic replay as evidence. See invariants below.

## Invariants (tested before features; property-based + adversarial)

World
- Every feature has a source or a deduction method. No attribute without provenance; licence travels with derived data.
- Deduced values never overwrite measured ones. Confidence is monotone: measured ≥ tagged ≥ inferred ≥ default.
- Held-out ground truth (LoD2, lidar points, imagery) is never readable by the deduction code. Enforced by the loader, as Sitewatch refuses `--truth`.
- Tiles are watertight where agents collide. No gaps at tile seams. Heights stay within the terrain DTM ± building bounds.
- ECEF↔ENU round trip < 1 mm across the tile. Geoid/ellipsoid height is declared, never mixed.

Simulation
- Same seed + same inputs ⇒ bit-identical replay (fixed step, no wall clock, no unordered iteration).
- Energy/battery never increases without a charge event. Mass and inertia are positive definite. No agent passes through collision geometry at max speed (CCD check).
- Sensor noise is applied once, from declared models. Denied GNSS returns *no fix*, never a stale fix marked fresh.
- One world, many missions: a mission cannot mutate world geometry except through declared events (blockage, weather), all logged.
- Scope rule enforced in code: the agent/payload schema has no weapon, effect or targeting fields; unknown payload types are refused.

Evidence
- Every run writes a manifest (world version digest, agent versions, seed, mission). Results without a manifest are not comparable (EvalEvidence contract).

## Decisions (2026-11-22, advisory: Jev judgments, maths in code)

| Engine | Question | Result |
|---|---|---|
| ORION (`orion_world.ts`, W = 0.63) | Milestone order | 1 sim core · 2 world tiles · 3 realism report · 4 sensors · 5 agents · 6 deduction · 7 missions · 8 US variant. All two-way doors except missions (one-way). Sim core and world tiles are a tie on P(first): 0.183 vs 0.188 |
| CDM (`cdm_world.py`) | Sites | **Commit: Swiss first, then US** (0.529, P(best) 0.53); innovation bet: both at once (0.492); US only 0.423; NL 0.375; Kigali 0.228. EVPI 0.045. Sensitive-site violation ≤ 0.14 for all |
| CDM | Viewer | **Commit: three.js + 3DTilesRendererJS in the existing app** (0.442, P(best) 0.63). EVPI 0: more research would not change it |
| Jev hazard review (`jev_review.ts`) | Design risks | See table below |

The owner asked for the US variant explicitly; ORION ranks it last on its own merit, which fits "Swiss first, then US".

| Hazard (Jev p) | Response in milestone 1 | Test |
|---|---|---|
| Public folder escapes the password (0.89) | `proxy.ts` gates every public path; test asserts it for each world file | `web/tests/world.test.ts` |
| Seam cracks (0.88) | One global lattice: tile edges are the same `origin + k·step` and the same sampler | seam tests; real build: max 0.04 mm |
| Roads cut in / hover (0.86) | Drape on the rendered triangles (not the raster), densify ≤ 1 m, round before draping | road test |
| Buildings float on slopes (0.79) | Skirt to 0.5 m below the lowest rendered ground under the footprint | no-float test; real build: 0 floating |
| ODbL share-alike (0.66) | OSM only in `roads.json` / `lines.json`; tiles are swisstopo only | licence tests |
| Truth leak into deduction (0.65) | `guard.raw_path(..., purpose="deduce")` refuses `buildings3d` and `lidar` | guard tests |
| Texture memory (0.64) | Root (2 m/px) + 16 leaves (0.49 m/px) at 2048², refined by screen error. KTX2 later | – |
| Non-determinism (0.64) | Sorted inputs, fixed JPEG settings, sorted JSON; digests in report | rebuild test |
| float32 jitter (0.63) | Vertices relative to each tile's centre (≤ 710 m): < 0.1 mm rounding | seam-after-float32 test |
| Constant geoid offset (0.48) | Measured: LN02 → ellipsoid varies 35 cm across the site, so the CHGeo2004 grid is used per vertex | frame test refuses ballpark |

## Milestone 1 result (2026-11-22)

Code: `world/` (uv, ruff, pytest + hypothesis; 23 invariant tests), web `/world` (2 gating tests).
Run: `uv run python -m archworld.fetch ch-lauterbrunnen`, `scripts/convert_buildings.sh data/raw/ch-lauterbrunnen 2634000 1158000 2638000 1162000`,
`uv run python -m archworld build ch-lauterbrunnen --out data/out/ch-lauterbrunnen --publish ../web/public/world/ch-lauterbrunnen --summary ../web/lib/data/world-ch-lauterbrunnen.json`.

| Measure | Value |
|---|---|
| Sources | 37 files, 980 MB, sha256 each (swissALTI3D 2025, SWISSIMAGE 2024, swissBUILDINGS3D 3.0 2021, OSM) |
| Terrain, 4 m mesh vs 0.5 m DTM | RMSE 1.75 m over the site; worst tile 4.2 m (p99 7.4 m, max 292 m on the near-vertical valley wall) |
| Seams after float32 storage | ≤ 0.04 mm |
| Buildings | 1,567 measured LoD2 solids; 0 floating; solids reach 2.9 m below ground (p5–p95 2.4–3.5 m) by swisstopo design |
| OSM lines | 1,037 ways (774 road/path, 158 rail, 105 water); widths: 25 tagged, 1,012 class defaults |
| Build | 125 s, 1.1 GB peak RAM; 79 MB published |

Findings worth keeping:
- PROJ's inverse Swiss oblique Mercator stops at ~1.1 mm; `Frame.from_enu` refines against the closed-form forward.
- pyogrio cannot read FileGDB TIN solids; one pinned GDAL container (`ghcr.io/osgeo/gdal:ubuntu-small-3.11.4`, no network) converts them.
- The 4 m mesh is the realism bottleneck on cliffs. Next fix: adaptive TIN (error-bounded), which also lowers the root's 300 m geometric error.

## Model re-verification and memory fix (2026-11-22, later the same day)

Trigger: the owner's browser ran out of graphics memory on `/world` (failed textures and tiles, shader errors).
Cause: the root tile's geometric error was the single worst pixel (300 m), and one root above 16 leaves is
all-or-nothing, so every 2048 px leaf loaded at once.

Changes
- **Three levels:** root → 16 mid tiles (8 m mesh, 1024 px) → 16 fine tiles (4 m, 2048 px). Geometric error is the
  99th percentile, not the maximum (root 32 m, mid 1.5–16 m). Overview now loads root + mid only; fine tiles load
  near the camera. Viewer cache is limited in bytes (180–260 MB), textures decode one at a time.
- **Edge skirts on terrain tiles**, as deep as the measured crack between fine and mid along each border + 0.5 m
  (worst crack 112 m on the valley wall).
- **Buildings rebuilt:** winding flipped outward (source solids are all wound inward), single-sided, welded,
  flat-shaded without stored normals; skirts only where the solid stops above ground (2 of 1,567).

Bugs found by the re-verification (all with tests now)
- Footprint buffering with round joins added hundreds of vertices per building, and every building got a skirt.
- `np.allclose` for "ring is closed" is an 11 m tolerance at LV95 magnitudes: a 10 m face lost a corner
  (generic path only; Swiss rings close exactly).
- earcut does not keep a face's winding (generic path only).
- Dropping zero-area sliver triangles opened one solid; slivers are kept.
- A negative mitre buffer erased 3 small buildings; footprints are now a plain union on a 1 mm grid, and dropped
  buildings are counted by reason (8 outside the site, 0 otherwise).

Verification (`world/scripts/verify_models.py`, shares no geometry code with the builder; `audit_buildings.py`)
| Check | Result |
|---|---|
| Khronos glTF validator, 33 glb | 0 errors, 0 warnings |
| Cesium 3d-tiles-validator | 0 errors, 0 warnings |
| Source solids closed and consistently wound | 1,575 / 1,575 (88,610 triangles, 1 sliver, 0 duplicates) |
| Published solids closed and outward | 1,565 + 2 with an open skirt collar = 1,567 |
| Volume / (footprint × height) | 0.34–1.00, median 0.90 |
| Terrain triangles facing up; uv corners; grid monotone | all, every level |
| Skirts vertical, outward, deep enough | 48,000 triangles, all |
| Fine seams | 0.039 mm |
| Digests | 37 / 37 files match the report |
| Tests | 29 world + web suite |

Known limits: lines are draped on the fine surface, so over mid tiles far from the camera parts of a line can dip
under the coarser mesh. Cliff faces still stretch the top-down imagery.

## Owner addition (2026-11-22): one site sim with drones, vehicles, personnel and guards

One simulation runs on the one site. It is milestone 3 (sim core) with the agent set widened; not a separate product.

- **Same world, same frame.** The sim reads the fine terrain surface (`terrain.Surface`), the closed outward building
  solids (collision, line of sight) and `roads.json` (the full 1 m road graph) in the ENU frame of the tiles.
- **Agent kinds from the start:** drone, ground vehicle, robot dog, **person on foot** (staff, visitor), **guard**
  (person with a patrol route, a post, a radio and a field of view). People walk the OSM path/road graph and open
  ground, with slope-dependent speed.
- **What guards and sensors do:** observe, detect, report, hand over, respond by moving. Outputs are detection time,
  coverage gaps, response time, missed handovers. No use of force, weapons or engagement is modelled (scope rule).
- **Core first, behaviours second:** fixed-step deterministic clock, seeded replay file, collision against terrain and
  solids, line of sight, event log, run manifest. Then simple kinematic movers for every kind, then real stacks
  (PX4 SITL, Nav2, MuJoCo) behind the same interface.
- **Invariants to write first:** bit-identical replay from a seed; no agent inside a solid or under the terrain; speed
  and slope limits per kind; line of sight is symmetric; a guard cannot detect through a building or a ridge; every
  detection has a cause in the log; missions change the world only through logged events.
- **Viewer:** agents drawn in `/world` from a replay file, with a time slider.

## Owner addition (2026-11-22): drills and long-horizon runs

- **Drills:** a drill is a scripted mission with injected events (intrusion at a point, sensor fault, road blocked,
  agent lost) run in the site sim, scored on detection time, response time, coverage gaps and missed handovers.
  Same seed, same drill, same result, so a change in procedure or equipment can be compared run against run.
- **Long-horizon runs:** days to months of simulated time for equipment use and monitoring: battery cycles and wear
  (the battery aging model), sensor faults over time (Sitewatch generator), maintenance and availability. The clock
  needs two rates: fine steps while something moves, event-to-event jumps while the site is quiet, with the same
  replay guarantee.
- Extra invariants: skipping quiet time gives the same state as stepping through it; wear never decreases without a
  maintenance event; a drill cannot read the injected events before they happen.

## Milestone 3 result: site sim with a warehouse site, drills and long-horizon runs (2026-11-23)

Code: `world/archworld/sim/` (`scope`, `simworld`, `engine`, `drill`, `compound`, `run`), 31 sim tests in
`world/tests/test_sim.py` (60 with the world tests). Web: sim layer in `/world` (`components/three/world-sim.tsx`).
Run: `uv run python -m archworld.fetch ch-lauterbrunnen` (now also the surface model, +260 MB), rebuild, then
`uv run python -m archworld sim ch-lauterbrunnen --out data/out/ch-lauterbrunnen --seeds 40 --days 30 --publish ../web/public/world/ch-lauterbrunnen/sim --summary ../web/lib/data/world-sim-ch-lauterbrunnen.json` (about 2 minutes).

What it is
- **Discrete-event engine.** Time in integer ms, energy in integer µJ. Motion is piecewise deterministic (legs with
  integer arrival times), so nothing is stepped while nothing happens: a 40 minute drill and a 30 day run use the
  same engine. One random stream per agent, keyed by id. Replay = event log + legs, hashed.
- **World as the sim sees it.** Fine terrain lattice, building solids as prisms, **measured canopy height**
  (swissSURFACE3D raster minus swissALTI3D, 2 m grid: 54% of the valley is forest, median 18.6 m), and the OSM
  path graph (126,259 nodes). State lives in the national grid and is converted to the tiles' ENU frame for
  replays; grid metres differ from true metres by at most 282 ppm here.
- **Agents:** person, guard, robot dog, vehicle, drone, camera mast. They observe, detect, report and move to meet.
  No force, weapon payload or engagement field exists; unknown kinds, payloads and keys are refused.
- **The specific site:** a synthetic warehouse compound (140 × 100 m, fence, one gate, yard road, drone pad, dog
  dock, vehicle bay, gate post, four corner masts) placed by rule: flattest open rectangle (2.95 m relief) with no
  building, tree, path, rail or water in it, whose link to a public road crosses no building, trees, water or rail.
  Provenance method `synthetic`, confidence 0: it never replaces a measured feature.
- **Viewer:** site objects, equipment models at true size, drill playback (play, 1/10/30×, slider, event feed),
  views "Whole valley / Warehouse site / Site from above" and a close-up camera that follows any agent.

Jev hazard review (`jev_sim_review.ts`) and the response
| Hazard (p) | Response |
|---|---|
| No vegetation in line of sight (0.87) | Measured canopy grid; a sight line ends after 25 m of foliage (assumed limit) |
| Detection too deterministic (0.86) | Per-second chance from range, view and sight line; drills run over 40 seeds and report a spread |
| OSM graph gaps (0.85) | Measured: walkable 98.5% and drivable 86.4% in one piece (26 and 13 pieces); routing stays in the main piece |
| Float replay (0.81) | Integer time and energy; manifest records the numpy version. Bit-identical on one platform, not claimed across platforms |
| Sight sampling (0.80) | 1 m samples, symmetric by construction, buildings tested exactly against footprints |
| Off-road movement (0.80) | Unknown persons and responders on foot walk cross-country (8 m grid, A*, 40° limit, fences are barriers) |
| Dual use (0.80) | Compound is notional and must be declared so; no least-detected route planner; findings are defender-side |
| Drone over cliffs (0.78) | Altitude envelope limited by climb rate; clearance and climb tested on every sample |
| Jump on re-tasking (0.75) | An agent on a path finishes the metre it is on; others are cut exactly where they are; tested |
| RNG coupling (0.72) | Per-agent streams; tested by adding agents |
| Quiet-time skip (0.47) | Forced extra sensing ticks give the same digest; tested |
| Grid vs metric (0.40) | Measured and written to every manifest (282 ppm) |

Results (40 seeds per drill; an unknown person appears 450 m north and walks 487 s to the fence line)
| Drill | Detected | Time to detect, median (p10–p90) | Detection to meeting | In the 101 m zone before being met |
|---|---|---|---|---|
| All sensors working | 40/40 | 68 s (60–81), always the drone | 214 s (202–249) | 0/40 |
| Camera mast facing the approach out | 40/40 | 68 s (60–81) | 214 s (202–249) | 0/40 |
| Drone camera out | 40/40 | 555 s (513–614), guard or dog | 147 s (126–156) | 40/40 |

Findings
- The drone carries early detection. Without it detection comes 8 times later and the person is always inside
  the zone first.
- **No mast detected the person in any of 120 runs.** Each corner mast looks out along its diagonal, so an approach
  square-on to the long north side passes between two fields of view, within 67 m of a camera. Verified from the
  replay track against each mast's view. A mast mid-way along each long side would close it.
- 30 days of continuous patrol: drone 889 charge cycles, 47% availability, 82% capacity left under the assumed
  fade; robot dog 172 cycles, 85% availability; vehicle 93 cycles, 67% availability. One drone cannot be the plan.

Bugs the tests and the first real runs caught
- Agents standing on a path node were 0.03 mm under the terrain (rounded road heights).
- Responders were tied to mapped paths, so nobody ever met a person crossing a field.
- The first compound was cut off from the road network: its link ran through a roadside building. The second
  link crossed the river. Both are now ruled out, and a compound that is not connected is refused.
- Slope judged per metre on the 4 m mesh made real roads impassable (vehicle reach 7,202 of 64,345 nodes). On a
  mapped way slope now only slows; hard limits apply off the paths.
- Off-path responders walked back to a path on every position update.

Assumed, not measured (provenance `default`): equipment class figures, detection chance per second, 25 m foliage
limit, 0.6 off-path speed factor, 0.02% capacity fade per cycle. Agents are moving points on real route and sight
geometry: no flight controller, gait or camera model yet (PX4 SITL, MuJoCo and Nav2 go behind the same interface).
Tunnels are not walkable. A leg in progress is not re-planned when a road is blocked. Guards have no shifts.

Next: mid-side masts and a second drone as drill variants; Sitewatch fault generator and the battery aging model in
the long-horizon run; sensor models; then the real autonomy stacks.

## Viewer models (2026-11-23)

Owner request: much more realistic models for guards, robot dog, patrol vehicle and the rest.
- **Robot dog:** Unitree Go2 meshes from MuJoCo Menagerie (BSD-3-Clause, (c) Unitree Robotics). The MJCF body tree is
  kept as glTF nodes, so the viewer drives thigh and calf joints in a trot that advances with distance covered.
  196,748 faces decimated to 141,924; 2.3 MB.
- **Drone:** Skydio X2 from MuJoCo Menagerie (Apache-2.0), textured; pitches nose-down when flying.
- **People:** CesiumMan body and 2 s walk cycle (CC BY 4.0, (c) 2017 Cesium). Its texture (which carries the Cesium
  logo) is not used; the viewer colours the body by measured region: guard in hi-vis vest, navy sleeves and cap;
  unknown person in hoodie and jeans. The walk cycle advances with distance. Proportions are stylised (large head):
  it is a mannequin, not a scanned person.
- **Patrol vehicle, camera mast, warehouse details:** modelled in code (`web/components/three/world-models.ts`):
  double-cab pickup from extruded side profiles with wheel arches, glasshouse, pillars, beacon bar, lamps, wheels
  that turn with distance; mast with base, tapered pole, cabinet, pitched camera, aerial, solar panel; warehouse
  roller doors, personnel door and plinth.
- Looks only: the sim's speed, battery and sensor figures remain class assumptions, not Go2 or X2 data.
- Reproduce: `world/scripts/fetch_models.sh` (pinned Menagerie commit 370c439) then `scripts/convert_models.py`
  (command in its docstring). Output goes to `web/public/world/models/` with `CREDITS.json` and licence texts;
  attribution is shown under the viewer. Not committed (built output), like the tiles.
- Not done: a realistic human (no openly licensed, logo-free, rigged one was at hand), vehicle suspension, rotor
  animation, vegetation models.

## Warehouse site as its own scene, with downloaded assets (2026-11-23)

Owner request: download from other sources; a very realistic warehouse site; work in another environment because
the 4 km map is too much to process.

- **Separate environment.** `python -m archworld yard ch-lauterbrunnen --out data/out/ch-lauterbrunnen --publish
  ../web/public/world/ch-lauterbrunnen/yard` cuts a 512 m square round the compound: terrain on a 1 m lattice (from
  the 0.5 m model, with normals), imagery at 12.5 cm (from the 10 cm orthophoto), the 26 measured buildings in it,
  184 trees (one per canopy peak, measured position and height, generic shape) and a height lookup (fit 5 mm).
  18.6 MB, 20 s. Page `/world/site`; the valley page links to it. Nothing of the valley tileset is loaded there.
- **Downloaded assets** (`world/scripts/fetch_site_assets.py`; data files only, nothing downloaded is executed;
  29 MB web copy, `CREDITS.json` with licence, source and sha256 per asset, licence texts alongside):
  - Poly Haven, CC0: 17 photoscanned props (chain-link fence kit, roller shutter, covered car, concrete barrier,
    security camera, flood lights, barrels, crates, boxes, generator, utility and power boxes, air-conditioning
    unit, bins, hand truck), 4 PBR materials (corrugated steel, asphalt, concrete, painted metal), 1 sky (HDR).
  - Microsoft Rocketbox, MIT: `Security_Male_01` (uniform, cap, torch on the belt, no weapon), `Male_Adult_08`,
    walk and idle animations. Loaded as FBX in the browser; textures converted from TGA to web sizes.
  - Kept from before: Unitree Go2 (BSD-3), Skydio X2 (Apache-2.0).
- **Scene** (`web/components/three/site-build.ts`, `site-scene.tsx`): image-based lighting from the sky, a sun
  placed at the sky's brightest point (48 degrees), shadows, filmic tone mapping; warehouse in corrugated steel on
  a concrete plinth with roller doors, ramps, gutters, roof lights, wall lights, cameras, air-conditioning; asphalt
  yard with markings; scanned fence panels and posts every 2 m on the measured ground; gate with posts, boom,
  barriers and cabin; lighting columns; stock on the apron. Agents and playback are the same replays, moved to the
  local frame and set on the fine terrain. Quality: "Full, with shadows" or "Light" (no shadow pass); software
  renderers start in Light.
- A converter binary (FBX2glTF) was considered and not used: running a downloaded executable was refused by the
  session's safety check, and the browser's own FBX loader made it unnecessary.
- **Not realistic yet:** the patrol vehicle (modelled in code; no openly licensed realistic pickup found), tree
  shapes, the yard texture repeat seen from far away. Baked shadows in the aerial imagery do not match the sun.
- Verified here only in a software-rendered headless browser (both quality modes drew correctly). Not measured:
  frame rate and memory on the owner's GPU.

## More operations at the warehouse, and ORION in the flow (2026-11-23)

Owner request: more defence operations in the same warehouse, inspired by search; then integrate ORION in the flow.

Search grounding (sources in the session summary)
- Sandia's physical-protection method: system effectiveness rests on the probability of interruption: detection and
  assessment early enough that the response arrives before the adversary's remaining task time runs out.
- CargoNet Q3 2026: fictitious pickups were 25% of cargo-theft incidents; 2025 losses about $725 million.
- GXO/Asylon: drones and robot dogs verify alarms so people respond only to real ones; DHL notes false alarms and
  blind spots as the limits of automated systems.
- Fence sensors: roughly one nuisance alarm per kilometre per day for a good installation, several a day for a poor
  one; detection probability specified at 95-99%. Manual gate check-in: 5-10 minutes (vendor-reported).
- Evacuation pre-movement times follow lognormal or log-logistic spreads (Fire Technology 2019, 2,486 data points).

Operations (`world/archworld/sim/ops.py`, `OpsSim`; 20 tests in `tests/test_ops.py`)
- **Protection timeline:** the subject crosses the fence (30 s assumed), walks to a door, works on it (90 s
  assumed). Fence sensor Pd 0.95; a camera covering the spot assesses 20 s later. Cases: all sensors; drone camera
  out; drone camera and fence sensor out. Plus eight approach directions and three door delays.
- **Alarms:** nuisance fence alarms (Poisson, 3 a day). "Machine checks first" (drone, else robot dog, else a
  patrolling guard; never a machine whose camera is out) against "everyone responds". 30-day workload, and a coupled
  drill: a real intrusion five minutes after a nuisance alarm on the far side.
- **Gate:** trucks (Poisson, 4 an hour, 10 h) queue first come first served; one check at a time by the gate guard
  (if he is away on a response, the queue waits); paper check against call-back; one fictitious booking per shift.
- **Evacuation:** 12 workers, half indoors, lognormal pre-movement, muster point by the gate; variant with the
  nearest exit blocked. New kinds `worker` and `truck`, role `visitor`.

Jev hazard review (`jev_ops_review.ts`): all ten rated likely (0.65-0.91). Addressed by runs: coupling of operations
and real-alarm risk (coupled drill), single path (direction sweep), assumed delays (sensitivity), best-case
evacuation (blocked exit, labelled best case). Stated as limits on the page: verifier never wrong, one-lane gate,
"stopped" share is the assumed catch rate by construction, daylight only, notional site.

A modelling flaw found and fixed on the way: a fence alarm sent staff to the outer side of the fence, so they left
by the gate and walked round, and a checker "cleared" a real alarm after the intruder had gone in. Alarms are now
checked from 10 m inside the fence (`_check_point`, tested). The first coupled result (20/40 against 40/40) came
from that flaw and was discarded.

ORION in the flow (`world/scripts/run_flow.sh`: build, sim, measures, orion, yard)
1. `archworld sim` finds the gaps.
2. `archworld measures` runs each candidate improvement in the sim on a hard case (drone camera and fence sensor
   out), same seeds as the baseline: mid-side camera masts, a second drone, a second patrolling guard.
3. `orion_site.ts` gives ORION those numbers, plus the measured alarm and gate comparisons, as evidence for five
   options and writes `web/lib/data/world-orion-<site>.json` (ranking, chance of being first, Eisenhower / effort /
   door reading, agreement of the five methods, digest of the evidence text).
4. `/world` shows the ranking with the evidence line ORION was given for each option.
ORION does not know costs, and its evidence carries the simulation's assumptions.

### Final run and what was added after it (2026-11-23, evening)

The line above ("ORION does not know costs") is superseded: options now carry rough public price ranges
(`measures.COSTS`), and the flow is build, sim, measures, coverage, orion, yard, report.

Camera coverage (`archworld coverage`, `sim/coverage.py`): a point counts as seen when it is in range and field of
view of a mast with a clear line of sight over terrain, buildings and canopy.
- As first laid out (four corner masts facing outward): 2% of the 480 m fence line and 0% of the yard.
- Same four masts aimed along the fence: 100% and 100%. No new equipment.
- Two more mid-side masts, all facing outward: 2% and 0%.

Hard case (protection timeline, first drone's camera and the fence sensor out), 40 seeds:
- Baseline: intruder met in time 31/40. North approach is the weakest (31/40); south 38/40; the rest 40/40;
  east and west are not walkable.
- Every measure reaches 40/40: re-aimed masts, mid masts, second drone, second guard.
- Door-delay sensitivity: 45 s 30/40, 90 s 31/40, 180 s 37/40.

Other operations results: verify-first sends guards 0 times over 94 nuisance alarms in 30 days (114 times and
6.5 guard hours when everyone responds); call-back at the gate stops the fictitious pickup in 38/40 shifts against
12/40 on paper, at a mean wait of 9 min against 3; all 12 staff muster in 40/40 evacuation drills, last person
after 178 s (247 s with the nearest exit blocked).

ORION ranking (agreement of methods 0.68): 1 re-aim the corner cameras, 2 second drone, 3 call-back at the gate,
4 verify-first, 5 mid masts, 6 second guard.

Report: `world/scripts/make_report.py` writes `reports/<site>-site-assessment.md` from the JSON outputs; the PDF
is rendered into `web/public/world/<site>/report/` (not in git, like the rest of the generated world).

Bugs found and fixed on the way: task time was booked under the new state when an agent was reassigned
(`Sim._assign` now settles first); a zero-length response never released the agent; a faulted machine could be
picked to verify an alarm.

Known rough edges: the report and the ORION evidence round the mid-mast fence share differently (2% and 3%, the
value is 2.5%); the new replays (truck, worker, gate, evacuation) were not checked in a browser after the final run.

## Realism and statistics fixes, and DoD engineering practice (2026-11-23, night)

Independent assessment (subagent, read-only) found three problems that changed the recommendation. All three were
fixed test-first (`world/tests/test_realism.py`, 19 tests):

1. **Cameras by pixel density.** A mast used to "see" a person anywhere within 200 m. Detection now follows
   IEC 62676-4: no detection below 25 px/m, full chance from 63 px/m. A 1080p camera with a 90° lens detects out to
   38 m, a 4K one to 77 m. `scope.MAST_SENSORS`, `scope.p_notice`, used by the engine, alarm assessment and coverage.
2. **Seen-before-fence flag** counted runs only when the person reached the fence; a person met earlier counted as
   "not seen". Fixed in `drill.score_timeline`. **Intrusion times** are now drawn per seed 1-9 h into a shift
   (`drill.intrusion_ms`, `drill.at_time`), so drills meet equipment charging, low or mid-patrol, and every variant of
   a seed meets the intruder at the same time (paired).
3. **Statistics.** Exact Clopper-Pearson intervals, exact McNemar paired tests and tie groups (`sim/stats.py`);
   measures run on 120 seeds; ORION is told which options the runs cannot separate.

Results (hard case: drone camera and fence sensor out, 120 seeds):

| Measure | Met in time | 95% interval |
|---|---:|---:|
| As it is now | 97/120 | 73-87% |
| Re-aim the corner cameras | 97/120 | 73-87% (no difference) |
| 4K cameras on the corner masts, aimed along the fence | 119/120 | 95-100% |
| Two more masts mid-way | 114/120 | 89-98% (tied with 4K) |
| Second drone | 111/120 | 86-97% (tied with second guard) |
| Second guard | 113/120 | 88-98% |

Coverage (fence / yard): as laid out 2% / 0%; re-aimed 32% / 20%; 4K re-aimed 63% / 69%. The earlier headline
("re-aiming gives 100% / 100% and 40/40") came from the 200 m camera and is withdrawn. ORION now ranks 4K cameras
first; it still ranks re-aiming second on cost although the runs cannot tell it from doing nothing (shown in the
report's measured table).

Engineering practice now follows tailored DoD instruments, see `docs/ENGINEERING.md`: VV&A per DoDI 5000.61 and
MIL-STD-3022 (`docs/vva/`, V&V Report generated and passing, accreditation decision pending the owner), MIL-STD-882E
hazard log enforced by `world/tests/test_hazards.py`, Software Acquisition Pathway roadmap with a release gate, and a
DevSecOps pipeline (`.github/workflows/devsecops.yml`). Static analysis found one medium issue (URL scheme not
checked); downloads are now HTTPS-only, with a test.
