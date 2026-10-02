import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BackupList, BackupPreview, BackupSettings } from "@board/contracts";
import { type EventStore, readSnapshot } from "./db.js";
import { notFound } from "./errors.js";
import { BoardStore } from "./projection.js";

// Rolling snapshots of the database in a `backups/` folder beside it: a new one every `everyHours`
// (Settings → Backups), keeping the newest `keep` (the oldest dropped to make room). Checked on boot,
// every few minutes and whenever the settings change, so a server that was off when one fell due takes
// it as soon as it's back up, and a new pace takes effect at once.
const CHECK_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface Backups {
  /** Take a backup if one is due — a no-op otherwise. */
  check(): void;
  list(): BackupList;
  preview(name: string): BackupPreview;
}

export function startBackups(events: EventStore, settings: () => BackupSettings): Backups {
  const dir = join(dirname(events.file), "backups");
  const check = () => {
    // A failed backup must never take the board down with it — log it and retry on the next check.
    try {
      backupIfDue(events, dir, settings());
    } catch (err) {
      console.error("backup failed", err);
    }
  };
  check();
  setInterval(check, CHECK_MS);
  return { check, list: () => listBackups(dir, settings()), preview: (name) => previewBackup(dir, name) };
}

// Names are timestamps, so name order is age order.
function backupFiles(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".db")).sort() : [];
}

export function backupIfDue(events: EventStore, dir: string, settings: BackupSettings): void {
  if (!settings.enabled) return;
  mkdirSync(dir, { recursive: true });
  const backups = backupFiles(dir);
  const newest = backups.at(-1);
  // The real clock, never the debug clock — pinning a fake date must not trigger or skip a backup.
  const now = Date.now();
  if (newest && now - statSync(join(dir, newest)).mtimeMs < settings.everyHours * HOUR_MS) return;

  // ':' isn't allowed in Windows filenames.
  const name = `board-${new Date(now).toISOString().replace(/[:.]/g, "-")}.db`;
  // Written under a temp name then renamed, so a crash mid-write can't leave a half-written file
  // posing as the newest backup.
  events.backupTo(join(dir, `${name}.tmp`));
  renameSync(join(dir, `${name}.tmp`), join(dir, name));
  for (const old of [...backups, name].slice(0, -settings.keep)) rmSync(join(dir, old));
}

export function listBackups(dir: string, settings: BackupSettings): BackupList {
  const slots = backupFiles(dir)
    .map((name) => {
      const file = statSync(join(dir, name));
      return { name, takenAt: new Date(file.mtimeMs).toISOString(), bytes: file.size };
    })
    .reverse();
  const newest = slots[0];
  const nextAt = !settings.enabled
    ? null
    : new Date(newest ? Date.parse(newest.takenAt) + settings.everyHours * HOUR_MS : Date.now()).toISOString();
  return { slots, nextAt };
}

// A backup's board, folded by the same projection as the live one.
export function previewBackup(dir: string, name: string): BackupPreview {
  // Only a name the folder holds — never a path built from what was asked for.
  if (!backupFiles(dir).includes(name)) throw notFound("backup");
  const file = join(dir, name);
  const takenAt = new Date(statSync(file).mtimeMs);
  const log = readSnapshot(file);
  const board = new BoardStore(log);
  // Its streaks as they stood then: as of when it was taken, or of its last event if that's later (a
  // board run on the debug clock stamps its events ahead of the real one).
  const lastEvent = log.readAll().at(-1)?.occurredAt;
  const asOf = lastEvent && Date.parse(lastEvent) > takenAt.getTime() ? new Date(lastEvent) : takenAt;
  return {
    takenAt: takenAt.toISOString(),
    sections: board.listSections(),
    tasks: board.listTasks(),
    streaks: board.listStreaks(undefined, asOf),
    points: board.pointsAvailable(),
  };
}
