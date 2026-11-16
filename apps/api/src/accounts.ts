import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// The accounts: who can log in, and where each one's board lives. Every account is a folder of its own
// under `accounts/` — its event log and its backups — so two people's data never share a file and no
// query has to remember to filter by person. `accounts.json` beside them holds each account's name,
// password hash and session secret (see auth.ts). Nothing here ever lists one account to another.
//
//   <data dir>/accounts.json
//   <data dir>/accounts/<id>/board.db
//   <data dir>/accounts/<id>/backups/

const Account = z.object({
  // Folder names are ids, never names: a name never becomes a path.
  id: z.string().uuid(),
  name: z.string().min(1),
  passwordHash: z.string(),
  sessionSecret: z.string(),
  createdAt: z.string(),
  // The board that was here before accounts: its devices still hold a cookie of the old shape, signed
  // with this same secret, which is honoured once and swapped for a new one (see auth.ts).
  legacySession: z.boolean().optional(),
});
export type Account = z.infer<typeof Account>;

const AccountsFile = z.object({ version: z.literal(1), accounts: z.array(Account) });

const SCRYPT_KEYLEN = 64;

export function dataDir(): string {
  // The paths of the single-board days. A server still pointed at them would quietly start a blank board
  // somewhere else, so it refuses to start instead.
  for (const old of ["BOARD_DB", "BOARD_AUTH_FILE"]) {
    if (process.env[old]) throw new Error(`${old} is no longer read — point BOARD_DATA_DIR at the data folder instead`);
  }
  return resolve(process.env.BOARD_DATA_DIR ?? fileURLToPath(new URL("../data", import.meta.url)));
}

export const accountsFile = (dir: string) => join(dir, "accounts.json");
export const accountDbFile = (dir: string, id: string) => join(dir, "accounts", id, "board.db");

/** Every account, or null when there is no accounts file yet (a fresh install, or one not migrated). */
export function readAccounts(dir: string): Account[] | null {
  const file = accountsFile(dir);
  if (!existsSync(file)) return null;
  return AccountsFile.parse(JSON.parse(readFileSync(file, "utf8"))).accounts;
}

export function writeAccounts(dir: string, accounts: Account[]): void {
  writeJsonAtomic(accountsFile(dir), { version: 1, accounts });
}

// Written under a temp name and renamed over the old one, so a crash mid-write never leaves half a file.
// Owner-only: it holds password hashes and session secrets.
export function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

// How a name is matched at login: case, spacing at the ends and look-alike Unicode forms don't matter.
function nameKey(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase();
}

export function findAccount(accounts: Account[], name: string): Account | undefined {
  const key = nameKey(name);
  return accounts.find((a) => nameKey(a.name) === key);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPasswordHash(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const newSessionSecret = () => randomBytes(32).toString("hex");

/**
 * Sets an account's password from the terminal (`pnpm set-password`), which also logs out every device
 * of that account and no other. With no accounts at all it makes the first one — how a fresh install
 * gets its first login. It never makes a second: that's for the app's invites.
 */
export function setAccountPassword(dir: string, name: string, password: string): "changed" | "created" | "missing" {
  const accounts = readAccounts(dir) ?? [];
  const account = findAccount(accounts, name);
  if (account) {
    // A new secret: every cookie signed with the old one, the pre-accounts kind included, stops working.
    const changed = { ...account, passwordHash: hashPassword(password), sessionSecret: newSessionSecret(), legacySession: undefined };
    writeAccounts(dir, accounts.map((a) => (a === account ? changed : a)));
    return "changed";
  }
  if (accounts.length > 0) return "missing";
  mkdirSync(dir, { recursive: true });
  writeAccounts(dir, [
    {
      id: randomUUID(),
      name: name.trim(),
      passwordHash: hashPassword(password),
      sessionSecret: newSessionSecret(),
      createdAt: new Date().toISOString(),
    },
  ]);
  return "created";
}
