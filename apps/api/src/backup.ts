import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EventStore } from "./db.js";

// Rolling snapshots of the database in a `backups/` folder beside it: a new one every 2 days,
// keeping the newest 5 (the oldest is dropped to make room). Checked on boot and then hourly, so a
// server that was off when one fell due takes it as soon as it's back up.
const SLOTS = 5;
const EVERY_MS = 2 * 24 * 60 * 60 * 1000;
const CHECK_MS = 60 * 60 * 1000;

export function startBackups(events: EventStore): void {
  const dir = join(dirname(events.file), "backups");
  const check = () => {
    // A failed backup must never take the board down with it — log it and retry on the next check.
    try {
      backupIfDue(events, dir);
    } catch (err) {
      console.error("backup failed", err);
    }
  };
  check();
  setInterval(check, CHECK_MS);
}

export function backupIfDue(events: EventStore, dir: string): void {
  mkdirSync(dir, { recursive: true });
  // Names are timestamps, so name order is age order.
  const backups = readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .sort();
  const newest = backups.at(-1);
  // The real clock, never the debug clock — pinning a fake date must not trigger or skip a backup.
  const now = Date.now();
  if (newest && now - statSync(join(dir, newest)).mtimeMs < EVERY_MS) return;

  // ':' isn't allowed in Windows filenames.
  const name = `board-${new Date(now).toISOString().replace(/[:.]/g, "-")}.db`;
  // Written under a temp name then renamed, so a crash mid-write can't leave a half-written file
  // posing as the newest backup.
  events.backupTo(join(dir, `${name}.tmp`));
  renameSync(join(dir, `${name}.tmp`), join(dir, name));
  for (const old of [...backups, name].slice(0, -SLOTS)) rmSync(join(dir, old));
}
