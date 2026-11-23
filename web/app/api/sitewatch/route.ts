import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sameOrigin } from "@/lib/auth/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNNER = path.join(process.cwd(), "scripts", "sitewatch_run.py");
const MAX_INVENTORY = 256 * 1024;
const MAX_TELEMETRY = 32 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const MAX_CONCURRENT = 2;
let running = 0;

function fail(status: number, error: string) {
  return Response.json({ ok: false, error }, { status });
}


function runEngine(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile("python3", ["-I", RUNNER, ...args],
      { timeout: TIMEOUT_MS, maxBuffer: 48 * 1024 * 1024, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8" } as unknown as NodeJS.ProcessEnv, encoding: "utf8" },
      (error: Error & { code?: unknown } | null, stdout: string) => {
        const code = error ? (typeof error.code === "number" ? error.code : -1) : 0;
        resolve({ code, stdout: String(stdout) });
      });
  });
}

export async function POST(req: Request) {
  if (process.env.VERCEL) return fail(501, "ENGINE_NOT_HOSTED");
  if (!sameOrigin(req)) return fail(403, "ORIGIN_REJECTED");
  if (running >= MAX_CONCURRENT) return fail(429, "BUSY");
  running += 1;
  let workdir: string | null = null;
  try {
    const type = req.headers.get("content-type") ?? "";
    let args: string[];
    if (type.startsWith("application/json")) {
      const body = (await req.json()) as { seed?: unknown; hours?: unknown };
      const seed = body.seed, hours = body.hours ?? 6;
      if (!Number.isInteger(seed) || (seed as number) < 0 || (seed as number) > 2147483647) return fail(400, "SEED_INVALID");
      if (!Number.isInteger(hours) || (hours as number) < 1 || (hours as number) > 24) return fail(400, "HOURS_INVALID");
      args = ["--seed", String(seed), "--hours", String(hours)];
    } else if (type.startsWith("multipart/form-data")) {
      const declared = Number(req.headers.get("content-length") ?? "0");
      if (declared > MAX_INVENTORY + MAX_TELEMETRY + 64 * 1024) return fail(413, "UPLOAD_TOO_LARGE");
      const form = await req.formData();
      const inventory = form.get("inventory"), telemetry = form.get("telemetry");
      if (!(inventory instanceof File) || !(telemetry instanceof File)) return fail(400, "FILES_REQUIRED");
      if (inventory.size > MAX_INVENTORY || telemetry.size > MAX_TELEMETRY) return fail(413, "UPLOAD_TOO_LARGE");
      workdir = await mkdtemp(path.join(tmpdir(), "sitewatch-"));
      const inv = path.join(workdir, "inventory.json"), tel = path.join(workdir, "telemetry.jsonl");
      await writeFile(inv, Buffer.from(await inventory.arrayBuffer()), { flag: "wx", mode: 0o600 });
      await writeFile(tel, Buffer.from(await telemetry.arrayBuffer()), { flag: "wx", mode: 0o600 });
      args = ["--inventory", inv, "--telemetry", tel];
    } else {
      return fail(415, "UNSUPPORTED_CONTENT_TYPE");
    }
    const { code, stdout } = await runEngine(args);
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return fail(500, code === -1 ? "ENGINE_TIMEOUT_OR_CRASH" : "ENGINE_OUTPUT_INVALID");
    }
    return Response.json(parsed, { status: code === 0 ? 200 : 422, headers: { "Cache-Control": "no-store" } });
  } catch {
    return fail(400, "REQUEST_INVALID");
  } finally {
    running -= 1;
    if (workdir) await rm(workdir, { recursive: true, force: true });
  }
}
