/**
 * Auth configuration. Fails closed: a hosted deployment without both values serves nothing.
 * The local loopback server (no VERCEL env) stays open when unconfigured, matching its single-user scope.
 */
export type AuthConfig =
  | { state: "enforced"; secret: string; passwordHash: string; secureCookie: boolean }
  | { state: "open-local" }
  | { state: "misconfigured"; reason: string };

export const HASH_RE = /^scrypt\$(1[4-7])\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/;

export function authConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const hosted = !!env.VERCEL;
  const secret = env.SESSION_SECRET?.trim(), passwordHash = env.SITE_PASSWORD_HASH?.trim();
  if (!secret && !passwordHash) return hosted ? { state: "misconfigured", reason: "login not configured" } : { state: "open-local" };
  if (!secret || secret.length < 32) return { state: "misconfigured", reason: "SESSION_SECRET missing or shorter than 32 characters" };
  if (!passwordHash || !HASH_RE.test(passwordHash)) return { state: "misconfigured", reason: "SITE_PASSWORD_HASH missing or malformed" };
  return { state: "enforced", secret, passwordHash, secureCookie: hosted };
}

export function cookieName(secure: boolean): string {
  return secure ? "__Host-ad_session" : "ad_session";
}

/** Only same-site relative paths; rejects "//host", "/\\host" and anything with a scheme. */
export function safeNext(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 512) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || /[\u0000-\u001f]/.test(raw)) return "/";
  if (raw.startsWith("/login") || raw.startsWith("/api/")) return "/";
  return raw;
}
