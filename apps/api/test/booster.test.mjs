import assert from "node:assert/strict";
import { test } from "node:test";
import { taskPointValue } from "@board/contracts";
import { setDebugNow } from "../dist/clock.js";
import { openEventStore } from "../dist/db.js";
import { BoardStore } from "../dist/projection.js";

// The weekly Booster through the real projection: a week close deals the Registry's habits face down (the deal
// recorded, with which card holds which task), the card picked decides the Booster, a Booster adds its amount
// to every tick of a tally and once to a tier, ticks keep what they were paid at, it ends with the week, and a
// rebuild replays the deal — it never deals again.
const at = (date) => `${date}T09:00:00.000Z`;
// 2026-09-27 is a Sunday — the default week start — so each +7 days is the next week.
const WEEK1 = "2026-09-27";
const WEEK2 = "2026-10-04";
const WEEK3 = "2026-10-11";

function board() {
  setDebugNow(at(WEEK1));
  const events = openEventStore(":memory:");
  const store = new BoardStore(events, () => 0.5);
  const daily = store.seedSection("Daily", "#888888", [{ type: "checkbox" }], "tasks", "day");
  const registry = store.seedSection("Registry", "#888888", [{ type: "tiered" }, { type: "repeatable" }], "tasks", "day");
  const tasksTab = store.seedSection("Tasks", "#888888", [{ type: "once" }], "tasks");
  const tier = (text, points = [1000, 2000]) =>
    store.createTask({ sectionId: registry.id, type: "tiered", text, tiers: points.map((p, i) => ({ label: `Tier ${i + 1}`, points: p })) });
  const tally = (text, points = 200) => store.createTask({ sectionId: registry.id, type: "repeatable", text, points });
  // The first week starts (nothing to close, so nothing's dealt), and the next one's close deals.
  const toWeek2 = () => {
    store.rollPeriod("week");
    setDebugNow(at(WEEK2));
    return store.rollPeriod("week").recap;
  };
  const dealt = () => events.readAll().filter((e) => e.event.type === "BoosterDealt").map((e) => e.event);
  const boosted = (s) => s.listTasks().filter((t) => t.booster).map((t) => t.text);
  const total = (s) => s.listTasks().reduce((sum, t) => sum + taskPointValue(t), 0);
  // Settings → Booster, changed one knob at a time (the client always sends the whole object).
  const boosterSettings = (change) => store.patchSettings({ booster: { ...store.getSettings().booster, ...change } });
  // A rebuild must never deal: give it randomness that fails the test if it's asked.
  const rebuild = () =>
    new BoardStore(events, () => {
      throw new Error("a rebuild dealt the Booster");
    });
  return { events, store, daily, tasksTab, tier, tally, toWeek2, dealt, boosted, total, boosterSettings, rebuild };
}

const boost = (value) => [{ id: "booster", kind: "flat", value }];

test("a week close deals the Registry's habits face down — never a daily or a to-do — and a first start deals none", (t) => {
  t.after(() => setDebugNow(null));
  const { store, daily, tasksTab, tier, tally, dealt, rebuild } = board();
  const hang = tier("Dead hang");
  const push = tally("Push-ups");
  store.createTask({ sectionId: daily.id, type: "checkbox", text: "Stretch", points: 500 });
  store.createTask({ sectionId: tasksTab.id, type: "once", text: "Fix the bike", points: 500 });

  store.rollPeriod("week"); // first start: nothing closed, nothing dealt
  assert.equal(dealt().length, 0);
  assert.equal(store.boosterStatus().hand, null);

  setDebugNow(at(WEEK2));
  const { recap } = store.rollPeriod("week");
  assert.equal(dealt().length, 1);
  assert.deepEqual(new Set(dealt()[0].taskIds), new Set([hang.id, push.id]));
  // Face down: the names are sorted, so they don't say which card is which.
  assert.deepEqual(recap.booster, { cards: 2, names: ["Dead hang", "Push-ups"], picks: 1, picked: [], revealed: null });
  assert.deepEqual(rebuild().boosterStatus(), store.boosterStatus());
});

test("the card picked decides the Booster: the task the deal put under it", (t) => {
  t.after(() => setDebugNow(null));
  // Two boards dealt the same hand, a different card picked on each.
  const one = board();
  for (const name of ["Dead hang", "Guitar", "Immersion"]) one.tier(name);
  one.toWeek2();
  const two = board();
  for (const name of ["Dead hang", "Guitar", "Immersion"]) two.tier(name);
  two.toWeek2();
  const textOf = (b, id) => b.store.getTask(id).text;
  const order = one.dealt()[0].taskIds.map((id) => textOf(one, id));
  assert.deepEqual(two.dealt()[0].taskIds.map((id) => textOf(two, id)), order, "the same deal");

  const first = one.store.pickBooster(0);
  const last = two.store.pickBooster(2);
  assert.deepEqual(one.boosted(one.store), [order[0]]);
  assert.deepEqual(two.boosted(two.store), [order[2]]);
  assert.notEqual(order[0], order[2]);
  assert.deepEqual(first.picked.map((p) => [p.card, p.text, p.amount]), [[0, order[0], 500]]);
  // Picked, every card is turned over, in the order dealt.
  assert.deepEqual(first.revealed, order);
  assert.deepEqual(last.revealed, order);

  assert.throws(() => one.store.pickBooster(1), /already picked/);
  assert.deepEqual(one.boosted(one.rebuild()), [order[0]]);
});

test("a Booster adds its amount to every tick of a tally and once to a tier; ticks keep what they were paid at", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, tier, tally, toWeek2, total, boosted, boosterSettings, rebuild } = board();
  const hang = tier("Dead hang", [1000, 2000]);
  const push = tally("Push-ups", 200);
  boosterSettings({ max: 2 });
  toWeek2();
  assert.equal(store.pickBooster(0).revealed, null, "face down while a pick is left");
  assert.throws(() => store.pickBooster(0), /can't be picked/);
  const both = store.pickBooster(1);
  assert.deepEqual(new Set(both.revealed), new Set(["Dead hang", "Push-ups"]));
  assert.deepEqual(boosted(store), ["Dead hang", "Push-ups"]);
  assert.deepEqual(store.getTask(push.id).booster, { amount: 500, periodKey: WEEK2 });

  // A tier is one completion, whichever: +0.5% once.
  store.setTier(hang.id, 0);
  assert.equal(total(store), 1500);
  store.setTier(hang.id, 1);
  assert.equal(total(store), 2500);
  assert.deepEqual(store.getTask(hang.id).paidWith, boost(500));

  // A tally's every tick is a completion: +0.5% each.
  for (const n of [1, 2, 3]) store.setProgress(push.id, n);
  assert.equal(total(store), 2500 + 3 * 700);
  const award = events.readAll().filter((e) => e.event.type === "TaskProgressSet").at(-1).event;
  assert.deepEqual([award.pointsAwarded, award.modifiers], [2100, boost(500)]);

  // Boosters switched off: the day's ticks so far keep what they were paid at, and a tick more pays the same
  // while any stays ticked — never re-pricing the earlier ones.
  boosterSettings({ enabled: false });
  assert.deepEqual(boosted(store), []);
  store.setProgress(push.id, 4);
  assert.equal(total(store), 2500 + 4 * 700);
  store.setProgress(push.id, 0);
  store.setProgress(push.id, 1); // a fresh start with no Booster: plain
  assert.equal(total(store), 2500 + 200);
  assert.equal(total(rebuild()), total(store));
});

test("a Booster ends with its week, its ticks banked at what they paid; the next close deals again", (t) => {
  t.after(() => setDebugNow(null));
  const { store, tally, toWeek2, dealt, boosted, total, rebuild } = board();
  const push = tally("Push-ups", 200);
  toWeek2();
  store.rollPeriod("day"); // the first day starts, so the next one closes it
  store.pickBooster(0);
  store.setProgress(push.id, 2);
  const before = store.pointsAvailable();
  assert.equal(before, 1400);

  setDebugNow(at("2026-10-05"));
  store.rollPeriod("day"); // the Registry resets: its points are banked at what they paid
  assert.equal(store.pointsAvailable(), before);
  assert.deepEqual(boosted(store), ["Push-ups"], "still this week's Booster");

  setDebugNow(at(WEEK3));
  store.rollPeriod("week");
  assert.deepEqual(boosted(store), []);
  assert.equal(dealt().length, 2);
  assert.equal(store.boosterStatus().hand.picked.length, 0);
  store.setProgress(push.id, 1);
  assert.equal(total(store), 200);
  assert.equal(rebuild().pointsAvailable(), store.pointsAvailable());
});

test("with Boosters off, no hand is dealt — and one picked stops boosting", (t) => {
  t.after(() => setDebugNow(null));
  const off = board();
  off.tally("Push-ups");
  off.boosterSettings({ enabled: false });
  const recap = off.toWeek2();
  assert.equal(off.dealt().length, 0);
  assert.equal(recap.booster, null);
  assert.throws(() => off.store.pickBooster(0), /no Booster to pick/);

  const on = board();
  on.tally("Push-ups");
  on.toWeek2();
  on.store.pickBooster(0);
  on.boosterSettings({ enabled: false });
  assert.deepEqual(on.boosted(on.store), []);
  assert.equal(on.store.boosterStatus().hand, null);
});

test("a big Registry is dealt nine cards, each a different task", (t) => {
  t.after(() => setDebugNow(null));
  const { store, tally, toWeek2, dealt } = board();
  for (let i = 0; i < 12; i++) tally(`Habit ${i}`);
  const recap = toWeek2();
  assert.equal(dealt()[0].taskIds.length, 9);
  assert.equal(new Set(dealt()[0].taskIds).size, 9);
  assert.equal(recap.booster.cards, 9);
  assert.throws(() => store.pickBooster(9), /can't be picked/);
});
