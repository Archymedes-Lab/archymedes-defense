/**
 * Stateless session tokens: "v1.<expiresAtSeconds>.<nonce>.<signature>".
 *
 * The HMAC key is derived from SESSION_SECRET *and* the stored password hash, so changing the password
 * or rotating the secret revokes every session at once. Verification uses crypto.subtle.verify, which
 * compares in constant time. Uses Web Crypto only, so the same code runs in the proxy and in routes.
 */
const enc = new TextEncoder();
export const SESSION_TTL_S = 7 * 24 * 3600;
const MAX_TOKEN_LEN = 256;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function sessionKey(secret: string, passwordHash: string): Promise<CryptoKey> {
  const root = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = await crypto.subtle.sign("HMAC", root, enc.encode(`archymedes-session-v1\n${passwordHash}`));
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function issueSession(secret: string, passwordHash: string, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const body = `v1.${nowS + SESSION_TTL_S}.${nonce}`;
  const sig = await crypto.subtle.sign("HMAC", await sessionKey(secret, passwordHash), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

export async function verifySession(token: string | undefined, secret: string, passwordHash: string,
  nowS = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!token || token.length > MAX_TOKEN_LEN) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1" || !/^\d{1,12}$/.test(parts[1]!)) return false;
  const exp = Number(parts[1]);
  if (exp <= nowS || exp > nowS + SESSION_TTL_S) return false;
  const sig = unb64url(parts[3]!);
  if (!sig || sig.length !== 32) return false;
  return crypto.subtle.verify("HMAC", await sessionKey(secret, passwordHash), sig as BufferSource,
    enc.encode(parts.slice(0, 3).join(".")));
}
