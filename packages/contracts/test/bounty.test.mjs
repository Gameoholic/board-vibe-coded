import assert from "node:assert/strict";
import { test } from "node:test";
import { boostOf, bountyWeight, canBounty, pickWeighted, rerollSource } from "../dist/bounty.js";
import { boosted } from "../dist/points.js";
import { taskPointValue } from "../dist/taskKinds.js";

const task = (over = {}) => ({ id: "t", sectionId: "s", type: "once", text: "x", done: false, points: 1000, createdAt: "2026-09-01T09:00:00.000Z", updatedAt: "", completedAt: null, ...over });

test("only an open, unblocked one-time task in a tab that never resets can be the Bounty", () => {
  assert.equal(canBounty(task(), {}), true);
  assert.equal(canBounty(task(), { period: "week" }), false);
  assert.equal(canBounty(task({ done: true }), {}), false);
  assert.equal(canBounty(task({ status: "blocked" }), {}), false);
  assert.equal(canBounty(task({ parentId: "p" }), {}), false);
  assert.equal(canBounty(task({ type: "checkbox" }), {}), false);
});

test("the roll leans on age: a day on the board is one more chance", () => {
  assert.equal(bountyWeight(task(), "2026-09-01T20:00:00.000Z"), 1);
  assert.equal(bountyWeight(task(), "2026-09-11T09:00:00.000Z"), 11);
  const weights = { old: 9, fresh: 1 };
  const pick = (r) => pickWeighted(["old", "fresh"], (c) => weights[c], r);
  assert.deepEqual([pick(0), pick(0.89), pick(0.9), pick(0.999)], ["old", "old", "fresh", "fresh"]);
  assert.equal(pickWeighted([], () => 1, 0.5), null);
});

test("a completion's boost is its own Bounty's, else its parent's, applied once and rounded half-up", () => {
  assert.equal(boostOf({}), 1);
  assert.equal(boostOf({ bounty: { multiplier: 2, periodKey: "w" } }), 2);
  assert.equal(boostOf({}, { bounty: { multiplier: 1.5, periodKey: "w" } }), 1.5);
  assert.equal(boosted(333, 1.5), 500);
  assert.equal(taskPointValue(task({ done: true, boost: 2 })), 2000);
  assert.equal(taskPointValue(task({ done: false, boost: 2 })), 0);
});

test("a reroll spends the week's free ones first, then bought ones", () => {
  assert.equal(rerollSource(1, 3), "week");
  assert.equal(rerollSource(0, 3), "bank");
  assert.equal(rerollSource(0, 0), null);
});
