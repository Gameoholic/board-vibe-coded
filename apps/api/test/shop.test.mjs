import assert from "node:assert/strict";
import { test } from "node:test";
import { CreateRewardBody } from "@board/contracts";
import { setDebugNow } from "../dist/clock.js";
import { openEventStore } from "../dist/db.js";
import { ApiError } from "../dist/errors.js";
import { BoardStore } from "../dist/projection.js";

// The shop through the real projection: a reward's kind (repeatable, one-time, Item), the weekend sale as a
// modifier on its price (frozen on the purchase), a timed reward bought by the minute and its stopwatch, the
// items a purchase gives (a Bounty reroll, a Booster reroll — and the Booster reroll's new deal), and a rebuild
// landing where the commands left it.

// The board's timezone is Asia/Jerusalem (UTC+3 in early October 2026). 2026-09-27 is a Sunday.
const THURSDAY_EVENING = "2026-10-01T15:00:00.000Z"; // 18:00 — the sale is on (from 17:00)
const THURSDAY_AFTERNOON = "2026-10-01T13:00:00.000Z"; // 16:00 — not yet
const FRIDAY = "2026-10-02T09:00:00.000Z";
const SATURDAY = "2026-10-03T09:00:00.000Z";
const SUNDAY_EARLY = "2026-10-04T00:00:00.000Z"; // 03:00 — the clock's new week, but Saturday may not have ended
const WEDNESDAY = "2026-09-30T09:00:00.000Z";

function board(now = WEDNESDAY) {
  setDebugNow(now);
  const events = openEventStore(":memory:");
  const store = new BoardStore(events, () => 0.5);
  // Points to spend: one big ticked daily task.
  const daily = store.seedSection("Daily", "#888888", [{ type: "checkbox" }], "tasks", "day");
  store.setDone(store.createTask({ sectionId: daily.id, type: "checkbox", text: "Work", points: 100_000 }).id, true);
  const shelf = store.createShopSection({ name: "Leisure", color: "#888888" });
  // Through the route's schema, which fills in a reward's kind.
  const reward = (name, cost, extra = {}) =>
    store.createReward(CreateRewardBody.parse({ shopSectionId: shelf.id, name, emoji: "🎬", cost, ...extra }));
  const rewardOf = (id) => store.getShop().rewards.find((r) => r.id === id);
  const purchases = () => events.readAll().filter((e) => e.event.type === "RewardPurchased").map((e) => e.event);
  const rebuild = () => new BoardStore(events, () => 0.5);
  // End the open day at `now` (the first call starts the first day and week) — days and weeks only pass when
  // they're ended.
  const endDayAt = (now) => {
    setDebugNow(now);
    store.rollPeriod("day");
  };
  return { events, store, daily, shelf, reward, rewardOf, purchases, rebuild, endDayAt };
}

const refused = (status) => (err) => err instanceof ApiError && err.status === status;

test("a repeatable reward is bought again and again; a one-time one once, and then it leaves its shelf", (t) => {
  t.after(() => setDebugNow(null));
  const { store, shelf, reward, rewardOf, rebuild } = board();
  const video = reward("Watch a video", 2000);
  const headphones = reward("Headphones", 30_000, { kind: "once" });
  const tail = reward("Watch a film", 4000);
  assert.equal(video.kind, "repeatable");
  assert.equal(headphones.kind, "once");

  store.purchaseReward(video.id);
  store.purchaseReward(video.id);
  assert.equal(rewardOf(video.id).redeemed, 2);

  store.purchaseReward(headphones.id);
  assert.equal(rewardOf(headphones.id).redeemed, 1);
  assert.ok(rewardOf(headphones.id).boughtAt, "it says when it was bought");
  assert.throws(() => store.purchaseReward(headphones.id), refused(400), "a one-time reward is bought once");
  // Bought, it trails its shelf — still there, never between the rewards still listed.
  const order = store.getShop().rewards.filter((r) => r.shopSectionId === shelf.id).map((r) => r.id);
  assert.deepEqual(order, [video.id, tail.id, headphones.id]);
  // A posted order can't strand it in the middle either.
  store.reorderRewards(shelf.id, [headphones.id, tail.id, video.id]);
  assert.deepEqual(store.getShop().rewards.map((r) => r.id), [tail.id, video.id, headphones.id]);

  assert.equal(store.getShop().spent, 2000 * 2 + 30_000);
  assert.deepEqual(rebuild().getShop(), store.getShop());
});

test("a one-time reward leaves its group once it's bought", (t) => {
  t.after(() => setDebugNow(null));
  const { store, shelf, reward, rewardOf } = board();
  const a = reward("Keyboard", 10_000, { kind: "once" });
  const b = reward("Mouse", 5000, { kind: "once" });
  const group = store.createGroup({ sectionId: shelf.id, label: "Desk", itemIds: [a.id, b.id] });
  store.purchaseReward(a.id);
  assert.equal(rewardOf(a.id).groupId, undefined);
  assert.equal(rewardOf(b.id).groupId, group.id);
});

test("the weekend sale takes its share off a reward on sale", (t) => {
  t.after(() => setDebugNow(null));
  const { store, reward, purchases, rebuild } = board(THURSDAY_EVENING);
  const video = reward("Watch a video", 2000);
  const keyboard = reward("Keyboard", 10_000, { kind: "once" });
  assert.equal(video.onSale, true, "a repeatable reward is on sale unless it says otherwise");
  assert.equal(keyboard.onSale, false, "a one-time one isn't");

  store.purchaseReward(video.id);
  store.purchaseReward(keyboard.id);
  const [onSale, fullPrice] = purchases();
  assert.equal(onSale.pointsSpent, 1000);
  assert.equal(onSale.cost, 2000, "the price before the sale is kept");
  assert.deepEqual(onSale.modifiers, [{ id: "sale", kind: "factor", value: 0.5 }]);
  assert.equal(fullPrice.pointsSpent, 10_000);
  assert.equal(fullPrice.modifiers, undefined);

  // A later change to the sale never reprices what was bought.
  store.patchSettings({ sale: { ...store.getSettings().sale, percentOff: 20 } });
  assert.equal(store.getShop().spent, 11_000);
  store.purchaseReward(video.id);
  assert.equal(purchases()[2].pointsSpent, 1600);
  assert.deepEqual(rebuild().getShop(), store.getShop());
});

test("the sale runs from Thursday evening until the week is ended — a day not yet ended is still today", (t) => {
  t.after(() => setDebugNow(null));
  const { store, reward, purchases, endDayAt } = board(WEDNESDAY);
  const video = reward("Watch a video", 2000);
  const priceAt = (now) => {
    setDebugNow(now);
    store.purchaseReward(video.id);
    return purchases().at(-1).pointsSpent;
  };
  endDayAt(WEDNESDAY);
  assert.equal(priceAt(WEDNESDAY), 2000);
  assert.equal(priceAt(THURSDAY_EVENING), 2000, "Wednesday hasn't been ended, so it isn't Thursday yet");
  endDayAt(THURSDAY_AFTERNOON);
  assert.equal(priceAt(THURSDAY_AFTERNOON), 2000);
  assert.equal(priceAt(THURSDAY_EVENING), 1000);
  endDayAt(FRIDAY);
  endDayAt(SATURDAY);
  assert.equal(priceAt(SUNDAY_EARLY), 1000, "Saturday hasn't been ended, so the week runs on");
  endDayAt(SUNDAY_EARLY); // Saturday ends, and the week with it
  assert.equal(priceAt(SUNDAY_EARLY), 2000);

  // Switched off, nothing's on sale; and a reward taken off the sale pays full price during it.
  endDayAt("2026-10-08T15:00:00.000Z"); // Thursday evening of the next week (the days between never opened)
  assert.equal(priceAt("2026-10-08T15:00:00.000Z"), 1000);
  store.patchSettings({ sale: { ...store.getSettings().sale, enabled: false } });
  assert.equal(priceAt("2026-10-08T15:00:00.000Z"), 2000);
  store.patchSettings({ sale: { ...store.getSettings().sale, enabled: true } });
  store.editReward(video.id, { onSale: false });
  assert.equal(priceAt("2026-10-08T15:00:00.000Z"), 2000);
});

test("the sale can be started early, and runs until the week is ended", (t) => {
  t.after(() => setDebugNow(null));
  const { store, reward, purchases, rebuild, endDayAt } = board(WEDNESDAY);
  const video = reward("Watch a video", 2000);
  assert.throws(() => store.startSale(), refused(400), "not before a week has started");
  endDayAt(WEDNESDAY);
  store.purchaseReward(video.id);
  assert.equal(purchases().at(-1).pointsSpent, 2000);
  assert.equal(store.startSale().saleStarted, true);
  store.purchaseReward(video.id);
  assert.equal(purchases().at(-1).pointsSpent, 1000);
  assert.throws(() => store.startSale(), refused(400), "it's on already");
  assert.deepEqual(rebuild().getShop(), store.getShop());

  endDayAt(THURSDAY_AFTERNOON);
  endDayAt(FRIDAY);
  endDayAt(SATURDAY);
  endDayAt(SUNDAY_EARLY); // the week ends, and its sale with it
  assert.equal(store.getShop().saleStarted, false);
  store.purchaseReward(video.id);
  assert.equal(purchases().at(-1).pointsSpent, 2000);
});

test("a purchase at a price the owner wasn't shown is refused, and nothing is bought", (t) => {
  t.after(() => setDebugNow(null));
  const { store, reward, purchases } = board(THURSDAY_EVENING);
  const video = reward("Watch a video", 2000);
  // The page still showed the full price as the sale began.
  assert.throws(() => store.purchaseReward(video.id, { price: 2000 }), refused(409));
  assert.equal(purchases().length, 0);
  store.purchaseReward(video.id, { price: 1000 });
  assert.equal(purchases().length, 1);
});

test("a timed reward is bought by the minute, at its cost for an hour", (t) => {
  t.after(() => setDebugNow(null));
  const { store, reward, rewardOf, purchases, rebuild } = board();
  const video = reward("YouTube", 2500, { timed: true });
  const film = reward("Watch a film", 4000);
  assert.equal(video.timed, true);
  assert.equal(film.timed, false, "a reward is paid for each time unless it says otherwise");

  store.purchaseReward(video.id, { minutes: 17 });
  const [first] = purchases();
  assert.equal(first.pointsSpent, 708, "2500 × 17 ÷ 60 = 708.33");
  assert.equal(first.minutes, 17);
  assert.equal(first.cost, 2500, "what an hour cost then is kept");

  // A later change to its rate never reprices what was bought.
  store.editReward(video.id, { cost: 6000 });
  assert.equal(store.getShop().spent, 708);
  store.purchaseReward(video.id, { minutes: 90, price: 9000 });
  assert.equal(purchases()[1].pointsSpent, 9000);
  assert.equal(rewardOf(video.id).redeemed, 2);

  assert.throws(() => store.purchaseReward(video.id), refused(400), "it has to say how long");
  assert.throws(() => store.purchaseReward(film.id, { minutes: 5 }), refused(400), "and no other reward does");
  assert.throws(() => store.purchaseReward(video.id, { minutes: 30, price: 1 }), refused(409), "never a price the owner wasn't shown");
  assert.throws(() => store.purchaseReward(video.id, { minutes: 100_000 }), refused(400), "more time than there are points for");
  store.editReward(video.id, { cost: 1 });
  assert.throws(() => store.purchaseReward(video.id, { minutes: 1 }), refused(400), "a purchase always spends something");
  assert.equal(purchases().length, 2);
  assert.deepEqual(rebuild().getShop(), store.getShop());
});

test("the weekend sale takes its share off a timed reward's time, rounded once", (t) => {
  t.after(() => setDebugNow(null));
  const { store, reward, purchases } = board(THURSDAY_EVENING);
  const video = reward("YouTube", 1000, { timed: true });
  assert.equal(video.onSale, true, "repeatable, so on the sale");
  store.purchaseReward(video.id, { minutes: 7 });
  const [bought] = purchases();
  // 116.67 for the 7 minutes, half of it 58.33 — not 117 halved to 59.
  assert.equal(bought.pointsSpent, 58);
  assert.deepEqual(bought.modifiers, [{ id: "sale", kind: "factor", value: 0.5 }]);
  assert.equal(bought.minutes, 7);
});

test("a timed reward's stopwatch is kept as it was left, until its time is bought", (t) => {
  t.after(() => setDebugNow(null));
  const { store, shelf, reward, rewardOf, rebuild } = board();
  const video = reward("YouTube", 2500, { timed: true });
  const film = reward("Watch a film", 4000);
  const running = { elapsedMs: 0, isRunning: true, startedAt: 1_790_000_000_000 };
  const paused = { elapsedMs: 17 * 60_000, isRunning: false };

  assert.deepEqual(store.setRewardTimer(video.id, running).timer, running);
  assert.deepEqual(rebuild().getShop(), store.getShop(), "a restart doesn't lose it");
  store.setRewardTimer(video.id, paused);
  assert.deepEqual(rewardOf(video.id).timer, paused);
  store.setRewardTimer(video.id, null);
  assert.equal(rewardOf(video.id).timer, undefined, "reset");
  assert.throws(() => store.setRewardTimer(film.id, paused), refused(400), "only a timed reward has one");

  store.setRewardTimer(video.id, paused);
  store.purchaseReward(video.id, { minutes: 17 });
  assert.equal(rewardOf(video.id).timer, undefined, "its time is paid for");
  assert.deepEqual(rebuild().getShop(), store.getShop());

  // Gone with its reward, and with its reward's tab.
  store.setRewardTimer(video.id, paused);
  store.deleteShopSection(shelf.id);
  assert.deepEqual(rebuild().getShop(), store.getShop());
});

test("a repeatable reward can be made timed, or not, later — and no other kind can", (t) => {
  t.after(() => setDebugNow(null));
  const { events, store, shelf, reward, rebuild } = board();
  const video = reward("YouTube", 2000);
  const keyboard = reward("Keyboard", 10_000, { kind: "once" });
  assert.equal(store.editReward(video.id, { timed: true }).timed, true);
  assert.throws(() => store.editReward(keyboard.id, { timed: true }), refused(400));
  assert.throws(() => CreateRewardBody.parse({ shopSectionId: shelf.id, name: "x", emoji: "🎲", cost: 1000, kind: "once", timed: true }));

  store.setRewardTimer(video.id, { elapsedMs: 60_000, isRunning: false });
  const back = store.editReward(video.id, { timed: false });
  assert.equal(back.timed, false);
  assert.equal(back.timer, undefined, "its stopwatch goes with it");
  const edits = events.readAll().filter((e) => e.event.type === "RewardEdited").map((e) => e.event);
  assert.deepEqual(edits.map((e) => [e.changes.timed, e.previous.timed]), [[true, false], [false, true]]);
  assert.deepEqual(rebuild().getShop(), store.getShop());
});

test("resetting progress keeps a reward timed, and clears its stopwatch with everything else", (t) => {
  t.after(() => setDebugNow(null));
  const { store, reward, rewardOf, rebuild } = board();
  const video = reward("YouTube", 2500, { timed: true });
  store.setRewardTimer(video.id, { elapsedMs: 60_000, isRunning: false });
  store.reseedFromCurrent();
  assert.equal(rewardOf(video.id).timed, true);
  assert.equal(rewardOf(video.id).timer, undefined);
  assert.deepEqual(rebuild().getShop(), store.getShop());
});

test("a day's recap says how long a timed purchase was for", (t) => {
  t.after(() => setDebugNow(null));
  const { store, reward, endDayAt } = board(WEDNESDAY);
  endDayAt(WEDNESDAY);
  store.purchaseReward(reward("YouTube", 2500, { timed: true }).id, { minutes: 30 });
  store.purchaseReward(reward("Watch a film", 4000).id);
  setDebugNow(THURSDAY_AFTERNOON);
  const { recap } = store.rollPeriod("day");
  assert.deepEqual(recap.days[0].purchases, [
    { name: "YouTube", emoji: "🎬", cost: 1250, minutes: 30 },
    { name: "Watch a film", emoji: "🎬", cost: 4000 },
  ]);
});

test("Bounty rerolls: the week's free one and bought ones are counted apart — only bought ones carry over", (t) => {
  t.after(() => setDebugNow(null));
  const { store, reward, events, rebuild, endDayAt } = board(WEDNESDAY);
  const bountyRerolls = () => store.getShop().inventory.find((i) => i.item === "bounty-reroll");
  endDayAt(WEDNESDAY);
  assert.deepEqual(bountyRerolls(), { item: "bounty-reroll", owned: 0, free: 1 });
  const item = reward("Bounty reroll", 3000, { kind: "game", item: "bounty-reroll" });
  assert.equal(item.onSale, false);
  store.purchaseReward(item.id);
  assert.deepEqual(bountyRerolls(), { item: "bounty-reroll", owned: 1, free: 1 });
  assert.equal(store.bountyStatus().rerollsLeft, 2);
  const grants = events.readAll().filter((e) => e.event.type === "BountyRerollsGranted").map((e) => e.event);
  assert.deepEqual(grants.map((g) => [g.source, g.count]), [["purchase", 1]]);
  assert.deepEqual(rebuild().getShop(), store.getShop());

  endDayAt(THURSDAY_AFTERNOON);
  endDayAt(FRIDAY);
  endDayAt(SATURDAY);
  endDayAt(SUNDAY_EARLY); // a new week: a new free one, and the bought one kept
  assert.deepEqual(bountyRerolls(), { item: "bounty-reroll", owned: 1, free: 1 });
});

test("a retried purchase gives its item once", (t) => {
  t.after(() => setDebugNow(null));
  const { store, reward } = board();
  const item = reward("Booster reroll", 3000, { kind: "game", item: "booster-reroll" });
  store.purchaseReward(item.id, undefined, "buy-1");
  const shop = store.purchaseReward(item.id, undefined, "buy-1");
  assert.deepEqual(shop.inventory.find((i) => i.item === "booster-reroll"), { item: "booster-reroll", owned: 1, free: 0 });
  assert.equal(shop.spent, 3000);
});

test("an Item reward needs its item, and only it has one", (t) => {
  t.after(() => setDebugNow(null));
  const { shelf } = board();
  const base = { shopSectionId: shelf.id, name: "x", emoji: "🎲", cost: 1000 };
  for (const body of [{ ...base, kind: "game" }, { ...base, kind: "once", item: "bounty-reroll" }]) {
    assert.throws(() => CreateRewardBody.parse(body));
  }
});

test("a reward from before kinds reads as a repeatable on the sale", (t) => {
  t.after(() => setDebugNow(null));
  const { events, shelf } = board(THURSDAY_EVENING);
  events.append({ type: "RewardCreated", rewardId: "old", shopSectionId: shelf.id, name: "Old video", emoji: "📺", cost: 2000 }, new Date().toISOString());
  const reread = new BoardStore(events, () => 0.5);
  const old = reread.getShop().rewards.find((r) => r.id === "old");
  assert.equal(old.kind, "repeatable");
  assert.equal(old.onSale, true);
  assert.equal(old.timed, false);
  reread.purchaseReward("old");
  assert.equal(reread.getShop().spent, 1000);
});

// ---- the Booster reroll ----

const at = (date) => `${date}T09:00:00.000Z`;
const WEEK1 = "2026-09-27";
const WEEK2 = "2026-10-04";

function boosterBoard() {
  setDebugNow(at(WEEK1));
  const events = openEventStore(":memory:");
  // Picks the last card each shuffle step — fixed, so the deals are known.
  const store = new BoardStore(events, () => 0.99);
  const daily = store.seedSection("Daily", "#888888", [{ type: "checkbox" }], "tasks", "day");
  store.setDone(store.createTask({ sectionId: daily.id, type: "checkbox", text: "Work", points: 100_000 }).id, true);
  const registry = store.seedSection("Registry", "#888888", [{ type: "tiered" }, { type: "repeatable" }], "tasks", "day");
  const tally = (text) => store.createTask({ sectionId: registry.id, type: "repeatable", text, points: 200 });
  const shelf = store.createShopSection({ name: "Game", color: "#888888" });
  const buyReroll = () => {
    const item = store.createReward(
      CreateRewardBody.parse({ shopSectionId: shelf.id, name: "Booster reroll", emoji: "🃏", cost: 1000, kind: "game", item: "booster-reroll" }),
    );
    store.purchaseReward(item.id);
  };
  const toWeek2 = () => {
    store.rollPeriod("week");
    setDebugNow(at(WEEK2));
    store.rollPeriod("week");
  };
  const boosted = (s = store) => s.listTasks().filter((t) => t.booster).map((t) => t.text).sort();
  const rebuild = () =>
    new BoardStore(events, () => {
      throw new Error("a rebuild dealt");
    });
  return { events, store, tally, buyReroll, toWeek2, boosted, rebuild };
}

test("a Booster reroll deals the hand again without the week's Boosters, and the card picked is the new one", (t) => {
  t.after(() => setDebugNow(null));
  const { store, tally, buyReroll, toWeek2, boosted, rebuild } = boosterBoard();
  ["Push-ups", "Pull-ups", "Squats", "Dips"].forEach(tally);
  toWeek2();
  store.pickBooster(0);
  const [first] = boosted();
  const firstId = store.listTasks().find((x) => x.text === first).id;

  assert.throws(() => store.rerollBooster(firstId), refused(400), "a reroll has to be bought first");
  buyReroll();
  assert.equal(store.boosterStatus().rerollsLeft, 1);
  const hand = store.rerollBooster(firstId);
  assert.equal(hand.picks, 1);
  assert.equal(hand.cards, 3, "every habit but the Booster it gives up");
  assert.ok(!hand.names.includes(first));
  assert.deepEqual(boosted(), [], "the old one stops being a Booster");
  assert.equal(store.boosterStatus().rerollsLeft, 0);

  const picked = store.pickBooster(2);
  assert.equal(boosted().length, 1);
  assert.notEqual(boosted()[0], first);
  assert.ok(picked.revealed, "the rest turn over once it's picked");
  assert.throws(() => store.pickBooster(1), refused(400), "a reroll's hand is one pick");
  assert.deepEqual(boosted(rebuild()), boosted());
  assert.deepEqual(rebuild().boosterStatus(), store.boosterStatus());
});

test("with several Boosters, a reroll gives up one and keeps the rest", (t) => {
  t.after(() => setDebugNow(null));
  const { store, tally, buyReroll, toWeek2, boosted, rebuild } = boosterBoard();
  ["Push-ups", "Pull-ups", "Squats", "Dips", "Plank"].forEach(tally);
  store.patchSettings({ booster: { ...store.getSettings().booster, max: 2 } });
  toWeek2();
  store.pickBooster(0);
  // Not until the week's hand is all picked.
  buyReroll();
  const firstId = store.listTasks().find((x) => x.booster).id;
  assert.throws(() => store.rerollBooster(firstId), refused(400));
  store.pickBooster(1);
  const [keep, drop] = store.listTasks().filter((x) => x.booster);
  const hand = store.rerollBooster(drop.id);
  assert.equal(hand.cards, 3, "the Registry less both of the week's Boosters");
  assert.deepEqual(boosted(), [keep.text]);
  store.pickBooster(0);
  assert.equal(boosted().length, 2);
  assert.ok(boosted().includes(keep.text));
  assert.ok(!boosted().includes(drop.text));
  assert.deepEqual(boosted(rebuild()), boosted());
});

test("a Booster reroll with nothing else to deal is refused and spends nothing", (t) => {
  t.after(() => setDebugNow(null));
  const { store, tally, buyReroll, toWeek2 } = boosterBoard();
  tally("Push-ups");
  toWeek2();
  store.pickBooster(0);
  buyReroll();
  assert.throws(() => store.rerollBooster(store.listTasks().find((x) => x.booster).id), refused(400));
  assert.equal(store.boosterStatus().rerollsLeft, 1);
});
