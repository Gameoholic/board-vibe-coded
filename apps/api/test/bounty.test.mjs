import assert from "node:assert/strict";
import { test } from "node:test";
import { taskPointValue } from "@board/contracts";
import { setDebugNow } from "../dist/clock.js";
import { openEventStore } from "../dist/db.js";
import { BoardStore } from "../dist/projection.js";

// The weekly Bounty through the real projection: a week close rolls a task from the Freezer (leaning toward
// the longest on ice, the result recorded), it stays frozen until it's thawed, a completion while it's on is
// paid at its multiplier and keeps that after it ends, a broken-down task's Bounty pays its pieces, and a
// rebuild replays the roll — it never rolls again. Frost is off here (frost.test.mjs covers it), so nothing
// but the Bounty moves a task's points.
const at = (date) => `${date}T09:00:00.000Z`;
// 2026-09-27 is a Sunday — the default week start — so each +7 days is the next week.
const WEEK1 = "2026-09-27";
const WEEK2 = "2026-10-04";
const WEEK3 = "2026-10-11";

function board(rolls = []) {
  const queue = [...rolls];
  const random = () => (queue.length ? queue.shift() : 0);
  setDebugNow(at(WEEK1));
  const events = openEventStore(":memory:");
  const store = new BoardStore(events, random);
  const tasksTab = store.seedSection("Tasks", "#888888", [{ type: "once" }], "tasks");
  store.seedSection("Freezer", "#888888", [{ type: "once" }], "tasks", undefined, tasksTab.id);
  const daily = store.seedSection("Daily", "#888888", [{ type: "checkbox" }], "tasks", "day");
  store.patchSettings({ freezer: { ...store.getSettings().freezer, frostPerWeek: 0 } });
  // A task in Tasks, and one on ice — where Bounties are rolled from.
  const addHot = (text, points = 1000, sectionId = tasksTab.id, type = "once") => store.createTask({ sectionId, type, text, points });
  const add = (text, points = 1000) => store.setFrozen(addHot(text, points).id, true);
  const thaw = (task) => store.setFrozen(task.id, false);
  const bountyOn = (s) => s.listTasks().filter((t) => t.bounty).map((t) => t.text);
  const total = (s) => s.listTasks().reduce((sum, t) => sum + taskPointValue(t), 0);
  // Settings → Bounty, changed one knob at a time (the client always sends the whole object).
  const bountySettings = (s, change) => s.patchSettings({ bounty: { ...s.getSettings().bounty, ...change } });
  // A rebuild must never roll: give it randomness that fails the test if it's asked.
  const rebuild = () =>
    new BoardStore(events, () => {
      throw new Error("a rebuild rolled the Bounty");
    });
  return { events, store, tasksTab, daily, add, addHot, thaw, bountyOn, total, rebuild, bountySettings };
}

const bountyFactor = (value) => [{ id: "bounty", kind: "factor", value }];

test("a week close rolls a task from the Freezer — leaning toward the longest on ice — and a first start doesn't", (t) => {
  t.after(() => setDebugNow(null));
  const { store, daily, add, addHot, bountyOn, rebuild } = board([0.4, 0.95]);
  const old = add("Call the tax office");
  store.rollPeriod("week"); // first start: nothing to close, no Bounty
  assert.deepEqual(bountyOn(store), []);

  setDebugNow(at("2026-10-03"));
  add("Return the parcel"); // six days later on ice
  const blocked = addHot("Renew registration");
  store.setStatus(blocked.id, "blocked", { note: "the letter" });
  addHot("Still in Tasks"); // not on ice: never in the roll
  const shelf = addHot("Build the shelf", 600);
  store.breakDown(shelf.id, ["Measure", "Mount"]);
  store.setFrozen(shelf.id, true); // its pieces go with it, and share its roll
  addHot("Reset board", 200, daily.id, "checkbox");

  setDebugNow(at(WEEK2));
  const { recap } = store.rollPeriod("week");
  // On ice: the tax office a week (weight 2), the parcel and the shelf a day (1 each) — r=0.4 lands on it.
  assert.deepEqual(bountyOn(store), ["Call the tax office"]);
  assert.equal(recap.bounties.length, 1);
  assert.equal(recap.bounties[0].taskId, old.id);
  assert.equal(recap.bounties[0].multiplier, 2);
  assert.equal(recap.bounties[0].rerollsLeft, 1);
  assert.deepEqual(new Set(recap.bounties[0].reel), new Set(["Return the parcel", "Build the shelf"]));
  assert.equal(store.getTask(old.id).bounty.periodKey, WEEK2);
  assert.equal(store.getTask(old.id).sectionId, store.getTask(shelf.id).sectionId, "a Bounty stays frozen");
  assert.deepEqual(bountyOn(rebuild()), bountyOn(store));

  // The next close ends it and rolls again: 3 / 2 / 2 by weeks on ice — r=0.95 lands on the last.
  setDebugNow(at(WEEK3));
  store.rollPeriod("week");
  assert.deepEqual(bountyOn(store), ["Build the shelf"]);
});

test("a Bounty can't be done on ice; thawed, it's paid at the multiplier and keeps it after it ends", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, add, thaw, bountyOn, total, rebuild } = board([0]);
  const task = add("Call the tax office", 1250);
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");
  assert.deepEqual(bountyOn(store), ["Call the tax office"]);
  assert.throws(() => store.setDone(task.id, true), /thawed first/);

  thaw(task);
  assert.throws(() => store.setFrozen(task.id, true), /A Bounty can't be frozen/);
  store.setDone(task.id, true);
  assert.deepEqual(store.getTask(task.id).paidWith, bountyFactor(2));
  const award = events.readAll().filter((e) => e.event.type === "TaskCompleted").at(-1).event;
  assert.deepEqual([award.pointsAwarded, award.modifiers], [2500, bountyFactor(2)]);
  assert.equal(total(store), 2500);

  setDebugNow(at(WEEK3));
  store.rollPeriod("week"); // the Bounty is over — the win isn't re-priced
  assert.deepEqual(bountyOn(store), []);
  assert.equal(total(store), 2500);
  assert.equal(total(rebuild()), 2500);

  store.setDone(task.id, false); // unticked, and ticked again after it ended: ×1
  assert.equal(store.getTask(task.id).paidWith, undefined);
  store.setDone(task.id, true);
  assert.equal(total(store), 1250);
});

test("an older completion that recorded only its Bounty's factor still pays it", (t) => {
  t.after(() => setDebugNow(null));
  const { events, addHot, total } = board();
  const task = addHot("Call the tax office", 1250);
  events.append({ type: "TaskCompleted", taskId: task.id, pointsAwarded: 2500, boost: 2 }, at(WEEK1));
  const s = new BoardStore(events);
  assert.deepEqual(s.getTask(task.id).paidWith, bountyFactor(2));
  assert.equal(total(s), 2500);
});

test("a broken-down task's Bounty pays its remaining pieces; rounding is half-up, once", (t) => {
  t.after(() => setDebugNow(null));
  const { store, addHot, thaw, total, bountySettings } = board([0]);
  const shelf = addHot("Build the shelf", 1000);
  const [, a, b, c] = store.breakDown(shelf.id, ["A", "B", "C"]); // 340 / 330 / 330
  store.setDone(a.id, true); // before any Bounty: ×1
  store.setFrozen(shelf.id, true);
  bountySettings(store, { multiplier: 1.5 });
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");
  assert.equal(store.getTask(shelf.id).bounty.multiplier, 1.5);

  thaw(shelf);
  store.setDone(b.id, true);
  store.setDone(c.id, true); // finishes the task — its own (0) points at ×1.5 too
  for (const task of [b, c, shelf]) assert.deepEqual(store.getTask(task.id).paidWith, bountyFactor(1.5));
  assert.equal(total(store), 340 + 495 + 495);
});

test("one reroll a week, onto another task, and never after the Bounty is won", (t) => {
  t.after(() => setDebugNow(null));
  const { store, add, thaw, bountyOn, rebuild } = board([0, 0, 0]);
  const first = add("Call the tax office");
  add("Return the parcel");
  store.rollPeriod("week");
  assert.throws(() => store.rerollBounty(first.id), /isn't a Bounty this week/);
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");
  assert.deepEqual(bountyOn(store), ["Call the tax office"]);

  const view = store.rerollBounty(first.id);
  assert.deepEqual(bountyOn(store), ["Return the parcel"]); // never the same task again
  assert.equal(view.rerollsLeft, 0);
  assert.throws(() => store.rerollBounty(view.taskId), /no rerolls left/);
  assert.deepEqual(bountyOn(rebuild()), ["Return the parcel"]);

  // Next week: a fresh reroll, but not once it's won.
  setDebugNow(at(WEEK3));
  store.rollPeriod("week");
  const won = store.listTasks().find((x) => x.bounty);
  thaw(won);
  store.setDone(won.id, true);
  assert.throws(() => store.rerollBounty(won.id), /already won/);
});

test("as many Bounties as may be on at once, each its own task; a reroll swaps just the one", (t) => {
  t.after(() => setDebugNow(null));
  const { store, add, bountyOn, rebuild, bountySettings } = board([0, 0, 0]);
  add("Call the tax office");
  add("Return the parcel");
  add("Sort the cables");
  bountySettings(store, { max: 2 });
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  const { recap } = store.rollPeriod("week");
  assert.deepEqual(bountyOn(store), ["Call the tax office", "Return the parcel"]);
  assert.deepEqual(recap.bounties.map((b) => b.text), ["Call the tax office", "Return the parcel"]);

  const swapped = store.rerollBounty(recap.bounties[1].taskId);
  assert.equal(swapped.text, "Sort the cables"); // never one that's already a Bounty
  assert.deepEqual(bountyOn(store), ["Call the tax office", "Sort the cables"]);
  assert.deepEqual(bountyOn(rebuild()), bountyOn(store));
});

test("rerolls: the week's free ones first (frozen as it starts), then bought ones, which carry over", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, add, rebuild, bountySettings } = board([0, 0, 0, 0, 0, 0]);
  for (const text of ["A", "B", "C", "D", "E"]) add(text);
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");
  bountySettings(store, { rerolls: 5 }); // a change mid-week leaves this week's grant alone
  assert.equal(store.bountyStatus().rerollsLeft, 1);
  const granted = events.readAll().filter((e) => e.event.type === "BountyRerollsGranted").map((e) => e.event);
  assert.deepEqual(granted, [{ type: "BountyRerollsGranted", count: 1, source: "week", periodKey: WEEK2 }]);

  // Two bought (the shop will grant them this way): one free + two banked.
  events.append({ type: "BountyRerollsGranted", count: 2, source: "purchase", periodKey: WEEK2 }, at(WEEK2));
  let s = rebuild();
  assert.equal(s.bountyStatus().rerollsLeft, 3);
  const spend = (from) => {
    const bounty = s.bountyStatus().bounties[0];
    s.rerollBounty(bounty.taskId);
    return events.readAll().at(-1).event.rerollFrom === from;
  };
  s = new BoardStore(events, () => 0);
  assert.ok(spend("week"));
  assert.ok(spend("bank"));
  assert.equal(s.bountyStatus().rerollsLeft, 1);

  // Next week: a fresh free allowance (now 5), and the bought one left over.
  setDebugNow(at(WEEK3));
  s.rollPeriod("week");
  assert.equal(s.bountyStatus().rerollsLeft, 6);
});

test("winning one rolls another when Settings say so — and unticking and reticking can't farm them", (t) => {
  t.after(() => setDebugNow(null));
  const { store, add, thaw, bountyOn, rebuild, bountySettings } = board([0, 0, 0, 0]);
  const first = add("Call the tax office");
  add("Return the parcel");
  add("Sort the cables");
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");

  thaw(first);
  store.setDone(first.id, true); // off by default: winning ends it
  assert.deepEqual(bountyOn(store), ["Call the tax office"]);
  assert.equal(store.bountyStatus().bounties.length, 0);
  store.setDone(first.id, false);

  bountySettings(store, { rollOnWin: true });
  store.setDone(first.id, true);
  assert.deepEqual(bountyOn(store).sort(), ["Call the tax office", "Return the parcel"]);
  assert.deepEqual(store.bountyStatus().bounties.map((b) => b.text), ["Return the parcel"]);
  store.setDone(first.id, false); // two to win again — one more than may be on at once
  store.setDone(first.id, true); // winning it again doesn't roll a third
  assert.deepEqual(bountyOn(store).sort(), ["Call the tax office", "Return the parcel"]);
  assert.deepEqual(bountyOn(rebuild()).sort(), bountyOn(store).sort());
});

test("with Bounties off, a week close rolls none and any on stop paying", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, add, thaw, bountyOn, bountySettings } = board([0, 0]);
  const task = add("Call the tax office", 1000);
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");
  assert.deepEqual(bountyOn(store), ["Call the tax office"]);

  bountySettings(store, { enabled: false });
  assert.deepEqual(bountyOn(store), []);
  thaw(task);
  store.setDone(task.id, true);
  assert.equal(store.getTask(task.id).paidWith, undefined);
  store.setDone(task.id, false);

  setDebugNow(at(WEEK3));
  const before = events.readAll().length;
  const { recap } = store.rollPeriod("week");
  assert.deepEqual(recap.bounties, []);
  assert.equal(recap.bountyEmpty, false); // off isn't empty
  assert.ok(!events.readAll().slice(before).some((e) => e.event.type.startsWith("Bounty")));
});

test("with nothing on ice there's no Bounty, and the recap says so", (t) => {
  t.after(() => setDebugNow(null));
  const { store, addHot } = board();
  addHot("Call the tax office"); // in Tasks, never in the roll
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  const { recap } = store.rollPeriod("week");
  assert.deepEqual(recap.bounties, []);
  assert.equal(recap.bountyEmpty, true);
});

test("a week reopened by the debug clock starts its Bounties afresh — they never stack", (t) => {
  t.after(() => setDebugNow(null));
  const { store, add, bountyOn, rebuild } = board([0, 0.99, 0, 0.99]);
  add("Buy stickers");
  add("Clean the PC");
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week"); // ahead: WEEK2's Bounty
  setDebugNow(at(WEEK1));
  store.rollPeriod("week"); // back: WEEK1 reopened, with a Bounty of its own
  setDebugNow(at(WEEK2));
  store.rollPeriod("week"); // ahead again: WEEK2 reopened
  assert.equal(store.bountyStatus().bounties.length, 1);
  assert.equal(bountyOn(store).length, 1);
  assert.equal(store.bountyStatus().rerollsLeft, 1); // its free rerolls start afresh too
  assert.deepEqual(bountyOn(rebuild()), bountyOn(store));
});

test("a reroll never lands on the task it's replacing, nor on one the week already had while another is left", (t) => {
  t.after(() => setDebugNow(null));
  // Every roll takes the first candidate (r = 0) — the one that was the Bounty, if it were allowed.
  const { store, add, addHot, bountyOn, bountySettings, rebuild } = board();
  bountySettings(store, { rerolls: 3 });
  const blocked = addHot("Renew registration"); // Blocked can't freeze, so it's never rolled
  store.setStatus(blocked.id, "blocked", { note: "the letter" });
  assert.throws(() => store.setFrozen(blocked.id, true), /Blocked tasks can't be frozen/);
  const a = add("Call the tax office");
  const b = add("Return the parcel");
  add("Buy stickers");
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");
  assert.deepEqual(bountyOn(store), ["Call the tax office"]);
  assert.equal(store.rerollBounty(a.id).text, "Return the parcel");
  assert.equal(store.rerollBounty(b.id).text, "Buy stickers"); // not back to the tax office
  // Only the week's earlier ones left: then one of those, never the one being replaced.
  assert.equal(store.rerollBounty(store.bountyStatus().bounties[0].taskId).text, "Call the tax office");
  assert.deepEqual(bountyOn(rebuild()), bountyOn(store));
});
