import { type NextRequest, NextResponse } from "next/server";
import { authConfig, cookieName } from "@/lib/auth/config";
import { verifySession } from "@/lib/auth/session";

/**
 * Gate for every page, API route and public file (including /runs/*.json).
 * Not matched: the login page and its POST route, logout, and build assets in /_next/static,
 * which carry no data (scripts/check_bundle.py fails the build if they do).
 */
export async function proxy(req: NextRequest) {
  const cfg = authConfig();
  if (cfg.state === "open-local") return NextResponse.next();
  if (cfg.state === "misconfigured") {
    return new NextResponse("Service unavailable: sign-in is not configured.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const ok = await verifySession(req.cookies.get(cookieName(cfg.secureCookie))?.value, cfg.secret, cfg.passwordHash);
  if (ok) {
    const res = NextResponse.next();
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/") || req.method !== "GET" || !(req.headers.get("accept") ?? "").includes("text/html")) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const url = new URL("/login", req.url);
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store" } });
}

export const config = {
  matcher: ["/((?!login$|api/login$|api/logout$|icon\\.svg$|_next/static/).*)"],
};
