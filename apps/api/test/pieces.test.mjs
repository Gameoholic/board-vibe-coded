import assert from "node:assert/strict";
import { test } from "node:test";
import { setDebugNow } from "../dist/clock.js";
import { openEventStore } from "../dist/db.js";
import { BoardStore } from "../dist/projection.js";

// Break down through the real projection: pieces take their task's points, pay as they're ticked, and
// finish the task with the last one; they're ordered under their task, never in the tab's list; and a
// rebuild from the log lands in the same place.
const noonOn = (date) => `${date}T09:00:00.000Z`;

function board() {
  setDebugNow(noonOn("2026-09-27"));
  const events = openEventStore(":memory:");
  const store = new BoardStore(events);
  const tasksTab = store.seedSection("Tasks", "#888888", [{ type: "once" }], "tasks");
  const daily = store.seedSection("Daily", "#888888", [{ type: "checkbox" }], "tasks", "day");
  const add = (text, points = 1000, sectionId = tasksTab.id, type = "once") =>
    store.createTask({ sectionId, type, text, points });
  // A task and its pieces as the owner sees them: [text, points, done], in order.
  const shape = (s, id) => {
    const pieces = s.listTasks().filter((t) => t.parentId === id).sort((a, b) => a.order - b.order);
    const task = s.getTask(id);
    return { task: [task.text, task.points, task.done], pieces: pieces.map((p) => [p.text, p.points, p.done]) };
  };
  // The tab's own list, in order — never a piece.
  const listed = (s) =>
    s.listTasks(tasksTab.id).filter((t) => !t.parentId).sort((a, b) => a.order - b.order).map((t) => t.text);
  // What the ticked tasks hold (a once task is worth its points when done).
  const earned = (s) => s.listTasks().reduce((sum, t) => sum + (t.done ? t.points ?? 0 : 0), 0);
  return { events, store, tasksTab, daily, add, shape, listed, earned };
}

test("breaking down splits a task's points across its pieces, and a later piece adds value", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, add, shape, listed } = board();
  const isp = add("Switch internet provider", 1000);
  add("Scan old documents", 500);

  const [task, ...pieces] = store.breakDown(isp.id, ["Compare plans", "Order the router", "Book the technician"]);
  assert.equal(task.points, 0);
  assert.equal(task.pointsSource, "manual"); // a formula rebalance never hands its old value back
  assert.deepEqual(pieces.map((p) => [p.text, p.points, p.order]), [
    ["Compare plans", 340, 0],
    ["Order the router", 330, 1],
    ["Book the technician", 330, 2],
  ]);
  // Pieces aren't in the tab's list, so a reorder names only the tab's own tasks.
  assert.deepEqual(listed(store), ["Switch internet provider", "Scan old documents"]);
  const top = store.listTasks().filter((x) => !x.parentId);
  store.reorderTasks(isp.sectionId, [top[1].id, top[0].id]);
  assert.deepEqual(listed(store), ["Scan old documents", "Switch internet provider"]);

  // Its points are all in the pieces now, so another piece is an average one of them — the task grew.
  store.breakDown(isp.id, ["Cancel the old contract"]);
  assert.deepEqual(shape(store, isp.id).pieces.at(-1), ["Cancel the old contract", 330, false]);

  const ids = store.listTasks().filter((x) => x.parentId === isp.id).sort((a, b) => a.order - b.order).map((x) => x.id);
  store.reorderPieces(isp.id, [ids[3], ids[0], ids[1], ids[2]]);
  assert.deepEqual(shape(store, isp.id).pieces.map((p) => p[0]), ["Cancel the old contract", "Compare plans", "Order the router", "Book the technician"]);

  assert.throws(() => store.breakDown(ids[0], ["deeper"]), /can't be broken down/); // one level deep
  assert.throws(() => store.reorderPieces(isp.id, [ids[0]]), /match all piece ids/);
  const rebuilt = new BoardStore(events);
  assert.deepEqual(shape(rebuilt, isp.id), shape(store, isp.id));
  assert.deepEqual(listed(rebuilt), listed(store));
});

test("pieces pay as they're ticked, the last one finishes the task, and the task's box is all of them", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, add, shape, listed, earned } = board();
  const isp = add("Switch internet provider", 900);
  const other = add("Scan old documents", 500);
  const [, a, b, c] = store.breakDown(isp.id, ["A", "B", "C"]);

  store.setDone(a.id, true);
  assert.equal(earned(store), 300);
  assert.equal(store.getTask(isp.id).done, false);
  store.setDone(b.id, true);
  store.setDone(c.id, true);
  assert.equal(store.getTask(isp.id).done, true); // its own completion, on its own event
  assert.equal(events.readAll().filter((e) => e.event.type === "TaskCompleted" && e.event.taskId === isp.id).length, 1);
  assert.equal(earned(store), 900);
  assert.deepEqual(listed(store), ["Scan old documents", "Switch internet provider"]); // finished, it trails

  store.setDone(b.id, false); // reopening a piece reopens the task, back at the end of the open run
  assert.equal(store.getTask(isp.id).done, false);
  assert.deepEqual(listed(store), ["Scan old documents", "Switch internet provider"]);

  // Ticking the task finishes every piece still open; unticking it reopens them all.
  store.setDone(isp.id, true);
  assert.deepEqual(shape(store, isp.id).pieces.map((p) => p[2]), [true, true, true]);
  assert.equal(store.getTask(isp.id).done, true);
  store.setDone(isp.id, false);
  assert.deepEqual(shape(store, isp.id).pieces.map((p) => p[2]), [false, false, false]);
  assert.equal(store.getTask(isp.id).done, false);

  // A task that waits on it is released once the last piece finishes it.
  store.setStatus(other.id, "blocked", { taskId: isp.id });
  store.setDone(isp.id, true);
  assert.equal(store.getTask(other.id).status, "backlog");

  const rebuilt = new BoardStore(events);
  assert.deepEqual(shape(rebuilt, isp.id), shape(store, isp.id));
  assert.equal(earned(rebuilt), earned(store));
});

test("a piece becomes its own task beside its old one, and a task can be tucked in as a piece", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, daily, add, shape, listed } = board();
  const isp = add("Switch internet provider", 600);
  const docs = add("Scan old documents", 500);
  const call = add("Call the plumber", 200);
  const g = store.createGroup({ sectionId: isp.sectionId, label: "Home", itemIds: [docs.id, call.id] });
  const [, a, b] = store.breakDown(isp.id, ["A", "B"]);

  store.setParent(b.id, null); // "Make it its own task": right after the task it left
  assert.deepEqual(listed(store), ["Switch internet provider", "B", "Scan old documents", "Call the plumber"]);
  assert.equal(store.getTask(b.id).points, 300); // a piece keeps its points either way
  store.setParent(b.id, isp.id); // tucked back in, as its last piece
  store.setDone(a.id, true);
  store.setParent(b.id, null); // what's left of the task is all done, so it's finished — and trails
  assert.equal(store.getTask(isp.id).done, true);
  assert.deepEqual(listed(store), ["B", "Scan old documents", "Call the plumber", "Switch internet provider"]);

  // Tucking a grouped task in takes it out of its group (a piece isn't one of the tab's items).
  store.setDone(isp.id, false);
  store.setParent(call.id, isp.id);
  assert.equal(store.getTask(call.id).groupId, undefined);
  assert.equal(store.getTask(docs.id).groupId, g.id);
  assert.deepEqual(shape(store, isp.id).pieces.map((p) => p[0]), ["A", "Call the plumber"]);
  assert.equal(store.getTask(isp.id).done, false);
  assert.throws(() => store.createGroup({ sectionId: isp.sectionId, label: "x", itemIds: [call.id] }), /not in this section/);

  // One level deep, one tab, never into itself or a finished task.
  const outside = add("Reset board", 200, daily.id, "checkbox");
  assert.throws(() => store.setParent(docs.id, call.id), /can't hold it/);
  assert.throws(() => store.setParent(isp.id, docs.id), /pieces of its own/);
  assert.throws(() => store.setParent(docs.id, docs.id), /into itself/);
  assert.throws(() => store.setParent(outside.id, isp.id), /own tab/);
  store.setDone(docs.id, true);
  assert.throws(() => store.setParent(call.id, docs.id), /already done/);

  const rebuilt = new BoardStore(events);
  assert.deepEqual(shape(rebuilt, isp.id), shape(store, isp.id));
  assert.deepEqual(listed(rebuilt), listed(store));
});

test("duplicate, delete and reset-keep-board carry pieces along", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, add, shape, listed } = board();
  const isp = add("Switch internet provider", 600);
  const [, a, b] = store.breakDown(isp.id, ["A", "B"]);

  const copyOfA = store.duplicateTask(a.id); // a sibling right after its source
  assert.equal(copyOfA.parentId, isp.id);
  assert.deepEqual(shape(store, isp.id).pieces.map((p) => p[0]), ["A", "A", "B"]);
  store.deleteTask(copyOfA.id);

  const copy = store.duplicateTask(isp.id); // a broken-down task's copy brings copies of its pieces
  assert.deepEqual(shape(store, copy.id).pieces, [["A", 300, false], ["B", 300, false]]);
  assert.deepEqual(listed(store), ["Switch internet provider", "Switch internet provider"]);

  store.setDone(a.id, true);
  store.deleteTask(b.id); // the last open piece gone: what's left is all done
  assert.equal(store.getTask(isp.id).done, true);

  store.deleteTask(copy.id); // a task goes with its pieces
  assert.equal(store.listTasks().filter((x) => x.parentId === copy.id).length, 0);

  store.reseedFromCurrent();
  const again = store.listTasks().filter((x) => x.parentId === isp.id);
  assert.deepEqual(again.map((p) => [p.text, p.points, p.done]), [["A", 300, false]]);
  assert.equal(store.getTask(isp.id).done, false);
  assert.deepEqual(shape(new BoardStore(events), isp.id), shape(store, isp.id));
});
