import assert from "node:assert/strict";
import { test } from "node:test";
import { setDebugNow } from "../dist/clock.js";
import { openEventStore } from "../dist/db.js";
import { BoardStore } from "../dist/projection.js";

// Days and weeks as the owner lives them: a week ends with the day that ends it (never asked about on its
// own), and days or weeks the board was never opened in are simply missing — nothing is written for them,
// the recap shows them empty, and streaks count them as misses (no making up for them).
const at = (date) => `${date}T09:00:00.000Z`; // midday in Jerusalem
const counts = (store) => Object.fromEntries(store.listStreaks().map((s) => [s.name, s.count]));

function board() {
  setDebugNow(at("2026-09-27")); // a Sunday: day one of a week
  const events = openEventStore(":memory:");
  const store = new BoardStore(events, () => 0.99);
  const daily = store.seedSection("Daily", "#16a34a", [{ type: "checkbox" }], "tasks", "day");
  const weekly = store.seedSection("Weekly", "#2563eb", [{ type: "checkbox" }], "tasks", "week");
  const streaksTab = store.seedSection("Streaks", "#ef4444", [{ type: "checkbox" }], "streaks");
  const stretch = store.createTask({ sectionId: daily.id, type: "checkbox", text: "Stretch", points: 500 });
  const plates = store.createTask({ sectionId: weekly.id, type: "checkbox", text: "Plates", points: 400 });
  for (const [name, type, task] of [["Stretch daily", "daily", stretch], ["Plates weekly", "weekly", plates]]) {
    store.createStreak({
      sectionId: streaksTab.id,
      name,
      type,
      mode: "all",
      since: "created",
      matcher: { kind: "tasks", conditions: [{ taskId: task.id, required: 1 }] },
    });
  }
  const open = () => {
    const { day, week } = store.periodStatus();
    return { day: day.openKey, week: week.openKey };
  };
  const started = () => events.readAll().filter((e) => e.event.type === "PeriodStarted").map((e) => `${e.event.kind} ${e.event.periodKey}`);
  return { store, stretch, plates, open, started };
}

test("ending a day ends its week too once the week is over — only then", (t) => {
  t.after(() => setDebugNow(null));
  const { store, open } = board();
  assert.equal(store.rollPeriod("day").week, undefined); // the first day starts the first week, nothing to recap
  assert.deepEqual(open(), { day: "2026-09-27", week: "2026-09-27" });

  setDebugNow(at("2026-09-30"));
  assert.equal(store.rollPeriod("day").week, undefined); // Wednesday: the week goes on
  setDebugNow(at("2026-10-03"));
  assert.equal(store.rollPeriod("day").week, undefined); // Saturday opens; the week is still on
  setDebugNow(at("2026-10-04"));
  const { recap, week } = store.rollPeriod("day"); // Saturday ends — and its week with it
  assert.equal(recap.periodKey, "2026-10-03");
  assert.equal(week.periodKey, "2026-09-27");
  assert.deepEqual(open(), { day: "2026-10-04", week: "2026-10-04" });
});

test("weeks away: the stale day and week end on return, the time between is missing, and streaks don't make up for it", (t) => {
  t.after(() => setDebugNow(null));
  const { store, stretch, plates, open, started } = board();
  store.rollPeriod("day");
  store.setDone(stretch.id, true);
  store.setDone(plates.id, true);
  setDebugNow(at("2026-09-28"));
  store.rollPeriod("day");
  store.setDone(stretch.id, true);
  assert.deepEqual(counts(store), { "Stretch daily": 2, "Plates weekly": 1 });

  // Gone from Tuesday until the Friday two weeks on.
  setDebugNow(at("2026-10-16"));
  const { recap, week } = store.rollPeriod("day");
  assert.equal(recap.periodKey, "2026-09-28"); // the day left open is the one that ends
  assert.equal(week.periodKey, "2026-09-27");
  assert.deepEqual(week.days.map((d) => [d.dayKey, d.tabs.length > 0]), [
    ["2026-09-27", true],
    ["2026-09-28", true],
    ["2026-09-29", false],
    ["2026-09-30", false],
    ["2026-10-01", false],
    ["2026-10-02", false],
    ["2026-10-03", false],
  ]);
  // Back on a Friday: that's the week now, Friday its first day here. Nothing was opened in between.
  assert.deepEqual(open(), { day: "2026-10-16", week: "2026-10-11" });
  assert.deepEqual(started(), ["day 2026-09-27", "week 2026-09-27", "day 2026-09-28", "day 2026-10-16", "week 2026-10-11"]);
  // The missed days and the missed week broke both runs; today and this week are still to play for.
  assert.deepEqual(counts(store), { "Stretch daily": 0, "Plates weekly": 0 });

  store.setDone(stretch.id, true);
  store.setDone(plates.id, true);
  assert.deepEqual(counts(store), { "Stretch daily": 1, "Plates weekly": 1 }); // counted the moment they're done
  setDebugNow(at("2026-10-17"));
  assert.equal(store.rollPeriod("day").week, undefined);
  setDebugNow(at("2026-10-18"));
  const short = store.rollPeriod("day").week; // Saturday ends: so does the Friday-to-Saturday week
  assert.equal(short.periodKey, "2026-10-11");
  assert.deepEqual(short.days.filter((d) => d.tabs.length > 0).map((d) => d.dayKey), ["2026-10-16"]);
  assert.deepEqual(counts(store), { "Stretch daily": 0, "Plates weekly": 1 }); // Saturday missed; that week's plates stand
});
