import assert from "node:assert/strict";
import { test } from "node:test";
import { setDebugNow } from "../dist/clock.js";
import { openEventStore } from "../dist/db.js";
import { BoardStore } from "../dist/projection.js";

// A streak counts only tasks that reset — a daily streak a daily tab's, a weekly one a weekly tab's (a weekly
// task would count every day, a daily one never for its week). A counter counts ticks, so it takes any task
// that resets. None takes a one-time task (Tasks, the Freezer): it would count for ever once ticked.
test("a streak only links tasks on its beat; a counter any that resets; none a one-time task", (t) => {
  t.after(() => setDebugNow(null));
  setDebugNow("2026-09-27T09:00:00.000Z");
  const store = new BoardStore(openEventStore(":memory:"));
  const tab = (name, period) => store.seedSection(name, "#888888", [{ type: period ? "checkbox" : "once" }], "tasks", period);
  const daily = store.createTask({ sectionId: tab("Daily", "day").id, type: "checkbox", text: "Stretch", points: 500 });
  const weekly = store.createTask({ sectionId: tab("Weekly", "week").id, type: "checkbox", text: "Plates", points: 500 });
  const once = store.createTask({ sectionId: tab("Tasks").id, type: "once", text: "Call the bank", points: 500 });
  const streaksTab = store.seedSection("Streaks", "#ef4444", [{ type: "checkbox" }], "streaks");
  const make = (type, task) =>
    store.createStreak({
      sectionId: streaksTab.id,
      name: `${type} ${task.text}`,
      type,
      mode: "all",
      since: "created",
      matcher: { kind: "tasks", conditions: [{ taskId: task.id, required: 1 }] },
    });

  const fine = [make("daily", daily), make("weekly", weekly), ...[daily, weekly].map((task) => make("counter", task))];
  assert.equal(fine.length, 4);
  assert.throws(() => make("daily", weekly), { status: 400, message: "Daily streaks only take daily tasks" });
  assert.throws(() => make("weekly", daily), { status: 400, message: "Weekly streaks only take weekly tasks" });
  for (const type of ["daily", "weekly", "counter"]) {
    assert.throws(() => make(type, once), { status: 400, message: "Streaks don't take one-time tasks" });
  }

  // Switching a streak's type re-checks what it counts; a rename doesn't.
  assert.throws(() => store.editStreak(fine[0].id, { type: "weekly" }), { status: 400 });
  assert.equal(store.editStreak(fine[0].id, { name: "Stretch every day" }).name, "Stretch every day");
  assert.equal(store.editStreak(fine[2].id, { type: "daily" }).type, "daily"); // a counter on a daily task
});
