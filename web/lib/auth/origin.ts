/** True when the request's Origin header names this host. Browsers send Origin on every form POST. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin"), host = req.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}
