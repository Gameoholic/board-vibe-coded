import assert from "node:assert/strict";
import { test } from "node:test";
import { setDebugNow } from "../dist/clock.js";
import { openEventStore } from "../dist/db.js";
import { BoardStore } from "../dist/projection.js";

// Status through the real projection: a task moves between In progress / Backlog / Blocked, a task
// blocked on another goes back to where it was once that one is done (for good — a daily reset doesn't
// block it again), and a rebuild from the log lands in the same place. Plus the group rule the bands
// lean on: a group is one contiguous run of its tab's order, whatever order or membership came before.
const noonOn = (date) => `${date}T09:00:00.000Z`;

function board() {
  setDebugNow(noonOn("2026-09-27"));
  const events = openEventStore(":memory:");
  const store = new BoardStore(events);
  const tasksTab = store.seedSection("Tasks", "#888888", [{ type: "once" }], "tasks");
  const daily = store.seedSection("Daily", "#888888", [{ type: "checkbox" }], "tasks", "day");
  const add = (text, sectionId = tasksTab.id, type = "once") => store.createTask({ sectionId, type, text, points: 500 });
  const statusOf = (s, task) => {
    const t = s.getTask(task.id);
    return { status: t.status ?? "backlog", blocker: t.blocker };
  };
  return { events, store, tasksTab, daily, add, statusOf };
}

test("a task moves between bands, and in progress records since when", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, add, statusOf } = board();
  const task = add("Fix bike brakes");
  assert.equal(store.getTask(task.id).status, undefined); // never set ≡ backlog

  store.setStatus(task.id, "in-progress");
  assert.equal(store.getTask(task.id).status, "in-progress");
  assert.equal(store.getTask(task.id).statusSince, noonOn("2026-09-27"));

  // Saying it again is a no-op: no event, and "since" doesn't move.
  const before = events.readAll().length;
  setDebugNow(noonOn("2026-09-29"));
  store.setStatus(task.id, "in-progress");
  assert.equal(events.readAll().length, before);
  assert.equal(store.getTask(task.id).statusSince, noonOn("2026-09-27"));

  store.setStatus(task.id, "blocked", { note: "waiting on parts" });
  assert.deepEqual(statusOf(store, task), { status: "blocked", blocker: { note: "waiting on parts", resume: "in-progress" } });
  // Re-saying why keeps where it goes back to.
  store.setStatus(task.id, "blocked", { note: "parts ordered" });
  assert.deepEqual(statusOf(store, task).blocker, { note: "parts ordered", resume: "in-progress" });

  store.setStatus(task.id, "backlog");
  assert.deepEqual(statusOf(store, task), { status: "backlog", blocker: undefined });
  assert.deepEqual(statusOf(new BoardStore(events), task), statusOf(store, task));
});

test("a task blocked on another goes back where it was once that one is done, and stays there", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, daily, add, statusOf } = board();
  store.rollPeriod("day");
  const shelf = add("Build the hallway shelf");
  const mirror = add("Hang the hallway mirror");
  const call = add("Call the plumber");
  const reset = add("Reset board", daily.id, "checkbox");

  store.setStatus(mirror.id, "blocked", { taskId: shelf.id });
  store.setStatus(call.id, "in-progress");
  store.setStatus(call.id, "blocked", { taskId: reset.id, note: "after the reset" });

  store.setDone(shelf.id, true);
  assert.deepEqual(statusOf(store, mirror), { status: "backlog", blocker: undefined });
  store.setDone(shelf.id, false); // unchecking it again doesn't re-block anything
  assert.deepEqual(statusOf(store, mirror), { status: "backlog", blocker: undefined });

  store.setDone(reset.id, true);
  assert.deepEqual(statusOf(store, call), { status: "in-progress", blocker: undefined });
  setDebugNow(noonOn("2026-09-28"));
  store.rollPeriod("day"); // the daily blocker is unchecked by the new day
  assert.deepEqual(statusOf(store, call), { status: "in-progress", blocker: undefined });

  const rebuilt = new BoardStore(events);
  for (const task of [mirror, call]) assert.deepEqual(statusOf(rebuilt, task), statusOf(store, task));
});

test("deleting the task it waits on releases it; a multi-box blocker releases only when every box is ticked", (t) => {
  t.after(() => setDebugNow(null));
  const { store, daily, add, statusOf } = board();
  const a = add("A");
  const b = add("B");
  const boxes = store.createTask({ sectionId: daily.id, type: "checkbox", text: "Stretch", points: 500, count: 3 });
  store.setStatus(a.id, "blocked", { taskId: b.id });
  store.deleteTask(b.id);
  assert.deepEqual(statusOf(store, a), { status: "backlog", blocker: undefined });

  store.setStatus(a.id, "blocked", { taskId: boxes.id });
  store.setProgress(boxes.id, 2);
  assert.equal(statusOf(store, a).status, "blocked");
  store.setProgress(boxes.id, 3);
  assert.equal(statusOf(store, a).status, "backlog");
});

test("a task can't wait on itself, on a missing task, or on one that's already done", (t) => {
  t.after(() => setDebugNow(null));
  const { store, add } = board();
  const a = add("A");
  const b = add("B");
  assert.throws(() => store.setStatus(a.id, "blocked", { taskId: a.id }), /itself/);
  assert.throws(() => store.setStatus(a.id, "blocked", { taskId: "nope" }), /doesn't exist/);
  store.setDone(b.id, true);
  assert.throws(() => store.setStatus(a.id, "blocked", { taskId: b.id }), /already done/);
  // A blocker given with another status is ignored by the command (the request schema refuses it).
  store.setStatus(a.id, "in-progress", { note: "stray" });
  assert.equal(store.getTask(a.id).blocker, undefined);
});

const idsInOrder = (store, sectionId) =>
  store
    .listTasks(sectionId)
    .sort((a, b) => a.order - b.order)
    .map((t) => t.id);

test("a group's members are gathered into one run, whatever order or membership came before", () => {
  const events = openEventStore(":memory:");
  const store = new BoardStore(events);
  const tab = store.seedSection("Tab", "#888888", [{ type: "once" }], "tasks");
  const [a, x, b, c] = ["A", "X", "B", "C"].map((text) => store.createTask({ sectionId: tab.id, type: "once", text, points: 500 }));

  // A run seen in one band ([A, B]) can have another band's task (X) between them in the full order.
  const group = store.createGroup({ sectionId: tab.id, label: "G", itemIds: [a.id, b.id] });
  assert.deepEqual(idsInOrder(store, tab.id), [a.id, b.id, x.id, c.id]);

  // A reorder that would split the group is gathered at its first member.
  store.reorderTasks(tab.id, [a.id, c.id, b.id, x.id]);
  assert.deepEqual(idsInOrder(store, tab.id), [a.id, b.id, c.id, x.id]);

  // So is an item added from afar.
  store.addGroupMembers(group.id, [x.id]);
  assert.deepEqual(idsInOrder(store, tab.id), [a.id, b.id, x.id, c.id]);
  assert.deepEqual(idsInOrder(new BoardStore(events), tab.id), idsInOrder(store, tab.id));
});
