import assert from "node:assert/strict";
import { test } from "node:test";
import { setDebugNow } from "../dist/clock.js";
import { openEventStore } from "../dist/db.js";
import { BoardStore } from "../dist/projection.js";

// The weekly Bounty through the real projection: a week close rolls one open, avoided task (weighted by
// age, the result recorded), a completion while it's on is paid at its multiplier and keeps that after it
// ends, a broken-down task's Bounty pays its pieces, and a rebuild replays the roll — it never rolls again.
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
  const daily = store.seedSection("Daily", "#888888", [{ type: "checkbox" }], "tasks", "day");
  const add = (text, points = 1000, sectionId = tasksTab.id, type = "once") => store.createTask({ sectionId, type, text, points });
  const bountyOn = (s) => s.listTasks().filter((t) => t.bounty).map((t) => t.text);
  const total = (s) => s.listTasks().reduce((sum, t) => sum + (t.done ? Math.round((t.points ?? 0) * (t.boost ?? 1)) : 0), 0);
  // Settings → Bounty, changed one knob at a time (the client always sends the whole object).
  const bountySettings = (s, change) => s.patchSettings({ bounty: { ...s.getSettings().bounty, ...change } });
  // A rebuild must never roll: give it randomness that fails the test if it's asked.
  const rebuild = () =>
    new BoardStore(events, () => {
      throw new Error("a rebuild rolled the Bounty");
    });
  return { events, store, tasksTab, daily, add, bountyOn, total, rebuild, bountySettings };
}

test("a week close rolls one open, avoided task — weighted by age — and a first start doesn't", (t) => {
  t.after(() => setDebugNow(null));
  const { store, daily, add, bountyOn, rebuild } = board([0.5, 0.95]);
  const old = add("Call the tax office");
  store.rollPeriod("week"); // first start: nothing to close, no Bounty
  assert.deepEqual(bountyOn(store), []);

  setDebugNow(at("2026-10-03"));
  const fresh = add("Return the parcel"); // 6 days younger
  const blocked = add("Renew registration");
  store.setStatus(blocked.id, "blocked", { note: "the letter" });
  const finished = add("Already done");
  store.setDone(finished.id, true);
  const parent = add("Build the shelf", 600);
  store.breakDown(parent.id, ["Measure", "Mount"]);
  add("Reset board", 200, daily.id, "checkbox"); // a tab that resets is never in the roll

  setDebugNow(at(WEEK2));
  const { recap } = store.rollPeriod("week");
  // Candidates: the old task (weight 8), the fresh one (2), the broken-down task (2) — r=0.5 lands on the old.
  assert.deepEqual(bountyOn(store), ["Call the tax office"]);
  assert.equal(recap.bounties.length, 1);
  assert.equal(recap.bounties[0].taskId, old.id);
  assert.equal(recap.bounties[0].multiplier, 2);
  assert.equal(recap.bounties[0].rerollsLeft, 1);
  assert.deepEqual(new Set(recap.bounties[0].reel), new Set(["Return the parcel", "Build the shelf"]));
  assert.equal(store.getTask(old.id).bounty.periodKey, WEEK2);
  assert.deepEqual(bountyOn(rebuild()), bountyOn(store));

  // The next close ends it and rolls again (r=0.95 now lands on the last candidate).
  setDebugNow(at(WEEK3));
  store.rollPeriod("week");
  assert.deepEqual(bountyOn(store), ["Build the shelf"]);
  void fresh;
});

test("a completion while it's on is paid at the multiplier, and keeps it after the Bounty ends", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, add, bountyOn, total, rebuild } = board([0]);
  const task = add("Call the tax office", 1250);
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");
  assert.deepEqual(bountyOn(store), ["Call the tax office"]);

  store.setDone(task.id, true);
  assert.equal(store.getTask(task.id).boost, 2);
  const award = events.readAll().filter((e) => e.event.type === "TaskCompleted").at(-1).event;
  assert.deepEqual([award.pointsAwarded, award.boost], [2500, 2]);
  assert.equal(total(store), 2500);

  setDebugNow(at(WEEK3));
  store.rollPeriod("week"); // the Bounty is over — the win isn't re-priced
  assert.deepEqual(bountyOn(store), []);
  assert.equal(total(store), 2500);
  assert.equal(total(rebuild()), 2500);

  store.setDone(task.id, false); // unticked, and ticked again after it ended: ×1
  assert.equal(store.getTask(task.id).boost, undefined);
  store.setDone(task.id, true);
  assert.equal(total(store), 1250);
});

test("a broken-down task's Bounty pays its remaining pieces; rounding is half-up, once", (t) => {
  t.after(() => setDebugNow(null));
  const { store, add, total, bountySettings } = board([0]);
  const shelf = add("Build the shelf", 1000);
  const [, a, b, c] = store.breakDown(shelf.id, ["A", "B", "C"]); // 340 / 330 / 330
  store.setDone(a.id, true); // before any Bounty: ×1
  bountySettings(store, { multiplier: 1.5 });
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");
  assert.equal(store.getTask(shelf.id).bounty.multiplier, 1.5);

  store.setDone(b.id, true);
  store.setDone(c.id, true); // finishes the task — its own (0) points at ×1.5 too
  assert.deepEqual([store.getTask(b.id).boost, store.getTask(c.id).boost, store.getTask(shelf.id).boost], [1.5, 1.5, 1.5]);
  assert.equal(total(store), 340 + 495 + 495);
});

test("one reroll a week, onto another task, and never after the Bounty is won", (t) => {
  t.after(() => setDebugNow(null));
  const { store, add, bountyOn, rebuild } = board([0, 0, 0]);
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
  const { store, add, bountyOn, rebuild, bountySettings } = board([0, 0, 0, 0]);
  const first = add("Call the tax office");
  add("Return the parcel");
  add("Sort the cables");
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");

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
  const { events, store, add, bountyOn, bountySettings } = board([0, 0]);
  const task = add("Call the tax office", 1000);
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");
  assert.deepEqual(bountyOn(store), ["Call the tax office"]);

  bountySettings(store, { enabled: false });
  assert.deepEqual(bountyOn(store), []);
  store.setDone(task.id, true);
  assert.equal(store.getTask(task.id).boost, undefined);
  store.setDone(task.id, false);

  setDebugNow(at(WEEK3));
  const before = events.readAll().length;
  const { recap } = store.rollPeriod("week");
  assert.deepEqual(recap.bounties, []);
  assert.ok(!events.readAll().slice(before).some((e) => e.event.type.startsWith("Bounty")));
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
  const { store, add, bountyOn, bountySettings, rebuild } = board();
  bountySettings(store, { rerolls: 3 });
  const blocked = add("Renew registration");
  store.setStatus(blocked.id, "blocked", { note: "the letter" });
  const a = add("Call the tax office");
  const b = add("Return the parcel");
  add("Buy stickers");
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");
  assert.deepEqual(bountyOn(store), ["Call the tax office"]); // Blocked is left out
  assert.equal(store.rerollBounty(a.id).text, "Return the parcel");
  assert.equal(store.rerollBounty(b.id).text, "Buy stickers"); // not back to the tax office
  // Only the week's earlier ones left: then one of those, never the one being replaced.
  assert.equal(store.rerollBounty(store.bountyStatus().bounties[0].taskId).text, "Call the tax office");
  assert.deepEqual(bountyOn(rebuild()), bountyOn(store));
});
