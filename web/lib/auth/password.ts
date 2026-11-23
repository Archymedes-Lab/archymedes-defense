import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { HASH_RE } from "./config";

/** scrypt$<log2N>$8$1$<salt b64url>$<hash b64url>; log2N 15 costs ~32 MB and roughly 50-100 ms per try. */
function scrypt(pw: string, salt: Buffer, logN: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(pw, salt, 32, { N: 2 ** logN, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))));
}

export const MAX_PASSWORD_LEN = 256;

export async function hashPassword(pw: string, logN = 15): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, logN);
  return `scrypt$${logN}$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  if (pw.length === 0 || pw.length > MAX_PASSWORD_LEN || !HASH_RE.test(stored)) return false;
  const [, logN, , , salt, hash] = stored.split("$");
  const expected = Buffer.from(hash!, "base64url");
  const actual = await scrypt(pw, Buffer.from(salt!, "base64url"), Number(logN));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
