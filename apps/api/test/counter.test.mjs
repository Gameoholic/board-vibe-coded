import assert from "node:assert/strict";
import { test } from "node:test";
import { setDebugNow } from "../dist/clock.js";
import { openEventStore } from "../dist/db.js";
import { BoardStore } from "../dist/projection.js";

// An "all time" counter streak through the real projection: period rolls, resets and a rebuild from the
// log. Times are 12:00 local (Asia/Jerusalem is UTC+3 in late Sept/early Oct 2026, the default settings).
const noonOn = (date) => `${date}T09:00:00.000Z`;

// A board with one tab of the given cadence holding one checkbox task, a Streaks tab, and an "all time"
// counter linked to that task with a backfill — the first day and week already started on Sun 27 Sept.
function boardWith(period, legacy) {
  setDebugNow(noonOn("2026-09-27"));
  const events = openEventStore(":memory:");
  const store = new BoardStore(events);
  const tab = store.seedSection("Tab", "#888888", [{ type: "checkbox" }], "tasks", period);
  const streaksTab = store.seedSection("Streaks", "#888888", [{ type: "checkbox" }], "streaks");
  const task = store.createTask({ sectionId: tab.id, type: "checkbox", text: "Task", points: 1 });
  store.rollPeriod("day");
  store.rollPeriod("week");
  const created = store.createStreak({
    sectionId: streaksTab.id,
    name: "Counter",
    type: "counter",
    mode: "any",
    since: "all",
    matcher: { kind: "tasks", conditions: [{ taskId: task.id, required: 1 }] },
  });
  store.editStreak(created.id, { legacy });
  const count = (s = store) => s.getStreak(created.id).count;
  return { events, store, task, count };
}

test("a weekly task that stays ticked across days counts once, not once per day", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, task, count } = boardWith("week", 110);

  store.setDone(task.id, true);
  assert.equal(count(), 111);

  // Next day: the day closes, but a weekly task stays ticked — it's still the same one tick.
  setDebugNow(noonOn("2026-09-28"));
  store.rollPeriod("day");
  assert.equal(count(), 111);
  store.setDone(task.id, false);
  assert.equal(count(), 110);
  store.setDone(task.id, true);
  assert.equal(count(), 111);
  assert.equal(count(new BoardStore(events)), 111); // a rebuild from the log agrees

  // Next week: the roll unticks it, but the tick it held is kept; ticking it again is a new one.
  setDebugNow(noonOn("2026-10-04"));
  store.rollPeriod("day");
  store.rollPeriod("week");
  assert.equal(store.getTask(task.id).done, false);
  assert.equal(count(), 111);
  store.setDone(task.id, true);
  assert.equal(count(), 112);
  assert.equal(count(new BoardStore(events)), 112);
});

test("a daily task counts once per day it was ticked at close", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, task, count } = boardWith("day", 0);

  store.setDone(task.id, true);
  setDebugNow(noonOn("2026-09-28"));
  store.rollPeriod("day"); // kept 1, task unticked
  assert.equal(count(), 1);

  store.setDone(task.id, true);
  assert.equal(count(), 2);

  // Ticked then unticked before the close: nothing was kept for that day.
  setDebugNow(noonOn("2026-09-29"));
  store.rollPeriod("day"); // kept 1 more (28th)
  store.setDone(task.id, true);
  store.setDone(task.id, false);
  setDebugNow(noonOn("2026-09-30"));
  store.rollPeriod("day");
  assert.equal(count(), 2);
  assert.equal(count(new BoardStore(events)), 2);
});
