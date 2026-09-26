import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { backupIfDue } from "../dist/backup.js";
import { openEventStore } from "../dist/db.js";

const DAY_S = 24 * 60 * 60;

test("replaces the oldest of 5 slots, and only once every 2 days", (t) => {
  const root = mkdtempSync(join(tmpdir(), "board-backup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const events = openEventStore(join(root, "board.db"));
  const dir = join(root, "backups");

  // Five full slots, the newest 3 days old — so a backup is due.
  mkdirSync(dir);
  for (let i = 1; i <= 5; i++) {
    const f = join(dir, `board-2026-01-0${i}.db`);
    writeFileSync(f, "");
    const at = Date.now() / 1000 - (18 - 3 * i) * DAY_S;
    utimesSync(f, at, at);
  }

  backupIfDue(events, dir);
  const after = readdirSync(dir).sort();
  assert.equal(after.length, 5);
  assert.equal(after[0], "board-2026-01-02.db"); // the oldest slot went
  assert.equal(readFileSync(join(dir, after[4])).subarray(0, 15).toString(), "SQLite format 3");

  backupIfDue(events, dir); // newest is fresh now — nothing to do
  assert.deepEqual(readdirSync(dir).sort(), after);
});
