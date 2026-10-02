import assert from "node:assert/strict";
import { test } from "node:test";
import { setDebugNow } from "../dist/clock.js";
import { openEventStore } from "../dist/db.js";
import { BoardStore } from "../dist/projection.js";

// Prune through the real projection: a daily/weekly checkbox task is skipped until its own tab's next
// period, changes nothing else, and a rebuild from the log agrees at every step. Times are 12:00 local
// (Asia/Jerusalem is UTC+3 in late Sept/early Oct 2026, the default settings).
const noonOn = (date) => `${date}T09:00:00.000Z`;

function board() {
  setDebugNow(noonOn("2026-09-27")); // a Sunday: the default week starts then
  const events = openEventStore(":memory:");
  const store = new BoardStore(events);
  const daily = store.seedSection("Daily", "#888888", [{ type: "checkbox" }], "tasks", "day");
  const weekly = store.seedSection("Weekly", "#888888", [{ type: "checkbox" }], "tasks", "week");
  const registry = store.seedSection("Registry", "#888888", [{ type: "tiered" }], "tasks", "day");
  const oneOff = store.seedSection("Tasks", "#888888", [{ type: "once" }], "tasks");
  const read = (s, task) => s.getTask(task.id).pruned === true;
  return { events, store, daily, weekly, registry, oneOff, read };
}

test("a pruned daily task is hidden until the next day, and nothing else about it changes", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, daily, read } = board();
  const task = store.createTask({ sectionId: daily.id, type: "checkbox", text: "Stretch", points: 1000, count: 3 });

  assert.throws(() => store.setPruned(task.id, true), /no day or week has started/);
  store.rollPeriod("day");
  store.rollPeriod("week");

  store.setProgress(task.id, 1);
  store.setPruned(task.id, true);
  assert.equal(read(store, task), true);
  assert.equal(store.getTask(task.id).progress, 1); // ticked boxes stay ticked
  assert.equal(read(new BoardStore(events), task), true);

  store.setPruned(task.id, false); // unprune
  assert.equal(read(store, task), false);
  store.setPruned(task.id, true);

  setDebugNow(noonOn("2026-09-28"));
  store.rollPeriod("day");
  assert.equal(read(store, task), false); // the new day brings it back, with no event of its own
  assert.equal(read(new BoardStore(events), task), false);
});

test("a weekly task stays pruned through day rolls and comes back with the week", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, weekly, read } = board();
  store.rollPeriod("day");
  store.rollPeriod("week");
  const task = store.createTask({ sectionId: weekly.id, type: "checkbox", text: "Laundry", points: 1000 });
  store.setPruned(task.id, true);

  setDebugNow(noonOn("2026-09-28"));
  store.rollPeriod("day");
  assert.equal(read(store, task), true);

  setDebugNow(noonOn("2026-10-04"));
  store.rollPeriod("day");
  store.rollPeriod("week");
  assert.equal(read(store, task), false);
  assert.equal(read(new BoardStore(events), task), false);
});

test("only a prunable type in a recurring tab can be pruned", (t) => {
  t.after(() => setDebugNow(null));
  const { store, registry, oneOff } = board();
  store.rollPeriod("day");
  store.rollPeriod("week");
  const tiered = store.createTask({ sectionId: registry.id, type: "tiered", text: "Practice", tiers: [{ label: "Tier 1", points: 1000 }] });
  const once = store.createTask({ sectionId: oneOff.id, type: "once", text: "Call", points: 500 });
  assert.throws(() => store.setPruned(tiered.id, true), /can't be pruned/);
  assert.throws(() => store.setPruned(once.id, true), /can't be pruned/);
});
