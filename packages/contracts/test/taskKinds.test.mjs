import assert from "node:assert/strict";
import { test } from "node:test";
import { behaviorOf, taskPointValue } from "../dist/taskKinds.js";

// A repeatable task tallies completions in `progress` (unbounded) and is worth `points` each.
const repeatable = (progress) => ({ type: "repeatable", points: 2000, progress });

test("repeatable: value is points × completions, single box, never done", () => {
  const b = behaviorOf(repeatable(3));
  assert.equal(b.boxes(repeatable(3)), 1);
  assert.equal(b.filled(repeatable(3)), 3);
  assert.equal(b.renderKind(repeatable(3)), "counter");
  assert.equal(b.unbounded, true);
  assert.equal(b.isDone(repeatable(3)), false);
  assert.equal(taskPointValue(repeatable(3)), 6000); // 2000 × 3
});

test("repeatable: a click always adds one, regardless of the box index", () => {
  const b = behaviorOf(repeatable(5));
  assert.equal(b.levelOnClick(repeatable(5), 0), 6);
  assert.deepEqual(b.patchForLevel(repeatable(5), 6), { progress: 6 });
});

test("repeatable: starts at 0 when progress is absent", () => {
  const t = { type: "repeatable", points: 2000 };
  assert.equal(behaviorOf(t).filled(t), 0);
  assert.equal(taskPointValue(t), 0);
});

test("repeatable: an optional count caps completions and marks it done at the cap", () => {
  const capped = (progress) => ({ type: "repeatable", points: 2000, count: 3, progress });
  const b = behaviorOf(capped(2));
  // Clicking climbs toward the cap, then holds there.
  assert.equal(b.levelOnClick(capped(2), 0), 3);
  assert.equal(b.levelOnClick(capped(3), 0), 3);
  // Done only once the cap is reached; max reachable value is points × cap.
  assert.equal(b.isDone(capped(2)), false);
  assert.equal(b.isDone(capped(3)), true);
  assert.equal(b.maxValue(capped(0)), 6000); // 2000 × 3
});
