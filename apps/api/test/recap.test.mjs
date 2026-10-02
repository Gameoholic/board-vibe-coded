import assert from "node:assert/strict";
import { test } from "node:test";
import { setDebugNow } from "../dist/clock.js";
import { openEventStore } from "../dist/db.js";
import { BoardStore } from "../dist/projection.js";

// The recap a period roll returns, day by day: per tab, the tasks that came out ahead and what the day's
// ticks earned there (net — so an untick of an earlier win counts against its day, and the close's own
// reset doesn't), the day's totals and each purchase; for a week, its days and where each streak started
// and ended. A fold over the log, so a rebuild recaps the same.
const at = (date) => `${date}T09:00:00.000Z`;
const tabs = (day) => day.tabs.map((t) => `${t.name} ${t.cleared} ${t.earned}`);

test("a day recaps by tab with its purchases; a week, each of its days and its streaks", (t) => {
  t.after(() => setDebugNow(null));
  setDebugNow(at("2026-09-27")); // a Sunday: day one of the week
  const events = openEventStore(":memory:");
  const store = new BoardStore(events, () => 0.99);
  const tasksTab = store.seedSection("Tasks", "#888888", [{ type: "once" }], "tasks");
  const daily = store.seedSection("Daily", "#16a34a", [{ type: "checkbox" }], "tasks", "day");
  const weekly = store.seedSection("Weekly", "#2563eb", [{ type: "checkbox" }], "tasks", "week");
  const streaksTab = store.seedSection("Streaks", "#ef4444", [{ type: "checkbox" }], "streaks");
  const stretch = store.createTask({ sectionId: daily.id, type: "checkbox", text: "Stretch", points: 500 });
  const plates = store.createTask({ sectionId: weekly.id, type: "checkbox", text: "Plates", points: 400 });
  const a = store.createTask({ sectionId: tasksTab.id, type: "once", text: "A", points: 1000 });
  const b = store.createTask({ sectionId: tasksTab.id, type: "once", text: "B", points: 2000 });
  const shop = store.createShopSection({ name: "Treats", color: "#8b5cf6" });
  const movie = store.createReward({ shopSectionId: shop.id, name: "Movie", emoji: "🎬", cost: 300 });
  const streak = store.createStreak({
    sectionId: streaksTab.id,
    name: "Plates weekly",
    type: "weekly",
    mode: "all",
    since: "created",
    matcher: { kind: "tasks", conditions: [{ taskId: plates.id, required: 1 }] },
  });
  store.rollPeriod("day"); // the first day — and with it the first week

  store.setDone(stretch.id, true);
  store.setDone(a.id, true);
  store.purchaseReward(movie.id);
  setDebugNow(at("2026-09-28"));
  const sunday = store.rollPeriod("day").recap;
  assert.equal(sunday.days.length, 1);
  assert.deepEqual(tabs(sunday.days[0]), ["Tasks 1 1000", "Daily 1 500"]);
  assert.deepEqual(sunday.days[0].tabs.map((x) => x.color), ["#888888", "#16a34a"]);
  assert.deepEqual([sunday.days[0].earned, sunday.days[0].lost], [1500, 300]);
  assert.deepEqual(sunday.days[0].purchases, [{ name: "Movie", emoji: "🎬", cost: 300 }]);
  assert.deepEqual(sunday.streaks, []); // a day's recap has no streak page

  store.setDone(stretch.id, true); // its reset at the close above wasn't a loss; ticked again today
  store.setDone(a.id, false); // yesterday's win taken back — against today
  store.setDone(b.id, true);
  store.setDone(plates.id, true);
  setDebugNow(at("2026-10-04"));
  // Ending Monday on the next week's Sunday ends the week with it.
  const { recap: monday, week } = store.rollPeriod("day");
  assert.deepEqual(tabs(monday.days[0]), ["Tasks 1 1000", "Daily 1 500", "Weekly 1 400"]);
  assert.deepEqual(week.days.map((d) => d.dayKey), ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.deepEqual(week.days.map(tabs), [["Tasks 1 1000", "Daily 1 500"], ["Tasks 1 1000", "Daily 1 500", "Weekly 1 400"], [], [], [], [], []]);
  assert.deepEqual([week.earned, week.lost], [3400, 300]);
  assert.deepEqual(week.streaks, [{ streakId: streak.id, name: "Plates weekly", type: "weekly", start: 0, end: 1 }]);

  // Next week, on a store rebuilt from the log: it starts where the last one ended.
  const rebuilt = new BoardStore(events, () => 0.99);
  setDebugNow(at("2026-10-05"));
  assert.equal(rebuilt.rollPeriod("day").week, undefined); // a day mid-week ends only the day
  rebuilt.setDone(plates.id, true);
  setDebugNow(at("2026-10-11"));
  const next = rebuilt.rollPeriod("day").week;
  assert.deepEqual(next.streaks.map((st) => [st.start, st.end]), [[1, 2]]);
});

test("a deleted task's points leave the recap with it", (t) => {
  t.after(() => setDebugNow(null));
  setDebugNow(at("2026-09-27"));
  const store = new BoardStore(openEventStore(":memory:"));
  const tasksTab = store.seedSection("Tasks", "#888888", [{ type: "once" }], "tasks");
  const kept = store.createTask({ sectionId: tasksTab.id, type: "once", text: "Kept", points: 700 });
  const gone = store.createTask({ sectionId: tasksTab.id, type: "once", text: "Gone", points: 900 });
  store.rollPeriod("day");
  store.setDone(kept.id, true);
  store.setDone(gone.id, true);
  store.deleteTask(gone.id);
  setDebugNow(at("2026-09-28"));
  const { recap } = store.rollPeriod("day");
  assert.deepEqual(tabs(recap.days[0]), ["Tasks 1 700"]);
  assert.equal(recap.earned, 700);
});
