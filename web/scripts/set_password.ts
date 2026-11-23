/**
 * Generate a random login password and its scrypt hash.
 * The password goes only to an owner-only file; stdout carries the hash alone, so it can be piped into
 * `vercel env add SITE_PASSWORD_HASH production` without the password ever appearing in a terminal or log.
 */
import { randomInt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { hashPassword } from "../lib/auth/password";

const dir = path.join(homedir(), ".config", "archymedes-defense");
const file = path.join(dir, "login-password");
// 20 uniform picks from 31 symbols without look-alikes = 99 bits, grouped for typing.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const chars = Array.from({ length: 20 }, () => ALPHABET[randomInt(ALPHABET.length)]);
const password = [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join("")).join("-");
mkdirSync(dir, { recursive: true, mode: 0o700 });
writeFileSync(file, password + "\n", { mode: 0o600, flag: "w" });
process.stdout.write(await hashPassword(password));
