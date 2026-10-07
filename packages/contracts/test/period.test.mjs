import assert from "node:assert/strict";
import { test } from "node:test";
import { dayKeyFor, weekKeyFor, windDownState, DEFAULT_SETTINGS } from "../dist/period.js";
import { computeStreak } from "../dist/streak.js";

// Israel is UTC+3 in Sept 2026 (DST). 22:00Z on the 23rd = 01:00 local on the 24th.
const S = DEFAULT_SETTINGS; // tz Asia/Jerusalem, dayStart 0, weekStart Sun(0) 00:01

test("day key is the local civil date at default (midnight) boundary", () => {
  assert.equal(dayKeyFor("2026-09-23T22:00:00.000Z", S), "2026-09-24"); // 01:00 local = the 24th
  assert.equal(dayKeyFor("2026-09-23T07:00:00.000Z", S), "2026-09-23"); // 10:00 local = the 23rd
});

test("a 4am day-start pushes early-morning hours back to the previous day", () => {
  const s = { ...S, dayStartMinutes: 240 }; // day starts 04:00 local
  // 02:00 local on the 24th (23:00Z the 23rd) is before 04:00 → still the 23rd.
  assert.equal(dayKeyFor("2026-09-23T23:00:00.000Z", s), "2026-09-23");
  // 10:00 local on the 24th is after 04:00 → the 24th.
  assert.equal(dayKeyFor("2026-09-24T07:00:00.000Z", s), "2026-09-24");
});

test("week key anchors to the configured start weekday", () => {
  // 2026-09-23 is a Wednesday; the Sunday that opens its week (the default) is 2026-09-20.
  assert.equal(weekKeyFor("2026-09-23T07:00:00.000Z", S), "2026-09-20");
  // 2026-09-20 (the Sunday itself) anchors to itself; the Saturday before still belongs to the week before.
  assert.equal(weekKeyFor("2026-09-20T07:00:00.000Z", S), "2026-09-20");
  assert.equal(weekKeyFor("2026-09-19T07:00:00.000Z", S), "2026-09-13");
  // A week set to start on Saturday anchors there instead.
  const sat = { ...S, weekStartDay: 6 };
  assert.equal(weekKeyFor("2026-09-23T07:00:00.000Z", sat), "2026-09-19");
  assert.equal(weekKeyFor("2026-09-19T07:00:00.000Z", sat), "2026-09-19");
});

// --- wind-down nudge timing curve (Israel is UTC+3 in Sept 2026, so local = UTC+3) ---
test("windDownState: idle before the lead window, ramping inside it, takeover at/after target", () => {
  const wd = {
    ...S,
    windDown: {
      enabled: true,
      targetMinutes: 21 * 60,
      message: "",
      displayTriggers: [{ kind: "before", minutes: 45 }],
    },
  };
  // Window opens at 20:15 local. 19:00 local (16:00Z) is well before it → idle.
  assert.equal(windDownState("2026-09-23T16:00:00.000Z", wd).phase, "idle");
  // 20:30 local (17:30Z): 15 min into a 45-min window → ramp at one third.
  const ramp = windDownState("2026-09-23T17:30:00.000Z", wd);
  assert.equal(ramp.phase, "ramp");
  assert.ok(Math.abs(ramp.progress - 1 / 3) < 1e-9);
  assert.equal(ramp.minutesToTarget, 30);
  // 21:05 local (18:05Z): past the target → full takeover, progress pinned at 1.
  const over = windDownState("2026-09-23T18:05:00.000Z", wd);
  assert.equal(over.phase, "takeover");
  assert.equal(over.progress, 1);
});

// --- streak integration: settled snapshots + "count from all time" ---
const now = new Date("2026-09-23T07:00:00.000Z");
const daily = (extra) => ({
  type: "daily",
  mode: "all",
  matcher: { kind: "tasks", conditions: [{ taskId: "t1", required: 1 }] },
  ...extra,
});
const at = (day) => ({ taskId: "t1", occurredAt: `2026-09-${String(day).padStart(2, "0")}T07:00:00.000Z` });

test("a settled period's snapshot overrides raw history (unchecked-before-close doesn't count)", () => {
  // Raw log says the 22nd was checked, but its close snapshot froze level 0 (it was unchecked before
  // close). With settled applied, the 22nd doesn't count — so the run is only the 23rd (today, lit).
  const settled = new Map([["2026-09-22", new Map([["t1", 0]])]]);
  const r = computeStreak([at(22), at(23)], daily(), now, new Map(), S.timeZone, { settings: S, settled });
  assert.equal(r.count, 1);
  assert.equal(r.active, true);
});

test("since:'all' ignores the createdAt window; 'created' honours it", () => {
  const created = daily({ createdAt: at(22).occurredAt, since: "created" });
  const all = daily({ createdAt: at(22).occurredAt, since: "all" });
  const comps = [at(21), at(22), at(23)];
  assert.equal(computeStreak(comps, created, now, new Map(), S.timeZone, { settings: S }).count, 2); // 22,23
  assert.equal(computeStreak(comps, all, now, new Map(), S.timeZone, { settings: S }).count, 3); // 21,22,23
});
