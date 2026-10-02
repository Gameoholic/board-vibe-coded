import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { backupIfDue, listBackups, previewBackup } from "../dist/backup.js";
import { setDebugNow } from "../dist/clock.js";
import { openEventStore } from "../dist/db.js";
import { BoardStore } from "../dist/projection.js";

const DAY_S = 24 * 60 * 60;
const SETTINGS = { enabled: true, everyHours: 48, keep: 5 };

// A database in a temp folder, its backups beside it; let go of and deleted when the test ends.
function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), "board-backup-"));
  const events = openEventStore(join(root, "board.db"));
  t.after(() => {
    events.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { events, dir: join(root, "backups") };
}

// Backup files of the given ages in days, oldest first, named in age order like real ones.
function fakeSlots(dir, ages) {
  mkdirSync(dir, { recursive: true });
  ages.forEach((days, i) => {
    const f = join(dir, `board-2026-01-0${i + 1}.db`);
    writeFileSync(f, "");
    const at = Date.now() / 1000 - days * DAY_S;
    utimesSync(f, at, at);
  });
}

test("replaces the oldest of 5 slots, and only once every 2 days", (t) => {
  const { events, dir } = scratch(t);
  fakeSlots(dir, [15, 12, 9, 6, 3]); // five full slots, the newest 3 days old — so a backup is due

  backupIfDue(events, dir, SETTINGS);
  const after = readdirSync(dir).sort();
  assert.equal(after.length, 5);
  assert.equal(after[0], "board-2026-01-02.db"); // the oldest slot went
  assert.equal(readFileSync(join(dir, after[4])).subarray(0, 15).toString(), "SQLite format 3");

  backupIfDue(events, dir, SETTINGS); // newest is fresh now — nothing to do
  assert.deepEqual(readdirSync(dir).sort(), after);
});

test("the pace and the slots kept are the settings', and off takes none", (t) => {
  const { events, dir } = scratch(t);
  fakeSlots(dir, [3, 2, 1]); // the newest a day old

  backupIfDue(events, dir, { ...SETTINGS, enabled: false, everyHours: 1 });
  assert.equal(readdirSync(dir).length, 3);
  backupIfDue(events, dir, SETTINGS); // not due on a 2-day pace
  assert.equal(readdirSync(dir).length, 3);
  backupIfDue(events, dir, { ...SETTINGS, everyHours: 12, keep: 2 }); // due twice a day — and only 2 kept
  assert.deepEqual(readdirSync(dir).sort().slice(0, 1), ["board-2026-01-03.db"]);
  assert.equal(readdirSync(dir).length, 2);
});

test("the list is newest first, with when the next falls due", (t) => {
  const { dir } = scratch(t);
  assert.deepEqual(listBackups(dir, SETTINGS).slots, []); // no folder yet

  fakeSlots(dir, [4, 1]);
  const { slots, nextAt } = listBackups(dir, SETTINGS);
  assert.deepEqual(slots.map((s) => s.name), ["board-2026-01-02.db", "board-2026-01-01.db"]);
  assert.equal(Date.parse(nextAt) - Date.parse(slots[0].takenAt), 48 * 60 * 60 * 1000);
  assert.equal(listBackups(dir, { ...SETTINGS, enabled: false }).nextAt, null);
});

test("a backup's preview is its board as it was saved, and only a name it holds is read", (t) => {
  t.after(() => setDebugNow(null));
  setDebugNow("2026-09-27T09:00:00.000Z");
  const { events, dir } = scratch(t);
  const store = new BoardStore(events);
  const tab = store.seedSection("Daily", "#888888", [{ type: "checkbox" }], "tasks", "day");
  const task = store.createTask({ sectionId: tab.id, type: "checkbox", text: "Stretch", points: 500 });
  store.setDone(task.id, true);
  backupIfDue(events, dir, SETTINGS);

  // The live board moves on; the backup doesn't.
  store.setDone(task.id, false);
  store.createTask({ sectionId: tab.id, type: "checkbox", text: "Read", points: 500 });

  const [slot] = listBackups(dir, SETTINGS).slots;
  const preview = previewBackup(dir, slot.name);
  assert.deepEqual(preview.sections.map((s) => s.name), ["Daily"]);
  assert.deepEqual(preview.tasks.map((t) => [t.text, t.done]), [["Stretch", true]]);
  assert.equal(preview.points, 500);
  assert.equal(preview.takenAt, slot.takenAt);

  for (const name of ["board-2020-01-01.db", "../board.db", join(dir, slot.name)]) {
    assert.throws(() => previewBackup(dir, name), { status: 404 });
  }
});
