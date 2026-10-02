import assert from "node:assert/strict";
import { test } from "node:test";
import { fromBoost, modifiersOf, onWholeTask, payout } from "../dist/modifiers.js";
import { DEFAULT_SETTINGS } from "../dist/period.js";
import { taskPointValue } from "../dist/taskKinds.js";

// Modifiers compose by construction: shares add up first, flats after them, factors multiply the lot, and a
// floor is the least a task pays — one result, rounded once.
const share = (value) => ({ id: "s", kind: "share", value });
const flat = (value) => ({ id: "f", kind: "flat", value });
const factor = (value) => ({ id: "x", kind: "factor", value });
const floor = (value) => ({ id: "m", kind: "floor", value });

test("each kind alone", () => {
  assert.equal(payout(1000, []), 1000);
  assert.equal(payout(1000, [share(0.4)]), 1400);
  assert.equal(payout(1000, [flat(250)]), 1250);
  assert.equal(payout(1000, [factor(2)]), 2000);
  assert.equal(payout(1000, [floor(100000)]), 100000);
});

test("every pair, in the one order: shares, then flats, then factors, then the floor", () => {
  assert.equal(payout(1000, [share(0.2), share(0.3)]), 1500, "shares add — they never compound");
  assert.equal(payout(1000, [share(0.4), flat(250)]), 1650, "a flat adds after the shares (not a share of it)");
  assert.equal(payout(1000, [factor(2), share(0.4)]), 2800, "a factor multiplies the shares too, whatever the order listed");
  assert.equal(payout(1000, [factor(2), flat(250)]), 2500, "and the flats");
  assert.equal(payout(1000, [factor(2), factor(1.5)]), 3000, "factors multiply each other");
  assert.equal(payout(1000, [share(0.4), floor(100000)]), 100000, "a floor lifts");
  assert.equal(payout(80000, [factor(2), floor(100000)]), 160000, "but never lowers");
  assert.equal(payout(1000, [floor(5000), floor(2000)]), 5000, "the highest floor holds");
});

test("a broken-down task's own completion: its floor less what its pieces already paid", () => {
  const paid = (value, piecesPaid) => ({ ...floor(value), piecesPaid });
  assert.equal(payout(0, [paid(100000, 1800)]), 98200, "it pays the rest of the floor");
  assert.equal(payout(0, [paid(100000, 120000)]), 0, "and nothing once the pieces paid more");
  assert.equal(payout(1000, [paid(5000, 4500)]), 1000, "its own points, when they come to more than what's left");
  // The whole task's worth, as its bracket shows it: the floor on all of it.
  assert.deepEqual(onWholeTask([share(2), paid(100000, 1800)]), [share(2), floor(100000)]);
  assert.equal(payout(600, onWholeTask([share(2), paid(100000, 1800)])), 100000);
});

test("rounded once, half-up, to whole thousandths — never step by step", () => {
  assert.equal(payout(333, [factor(1.5)]), 500); // 499.5 → 500
  // Stepping would round 333 × 1.1 = 366.3 → 366, then × 1.5 = 549; composed it's 549.45 → 549, and
  // 335 × 1.1 × 1.5 = 552.75 → 553 where stepping gives 368 × 1.5 = 552.
  assert.equal(payout(335, [share(0.1), factor(1.5)]), 553);
});

test("the modifiers on a task: its Bounty (or its task's), frost on its own points, Subzero once thawed", () => {
  const settings = { ...DEFAULT_SETTINGS, freezer: { ...DEFAULT_SETTINGS.freezer, frostPerWeek: 20, frostCap: 200 } };
  const task = (over = {}) => ({ id: "t", sectionId: "s", type: "once", text: "x", done: false, points: 1000, createdAt: "", updatedAt: "", completedAt: null, ...over });
  const inTasks = { settings, section: {} };
  const onIce = { settings, section: { freezerFor: "tasks" } };
  const bounty = { multiplier: 2, periodKey: "w" };

  assert.deepEqual(modifiersOf(task(), inTasks), []);
  assert.deepEqual(modifiersOf(task({ bounty }), inTasks), [{ id: "bounty", kind: "factor", value: 2 }]);
  assert.deepEqual(modifiersOf(task({ parentId: "p" }), { ...inTasks, parent: { bounty } }), [{ id: "bounty", kind: "factor", value: 2 }]);
  assert.deepEqual(modifiersOf(task({ frostDays: 7 }), onIce), [{ id: "frost", kind: "share", value: 0.2 }]);
  assert.deepEqual(modifiersOf(task({ frostDays: 7, points: 0 }), onIce), [], "frost on no points adds nothing");
  assert.deepEqual(modifiersOf(task({ frostDays: 7, points: 0 }), { ...onIce, hasPieces: true }), [{ id: "frost", kind: "share", value: 0.2 }], "unless its points are in its pieces");
  // A piece pays its task's frost — it waited as one, and a piece made after the thaw has none of its own.
  assert.deepEqual(modifiersOf(task({ parentId: "p" }), { ...onIce, parent: { frostDays: 7 } }), [{ id: "frost", kind: "share", value: 0.2 }]);

  // Full frost (70 days at 20% a week is 200%): Subzero — but only once it's out of the Freezer, and on the
  // whole task: a piece pays toward its task's floor, and a broken-down task's finish counts what they paid.
  const full = task({ frostDays: 70 });
  assert.deepEqual(modifiersOf(full, onIce).map((m) => m.id), ["frost"]);
  assert.deepEqual(modifiersOf(full, inTasks), [
    { id: "frost", kind: "share", value: 2 },
    { id: "subzero", kind: "floor", value: 100000 },
  ]);
  assert.deepEqual(modifiersOf({ ...full, parentId: "p" }, inTasks).map((m) => m.id), ["frost"]);
  assert.deepEqual(modifiersOf({ ...full, points: 0 }, { ...inTasks, hasPieces: true, piecesPaid: 1800 }), [
    { id: "frost", kind: "share", value: 2 },
    { id: "subzero", kind: "floor", value: 100000, piecesPaid: 1800 },
  ]);
  assert.deepEqual(modifiersOf(task({ frostDays: 200 }), inTasks)[0], { id: "frost", kind: "share", value: 2 }, "frost stops at its cap");
});

test("a done task is worth what it was paid at, plus a thaw bonus it holds; an undone one only its bonus", () => {
  const task = (over = {}) => ({ id: "t", sectionId: "s", type: "once", text: "x", done: false, points: 1000, createdAt: "", updatedAt: "", completedAt: null, ...over });
  assert.equal(taskPointValue(task({ done: true, paidWith: [factor(2)] })), 2000);
  assert.equal(taskPointValue(task({ done: true, paidWith: [floor(100000)], thawBonus: 500 })), 100500);
  assert.equal(taskPointValue(task({ thawBonus: 500 })), 500);
  assert.equal(taskPointValue(task()), 0);
  // An older completion recorded only its Bounty's factor.
  assert.deepEqual(fromBoost(2), [{ id: "bounty", kind: "factor", value: 2 }]);
  assert.equal(fromBoost(1), undefined);
  assert.equal(fromBoost(undefined), undefined);
});
