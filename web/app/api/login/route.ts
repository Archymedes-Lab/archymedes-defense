import { authConfig, cookieName, safeNext } from "@/lib/auth/config";
import { clearFailures, recordFailure, throttled } from "@/lib/auth/limiter";
import { sameOrigin } from "@/lib/auth/origin";
import { MAX_PASSWORD_LEN, verifyPassword } from "@/lib/auth/password";
import { SESSION_TTL_S, issueSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
const MIN_FAIL_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function back(req: Request, params: Record<string, string>): Response {
  const url = new URL("/login", req.url);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return new Response(null, { status: 303, headers: { Location: url.pathname + url.search, "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const started = Date.now();
  const cfg = authConfig();
  if (cfg.state !== "enforced") return Response.json({ ok: false, error: "LOGIN_NOT_CONFIGURED" }, { status: 503 });
  if (!sameOrigin(req)) return Response.json({ ok: false, error: "ORIGIN_REJECTED" }, { status: 403 });
  if (Number(req.headers.get("content-length") ?? "0") > 4096) return Response.json({ ok: false, error: "TOO_LARGE" }, { status: 413 });

  let form: FormData;
  try { form = await req.formData(); } catch { return back(req, { error: "1" }); }
  const password = form.get("password"), next = safeNext(form.get("next"));
  const nextParam = next === "/" ? "" : next;
  const client = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

  if (throttled(client)) return back(req, { error: "throttled", next: nextParam });
  const ok = typeof password === "string" && password.length <= MAX_PASSWORD_LEN && (await verifyPassword(password, cfg.passwordHash));
  if (!ok) {
    recordFailure(client);
    await sleep(Math.max(0, MIN_FAIL_MS - (Date.now() - started)));
    return back(req, { error: "1", next: nextParam });
  }
  clearFailures(client);
  const token = await issueSession(cfg.secret, cfg.passwordHash);
  const cookie = [`${cookieName(cfg.secureCookie)}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${SESSION_TTL_S}`,
    ...(cfg.secureCookie ? ["Secure"] : [])].join("; ");
  return new Response(null, { status: 303, headers: { Location: next, "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}
