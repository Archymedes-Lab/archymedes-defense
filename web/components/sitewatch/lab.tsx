"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Legend, Panel } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/segmented";
import type { Cause } from "@/lib/causes";
import { CAUSES, KIND_TO_CAUSE, RETROSPECTIVE } from "@/lib/causes";
import type { Alarm, RunError, RunResult, View } from "@/lib/sitewatch";
import type { SensorState } from "@/components/three/site";
import runIndex from "@/lib/data/runs.json";

/** Hosted builds (Vercel) have no Python engine: they load runs precomputed by the same runner. */
const STATIC = process.env.NEXT_PUBLIC_ENGINE === "static";
const RUNS = runIndex.runs as { seed: number; hours: number; file: string }[];

const SiteScene = dynamic(() => import("@/components/three/site").then((m) => m.SiteScene), {
  ssr: false, loading: () => <div className="aspect-[4/3] w-full animate-pulse bg-surface" />,
});

const fmt = (m: number) => `T+${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
const LEGEND: Cause[] = ["link_lost", "intermittent_loss", "link_buffered", "clock_step", "frozen_reading", "power_loss_reboot", "silent", "offline"];

interface Active { cause: Cause; alarm?: Alarm; kind?: string; start?: number; end?: number }

function activeAt(run: RunResult, view: View, t: number): Record<string, Active> {
  const out: Record<string, Active> = {};
  if (view === "truth") {
    for (const e of run.truth ?? []) {
      const end = e.kind === "clock_step" ? e.start + 6 : e.end;
      if (e.start <= t && t < end) out[e.device] = { cause: KIND_TO_CAUSE[e.kind] ?? "silent", kind: e.kind, start: e.start, end: e.end };
    }
    return out;
  }
  for (const a of view === "sitewatch" ? run.sitewatch : run.naive) {
    const end = a.cleared ?? run.timeline.minutes;
    const until = a.cause === "clock_step" ? a.raised + 6 : end;
    if (a.raised <= t && t < until) {
      const pending = RETROSPECTIVE.has(a.cause) && a.cleared !== null && t < a.cleared;
      out[a.device] = { cause: pending ? "silent" : a.cause, alarm: a };
    }
  }
  return out;
}

function why(device: string, act: Active): string {
  const a = act.alarm;
  if (!a) return `Injected ${act.kind?.replaceAll("_", " ")} from ${fmt(act.start ?? 0)}${act.kind === "clock_step" ? "" : ` to ${fmt(act.end ?? 0)}`}.`;
  const ev = a.evidence as Record<string, number | string | boolean>;
  const lag = Math.round((a.raised - a.onset) * 60);
  switch (act.cause) {
    case "silent": return `No messages since ${fmt(a.onset)}. Raised after ${lag} s. The cause is named when messages resume.`;
    case "link_lost": return `${ev.seq_gap} sequence numbers never arrived, same boot. Messages were lost in transit.`;
    case "link_buffered": return "No sequence gap. Held messages arrived in a burst: the link was down, the data was kept.";
    case "power_loss_reboot": return `Boot id changed from ${ev.boot_before} to ${ev.boot_after}. The device lost power and restarted.`;
    case "clock_step": return `Device clock jumped ${Math.round(Number(ev.step_ms) / 60000)} min against receive time. Freshness still uses receive time.`;
    case "intermittent_loss": return `Loss rate ${Math.round(Number(ev.loss_rate_at_raise ?? 0) * 100)}% in the recent window.`;
    case "frozen_reading": return `Identical reading for 30 or more messages.${device === "hum-10" ? " Known hard case: this sensor reports whole numbers and is often legitimately flat." : ""}`;
    case "offline": return "Newest device timestamp is older than 3 heartbeats. No cause is given.";
    case "never_seen": return "No message from this device in the whole window.";
    default: return "";
  }
}

function Timeline({ run, playhead, onSeek }: { run: RunResult; playhead: number; onSeek: (m: number) => void }) {
  const { minutes, devices, value } = run.timeline;
  const W = 1160, left = 78, right = 14, laneH = 36, top = 24, H = top + devices.length * laneH + 8;
  const x = (m: number) => left + (m / minutes) * (W - left - right);
  const svgRef = useRef<SVGSVGElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const seek = (clientX: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const vx = ((clientX - r.left) * W) / r.width;
    onSeek(Math.max(0, Math.min(minutes - 0.5, ((vx - left) / (W - left - right)) * minutes)));
  };
  const hours = Math.floor(minutes / 60);
  const step = hours > 12 ? 2 : 1;
  const show = (e: React.MouseEvent, text: string) => setTip({ x: e.clientX, y: e.clientY, text });
  return (
    <div className="relative overflow-x-auto">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[760px]" role="img" aria-label="Per-sensor timeline of readings, true faults, Sitewatch alarms and naive alarms"
        onMouseLeave={() => setTip(null)}>
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--fg-3)" strokeWidth="1.5" />
          </pattern>
        </defs>
        {Array.from({ length: Math.floor(hours / step) + 1 }, (_, i) => i * step).map((h) => (
          <g key={h}>
            <line x1={x(h * 60)} x2={x(h * 60)} y1={top - 4} y2={H - 6} stroke="var(--line)" />
            <text x={x(h * 60)} y={13} fontSize={10.5} textAnchor={h === 0 ? "start" : "middle"}>T+{h}h</text>
          </g>
        ))}
        {devices.map((d, i) => {
          const y0 = top + i * laneH;
          const pts = (value[d] ?? []).map((v, m) => [m, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
          let path = "";
          if (pts.length) {
            const lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1])), span = hi - lo || 1;
            let prev = -2;
            for (const [m, v] of pts) {
              path += `${m === prev + 1 ? "L" : "M"}${x(m + 0.5).toFixed(1)},${(y0 + laneH - 8 - ((v - lo) / span) * (laneH - 20)).toFixed(1)}`;
              prev = m;
            }
          }
          const bars = (list: Alarm[], y: number, h: number, engine: string) => list.filter((a) => a.device === d).map((a, k) => {
            const end = a.cause === "clock_step" ? a.raised + 1.5 : a.cleared ?? minutes;
            return (
              <rect key={`${engine}${k}`} x={x(a.raised)} y={y} width={Math.max(x(end) - x(a.raised), 3)} height={h}
                fill={CAUSES[a.cause].color} stroke="var(--raised)" strokeWidth={1}
                onMouseMove={(e) => show(e, `${d} · ${engine}: ${CAUSES[a.cause].label}. Raised ${fmt(a.raised)}${a.cleared !== null ? `, cleared ${fmt(a.cleared)}` : ", still open"}.`)} />
            );
          });
          return (
            <g key={d}>
              {i > 0 && <line x1={left} x2={W - right} y1={y0} y2={y0} stroke="var(--line)" strokeDasharray="2 3" />}
              <text x={0} y={y0 + laneH / 2 + 4} fontSize={11} style={{ fill: "var(--fg)" }}>{d}</text>
              {(run.truth ?? []).filter((e) => e.device === d).map((e, k) => (
                <rect key={`t${k}`} x={x(e.start)} y={y0 + 3} width={Math.max(x(e.end) - x(e.start), 3)} height={laneH - 6} fill="url(#hatch)"
                  onMouseMove={(ev) => show(ev, `${d} · injected ${e.kind.replaceAll("_", " ")}, ${fmt(e.start)}${e.kind === "clock_step" ? "" : ` to ${fmt(e.end)}`}`)} />
              ))}
              {path && <path d={path} fill="none" stroke="var(--fg-3)" strokeWidth={1} opacity={0.75} />}
              {bars(run.sitewatch, y0 + 6, 13, "Sitewatch")}
              {bars(run.naive, y0 + laneH - 12, 6, "Naive")}
            </g>
          );
        })}
        <line x1={x(playhead)} x2={x(playhead)} y1={top - 8} y2={H - 4} stroke="var(--accent)" strokeWidth={2} />
        <rect x={x(playhead) - 5} y={top - 14} width={10} height={8} fill="var(--accent)" />
        <rect x={left} y={0} width={W - left - right} height={top} fill="transparent" style={{ cursor: "ew-resize" }}
          onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); seek(e.clientX); }}
          onPointerMove={(e) => { if (e.buttons) seek(e.clientX); }} />
      </svg>
      {tip && (
        <div className="pointer-events-none fixed z-50 max-w-[300px]  border border-line bg-raised px-3 py-2 text-[12px]"
          style={{ left: Math.min(tip.x + 14, window.innerWidth - 310), top: tip.y + 14 }}>{tip.text}</div>
      )}
    </div>
  );
}

export function SitewatchLab() {
  const [run, setRun] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState("7");
  const [hours, setHours] = useState("6");
  const [view, setView] = useState<View>("sitewatch");
  const [playhead, setPlayhead] = useState(142);
  const [playing, setPlaying] = useState(false);
  const invRef = useRef<HTMLInputElement>(null);
  const telRef = useRef<HTMLInputElement>(null);

  const call = useCallback(async (init: RequestInit) => {
    setBusy(true); setError(null); setPlaying(false);
    try {
      const res = await fetch("/api/sitewatch", { method: "POST", ...init });
      const body = (await res.json()) as RunResult | RunError;
      if (!body.ok) { setError(body.error + (body.line ? ` (line ${body.line})` : "")); return; }
      setRun(body);
      if (body.mode === "uploaded") setView("sitewatch");
      setPlayhead((p) => Math.min(p, body.timeline.minutes - 0.5));
    } catch {
      setError("The engine did not answer. Check that the server is running.");
    } finally {
      setBusy(false);
    }
  }, []);

  const runSeed = useCallback(async (s: number, h: number) => {
    if (!STATIC) return call({ headers: { "content-type": "application/json" }, body: JSON.stringify({ seed: s, hours: h }) });
    const hit = RUNS.find((r) => r.seed === s && r.hours === h);
    if (!hit) { setError("NOT_PRECOMPUTED"); return; }
    setBusy(true); setError(null); setPlaying(false);
    try {
      const body = (await (await fetch(hit.file)).json()) as RunResult;
      setRun(body);
      setPlayhead((p) => Math.min(p, body.timeline.minutes - 0.5));
    } catch {
      setError("RUN_UNAVAILABLE");
    } finally {
      setBusy(false);
    }
  }, [call]);

  useEffect(() => { void runSeed(7, 6); }, [runSeed]);

  useEffect(() => {
    if (!playing || !run) return;
    let last = performance.now(), frame = 0;
    const tick = (now: number) => {
      setPlayhead((p) => {
        const next = p + ((now - last) / 1000) * 6;
        if (next >= run.timeline.minutes - 0.5) { setPlaying(false); return run.timeline.minutes - 0.5; }
        return next;
      });
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, run]);

  const active = useMemo(() => (run ? activeAt(run, view, playhead) : {}), [run, view, playhead]);
  const states = useMemo(() => {
    const out: Record<string, SensorState> = {};
    for (const [d, a] of Object.entries(active)) out[d] = { color: CAUSES[a.cause].color, label: CAUSES[a.cause].label };
    return out;
  }, [active]);

  const upload = (e: React.FormEvent) => {
    e.preventDefault();
    const inv = invRef.current?.files?.[0], tel = telRef.current?.files?.[0];
    if (!inv || !tel) { setError("Choose both an inventory (.json) and a telemetry file (.jsonl)."); return; }
    const form = new FormData();
    form.set("inventory", inv); form.set("telemetry", tel);
    void call({ body: form });
  };

  const views = [{ value: "sitewatch" as const, label: "Sitewatch" }, { value: "naive" as const, label: "Naive monitor" },
    ...(run?.truth ? [{ value: "truth" as const, label: "Ground truth" }] : [])];
  const keys = Object.keys(active).sort();

  return (
    <div className="grid gap-6">
      <Panel className="flex flex-wrap items-end gap-4 p-4 sm:p-5">
        {STATIC ? (
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
            <label className="grid gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Precomputed run
              <select id="sw-run" value={`${seed}-${hours}`} disabled={busy}
                onChange={(e) => { const [s, h] = e.target.value.split("-").map(Number); setSeed(String(s)); setHours(String(h)); void runSeed(s!, h!); }}
                className="field w-auto">
                {RUNS.map((r) => <option key={r.file} value={`${r.seed}-${r.hours}`}>Seed {r.seed} · {r.hours} h</option>)}
              </select>
            </label>
            <p className="max-w-[46ch] text-[12.5px] text-fg-2">Hosted version: these runs were produced by the same engine ahead of time. Run the app locally to try any seed or diagnose your own files.</p>
          </form>
        ) : (<>
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const s = Number(seed), h = Number(hours); if (Number.isInteger(s) && s >= 0) void runSeed(s, h); else setError("Seed must be a whole number from 0."); }}>
          <label className="grid gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Seed
            <input id="sw-seed" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, "").slice(0, 10))}
              className="field w-28" />
          </label>
          <label className="grid gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Hours
            <select id="sw-hours" value={hours} onChange={(e) => setHours(e.target.value)} className="field w-auto">
              {[3, 6, 12, 24].map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? "Running…" : "Run synthetic site"}
          </button>
        </form>
        <div className="hidden h-10 w-px bg-line sm:block" />
        <form className="flex flex-wrap items-end gap-3" onSubmit={upload}>
          <label className="grid gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Inventory (.json)
            <input id="sw-inv" ref={invRef} type="file" accept=".json,application/json" className="max-w-[270px] text-[11px] text-fg-2 file:mr-2 file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-fg" />
          </label>
          <label className="grid gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">Telemetry (.jsonl)
            <input id="sw-tel" ref={telRef} type="file" accept=".jsonl,.ndjson,.txt" className="max-w-[270px] text-[11px] text-fg-2 file:mr-2 file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-fg" />
          </label>
          <button type="submit" disabled={busy} className="btn-ghost">Diagnose my files</button>
        </form>
        </>)}
        {error && <p role="alert" className="basis-full text-[13px] text-critical">Engine refused the input: <span className="font-mono">{error}</span></p>}
      </Panel>

      {run && (
        <>
          <Panel className="overflow-hidden">
            <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <div className="border-b border-line lg:border-r lg:border-b-0">
                <SiteScene devices={run.timeline.devices} states={states} animate={keys.length > 0} />
              </div>
              <div className="grid content-start gap-5 p-5">
                <Segmented label="Which view colors the site" value={view} options={views} onChange={setView} />
                <div>
                  <div className="eyebrow">Trace time</div>
                  <div className="num text-[44px] font-semibold leading-none tracking-tight">{fmt(playhead)}</div>
                </div>
                <div className="eyebrow">{view === "truth" ? "Faults injected now" : view === "naive" ? "Naive monitor shows" : "Sitewatch shows"}</div>
                <div className="grid max-h-[320px] gap-2 overflow-y-auto" aria-live="polite">
                  {keys.length === 0 ? (
                    <p className="text-[13px] text-fg-3">All {run.timeline.devices.length} sensors {view === "truth" ? "fault-free" : "healthy"} at {fmt(playhead)}.</p>
                  ) : keys.map((d) => {
                    const a = active[d]!;
                    return (
                      <div key={d} className="grid grid-cols-[10px_minmax(0,1fr)] gap-3  bg-surface px-3 py-2.5 text-[13px]">
                        <span className="mt-1.5 h-2.5 w-2.5 " style={{ background: CAUSES[a.cause].color }} />
                        <div><span className="font-mono">{d}</span> · {CAUSES[a.cause].label}<div className="text-[12px] text-fg-2">{why(d, a)}</div></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 border-t border-line px-5 py-3">
              <button type="button" onClick={() => { if (playhead >= run.timeline.minutes - 1) setPlayhead(0); setPlaying((p) => !p); }}
                className="btn-ghost h-8 w-20 px-0">{playing ? "Pause" : "Play"}</button>
              <label htmlFor="sw-scrub" className="sr-only">Playhead</label>
              <input id="sw-scrub" type="range" min={0} max={run.timeline.minutes - 0.5} step={0.5} value={playhead}
                onChange={(e) => { setPlaying(false); setPlayhead(Number(e.target.value)); }} className="min-w-0 flex-1 accent-[var(--accent)]" />
            </div>
            <div className="border-t border-line py-3"><Timeline run={run} playhead={playhead} onSeek={(m) => { setPlaying(false); setPlayhead(m); }} /></div>
            <div className="border-t border-line px-5 py-4">
              <Legend items={[...LEGEND.map((c) => ({ label: CAUSES[c].label, color: CAUSES[c].color })),
                ...(run.truth ? [{ label: "Injected fault", swatch: <span className="h-2.5 w-4 " style={{ backgroundImage: "repeating-linear-gradient(45deg, var(--fg-3) 0 1.5px, transparent 1.5px 5px)" }} /> }] : []),
                { label: "Upper bar Sitewatch, lower bar naive, grey line reading", swatch: <span /> }]} />
            </div>
          </Panel>

          <RunSummary run={run} />
        </>
      )}
    </div>
  );
}

function RunSummary({ run }: { run: RunResult }) {
  const s = run.score;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Panel className="grid gap-1 p-5">
        <div className="eyebrow">This run</div>
        <div className="num text-[28px] font-semibold">{run.receipts.toLocaleString()}</div>
        <div className="text-[13px] text-fg-2">messages from {run.timeline.devices.length} sensors, {run.mode === "synthetic" ? `synthetic seed ${run.seed}` : "your uploaded files"}{run.outsideScope ? `. ${run.outsideScope} outside the inventory or window were ignored.` : ""}</div>
      </Panel>
      <Panel className="grid gap-1 p-5">
        <div className="eyebrow">Causes named</div>
        {s ? (<>
          <div className="num text-[28px] font-semibold">{s.sitewatch.classified} / {s.sitewatch.episodes}</div>
          <div className="text-[13px] text-fg-2">Sitewatch. The naive monitor named {s.naive.classified}; its alarms overlapped {s.naive.alarm_overlap}.</div>
        </>) : (<>
          <div className="text-[28px] font-semibold">Not scored</div>
          <div className="text-[13px] text-fg-2">Uploaded files have no ground truth. Compare the alarms with your own fault log.</div>
        </>)}
      </Panel>
      <Panel className="grid gap-1 p-5">
        <div className="eyebrow">False alarms</div>
        {s ? (<>
          <div className="num text-[28px] font-semibold">{s.sitewatch.false_alarms} <span className="text-[15px] font-normal text-fg-2">vs {s.naive.false_alarms} naive</span></div>
          <div className="text-[13px] text-fg-2">Sitewatch&apos;s come from the flat humidity sensor, kept in on purpose. It needs per-device calibration.</div>
        </>) : (<>
          <div className="num text-[28px] font-semibold">{run.sitewatch.length} <span className="text-[15px] font-normal text-fg-2">alarms</span></div>
          <div className="text-[13px] text-fg-2">Sitewatch raised these on your files. The naive monitor raised {run.naive.length}.</div>
        </>)}
      </Panel>
    </div>
  );
}
