import { randomUUID } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { accountDbFile, accountsFile, writeAccounts, writeJsonAtomic } from "./accounts.js";

// Moving the one board from before accounts into an account of its own, run on boot (and by the
// password CLI) before anything opens a database. The board's file is *moved*, never rewritten: not one
// event is read, changed or re-written, so none can be lost or mangled. Its password hash and session
// secret carry over, so the same password works and its devices stay logged in.
//
// Crash-safe: what it will do is written to a plan file first, and every step after that is safe to run
// again — a boot that dies halfway carries on from where it stopped on the next one. A step that finds
// something it doesn't expect (a file already at the place it would move one to) stops the boot rather
// than guess. `accounts.json` is written last, and its existence is what says the move is done.

// The name the board from before accounts is moved in under — it only matters the once, on the one
// install that had a board then. BOARD_OWNER_NAME overrides it.
export const FIRST_ACCOUNT_NAME = process.env.BOARD_OWNER_NAME ?? "daniel";

const LegacyAuth = z.object({ passwordHash: z.string(), sessionSecret: z.string() });

const Plan = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  passwordHash: z.string(),
  sessionSecret: z.string(),
  startedAt: z.string(),
  backupDir: z.string(),
});
type Plan = z.infer<typeof Plan>;

// SQLite's own files beside a database: moved and backed up with it, so a write it hadn't finished stays
// recoverable rather than being split from its database.
const SIDECARS = ["-journal", "-wal", "-shm"];

export type MigrationStep = "planned" | "backed-up" | "board-moved" | "backups-moved" | "accounts-written" | "done";

/**
 * Moves the board from before accounts into its own account, if there is one to move. Returns whether
 * it did anything. `afterStep` is for tests: throwing from it is a crash at that point.
 */
export function migrateToAccounts(dir: string, name: string, afterStep?: (step: MigrationStep) => void): boolean {
  const planFile = join(dir, "accounts-migration.json");
  const legacyAuth = join(dir, "auth.json");
  const legacyDb = join(dir, "board.db");

  let plan: Plan;
  if (existsSync(planFile)) {
    plan = Plan.parse(JSON.parse(readFileSync(planFile, "utf8")));
  } else {
    if (existsSync(accountsFile(dir))) return false;
    if (!existsSync(legacyAuth)) {
      // Never booted before accounts, or a board that never had a password: nothing to move in.
      if (existsSync(legacyDb)) console.warn(`${legacyDb} has no password set; run pnpm set-password to move it into an account`);
      return false;
    }
    const auth = LegacyAuth.parse(JSON.parse(readFileSync(legacyAuth, "utf8")));
    const startedAt = new Date().toISOString();
    plan = {
      id: randomUUID(),
      name,
      ...auth,
      startedAt,
      // ':' isn't allowed in Windows filenames.
      backupDir: `pre-accounts-backup-${startedAt.replace(/[:.]/g, "-")}`,
    };
    writeJsonAtomic(planFile, plan);
  }
  afterStep?.("planned");

  // 1. A copy of everything as it was, before anything moves.
  const backup = join(dir, plan.backupDir);
  if (!existsSync(backup)) {
    const partial = `${backup}.partial`;
    rmSync(partial, { recursive: true, force: true });
    mkdirSync(partial);
    for (const file of [...withSidecars("board.db"), "auth.json"]) {
      if (existsSync(join(dir, file))) copyFileSync(join(dir, file), join(partial, file), constants.COPYFILE_EXCL);
    }
    renameSync(partial, backup);
  }
  afterStep?.("backed-up");

  // 2. The board into the account's folder — its sidecars first, so the database never sits in its new
  // place without them.
  const accountDb = accountDbFile(dir, plan.id);
  for (const suffix of [...SIDECARS, ""]) moveOnce(legacyDb + suffix, accountDb + suffix);
  afterStep?.("board-moved");

  // 3. Its backups beside it, where the account's backups are taken and listed.
  moveOnce(join(dir, "backups"), join(dirname(accountDb), "backups"));
  afterStep?.("backups-moved");

  // 4. The account itself — the step that makes it real.
  if (!existsSync(accountsFile(dir))) {
    writeAccounts(dir, [
      {
        id: plan.id,
        name: plan.name,
        passwordHash: plan.passwordHash,
        sessionSecret: plan.sessionSecret,
        createdAt: plan.startedAt,
        legacySession: true,
        canInvite: true,
      },
    ]);
  }
  afterStep?.("accounts-written");

  // 5. The old password file has a copy in the backup and its contents in accounts.json; the plan holds
  // the same secrets and is done with.
  rmSync(legacyAuth, { force: true });
  rmSync(planFile, { force: true });
  afterStep?.("done");
  console.log(`moved the board into the account "${plan.name}" (backup: ${plan.backupDir})`);
  return true;
}

const withSidecars = (file: string) => ["", ...SIDECARS].map((suffix) => file + suffix);

// Moves `from` to `to` unless that's already happened. Both present means something other than this
// migration put a file there: stop, touching neither.
function moveOnce(from: string, to: string): void {
  const source = existsSync(from);
  if (source && existsSync(to)) throw new Error(`accounts migration stopped: both ${from} and ${to} exist`);
  if (!source) return;
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
}
