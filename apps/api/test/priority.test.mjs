import assert from "node:assert/strict";
import { test } from "node:test";
import { openEventStore } from "../dist/db.js";
import { BoardStore } from "../dist/projection.js";

// Priority through the real projection: a to-do starts Low, is set as an edit that says what it was, is
// refused where it means nothing (a habit, a piece), is kept by a copy and by a rebuilt board, and a
// rebuild from the log lands in the same place.

function board() {
  const events = openEventStore(":memory:");
  const store = new BoardStore(events);
  const tasksTab = store.seedSection("Tasks", "#888888", [{ type: "once" }], "tasks");
  const daily = store.seedSection("Daily", "#888888", [{ type: "checkbox" }], "tasks", "day");
  const add = (text, sectionId = tasksTab.id, type = "once") => store.createTask({ sectionId, type, text, points: 500 });
  return { events, store, tasksTab, daily, add };
}

const edits = (events) => events.readAll().filter((s) => s.event.type === "TaskEdited").map((s) => s.event);

test("a to-do starts Low, and setting its priority is an edit that says what it was", () => {
  const { events, store, add } = board();
  const task = add("Renew passport");
  assert.equal(store.getTask(task.id).priority, undefined); // never set ≡ Low

  assert.equal(store.setPriority(task.id, "high").priority, "high");
  assert.deepEqual(edits(events), [{ type: "TaskEdited", taskId: task.id, changes: { priority: "high" }, previous: { priority: "low" } }]);

  store.setPriority(task.id, "medium");
  assert.deepEqual(edits(events).at(-1).previous, { priority: "high" });

  // Back to Low is recorded like any other, not dropped.
  assert.equal(store.setPriority(task.id, "low").priority, "low");
  assert.equal(edits(events).length, 3);

  assert.equal(new BoardStore(events).getTask(task.id).priority, "low");
});

test("saying again what it already is writes nothing", () => {
  const { events, store, add } = board();
  const task = add("Call grandma");
  store.setPriority(task.id, "low"); // Low is what it has
  assert.equal(edits(events).length, 0);

  store.setPriority(task.id, "high");
  store.setPriority(task.id, "high");
  assert.equal(edits(events).length, 1);
});

test("only a to-do of its tab's own list takes a priority", () => {
  const { store, daily, add } = board();
  const habit = add("Stretch", daily.id, "checkbox");
  assert.throws(() => store.setPriority(habit.id, "high"), /doesn't take a priority/);

  const task = add("Hang the shelf");
  const [, piece] = store.breakDown(task.id, ["Buy brackets"]);
  assert.throws(() => store.setPriority(piece.id, "high"), /doesn't take a priority/);
  assert.throws(() => store.setPriority("nope", "high"));
});

test("a copy keeps the priority, and so does a board rebuilt by reset-keep-board", () => {
  const { events, store, add } = board();
  const task = add("Book flights");
  store.setPriority(task.id, "high");

  const copy = store.duplicateTask(task.id);
  assert.equal(copy.priority, "high");
  assert.equal(new BoardStore(events).getTask(copy.id).priority, "high");

  store.reseedFromCurrent();
  assert.equal(store.getTask(task.id).priority, "high");
  assert.equal(store.getTask(copy.id).priority, "high");
  assert.equal(new BoardStore(events).getTask(task.id).priority, "high");
});

test("a priority stays with its task through the Freezer and back", () => {
  const { store, tasksTab, add } = board();
  store.seedSection("Freezer", "#0ea5e9", [{ type: "once" }], "tasks", undefined, tasksTab.id);
  const task = add("Sort the photo backup");
  store.setPriority(task.id, "medium");

  store.setFrozen(task.id, true);
  assert.equal(store.getTask(task.id).priority, "medium");
  store.setFrozen(task.id, false);
  assert.equal(store.getTask(task.id).priority, "medium");
});

test("a task can be made with a priority — where its type takes one", () => {
  const { events, store, tasksTab, daily } = board();
  const task = store.createTask({ sectionId: tasksTab.id, type: "once", text: "File the claim", points: 500, priority: "high" });
  assert.equal(task.priority, "high");
  const created = events.readAll().find((s) => s.event.type === "TaskCreated" && s.event.taskId === task.id);
  assert.equal(created.event.priority, "high");
  assert.equal(new BoardStore(events).getTask(task.id).priority, "high");

  // Left out, it's Low — nothing is stored.
  const plain = store.createTask({ sectionId: tasksTab.id, type: "once", text: "Water the plants", points: 500 });
  assert.equal(plain.priority, undefined);

  assert.throws(
    () => store.createTask({ sectionId: daily.id, type: "checkbox", text: "Stretch", points: 500, priority: "high" }),
    /don't take a priority/,
  );
});
