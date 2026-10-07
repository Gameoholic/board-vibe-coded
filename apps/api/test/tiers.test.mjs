import assert from "node:assert/strict";
import { test } from "node:test";
import { openEventStore } from "../dist/db.js";
import { BoardStore } from "../dist/projection.js";

// A tiered task's tiers are its definition, edited as a whole: tiers can be added and removed after it's
// made. What's ticked is a level (the tier's place), so it stays valid when tiers come and go — a level
// the task no longer reaches comes down to its last tier, as a shrunk box count clamps progress.

const tier = (n, points) => ({ label: `Tier ${n}`, points });

function board() {
  const events = openEventStore(":memory:");
  const store = new BoardStore(events);
  const registry = store.seedSection("Registry", "#888888", [{ type: "tiered" }], "tasks", "day");
  const task = store.createTask({ sectionId: registry.id, type: "tiered", text: "Practice", tiers: [tier(1, 1000), tier(2, 2000), tier(3, 3000)] });
  return { events, store, id: task.id };
}

test("a tier added to a tiered task is one more box, and what's ticked stays", () => {
  const { store, id } = board();
  store.setTier(id, 1);
  const edited = store.editTask(id, { tiers: [tier(1, 1000), tier(2, 2000), tier(3, 3000), tier(4, 5000)] });
  assert.deepEqual(edited.tiers.map((t) => t.points), [1000, 2000, 3000, 5000]);
  assert.equal(edited.activeTier, 1);
  // The new tier can be ticked like any other.
  assert.equal(store.setTier(id, 3).activeTier, 3);
});

test("removing the tier that's ticked brings it down to the last tier left", () => {
  const { store, id } = board();
  store.setTier(id, 2);
  const edited = store.editTask(id, { tiers: [tier(1, 1000), tier(2, 2000)] });
  assert.equal(edited.tiers.length, 2);
  assert.equal(edited.activeTier, 1);
  // Down to one tier, it's still that tier that's ticked.
  assert.equal(store.editTask(id, { tiers: [tier(1, 1500)] }).activeTier, 0);
});

test("removing a tier leaves an unticked task unticked, and a lower tick where it was", () => {
  const { store, id } = board();
  assert.equal(store.editTask(id, { tiers: [tier(1, 1000), tier(2, 2000)] }).activeTier ?? null, null);
  store.setTier(id, 0);
  assert.equal(store.editTask(id, { tiers: [tier(1, 1000)] }).activeTier, 0);
});

test("edited tiers rebuild from the log to the same task", () => {
  const { events, store, id } = board();
  store.setTier(id, 2);
  store.editTask(id, { tiers: [tier(1, 1000), tier(2, 2500)] });
  store.editTask(id, { tiers: [tier(1, 1000), tier(2, 2500), tier(3, 4000), tier(4, 6000)] });
  const rebuilt = new BoardStore(events);
  assert.deepEqual(rebuilt.getTask(id), store.getTask(id));
  assert.equal(rebuilt.getTask(id).activeTier, 1);
});
