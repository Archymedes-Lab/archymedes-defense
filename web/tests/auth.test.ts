import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { authConfig, safeNext } from "../lib/auth/config";
import { clearFailures, recordFailure, throttled } from "../lib/auth/limiter";
import { hashPassword, verifyPassword } from "../lib/auth/password";
import { SESSION_TTL_S, issueSession, verifySession } from "../lib/auth/session";

const SECRET = "s".repeat(48);
let HASH = "";
setDefaultTimeout(60_000);
beforeAll(async () => { HASH = await hashPassword("correct horse", 14); });

describe("password", () => {
  test("hash verifies the right password and rejects others", async () => {
    expect(await verifyPassword("correct horse", HASH)).toBe(true);
    expect(await verifyPassword("correct horsf", HASH)).toBe(false);
    expect(await verifyPassword("", HASH)).toBe(false);
    expect(await verifyPassword("x".repeat(257), HASH)).toBe(false);
  });
  test("malformed stored hash fails closed", async () => {
    expect(await verifyPassword("correct horse", "plain")).toBe(false);
    expect(await verifyPassword("correct horse", HASH.replace("scrypt$14", "scrypt$30"))).toBe(false);
  });
});

describe("session", () => {
  test("round trip, expiry, tamper, wrong key, password rotation", async () => {
    const now = 1_800_000_000;
    const t = await issueSession(SECRET, HASH, now);
    expect(await verifySession(t, SECRET, HASH, now)).toBe(true);
    expect(await verifySession(t, SECRET, HASH, now + SESSION_TTL_S)).toBe(false);
    expect(await verifySession(t, "t".repeat(48), HASH, now)).toBe(false);
    expect(await verifySession(t, SECRET, await hashPassword("new password", 14), now)).toBe(false);
    const [v, exp, nonce, sig] = t.split(".");
    expect(await verifySession(`${v}.${Number(exp) + 3600}.${nonce}.${sig}`, SECRET, HASH, now)).toBe(false);
    expect(await verifySession(`${v}.${exp}.${nonce}x.${sig}`, SECRET, HASH, now)).toBe(false);
    const flipped = sig!.slice(0, -2) + (sig!.endsWith("AA") ? "AB" : "AA");
    expect(await verifySession(`${v}.${exp}.${nonce}.${flipped}`, SECRET, HASH, now)).toBe(false);
  });
  test("garbage tokens are rejected without throwing", async () => {
    for (const bad of [undefined, "", "v1", "v1.a.b.c", "v2.1.a.b", "v1.99999999999999.a.b", "v1.1.a.!!!", "x".repeat(300)])
      expect(await verifySession(bad, SECRET, HASH)).toBe(false);
  });
});

describe("config", () => {
  test("hosted without values fails closed; local without values is open", () => {
    expect(authConfig({ VERCEL: "1" }).state).toBe("misconfigured");
    expect(authConfig({}).state).toBe("open-local");
  });
  test("partial or weak values fail closed even locally", () => {
    expect(authConfig({ SESSION_SECRET: SECRET }).state).toBe("misconfigured");
    expect(authConfig({ SITE_PASSWORD_HASH: HASH }).state).toBe("misconfigured");
    expect(authConfig({ SESSION_SECRET: "short", SITE_PASSWORD_HASH: HASH }).state).toBe("misconfigured");
    expect(authConfig({ SESSION_SECRET: SECRET, SITE_PASSWORD_HASH: "scrypt$15$bad" }).state).toBe("misconfigured");
  });
  test("complete values enforce; secure cookie only when hosted", () => {
    const local = authConfig({ SESSION_SECRET: SECRET, SITE_PASSWORD_HASH: HASH });
    const hosted = authConfig({ VERCEL: "1", SESSION_SECRET: SECRET, SITE_PASSWORD_HASH: HASH });
    expect(local.state === "enforced" && !local.secureCookie).toBe(true);
    expect(hosted.state === "enforced" && hosted.secureCookie).toBe(true);
  });
});

describe("redirect target", () => {
  test("only same-site relative paths survive", () => {
    expect(safeNext("/battery?x=1")).toBe("/battery?x=1");
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "evil", "/login", "/api/login", "/\nx", null, 5, "/" + "a".repeat(600)])
      expect(safeNext(bad)).toBe("/");
  });
});

describe("limiter", () => {
  test("throttles after ten failures and resets after the window", () => {
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) recordFailure("ip", now);
    expect(throttled("ip", now)).toBe(true);
    expect(throttled("ip", now + 10 * 60_000 + 1)).toBe(false);
    clearFailures("ip");
    expect(throttled("ip", now)).toBe(false);
  });
});
