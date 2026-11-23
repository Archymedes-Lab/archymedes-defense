/**
 * Best-effort per-instance throttle on login attempts. Serverless instances do not share memory,
 * so this only slows a single-instance attacker; the real bound is the password's entropy plus scrypt cost.
 */
const WINDOW_MS = 10 * 60_000, MAX_FAILS = 10, MAX_KEYS = 5000;
const fails = new Map<string, { n: number; since: number }>();

export function throttled(key: string, now = Date.now()): boolean {
  const e = fails.get(key);
  if (!e || now - e.since > WINDOW_MS) return false;
  return e.n >= MAX_FAILS;
}
export function recordFailure(key: string, now = Date.now()): void {
  const e = fails.get(key);
  if (!e || now - e.since > WINDOW_MS) {
    if (fails.size >= MAX_KEYS) fails.delete(fails.keys().next().value!);
    fails.set(key, { n: 1, since: now });
  } else e.n++;
}
export function clearFailures(key: string): void { fails.delete(key); }
