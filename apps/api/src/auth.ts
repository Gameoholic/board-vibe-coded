import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Single shared secret, not a user table — there is only ever one person who opens this board (see
// CONVENTIONS.md: no concept of users). The session cookie is a stateless HMAC over a fixed string
// rather than an opaque token in a session store, so "log out everywhere" falls out for free: setting
// a new password rotates `sessionSecret`, which instantly invalidates every previously issued cookie.

interface AuthConfig {
  passwordHash: string;
  sessionSecret: string;
}

const SESSION_MESSAGE = "board-session";
const SCRYPT_KEYLEN = 64;

function defaultAuthPath(): string {
  return fileURLToPath(new URL("../data/auth.json", import.meta.url));
}

function authPath(): string {
  return resolve(process.env.BOARD_AUTH_FILE ?? defaultAuthPath());
}

function loadConfig(): AuthConfig | null {
  const path = authPath();
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as AuthConfig;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPasswordHash(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sessionTokenFor(sessionSecret: string): string {
  return createHmac("sha256", sessionSecret).update(SESSION_MESSAGE).digest("hex");
}

/** Writes a fresh password hash and a fresh session secret — invalidates every existing session. */
export function setPassword(password: string): void {
  const path = authPath();
  mkdirSync(dirname(path), { recursive: true });
  const config: AuthConfig = { passwordHash: hashPassword(password), sessionSecret: randomBytes(32).toString("hex") };
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
}

export function isPasswordConfigured(): boolean {
  return loadConfig() !== null;
}

/** Checks a submitted password and, on success, returns the session token to set as a cookie. */
export function verifyPassword(password: string): string | null {
  const config = loadConfig();
  if (!config) return null;
  if (!verifyPasswordHash(password, config.passwordHash)) return null;
  return sessionTokenFor(config.sessionSecret);
}

export function isValidSessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const config = loadConfig();
  if (!config) return false;
  const expected = Buffer.from(sessionTokenFor(config.sessionSecret), "hex");
  let actual: Buffer;
  try {
    actual = Buffer.from(token, "hex");
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
