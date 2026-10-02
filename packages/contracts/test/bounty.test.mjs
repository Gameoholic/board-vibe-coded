import assert from "node:assert/strict";
import { test } from "node:test";
import { bountyWeight, canBounty, pickWeighted, rerollSource } from "../dist/bounty.js";

const task = (over = {}) => ({ id: "t", sectionId: "s", type: "once", text: "x", done: false, points: 1000, createdAt: "2026-09-01T09:00:00.000Z", updatedAt: "", completedAt: null, ...over });
const freezer = { freezerFor: "tasks" };

test("only an open one-time task on ice can be the Bounty — never a piece, never one in its own tab", () => {
  assert.equal(canBounty(task(), freezer), true);
  assert.equal(canBounty(task(), {}), false);
  assert.equal(canBounty(task({ done: true }), freezer), false);
  assert.equal(canBounty(task({ parentId: "p" }), freezer), false);
  assert.equal(canBounty(task({ type: "checkbox" }), freezer), false);
});

test("the roll leans a little toward the longest on ice: a week there is one more chance", () => {
  const onIce = task({ waitMs: 0, waitingSince: "2026-09-01T09:00:00.000Z" });
  assert.equal(bountyWeight(onIce, "2026-09-07T20:00:00.000Z"), 1);
  assert.equal(bountyWeight(onIce, "2026-09-08T09:00:00.000Z"), 2);
  assert.equal(bountyWeight(onIce, "2026-09-29T09:00:00.000Z"), 5);
  const weights = { old: 9, fresh: 1 };
  const pick = (r) => pickWeighted(["old", "fresh"], (c) => weights[c], r);
  assert.deepEqual([pick(0), pick(0.89), pick(0.9), pick(0.999)], ["old", "old", "fresh", "fresh"]);
  assert.equal(pickWeighted([], () => 1, 0.5), null);
});

test("a reroll spends the week's free ones first, then bought ones", () => {
  assert.equal(rerollSource(1, 3), "week");
  assert.equal(rerollSource(0, 3), "bank");
  assert.equal(rerollSource(0, 0), null);
});
