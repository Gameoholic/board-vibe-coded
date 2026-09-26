import assert from "node:assert/strict";
import { test } from "node:test";
import { boxScheduleLabel, DEFAULT_SETTINGS, isBoxLocked } from "../dist/period.js";

// Asia/Jerusalem, Sept 2026 is DST (+3), so 07:00Z == 10:00 local. 2026-09-25 is a Friday.
const now = "2026-09-25T07:00:00.000Z"; // Friday 10:00 local
const s = DEFAULT_SETTINGS; // weekStartDay 0 (Sun)

test("daily gate: locked before its time, open at/after", () => {
  assert.equal(isBoxLocked({ minutes: 660 }, now, s), true); // 11:00 — not yet
  assert.equal(isBoxLocked({ minutes: 600 }, now, s), false); // 10:00 — exactly now
  assert.equal(isBoxLocked({ minutes: 540 }, now, s), false); // 09:00 — passed
});

test("weekly gate: same day gated by time", () => {
  assert.equal(isBoxLocked({ minutes: 660, dayOfWeek: 5 }, now, s), true); // Fri 11:00
  assert.equal(isBoxLocked({ minutes: 540, dayOfWeek: 5 }, now, s), false); // Fri 09:00
});

test("weekly gate: teeth plates — Fri box open, Sat box still locked", () => {
  assert.equal(isBoxLocked({ minutes: 600, dayOfWeek: 5 }, now, s), false); // Friday box
  assert.equal(isBoxLocked({ minutes: 600, dayOfWeek: 6 }, now, s), true); // Saturday box
});

test("weekly gate: an earlier weekday this week is already open", () => {
  assert.equal(isBoxLocked({ minutes: 600, dayOfWeek: 4 }, now, s), false); // Thursday passed
});

test("weekly gate with no time: open all of its day, still gated on later days", () => {
  assert.equal(isBoxLocked({ dayOfWeek: 5 }, now, s), false); // Friday — open any time today
  assert.equal(isBoxLocked({ dayOfWeek: 6 }, now, s), true); // Saturday — not yet
  assert.equal(isBoxLocked({ dayOfWeek: 4 }, now, s), false); // Thursday passed
});

test("labels read as time (daily), weekday+time, or weekday only (any time)", () => {
  assert.equal(boxScheduleLabel({ minutes: 600 }), "10:00");
  assert.equal(boxScheduleLabel({ minutes: 605, dayOfWeek: 5 }), "Friday 10:05");
  assert.equal(boxScheduleLabel({ dayOfWeek: 5 }), "Friday");
});
