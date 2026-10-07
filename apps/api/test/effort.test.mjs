import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "@board/contracts";
import { openEventStore } from "../dist/db.js";
import { BoardStore } from "../dist/projection.js";

// Effort levels are stored by id. A log written before they had ids — a formula of two levels, and tasks
// and tiers that kept their level's place in the list — has to fold into the same board: each old level
// becomes the one it meant, keeping its multiplier, so no task's points move.

const at = "2026-10-01T09:00:00.000Z";

function legacyBoard() {
  const events = openEventStore(":memory:");
  const seeded = new BoardStore(events);
  const tab = seeded.seedSection("Tab", "#888888", [{ type: "checkbox" }, { type: "tiered" }, { type: "repeatable" }], "tasks", "day");
  const legacyFormula = { ratePercentPerHour: 2.5, effortLevels: [{ label: "Normal", mult: 1 }, { label: "Challenging", mult: 1.3 }] };
  events.append({ type: "SettingsChanged", settings: { ...DEFAULT_SETTINGS, pointsFormula: legacyFormula } }, at);
  const created = (taskId, fields) => events.append({ type: "TaskCreated", taskId, sectionId: tab.id, ...fields }, at);
  // 1h on the old harder level at ×1.3 → 3.25%.
  created("hard", { taskType: "checkbox", text: "Hard", points: 3250, estimateMinutes: 60, estimateEffortIndex: 1, pointsSource: "builder" });
  created("plain", { taskType: "checkbox", text: "Plain", points: 2500, estimateMinutes: 60, estimateEffortIndex: 0, pointsSource: "builder" });
  created("tiers", {
    taskType: "tiered",
    text: "Tiers",
    tiers: [
      { label: "Tier 1", points: 1250, minutes: 30, effortIndex: 0, pointsSource: "builder" },
      { label: "Tier 2", points: 3250, minutes: 60, effortIndex: 1, pointsSource: "builder" },
    ],
  });
  events.append({ type: "TaskEdited", taskId: "plain", changes: { estimateEffortIndex: 1, points: 3250 }, previous: { estimateEffortIndex: 0, points: 2500 } }, at);
  return { events, store: new BoardStore(events) };
}

test("an old board's levels and tasks fold into the four levels, priced as before", () => {
  const { store } = legacyBoard();
  assert.deepEqual(
    store.getSettings().pointsFormula.effortLevels.map((l) => [l.id, l.label, l.mult]),
    [["casual", "Casual", 0.75], ["normal", "Normal", 1], ["grind", "Ugh", 1.3], ["dread", "Dread", 2.5]],
  );
  assert.equal(store.getTask("hard").estimateEffort, "grind");
  assert.equal(store.getTask("hard").points, 3250);
  assert.equal(store.getTask("plain").estimateEffort, "grind"); // the edit moved it up a level
  assert.deepEqual(store.getTask("tiers").tiers.map((t) => t.effort), ["normal", "grind"]);
  assert.equal("effortIndex" in store.getTask("tiers").tiers[1], false);

  // Nothing moves: every builder value already costs what its level now prices it at.
  assert.deepEqual(store.previewFormula(store.getSettings().pointsFormula).willUpdate, []);
});

test("repricing a level moves only the tasks on it, whatever their kind", () => {
  const { events, store } = legacyBoard();
  const sectionId = store.getTask("hard").sectionId;
  // A tally on Ugh: 1h at ×1.3 → 3.25%.
  const tally = store.createTask({ sectionId, type: "repeatable", text: "Tally", points: 3250, estimateMinutes: 60, estimateEffort: "grind", pointsSource: "builder" });
  const formula = store.getSettings().pointsFormula;
  const grindAt2 = { ...formula, effortLevels: formula.effortLevels.map((l) => (l.id === "grind" ? { ...l, mult: 2 } : l)) };
  store.applyFormula(grindAt2, true);
  assert.equal(store.getTask("hard").points, 5000);
  assert.equal(store.getTask(tally.id).points, 5000);
  assert.deepEqual(store.getTask("tiers").tiers.map((t) => t.points), [1250, 5000]); // the Normal tier stays

  const rebuilt = new BoardStore(events);
  assert.equal(rebuilt.getTask("hard").points, 5000);
  assert.deepEqual(rebuilt.getTask("tiers").tiers.map((t) => t.points), [1250, 5000]);
});

test("a task can only be on one of the board's levels, and the levels can't be added, removed or reordered", () => {
  const { store } = legacyBoard();
  const sectionId = store.getTask("hard").sectionId;
  const made = store.createTask({ sectionId, type: "checkbox", text: "New", points: 6250, estimateMinutes: 60, estimateEffort: "dread", pointsSource: "builder" });
  assert.equal(made.estimateEffort, "dread");
  assert.throws(() => store.createTask({ sectionId, type: "checkbox", text: "X", points: 1000, estimateMinutes: 60, estimateEffort: "nope" }), /unknown effort level/);
  assert.throws(() => store.editTask("tiers", { tiers: [{ label: "Tier 1", points: 1000, minutes: 30, effort: "nope" }] }), /unknown effort level/);

  const formula = store.getSettings().pointsFormula;
  assert.throws(() => store.previewFormula({ ...formula, effortLevels: formula.effortLevels.slice(1) }), /effort levels/);
  assert.throws(() => store.applyFormula({ ...formula, effortLevels: [...formula.effortLevels].reverse() }, false), /effort levels/);
  // Renaming and repricing is what Settings does.
  const renamed = { ...formula, effortLevels: formula.effortLevels.map((l) => (l.id === "dread" ? { ...l, label: "Boss", mult: 3 } : l)) };
  store.applyFormula(renamed, true);
  assert.equal(store.getSettings().pointsFormula.effortLevels[3].label, "Boss");
  assert.equal(store.getTask(made.id).points, 7500);
});
