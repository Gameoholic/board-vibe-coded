import assert from "node:assert/strict";
import { test } from "node:test";
import {
  daysLeftInWeek,
  freezeRefusal,
  freezerOf,
  freezesAtWeekEnd,
  frostFill,
  frostShare,
  isFullFrost,
  waitAcross,
  waitDays,
  willFreezeAtWeekEnd,
} from "../dist/freezer.js";
import { DEFAULT_SETTINGS } from "../dist/period.js";
import { releasedFrom, statusChange } from "../dist/taskStatus.js";

const at = (date, time = "09:00") => `${date}T${time}:00.000Z`;
const task = (over = {}) => ({ id: "t", sectionId: "s", type: "once", text: "x", done: false, points: 1000, createdAt: at("2026-09-27"), updatedAt: "", completedAt: null, waitMs: 0, waitingSince: at("2026-09-27"), ...over });
const settings = DEFAULT_SETTINGS; // freeze after 7 days, 20% a week, capped at 200%

test("the wait: whole days, paused In progress (the stretch so far kept), started again after", () => {
  assert.equal(waitDays(task(), at("2026-09-30", "08:59")), 2);
  assert.equal(waitDays(task(), at("2026-09-30")), 3);
  const paused = { ...task(), ...waitAcross(task(), "backlog", "in-progress", at("2026-09-30")) };
  assert.equal(paused.waitingSince, undefined);
  assert.equal(waitDays(paused, at("2026-10-20")), 3);
  const resumed = { ...paused, ...waitAcross(paused, "in-progress", "backlog", at("2026-10-01")) };
  assert.equal(waitDays(resumed, at("2026-10-03")), 5);
  assert.deepEqual(waitAcross(resumed, "backlog", "blocked", at("2026-10-03")), { waitMs: resumed.waitMs, waitingSince: resumed.waitingSince });
});

test("a status change carries the wait, and a thaw bonus only In progress keeps — for good", () => {
  const thawed = task({ status: "in-progress", waitingSince: undefined, thawBonus: 500 });
  const parked = statusChange(thawed, "backlog", {}, at("2026-09-28"));
  assert.equal(parked.thawBonus, undefined);
  assert.equal(parked.waitingSince, at("2026-09-28"));
  assert.equal(statusChange({ ...thawed, ...parked }, "in-progress", {}, at("2026-09-29")).thawBonus, undefined);
  // Released from a block back to In progress, its wait pauses.
  const blocked = task({ status: "blocked", blocker: { taskId: "b", resume: "in-progress" } });
  assert.equal(releasedFrom(blocked, "b", at("2026-09-30")).waitingSince, undefined);
});

test("frost: a share of its own points per day on ice, at the weekly rate, up to the cap", () => {
  assert.equal(frostShare(task(), settings), 0);
  assert.equal(frostShare(task({ frostDays: 7 }), settings), 0.2);
  assert.equal(frostShare(task({ frostDays: 1 }), settings), 20 / 7 / 100);
  assert.equal(frostShare(task({ frostDays: 500 }), settings), 2);
  assert.equal(isFullFrost(task({ frostDays: 69 }), settings), false);
  assert.equal(isFullFrost(task({ frostDays: 70 }), settings), true);
  assert.equal(frostFill(task({ frostDays: 35 }), settings), 0.5);
  assert.equal(frostFill(task({ frostDays: 700 }), settings), 1);
});

test("who may freeze: not a piece, the Bounty, a blocked or finished task; the Freezer is found by its tab", () => {
  assert.equal(freezeRefusal(task()), null);
  assert.match(freezeRefusal(task({ parentId: "p" })), /piece/);
  assert.match(freezeRefusal(task({ bounty: { multiplier: 2, periodKey: "w" } })), /Bounty/);
  assert.match(freezeRefusal(task({ status: "blocked" })), /Blocked/);
  assert.match(freezeRefusal(task({ done: true })), /done/);
  const sections = [{ id: "tasks" }, { id: "ice", freezerFor: "tasks" }];
  assert.equal(freezerOf(sections, "tasks").id, "ice");
  assert.equal(freezerOf(sections, "ice"), undefined);
});

test("a week close freezes a Backlog task that waited more than the limit — said beforehand", () => {
  assert.equal(freezesAtWeekEnd(task(), at("2026-10-04"), settings), false, "exactly 7 days isn't more");
  assert.equal(freezesAtWeekEnd(task(), at("2026-10-05"), settings), true);
  for (const over of [{ status: "in-progress" }, { status: "blocked" }, { bounty: { multiplier: 2, periodKey: "w" } }, { done: true }, { parentId: "p" }]) {
    assert.equal(freezesAtWeekEnd(task(over), at("2026-10-05"), settings), false);
  }
  // Friday the 2nd: Friday and Saturday are left, so by the close it'll have waited 7 days — not more.
  assert.equal(daysLeftInWeek(at("2026-10-02"), settings), 2);
  assert.equal(willFreezeAtWeekEnd(task(), at("2026-10-02"), settings), false);
  assert.equal(willFreezeAtWeekEnd(task({ waitingSince: at("2026-09-26") }), at("2026-10-02"), settings), true);
});
