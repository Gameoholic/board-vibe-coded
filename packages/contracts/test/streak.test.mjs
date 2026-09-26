import assert from "node:assert/strict";
import { test } from "node:test";
import { computeCounter, computeStreak } from "../dist/streak.js";

// Israel time. A UTC ISO whose local date (Asia/Jerusalem) is the given day at ~10:00 local.
// Sept 2026 is DST (+3), so 07:00Z == 10:00 local — comfortably inside the civil day.
const at = (day) => ({ taskId: "t1", occurredAt: `2026-09-${String(day).padStart(2, "0")}T07:00:00.000Z` });
const now = new Date("2026-09-23T07:00:00.000Z"); // Wed 23rd, local

// Helpers build the normalised matcher shape (conditions), the same shape computeStreak sees in
// production after Zod parses a stored event. `required: 1` is the plain "was it done this period".
const cond = (taskId, required = 1) => ({ taskId, required });
const daily = (extra) => ({ type: "daily", mode: "all", matcher: { kind: "tasks", conditions: [cond("t1")] }, ...extra });

test("consecutive days ending today count, today lit", () => {
  const r = computeStreak([at(21), at(22), at(23)], daily(), now);
  assert.equal(r.count, 3);
  assert.equal(r.active, true);
});

test("today missing is a grace day, not a break", () => {
  const r = computeStreak([at(21), at(22)], daily(), now);
  assert.equal(r.count, 2);
  assert.equal(r.active, false);
});

test("a gap before today breaks the run", () => {
  const r = computeStreak([at(19), at(21), at(22), at(23)], daily(), now);
  assert.equal(r.count, 3); // 21,22,23 — the 20th gap stops it
});

test("mode all needs every task; mode any needs one", () => {
  const comps = [
    { taskId: "a", occurredAt: at(22).occurredAt },
    { taskId: "a", occurredAt: at(23).occurredAt },
    { taskId: "b", occurredAt: at(23).occurredAt },
  ];
  const both = { type: "daily", matcher: { kind: "tasks", conditions: [cond("a"), cond("b")] } };
  assert.equal(computeStreak(comps, { ...both, mode: "all" }, now).count, 1); // only 23rd has both
  assert.equal(computeStreak(comps, { ...both, mode: "any" }, now).count, 2); // 22nd + 23rd
});

test("weekly buckets by ISO week", () => {
  // 2026-09-23 is Wed of one ISO week; 09-16 the prior week; 09-09 two weeks back.
  const weekly = { type: "weekly", mode: "all", matcher: { kind: "tasks", conditions: [cond("t1")] } };
  const r = computeStreak([at(9), at(16), at(23)], weekly, now);
  assert.equal(r.count, 3);
});

test("filter matcher and empty condition list are inert", () => {
  assert.equal(computeStreak([at(23)], daily({ matcher: { kind: "filter", rules: [] } }), now).count, 0);
  assert.equal(computeStreak([at(23)], daily({ matcher: { kind: "tasks", conditions: [] } }), now).count, 0);
});

// A count task records the level reached (CompletionRecord.count); a condition asks for at least N.
const lvl = (day, count) => ({ taskId: "t1", occurredAt: at(day).occurredAt, count });

test("numeric requirement needs the reached level to meet it", () => {
  const need2 = daily({ matcher: { kind: "tasks", conditions: [cond("t1", 2)] } });
  // Reached 2 on the 22nd and 23rd, only 1 on the 21st — so the run is the 22nd+23rd.
  assert.equal(computeStreak([lvl(21, 1), lvl(22, 2), lvl(23, 2)], need2, now).count, 2);
});

test("required 'all' resolves to the task's live box count", () => {
  const all = daily({ matcher: { kind: "tasks", conditions: [{ taskId: "t1", required: "all" }] } });
  const comps = [lvl(22, 3), lvl(23, 3)];
  assert.equal(computeStreak(comps, all, now, new Map([["t1", 3]])).count, 2); // need 3, reached 3
  assert.equal(computeStreak(comps, all, now, new Map([["t1", 4]])).count, 0); // need 4, only reached 3
});

test("createdAt windows the fold — completions before the streak existed don't count", () => {
  // Created the 22nd; the 20th/21st are pre-creation and ignored, so only the 22nd+23rd count.
  const s = daily({ createdAt: at(22).occurredAt });
  assert.equal(computeStreak([at(20), at(21), at(22), at(23)], s, now).count, 2);
});

// A counter mirrors current state: the sum of its linked tasks' currently-ticked boxes. Ticking
// raises it, unticking lowers it — no history, no periods.
const counterOf = (...taskIds) => ({ matcher: { kind: "tasks", conditions: taskIds.map((id) => cond(id)) } });

test("counter sums the linked tasks' current ticked-box counts", () => {
  const levels = new Map([["a", 1], ["b", 3], ["c", 0]]);
  assert.equal(computeCounter(counterOf("a", "b", "c"), levels).count, 4); // 1 + 3 + 0
  assert.equal(computeCounter(counterOf("a", "b", "c"), levels).active, true);
});

test("counter falls when a box is unticked and hits zero when all are clear", () => {
  assert.equal(computeCounter(counterOf("a"), new Map([["a", 3]])).count, 3);
  assert.equal(computeCounter(counterOf("a"), new Map([["a", 2]])).count, 2); // unticked one box
  const empty = computeCounter(counterOf("a"), new Map([["a", 0]]));
  assert.equal(empty.count, 0);
  assert.equal(empty.active, false); // nothing ticked → cold
});

test("legacy backfill is added on top of the computed count in 'all time', never affecting active", () => {
  const s = daily({ legacy: 5, since: "all" });
  const r = computeStreak([at(22)], s, now); // today (23rd) missing → grace, computed 1
  assert.equal(r.count, 6); // 5 legacy + 1 computed
  assert.equal(r.active, false); // legacy doesn't light it
});

test("legacy is ignored when counting from 'now' (fresh start)", () => {
  const s = daily({ legacy: 5, since: "created" });
  assert.equal(computeStreak([at(22), at(23)], s, now).count, 2); // 2 computed, no legacy added
});

test("best is the longest run ever, independent of the current run", () => {
  // A run of 3 (10th–12th), a gap, then 2 (20th–21st); today (23rd) is missing so the current run is 0.
  const r = computeStreak([at(10), at(11), at(12), at(20), at(21)], daily(), now);
  assert.equal(r.count, 0); // current run broken (22nd/23rd missing)
  assert.equal(r.best, 3); // longest historical run
});

test("legacyBest floors the best (a pre-app record), max not additive", () => {
  assert.equal(computeStreak([at(22), at(23)], daily({ legacyBest: 10 }), now).best, 10); // 10 > 2
  assert.equal(computeStreak([at(10), at(11), at(12), at(20), at(21)], daily({ legacyBest: 2 }), now).best, 3); // 3 > 2
});

test("counter has no best (always 0)", () => {
  assert.equal(computeCounter(counterOf("a"), new Map([["a", 3]])).best, 0);
});

test("current open period is live — a same-day check-then-uncheck drops it", () => {
  const comps = [at(21), at(22), at(23)]; // raw log shows today (23rd) was checked at some point
  // Live level says today is now 0 (checked then unchecked) → today doesn't count; 21+22 hold (grace).
  const off = computeStreak(comps, daily(), now, new Map(), undefined, { currentLevels: new Map([["t1", 0]]) });
  assert.equal(off.count, 2);
  assert.equal(off.active, false);
  // Live level says today is still ticked → today counts, run is lit at 3.
  const on = computeStreak(comps, daily(), now, new Map(), undefined, { currentLevels: new Map([["t1", 1]]) });
  assert.equal(on.count, 3);
  assert.equal(on.active, true);
});

test("counter 'all time' sums each day's reached level, snapshot-honest, plus legacy and today live", () => {
  const s = { ...counterOf("t1"), since: "all", legacy: 10 };
  // Raw log: reached 3 on the 20th, and 3 on the 21st. But the 21st's close snapshot froze 2 (a box
  // was unchecked before close) — so the 21st must count 2, not 3. Today (23rd) has 1 ticked live.
  const completions = [lvl(20, 3), lvl(21, 3)];
  const settled = new Map([
    ["2026-09-20", new Map([["t1", 3]])],
    ["2026-09-21", new Map([["t1", 2]])],
  ]);
  const r = computeCounter(s, new Map([["t1", 1]]), { completions, settled, now });
  assert.equal(r.count, 16); // 10 legacy + 3 (20th) + 2 (21st, snapshot wins) + 1 (today live)
  assert.equal(r.active, true);
});

test("counter 'now' ignores both history and legacy — just the live ticked sum", () => {
  const s = { ...counterOf("t1"), since: "created", legacy: 4 };
  const completions = [lvl(20, 3), lvl(21, 3)]; // history + legacy both irrelevant in "now" mode
  assert.equal(computeCounter(s, new Map([["t1", 2]]), { completions, now }).count, 2); // live only
});
