import assert from "node:assert/strict";
import { test } from "node:test";
import { taskPointValue } from "@board/contracts";
import { setDebugNow } from "../dist/clock.js";
import { openEventStore } from "../dist/db.js";
import { BoardStore } from "../dist/projection.js";

// The weekly Bounty through the real projection: a week close deals a reel of the Freezer's tasks (more
// spots the longer on ice, the deal recorded), the spot it's stopped on is the Bounty, it stays frozen until
// it's thawed, a completion while it's on is paid at its multiplier and keeps that after it ends, a
// broken-down task's Bounty pays its pieces, and a rebuild replays the deal — it never deals again. Frost is
// off here (frost.test.mjs covers it), so nothing but the Bounty moves a task's points.
const at = (date) => `${date}T09:00:00.000Z`;
// 2026-09-27 is a Sunday — the default week start — so each +7 days is the next week.
const WEEK1 = "2026-09-27";
const WEEK2 = "2026-10-04";
const WEEK3 = "2026-10-11";

function board() {
  setDebugNow(at(WEEK1));
  const events = openEventStore(":memory:");
  const store = new BoardStore(events, () => 0);
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
  // A rebuild must never deal: give it randomness that fails the test if it's asked.
  const rebuild = () =>
    new BoardStore(events, () => {
      throw new Error("a rebuild dealt the Bounty's reel");
    });
  return { events, store, tasksTab, daily, add, addHot, thaw, bountyOn, total, rebuild, bountySettings };
}

const bountyFactor = (value) => [{ id: "bounty", kind: "factor", value }];
// The open week's reel: the tasks on it (each once, sorted), how many spots one has, and a stop on a spot of it.
const reelOf = (s) => s.bountyStatus().reel;
const onReel = (s) => [...new Set(reelOf(s).spots)].sort();
const spotsOf = (s, text) => reelOf(s).spots.filter((name) => name === text).length;
const stopOn = (s, text) => s.rollBounty(reelOf(s).spots.indexOf(text));

test("a week close deals a reel from the Freezer — more spots the longer on ice — and the stop decides; a first start deals none", (t) => {
  t.after(() => setDebugNow(null));
  const { store, daily, add, addHot, bountyOn, rebuild } = board();
  const old = add("Call the tax office");
  store.rollPeriod("week"); // first start: nothing to close, no reel
  assert.equal(reelOf(store), null);

  setDebugNow(at("2026-10-03"));
  const parcel = add("Return the parcel"); // six days later on ice
  const blocked = addHot("Renew registration");
  store.setStatus(blocked.id, "blocked", { note: "the letter" });
  addHot("Still in Tasks"); // not on ice: never on the reel
  const shelf = addHot("Build the shelf", 600);
  store.breakDown(shelf.id, ["Measure", "Mount"]);
  store.setFrozen(shelf.id, true); // its pieces go with it, and share its spots
  addHot("Reset board", 200, daily.id, "checkbox");

  setDebugNow(at(WEEK2));
  const { recap } = store.rollPeriod("week");
  // Nothing's a Bounty until the reel is stopped.
  assert.deepEqual(bountyOn(store), []);
  assert.deepEqual(recap.bounty.bounties, []);
  // On ice: the tax office a week (two spots), the parcel and the shelf a day (one each).
  assert.deepEqual([...recap.bounty.reel.spots].sort(), ["Build the shelf", "Call the tax office", "Call the tax office", "Return the parcel"]);
  assert.deepEqual([recap.bounty.reel.rolls, recap.bounty.reel.multiplier, recap.bounty.rerollsLeft], [1, 2, 1]);
  assert.deepEqual(rebuild().bountyStatus(), store.bountyStatus());
  assert.throws(() => store.rollBounty(4), /isn't on the reel/);

  const stopped = stopOn(store, "Return the parcel");
  assert.deepEqual([stopped.rolled.taskId, stopped.rolled.multiplier, stopped.reel], [parcel.id, 2, null]);
  assert.deepEqual(new Set(stopped.rolled.reel), new Set(["Call the tax office", "Build the shelf"]));
  assert.deepEqual(bountyOn(store), ["Return the parcel"]);
  assert.equal(store.getTask(parcel.id).bounty.periodKey, WEEK2);
  assert.equal(store.getTask(parcel.id).sectionId, store.getTask(old.id).sectionId, "a Bounty stays frozen");
  assert.throws(() => store.rollBounty(0), /no Bounty to roll/);
  assert.deepEqual(bountyOn(rebuild()), bountyOn(store));

  // The next close ends it and deals again: 3 / 2 / 2 spots by weeks on ice.
  setDebugNow(at(WEEK3));
  store.rollPeriod("week");
  assert.deepEqual(bountyOn(store), []);
  assert.deepEqual(["Call the tax office", "Return the parcel", "Build the shelf"].map((text) => spotsOf(store, text)), [3, 2, 2]);
});

test("a Bounty can't be done on ice; thawed, it's paid at the multiplier and keeps it after it ends", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, add, thaw, bountyOn, total, rebuild } = board();
  const task = add("Call the tax office", 1250);
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");
  stopOn(store, "Call the tax office");
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

test("a Bounty the server rolled itself, and its reroll, from before reels still fold", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, add, bountyOn, rebuild } = board();
  const a = add("Call the tax office");
  const b = add("Return the parcel");
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.patchSettings({ bounty: { ...store.getSettings().bounty, enabled: false } }); // so the close deals no reel
  store.rollPeriod("week");
  store.patchSettings({ bounty: { ...store.getSettings().bounty, enabled: true } });
  events.append({ type: "BountyRerollsGranted", count: 1, source: "week", periodKey: WEEK2 }, at(WEEK2));
  events.append({ type: "BountyRolled", taskId: a.id, periodKey: WEEK2, multiplier: 2 }, at(WEEK2));
  assert.deepEqual(bountyOn(rebuild()), ["Call the tax office"]);
  events.append({ type: "BountyRolled", taskId: b.id, periodKey: WEEK2, multiplier: 2, reroll: true, replaces: a.id, rerollFrom: "week" }, at(WEEK2));
  const s = rebuild();
  assert.deepEqual(bountyOn(s), ["Return the parcel"]);
  assert.deepEqual([s.bountyStatus().rerollsLeft, s.bountyStatus().reel], [0, null]);
});

test("a broken-down task's Bounty pays its remaining pieces; rounding is half-up, once", (t) => {
  t.after(() => setDebugNow(null));
  const { store, addHot, thaw, total, bountySettings } = board();
  const shelf = addHot("Build the shelf", 1000);
  const [, a, b, c] = store.breakDown(shelf.id, ["A", "B", "C"]); // 340 / 330 / 330
  store.setDone(a.id, true); // before any Bounty: ×1
  store.setFrozen(shelf.id, true);
  bountySettings(store, { multiplier: 1.5 });
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");
  stopOn(store, "Build the shelf");
  assert.equal(store.getTask(shelf.id).bounty.multiplier, 1.5);

  thaw(shelf);
  store.setDone(b.id, true);
  store.setDone(c.id, true); // finishes the task — its own (0) points at ×1.5 too
  for (const task of [b, c, shelf]) assert.deepEqual(store.getTask(task.id).paidWith, bountyFactor(1.5));
  assert.equal(total(store), 340 + 495 + 495);
});

test("one reroll a week: the Bounty stops being one and a new reel is dealt without it — never after it's won", (t) => {
  t.after(() => setDebugNow(null));
  const { store, add, thaw, bountyOn, rebuild } = board();
  const first = add("Call the tax office");
  add("Return the parcel");
  store.rollPeriod("week");
  assert.throws(() => store.rerollBounty(first.id), /isn't a Bounty this week/);
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");
  assert.throws(() => store.rerollBounty(first.id), /isn't a Bounty this week/); // on the reel isn't rolled
  stopOn(store, "Call the tax office");

  const status = store.rerollBounty(first.id);
  assert.deepEqual(bountyOn(store), []);
  assert.deepEqual([status.bounties.length, status.rerollsLeft, status.reel.rolls], [0, 0, 1]);
  assert.deepEqual(onReel(store), ["Return the parcel"]); // never the same task again
  assert.deepEqual(rebuild().bountyStatus(), store.bountyStatus());
  const next = stopOn(store, "Return the parcel");
  assert.deepEqual(bountyOn(store), ["Return the parcel"]);
  assert.throws(() => store.rerollBounty(next.rolled.taskId), /no rerolls left/);
  assert.deepEqual(bountyOn(rebuild()), ["Return the parcel"]);

  // Next week: a fresh reroll, but not once it's won.
  setDebugNow(at(WEEK3));
  store.rollPeriod("week");
  const won = store.getTask(stopOn(store, "Call the tax office").rolled.taskId);
  thaw(won);
  store.setDone(won.id, true);
  assert.throws(() => store.rerollBounty(won.id), /already won/);
});

test("as many stops as Bounties may be on at once, each landing on its own task; a reroll gives up just the one", (t) => {
  t.after(() => setDebugNow(null));
  const { store, add, bountyOn, rebuild, bountySettings } = board();
  add("Call the tax office");
  add("Return the parcel");
  add("Sort the cables");
  bountySettings(store, { max: 2 });
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  const { recap } = store.rollPeriod("week");
  assert.equal(recap.bounty.reel.rolls, 2);

  // A stop takes its task off the reel; a retried one is answered with what its first try rolled.
  const spot = reelOf(store).spots.indexOf("Call the tax office");
  const one = store.rollBounty(spot, "stop-1");
  assert.deepEqual([one.reel.rolls, one.reel.spots.includes("Call the tax office")], [1, false]);
  assert.equal(store.rollBounty(spot, "stop-1").rolled.taskId, one.rolled.taskId);
  assert.deepEqual(bountyOn(store), ["Call the tax office"]);
  assert.throws(() => store.rerollBounty(one.rolled.taskId), /aren't all rolled yet/);
  const two = stopOn(store, "Return the parcel");
  assert.equal(two.reel, null);
  assert.deepEqual(two.bounties.map((b) => b.text), ["Call the tax office", "Return the parcel"]);
  assert.deepEqual(bountyOn(store), ["Call the tax office", "Return the parcel"]);

  store.rerollBounty(two.rolled.taskId);
  assert.deepEqual(onReel(store), ["Sort the cables"]); // never one that's already a Bounty
  stopOn(store, "Sort the cables");
  assert.deepEqual(bountyOn(store), ["Call the tax office", "Sort the cables"]);
  assert.deepEqual(bountyOn(rebuild()), bountyOn(store));
});

test("rerolls: the week's free ones first (frozen as it starts), then bought ones, which carry over", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, add, rebuild, bountySettings } = board();
  for (const text of ["A", "B", "C", "D", "E"]) add(text);
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");
  stopOn(store, "A");
  bountySettings(store, { rerolls: 5 }); // a change mid-week leaves this week's grant alone
  assert.equal(store.bountyStatus().rerollsLeft, 1);
  const granted = events.readAll().filter((e) => e.event.type === "BountyRerollsGranted").map((e) => e.event);
  assert.deepEqual(granted, [{ type: "BountyRerollsGranted", count: 1, source: "week", periodKey: WEEK2 }]);

  // Two bought (the shop will grant them this way): one free + two banked.
  events.append({ type: "BountyRerollsGranted", count: 2, source: "purchase", periodKey: WEEK2 }, at(WEEK2));
  let s = rebuild();
  assert.equal(s.bountyStatus().rerollsLeft, 3);
  // A reroll, its reel stopped: whether it was spent from `from`.
  const spend = (from) => {
    s.rerollBounty(s.bountyStatus().bounties[0].taskId);
    const spent = events.readAll().at(-1).event.rerollFrom === from;
    s.rollBounty(0);
    return spent;
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

test("winning one deals a reel for another when Settings say so — and unticking and reticking can't farm them", (t) => {
  t.after(() => setDebugNow(null));
  const { store, add, thaw, bountyOn, rebuild, bountySettings } = board();
  const first = add("Call the tax office");
  add("Return the parcel");
  add("Sort the cables");
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");
  stopOn(store, "Call the tax office");

  thaw(first);
  store.setDone(first.id, true); // off by default: winning ends it
  assert.deepEqual(bountyOn(store), ["Call the tax office"]);
  assert.deepEqual([store.bountyStatus().bounties.length, reelOf(store)], [0, null]);
  store.setDone(first.id, false);

  bountySettings(store, { rollOnWin: true });
  store.setDone(first.id, true);
  assert.deepEqual(onReel(store), ["Return the parcel", "Sort the cables"]); // never the one just won
  store.setDone(first.id, false); // won again before the reel is stopped: still the one stop
  store.setDone(first.id, true);
  assert.equal(reelOf(store).rolls, 1);
  stopOn(store, "Return the parcel");
  assert.deepEqual(bountyOn(store).sort(), ["Call the tax office", "Return the parcel"]);
  assert.deepEqual(store.bountyStatus().bounties.map((b) => b.text), ["Return the parcel"]);
  store.setDone(first.id, false); // two to win again — one more than may be on at once
  store.setDone(first.id, true); // winning it again doesn't deal for a third
  assert.equal(reelOf(store), null);
  assert.deepEqual(bountyOn(store).sort(), ["Call the tax office", "Return the parcel"]);
  assert.deepEqual(bountyOn(rebuild()).sort(), bountyOn(store).sort());
});

test("with Bounties off, a reel can't be stopped, a week close deals none and any on stop paying", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, add, thaw, bountyOn, bountySettings } = board();
  const task = add("Call the tax office", 1000);
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");
  bountySettings(store, { enabled: false });
  assert.equal(reelOf(store), null);
  assert.throws(() => store.rollBounty(0), /no Bounty to roll/);
  bountySettings(store, { enabled: true });
  stopOn(store, "Call the tax office");
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
  assert.equal(recap.bounty, null);
  assert.equal(recap.bountyEmpty, false); // off isn't empty
  assert.ok(!events.readAll().slice(before).some((e) => e.event.type.startsWith("Bounty")));
});

test("with nothing on ice there's no reel, and the recap says so", (t) => {
  t.after(() => setDebugNow(null));
  const { store, addHot } = board();
  addHot("Call the tax office"); // in Tasks, never on the reel
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  const { recap } = store.rollPeriod("week");
  assert.deepEqual([recap.bounty.bounties, recap.bounty.reel], [[], null]);
  assert.equal(recap.bountyEmpty, true);
});

test("a task that leaves the Freezer is off the reel, and a reel never stopped ends with its week", (t) => {
  t.after(() => setDebugNow(null));
  const { store, add, thaw, bountyOn, rebuild } = board();
  const taxes = add("Call the tax office");
  const parcel = add("Return the parcel");
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");
  thaw(taxes);
  assert.deepEqual(onReel(store), ["Return the parcel"]);
  thaw(parcel); // nothing left on it to stop
  assert.equal(reelOf(store), null);
  assert.throws(() => store.rollBounty(0), /no Bounty to roll/);

  store.setFrozen(parcel.id, true);
  setDebugNow(at(WEEK3));
  store.rollPeriod("week"); // last week's reel is gone; this week's is its own
  assert.deepEqual(bountyOn(store), []);
  assert.deepEqual([onReel(store), reelOf(store).rolls], [["Return the parcel"], 1]);
  assert.deepEqual(rebuild().bountyStatus(), store.bountyStatus());
});

test("a week reopened by the debug clock starts its Bounties afresh — they never stack", (t) => {
  t.after(() => setDebugNow(null));
  const { store, add, bountyOn, rebuild } = board();
  add("Buy stickers");
  add("Clean the PC");
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week"); // ahead: WEEK2's reel, stopped
  stopOn(store, "Buy stickers");
  setDebugNow(at(WEEK1));
  store.rollPeriod("week"); // back: WEEK1 reopened, with a reel of its own
  stopOn(store, "Clean the PC");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week"); // ahead again: WEEK2 reopened — its earlier Bounty is gone, its reel is new
  assert.deepEqual([bountyOn(store), reelOf(store).rolls], [[], 1]);
  stopOn(store, "Clean the PC");
  assert.equal(store.bountyStatus().bounties.length, 1);
  assert.equal(bountyOn(store).length, 1);
  assert.equal(store.bountyStatus().rerollsLeft, 1); // its free rerolls start afresh too
  assert.deepEqual(bountyOn(rebuild()), bountyOn(store));
});

test("a reroll's reel never holds the task it's replacing, nor one the week already had while another is left", (t) => {
  t.after(() => setDebugNow(null));
  const { store, add, addHot, bountyOn, bountySettings, rebuild } = board();
  bountySettings(store, { rerolls: 3 });
  const blocked = addHot("Renew registration"); // Blocked can't freeze, so it's never on a reel
  store.setStatus(blocked.id, "blocked", { note: "the letter" });
  assert.throws(() => store.setFrozen(blocked.id, true), /Blocked tasks can't be frozen/);
  const a = add("Call the tax office");
  const b = add("Return the parcel");
  const c = add("Buy stickers");
  store.rollPeriod("week");
  setDebugNow(at(WEEK2));
  store.rollPeriod("week");
  stopOn(store, "Call the tax office");
  store.rerollBounty(a.id);
  assert.deepEqual(onReel(store), ["Buy stickers", "Return the parcel"]);
  stopOn(store, "Return the parcel");
  store.rerollBounty(b.id);
  assert.deepEqual(onReel(store), ["Buy stickers"]); // not back to the tax office
  stopOn(store, "Buy stickers");
  // Only the week's earlier ones left: then those, never the one being replaced.
  store.rerollBounty(c.id);
  assert.deepEqual(onReel(store), ["Call the tax office", "Return the parcel"]);
  stopOn(store, "Call the tax office");
  assert.deepEqual(bountyOn(store), ["Call the tax office"]);
  assert.deepEqual(bountyOn(rebuild()), bountyOn(store));
});
