import { authConfig, cookieName } from "@/lib/auth/config";
import { sameOrigin } from "@/lib/auth/origin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ ok: false, error: "ORIGIN_REJECTED" }, { status: 403 });
  const cfg = authConfig();
  const secure = cfg.state === "enforced" && cfg.secureCookie;
  const cookie = [`${cookieName(secure)}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0", ...(secure ? ["Secure"] : [])].join("; ");
  return new Response(null, { status: 303, headers: { Location: "/login?signedout=1", "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}
