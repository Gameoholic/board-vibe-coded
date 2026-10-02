import assert from "node:assert/strict";
import { test } from "node:test";
import { openEventStore } from "../dist/db.js";
import { BoardStore } from "../dist/projection.js";

// The row menu's "Duplicate" through the real projection: the copy carries the task's definition but
// none of its progress, lands right after its source (inside the source's group), and a rebuild from
// the log lands in the same place.

const idsInOrder = (store, sectionId) =>
  store
    .listTasks(sectionId)
    .sort((a, b) => a.order - b.order)
    .map((t) => t.id);

test("a duplicate copies the definition, not the progress, and sits right after its source in its group", () => {
  const events = openEventStore(":memory:");
  const store = new BoardStore(events);
  const tab = store.seedSection("Tab", "#888888", [{ type: "checkbox" }], "tasks", "day");
  const add = (text, extra = {}) =>
    store.createTask({ sectionId: tab.id, type: "checkbox", text, points: 1000, ...extra });

  const a = add("A", { count: 3, description: "a note", estimateMinutes: 30 });
  const b = add("B");
  const c = add("C");
  const group = store.createGroup({ sectionId: tab.id, label: "G", itemIds: [a.id, b.id] });
  store.setProgress(a.id, 2);

  const copy = store.duplicateTask(a.id);
  assert.notEqual(copy.id, a.id);
  assert.equal(copy.text, "A");
  assert.equal(copy.points, 1000);
  assert.equal(copy.count, 3);
  assert.equal(copy.description, "a note");
  assert.equal(copy.estimateMinutes, 30);
  assert.equal(copy.progress, 0);
  assert.equal(copy.done, false);
  assert.equal(copy.groupId, group.id);
  assert.equal(store.getTask(a.id).progress, 2); // the source is untouched
  assert.deepEqual(idsInOrder(store, tab.id), [a.id, copy.id, b.id, c.id]);

  // The group's last member: the copy still lands inside the group's run, so it stays contiguous.
  const copyB = store.duplicateTask(b.id);
  assert.equal(copyB.groupId, group.id);
  assert.deepEqual(idsInOrder(store, tab.id), [a.id, copy.id, b.id, copyB.id, c.id]);

  const rebuilt = new BoardStore(events);
  assert.deepEqual(idsInOrder(rebuilt, tab.id), idsInOrder(store, tab.id));
  assert.equal(rebuilt.getTask(copy.id).groupId, group.id);
  assert.equal(rebuilt.getTask(copy.id).progress, 0);

  const created = events.readAll().find((s) => s.event.type === "TaskCreated" && s.event.taskId === copy.id);
  assert.equal(created.event.duplicatedFrom, a.id);
});

test("duplicating a finished one-time task gives a fresh copy ahead of the tab's finished tasks", () => {
  const events = openEventStore(":memory:");
  const store = new BoardStore(events);
  const tab = store.seedSection("Tasks", "#888888", [{ type: "once" }], "tasks");
  const x = store.createTask({ sectionId: tab.id, type: "once", text: "X", points: 500 });
  const y = store.createTask({ sectionId: tab.id, type: "once", text: "Y", points: 500 });
  store.setDone(x.id, true); // X retires: it trails the listed run
  assert.deepEqual(idsInOrder(store, tab.id), [y.id, x.id]);

  const copy = store.duplicateTask(x.id);
  assert.equal(copy.done, false);
  assert.deepEqual(idsInOrder(store, tab.id), [y.id, copy.id, x.id]);
  assert.deepEqual(idsInOrder(new BoardStore(events), tab.id), [y.id, copy.id, x.id]);
});
