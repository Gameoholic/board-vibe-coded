import assert from "node:assert/strict";
import { test } from "node:test";
import { modifiersOf, waitDays } from "@board/contracts";
import { setDebugNow } from "../dist/clock.js";
import { openEventStore } from "../dist/db.js";
import { BoardStore } from "../dist/projection.js";
import { ensureFreezerTab, initializeBoard } from "../dist/seed.js";

// The Freezer through the real projection: freezing and thawing (by hand, and a week close freezing what
// waited too long), the wait clock, frost banked at each week's end, the thaw bonus, Subzero — and that a
// rebuild from the log lands on exactly the same board and points.
const at = (date, time = "09:00") => `${date}T${time}:00.000Z`;
// 2026-09-27 is a Sunday — the default week start — so each +7 days is the next week.
const WEEK1 = "2026-09-27";
const WEEK2 = "2026-10-04";
const WEEK3 = "2026-10-11";
const WEEK4 = "2026-10-18";

function board() {
  setDebugNow(at(WEEK1));
  const events = openEventStore(":memory:");
  const store = new BoardStore(events, () => 0);
  const tasksTab = store.seedSection("Tasks", "#888888", [{ type: "once" }], "tasks");
  const freezer = store.seedSection("Freezer", "#0ea5e9", [{ type: "once" }], "tasks", undefined, tasksTab.id);
  const daily = store.seedSection("Daily", "#888888", [{ type: "checkbox" }], "tasks", "day");
  const add = (text, points = 1000) => store.createTask({ sectionId: tasksTab.id, type: "once", text, points });
  const freezerSettings = (change) => store.patchSettings({ freezer: { ...store.getSettings().freezer, ...change } });
  // Bounties roll from the Freezer — off here, so only frost and thawing move a task (bounty.test.mjs has them).
  store.patchSettings({ bounty: { ...store.getSettings().bounty, enabled: false } });
  const rebuild = () => new BoardStore(events, () => 0);
  // The week close the owner's "yes, it ended" brings — straight to the week here (no day open).
  const closeWeekAt = (date) => {
    setDebugNow(at(date));
    return store.rollPeriod("week").recap;
  };
  store.rollPeriod("week"); // the first week starts (nothing to close)
  return { events, store, tasksTab, freezer, daily, add, freezerSettings, rebuild, closeWeekAt };
}

// A rebuild from the log must land on exactly the same board and points.
function assertRebuilds(store, rebuild) {
  const again = rebuild();
  assert.deepEqual(again.listTasks(), store.listTasks());
  assert.equal(again.pointsAvailable(), store.pointsAvailable());
}

test("the seed and a migration give the one-time tasks tab a Freezer, once — by its settings, not its name", (t) => {
  t.after(() => setDebugNow(null));
  setDebugNow(at(WEEK1));
  const fresh = new BoardStore(openEventStore(":memory:"));
  initializeBoard(fresh);
  initializeBoard(fresh); // idempotent
  const freezers = fresh.listSections().filter((s) => s.freezerFor);
  assert.equal(freezers.length, 1);
  assert.equal(fresh.listSections().find((s) => s.id === freezers[0].freezerFor).allowedTypes[0].type, "once");

  // A board from before the Freezer, its to-do tab named anything: one Freezer, beside that tab.
  const older = new BoardStore(openEventStore(":memory:"));
  older.seedSection("Daily", "#888888", [{ type: "checkbox" }], "tasks", "day");
  const todo = older.seedSection("To do", "#888888", [{ type: "once" }]);
  ensureFreezerTab(older);
  ensureFreezerTab(older);
  assert.deepEqual(older.listSections().filter((s) => s.freezerFor).map((s) => s.freezerFor), [todo.id]);

  // An empty board (after a reset) has no to-do tab, so no Freezer.
  const empty = new BoardStore(openEventStore(":memory:"));
  ensureFreezerTab(empty);
  assert.equal(empty.listSections().length, 0);
});

test("freezing by hand moves it (and its pieces) to the Freezer, out of its group and status; thawing starts it at the top", (t) => {
  t.after(() => setDebugNow(null));
  const { store, tasksTab, freezer, daily, add, rebuild } = board();
  const first = add("Sort the cables");
  const bank = add("Call the bank");
  store.createGroup({ sectionId: tasksTab.id, label: "Errands", itemIds: [first.id, bank.id] });
  store.setStatus(bank.id, "in-progress");
  const [, piece] = store.breakDown(bank.id, ["Find the letter", "Phone them"]);

  const frozen = store.setFrozen(bank.id, true);
  assert.equal(frozen.sectionId, freezer.id);
  assert.equal(frozen.groupId, undefined);
  assert.equal(frozen.status, undefined);
  assert.equal(frozen.tabSince, at(WEEK1));
  assert.equal(store.getTask(piece.id).sectionId, freezer.id, "its pieces go with it");
  assert.deepEqual(store.listTasks(freezer.id).filter((x) => !x.parentId).map((x) => x.text), ["Call the bank"]);
  assert.equal(store.setFrozen(bank.id, true).sectionId, freezer.id, "freezing a frozen task is a no-op");

  // On ice it can't be done, take a status, or be added to directly.
  assert.throws(() => store.setDone(bank.id, true), /thawed first/);
  assert.throws(() => store.setDone(piece.id, true), /thawed first/);
  assert.throws(() => store.setStatus(bank.id, "in-progress"), /no status/);
  assert.throws(() => store.createTask({ sectionId: freezer.id, type: "once", text: "New", points: 1 }), /aren't added/);
  assert.throws(() => store.setFrozen(piece.id, false), /a piece thaws with its task/);

  setDebugNow(at("2026-09-29"));
  const thawed = store.setFrozen(bank.id, false);
  assert.equal(thawed.sectionId, tasksTab.id);
  assert.equal(thawed.status, "in-progress");
  assert.equal(thawed.statusSince, at("2026-09-29"));
  assert.equal(thawed.order, 0, "at the top of its tab");
  assert.equal(thawed.thawBonus, undefined, "no frost, no thaw bonus");
  assert.equal(store.getTask(piece.id).sectionId, tasksTab.id);

  // What can't be frozen: a piece, a blocked task, a finished one, one in a tab with no Freezer.
  assert.throws(() => store.setFrozen(piece.id, true), /piece goes with its task/);
  store.setStatus(first.id, "blocked", { note: "the drawer" });
  assert.throws(() => store.setFrozen(first.id, true), /Blocked tasks can't be frozen/);
  const done = add("Done already");
  store.setDone(done.id, true);
  assert.throws(() => store.setFrozen(done.id, true), /already done/);
  const routine = store.createTask({ sectionId: daily.id, type: "checkbox", text: "Stretch", points: 500 });
  assert.throws(() => store.setFrozen(routine.id, true), /no Freezer/);
  assertRebuilds(store, rebuild);
});

test("the wait counts in the Backlog and while Blocked, pauses In progress, and starts again on a freeze or thaw", (t) => {
  t.after(() => setDebugNow(null));
  const { store, add, rebuild } = board();
  const task = add("Renew the passport");
  const wait = (date) => waitDays(store.getTask(task.id), at(date));
  assert.equal(wait("2026-09-30"), 3);

  setDebugNow(at("2026-09-30"));
  store.setStatus(task.id, "in-progress");
  assert.equal(wait("2026-10-03"), 3, "paused while In progress");
  setDebugNow(at("2026-10-03"));
  store.setStatus(task.id, "backlog");
  assert.equal(wait("2026-10-05"), 5, "carries on where it left off");
  setDebugNow(at("2026-10-05"));
  store.setStatus(task.id, "blocked", { note: "the photo" });
  assert.equal(wait("2026-10-07"), 7, "Blocked keeps counting");

  setDebugNow(at("2026-10-07"));
  store.setStatus(task.id, "backlog");
  store.setFrozen(task.id, true);
  assert.equal(wait("2026-10-09"), 2, "freezing starts it again");
  setDebugNow(at("2026-10-09"));
  store.setFrozen(task.id, false);
  assert.equal(wait("2026-10-20"), 0, "thawed, it's In progress: paused at nothing");
  assertRebuilds(store, rebuild);
});

test("a week close freezes Backlog tasks that waited more than the limit — never In progress or Blocked ones", (t) => {
  t.after(() => setDebugNow(null));
  setDebugNow(at("2026-09-26"));
  const { store, tasksTab, freezer, add, rebuild, closeWeekAt } = board();
  setDebugNow(at("2026-09-26"));
  const old = add("Return the parcel"); // 8 days by the close
  const working = add("Write the report");
  store.setStatus(working.id, "in-progress");
  const blocked = add("Renew the passport");
  store.setStatus(blocked.id, "blocked", { note: "the photo" });
  setDebugNow(at(WEEK1));
  const exact = add("Book the dentist"); // exactly 7 days by the close: not more

  const recap = closeWeekAt(WEEK2);
  assert.deepEqual(recap.frozen, [{ taskId: old.id, name: "Return the parcel", waited: 8 }]);
  assert.deepEqual(store.listTasks(freezer.id).map((x) => x.text), ["Return the parcel"]);
  assert.deepEqual(
    store.listTasks(tasksTab.id).map((x) => x.text).sort(),
    ["Book the dentist", "Renew the passport", "Write the report"],
  );
  void exact;
  assertRebuilds(store, rebuild);
});

test("frost banks at each week's end — by the day, from the day it froze — and stops the moment it thaws", (t) => {
  t.after(() => setDebugNow(null));
  const { store, add, rebuild, closeWeekAt } = board();
  const storage = add("Clear out the storage room", 5000);
  store.setFrozen(storage.id, true); // Sunday: the whole week on ice
  setDebugNow(at("2026-10-03")); // Saturday: one day
  const photos = add("Back up the photos", 1000);
  store.setFrozen(photos.id, true);
  setDebugNow(at("2026-09-28"));
  const thawedSoon = add("Sell the monitor", 2000);
  store.setFrozen(thawedSoon.id, true);
  setDebugNow(at("2026-10-01"));
  store.setFrozen(thawedSoon.id, false); // thawed Thursday: those days on ice are lost

  const recap = closeWeekAt(WEEK2);
  assert.equal(store.getTask(storage.id).frostDays, 7);
  assert.equal(store.getTask(photos.id).frostDays, 1);
  assert.equal(store.getTask(thawedSoon.id).frostDays, undefined);
  // 7 days at 20% a week is +20% of 5% = 1%.
  assert.deepEqual(
    recap.frost.find((f) => f.taskId === storage.id),
    { taskId: storage.id, name: "Clear out the storage room", from: 0, to: 1000, fillFrom: 0, fillTo: 0.1, subzero: false, subzeroNow: false },
  );
  assert.ok(!recap.frost.some((f) => f.taskId === thawedSoon.id));

  // Frost is a share of its own points, so editing them moves it: 20% of 10% is 2%.
  const ctx = () => ({ settings: store.getSettings(), section: { freezerFor: "x" } });
  assert.deepEqual(modifiersOf(store.getTask(storage.id), ctx()), [{ id: "frost", kind: "share", value: 0.2 }]);
  store.editTask(storage.id, { points: 10000 });

  // Thawed and frozen again mid-week, it carries on from what it kept, counting only from the new freeze.
  closeWeekAt(WEEK3);
  assert.equal(store.getTask(storage.id).frostDays, 14);
  setDebugNow(at("2026-10-13"));
  store.setFrozen(storage.id, false);
  setDebugNow(at("2026-10-14")); // Wednesday
  store.setFrozen(storage.id, true);
  closeWeekAt(WEEK4);
  assert.equal(store.getTask(storage.id).frostDays, 14 + 4);
  assertRebuilds(store, rebuild);
});

test("the thaw bonus: paid only with frost, taken back for good once it leaves In progress, paid again after a refreeze", (t) => {
  t.after(() => setDebugNow(null));
  const { store, add, rebuild, closeWeekAt } = board();
  const task = add("Call the bank", 1000);
  store.setFrozen(task.id, true);
  const quick = add("Return the parcel", 1000);
  store.setFrozen(quick.id, true);
  store.setFrozen(quick.id, false);
  assert.equal(store.getTask(quick.id).thawBonus, undefined, "no frost yet, no bonus");

  closeWeekAt(WEEK2);
  const before = store.pointsAvailable();
  setDebugNow(at("2026-10-05"));
  assert.equal(store.setFrozen(task.id, false).thawBonus, 500);
  assert.equal(store.pointsAvailable(), before + 500);

  store.setStatus(task.id, "backlog");
  assert.equal(store.getTask(task.id).thawBonus, undefined);
  assert.equal(store.pointsAvailable(), before);
  store.setStatus(task.id, "in-progress");
  assert.equal(store.getTask(task.id).thawBonus, undefined, "it doesn't come back");

  // Frozen and thawed again, it has frost already: the bonus is paid again — and kept once it's done.
  store.setFrozen(task.id, true);
  store.setFrozen(task.id, false);
  assert.equal(store.getTask(task.id).thawBonus, 500);
  store.setDone(task.id, true);
  // 1% with +20% frost, plus the bonus.
  assert.equal(store.pointsAvailable(), before + 1200 + 500);
  assertRebuilds(store, rebuild);
});

test("Subzero: full frost pays at least the minimum once thawed — never less than the rest comes to", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, add, freezerSettings, rebuild, closeWeekAt } = board();
  freezerSettings({ frostPerWeek: 100, frostCap: 200 }); // full after two weeks on ice
  const small = add("Fix the tap", 400);
  const big = add("Paint the hall", 40000);
  store.setFrozen(small.id, true);
  store.setFrozen(big.id, true);
  closeWeekAt(WEEK2);
  const recap = closeWeekAt(WEEK3);
  assert.ok(recap.frost.every((f) => f.subzero && f.subzeroNow));

  setDebugNow(at("2026-10-12"));
  store.setFrozen(small.id, false);
  store.setFrozen(big.id, false);
  store.setDone(small.id, true);
  store.setDone(big.id, true);
  const awards = events.readAll().filter((e) => e.event.type === "TaskCompleted").map((e) => e.event);
  // 0.4% × 3 is 1.2% — Subzero lifts it to 100%; 40% × 3 is 120% — already more, so it stays.
  assert.deepEqual(awards.map((a) => a.pointsAwarded), [100000, 120000]);
  assert.deepEqual(awards[0].modifiers, [
    { id: "frost", kind: "share", value: 2 },
    { id: "subzero", kind: "floor", value: 100000 },
  ]);
  // Paid once: a later change to the minimum doesn't re-price it.
  freezerSettings({ subzeroMin: 1000 });
  assert.equal(store.pointsAvailable(), 100000 + 120000 + 500 + 500);
  assertRebuilds(store, rebuild);
});

test("a broken-down task's frost and Subzero are the whole task's: its pieces pay its frost as they go, its finish the rest", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, add, freezerSettings, rebuild, closeWeekAt } = board();
  freezerSettings({ frostPerWeek: 100, frostCap: 200 }); // full after two weeks on ice
  const garage = add("Clear the garage", 600);
  store.setFrozen(garage.id, true);
  closeWeekAt(WEEK2);
  closeWeekAt(WEEK3);

  // Thawed with full frost, then broken down: the pieces are new, but they pay the task's frost (+200%).
  setDebugNow(at("2026-10-12"));
  store.setFrozen(garage.id, false);
  const [, ...pieces] = store.breakDown(garage.id, ["Sort it", "Bin it", "Sweep it"]);
  assert.deepEqual(pieces.map((p) => p.points), [200, 200, 200]);
  store.setDone(pieces[0].id, true);
  store.setDone(pieces[1].id, true);
  assert.equal(store.pointsAvailable(), 500 + 600 + 600, "the thaw bonus, and each piece at ×3");

  // The last piece finishes the task: Subzero tops the whole task up to 100%.
  store.setDone(pieces[2].id, true);
  const finish = events.readAll().map((e) => e.event).filter((e) => e.type === "TaskCompleted" && e.taskId === garage.id);
  assert.deepEqual(finish.map((e) => e.pointsAwarded), [100000 - 1800]);
  assert.deepEqual(finish[0].modifiers, [
    { id: "frost", kind: "share", value: 2 },
    { id: "subzero", kind: "floor", value: 100000, piecesPaid: 1800 },
  ]);
  assert.equal(store.pointsAvailable(), 100000 + 500);

  // Reopened, the top-up goes with it; finished again, it's back.
  store.setDone(pieces[2].id, false);
  assert.equal(store.pointsAvailable(), 500 + 1200);
  store.setDone(pieces[2].id, true);
  assert.equal(store.pointsAvailable(), 100000 + 500);
  assertRebuilds(store, rebuild);
});
