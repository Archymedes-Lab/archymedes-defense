import "server-only";
import ch from "./data/world-ch-lauterbrunnen.json";

export interface TileError { tile: [number, number]; rmse_m: number; p99_m: number; max_m: number; pixels: number }
export interface Source { layer: string; url: string; sha256?: string; bytes?: number; licence: string; retrieved?: string; note?: string }
export interface WorldReport {
  site: { id: string; name: string; crs: string; bounds: number[]; size_m: number; tile_m: number; notes: string };
  frame: { lon0: number; lat0: number; vertical_method: string };
  grid: { leaf_step_m: number; root_step_m: number; tex_px: number; tex_m_per_px: number };
  sources: Source[];
  coverage: Record<string, Record<string, number>>;
  terrain: { tiles: TileError[]; max_seam_gap_m: number; root_max_err_m: number; root_p99_err_m: number; rmse_m: number };
  buildings: { count: number; input: number; closed_solids: number; winding_flipped: number; skirted: number; dropped: Record<string, number>; floating: number; base_above_ground: number; embed_m: { p5: number; median: number; p95: number } };
  lines: { ways: number; rendered: number; by_kind: Record<string, number> };
  digests: Record<string, string>;
}

export const swiss = ch as unknown as WorldReport;

/** Invariants checked by `uv run pytest` in world/ (tests/test_invariants.py). Kept in step with that file by hand. */
export const INVARIANTS: { group: string; rule: string; why: string }[] = [
  { group: "Provenance", rule: "Every value has a source, a licence, a method and a confidence within that method's cap", why: "No anonymous facts in the world" },
  { group: "Provenance", rule: "A deduced value can never replace a measured one (measured > tagged > inferred > default)", why: "Deduction fills gaps, it does not overwrite data" },
  { group: "Hidden truth", rule: "LoD2 buildings and lidar cannot be opened for deduction", why: "Milestone 2 is scored against them" },
  { group: "Frames", rule: "LV95 → ENU → LV95 round trip under 1 mm anywhere in the site, heights included", why: "One frame for tiles and simulation" },
  { group: "Frames", rule: "Heights use the CHGeo2004 geoid grid, never a ballpark offset", why: "The offset varies by 35 cm across this site" },
  { group: "Terrain", rule: "Adjacent tiles share edge vertices bit for bit; under 1 mm after float32 storage", why: "No cracks at tile seams" },
  { group: "Terrain", rule: "Placement height = the rendered triangles, not the source raster", why: "Roads and buildings sit on what you see" },
  { group: "Buildings", rule: "Every solid is checked for closure (each edge used once in each direction) and wound outward; none is dropped without being counted", why: "Closed, outward solids are what collision and line-of-sight need later" },
  { group: "Buildings", rule: "No building floats: the solid, or a skirt added only where needed, reaches 0.5 m below the lowest rendered ground under its footprint", why: "Coarse terrain on slopes would otherwise leave gaps" },
  { group: "Lines", rule: "Roads densified to ≤ 1 m and draped at a fixed offset; tunnels kept as data, not drawn", why: "Ribbons neither cut in nor hover" },
  { group: "Licences", rule: "One licence family per file: OSM (ODbL) never inside swisstopo tiles", why: "Share-alike stays contained" },
  { group: "Determinism", rule: "Same inputs give byte-identical tiles and reports (digests compared)", why: "Runs are evidence only if they repeat" },
];

// ---------------------------------------------------------------- site sim (world/archworld/sim)
import simCh from "./data/world-sim-ch-lauterbrunnen.json";

export interface Quant { n: number; p10: number; median: number; p90: number }
export interface DrillBatch {
  id: string; title: string; info: { approach_bearing_deg: number; start_m: number; walk_s: number; faulted?: string };
  runs: number; detected: number; contacted: number; entered_zone: number; entered_zone_before_contact: number;
  time_to_detect_s: Quant | null; time_to_contact_s: Quant | null; detect_to_contact_s: Quant | null;
  replay_seed: number; replay_digest: string;
}
export interface HorizonAgent { kind: string; label: string; distance_m: number; moving_ms: number; idle_ms: number; charging_ms: number; cycles: number; capacity_fraction: number | null; availability: number | null }
export interface OpsSummary {
  timeline: { id: string; title: string; info: { fence_pd: number; fence_delay_s: number; door_delay_s: number; faulted?: string }; runs: number; interrupted: number; task_completed: number; fence_alarm: number; detected_before_fence: number; time_to_detect_s: Quant | null; contact_s: Quant | null; margin_s: Quant | null; task_s: Quant | null }[];
  alarms: { policy: string; title: string; days: number; per_day: number; alarms: number; cleared: number; guard_hours_on_alarms: number; dog_hours_on_alarms: number; drone_hours_on_alarms: number; guard_dispatches: number; drone_verifications: number; unverified: number }[];
  gate: { procedure: string; hours: number; runs: number; trucks: Quant; mean_wait_s: Quant; p90_wait_s: Quant; max_wait_s: Quant; max_queue: Quant; stopped: number; lost: number }[];
  evacuation: { title: string; runs: number; all_mustered: number; median_s: Quant; last_s: Quant };
  evacuation_blocked: { title: string; runs: number; all_mustered: number; median_s: Quant; last_s: Quant };
  coupled: { policy: string; runs: number; interrupted: number; task_completed: number; contact_s: Quant | null }[];
  sweep: { bearing_deg: number; walkable: boolean; runs?: number; interrupted?: number; task_completed?: number; detected_before_fence?: number }[];
  sensitivity: { door_delay_s: number; runs: number; interrupted: number }[];
  replays: { id: string; title: string }[];
  assumptions: { fence_pd: number; fence_delay_s: number; door_delay_s: number; check_s: number[]; callback_s: number[]; p_catch: Record<string, number>; trucks_per_hour: number; nuisance_per_day: number; premovement: string; workers: number };
}
export interface SimSummary {
  compound: { centre: number[]; relief_m: number; size: number[]; gate_side: string };
  graph: { nodes: number; edges_dropped_inside_buildings: number; foot: { components: number; main_fraction: number }; drive: { components: number; main_fraction: number } };
  frame_distortion_ppm: number;
  agents: { id: string; kind: string; label: string; payloads: string[] }[];
  drills: DrillBatch[];
  operations: OpsSummary;
  replays: { id: string; title: string }[];
  horizon: { days: number; events: number; digest: string; agents: Record<string, HorizonAgent> };
  assumptions: { fade_per_cycle: number; foliage_path_limit_m: number; off_path_speed_factor: number; kinds: Record<string, { vmax_ms: number; battery_wh: number; move_w: number; sensor: { range_m: number; fov_deg: number; p0: number } | null }> };
  seconds: number;
}
export const swissSim = simCh as unknown as SimSummary;

/** Checked by tests/test_sim.py. Kept in step with that file by hand. */
export const SIM_INVARIANTS: { group: string; rule: string; why: string }[] = [
  { group: "Scope", rule: "Unknown agent kinds, payloads and fields are refused; there is no weapon payload and no engagement field", why: "Guards and machines observe, detect, report and move" },
  { group: "Scope", rule: "A protected zone must be declared notional; drill subjects walk scripted or fastest routes, never a least-seen route", why: "No real facility layouts, no evasion planning" },
  { group: "Replay", rule: "Same seed gives the same event log and positions, bit for bit; a different seed gives a different run", why: "A drill result can be checked by re-running it" },
  { group: "Causality", rule: "An injected event changes nothing before its own time", why: "A drill cannot be answered in advance" },
  { group: "Randomness", rule: "Each agent has its own random stream: adding an agent does not change another agent's run", why: "Runs with different equipment stay comparable" },
  { group: "Time", rule: "Extra sensing ticks while nobody is there change nothing", why: "Skipping quiet time over 30 days is exact" },
  { group: "Motion", rule: "No agent under the terrain or inside a building; no jump when re-tasked; speed limits hold; drones keep clearance and climb rate", why: "Tracks are physically possible" },
  { group: "Sight", rule: "Line of sight is symmetric and blocked by terrain, buildings and more than 25 m of foliage", why: "Detection follows the measured valley" },
  { group: "Detection", rule: "Every detection names its observer, range and a working sensor; none through a building, a ridge or a faulted camera", why: "Each alarm has a cause" },
  { group: "Energy", rule: "Energy never rises without a charge event and never goes negative; a leg starts only if the battery covers it and the way home", why: "Equipment-use numbers add up" },
  { group: "Operations", rule: "A subject crosses a barrier slowly, never by a jump; an alarm is assessed 20 s later only by a camera that covers the spot", why: "The protection timeline is honest about delay and assessment" },
  { group: "Operations", rule: "The gate checks one truck at a time in arrival order; no truck is inside the fence before it is admitted; a fictitious booking is stopped or counted as a loss, never dropped", why: "Gate figures cannot hide an outcome" },
  { group: "Operations", rule: "A verified nuisance alarm leaves every guard's run unchanged; nobody moves before the evacuation alarm and everyone is counted at the muster point", why: "Procedures can be compared like for like" },
  { group: "Compound", rule: "The synthetic compound replaces no measured feature, sits on open ground and is reachable only through its gate", why: "Placed objects stay separate from data" },
];

// ---------------------------------------------------------------- measured improvements and ORION's ranking of them
import measuresCh from "./data/world-measures-ch-lauterbrunnen.json";
import orionCh from "./data/world-orion-ch-lauterbrunnen.json";
import coverageCh from "./data/world-coverage-ch-lauterbrunnen.json";

export interface Cost { one_off_usd: [number, number]; per_year_usd: [number, number]; basis: string }
export interface CoverageVariant { masts: number; fence: { length_m: number; seen_share: number; seen_by_two_share: number; blind_m: number; gaps: { side: string; length_m: number }[] }; yard: { seen_share: number; area_m2: number }; band: { seen_share: number; area_m2: number } }
export interface Coverage { method: string; variants: Record<string, CoverageVariant> }
export interface Rate { k: number; n: number; share: number; lo: number; hi: number }
export interface Measure { label: string; cost: Cost; runs: number; met_in_time: number; met_in_time_ci: Rate; vs_baseline_p: number; tie_group: number; tied_with: string[]; task_completed: number; seen_before_fence: number; time_to_detect_s: Quant | null; time_to_contact_s: Quant | null; drone_cover?: { drones: number; days: number; share_with_a_drone_available: number } }
export interface Measures { drill: string; seeds: number; intrusion_window_s: [number, number]; measures: Record<string, Measure>; note: string }
export interface OrionRow { rank: number; id: string; label: string; evidence: string; pFirst: number; eisenhower: string; effort: string; door: string; level: Record<string, number> }
export interface OrionVerdict { engine: string; model: string; agreement: number; rows: OrionRow[]; context_sha256: string; note: string; evidence_from: { sim_digest: string; seeds: number } }
export const swissMeasures = measuresCh as unknown as Measures;
export const swissOrion = orionCh as unknown as OrionVerdict;
export const swissCoverage = coverageCh as unknown as Coverage;
