import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_POINTS_FORMULA,
  effortMultOf,
  pointsFromMinutes,
  resolvePointsSource,
} from "../dist/pointsFormula.js";

const F = DEFAULT_POINTS_FORMULA; // 2.5%/hr, [Normal ×1, Challenging ×1.5]

test("pointsFromMinutes matches the builder rate (thousandths, 2-dec rounded)", () => {
  assert.equal(pointsFromMinutes(30, 1, F), 1250); // 30m → 1.25%
  assert.equal(pointsFromMinutes(60, 1, F), 2500); // 1h → 2.5%
  assert.equal(pointsFromMinutes(15, 1, F), 630); // 15m → 0.625 → 0.63%
  assert.equal(pointsFromMinutes(60, 1.5, F), 3750); // 1h Challenging → 3.75%
});

test("effortMultOf falls back to 1 for an absent / out-of-range index", () => {
  assert.equal(effortMultOf(F, undefined), 1);
  assert.equal(effortMultOf(F, 1), 1.5);
  assert.equal(effortMultOf(F, 99), 1);
});

test("a doubled rate doubles the computed points", () => {
  const F2 = { ...F, ratePercentPerHour: 5 };
  assert.equal(pointsFromMinutes(30, 1, F2), 2500); // 30m → 2.5% at 5%/hr
});

test("resolvePointsSource: stored flag wins; else derive vs historic formula", () => {
  // Explicit stored flag is returned untouched (never re-derived).
  assert.equal(resolvePointsSource("manual", 30, 1250, 0, F), "manual");
  assert.equal(resolvePointsSource("builder", 30, 999, 0, F), "builder");
  // Absent + no estimate → manual.
  assert.equal(resolvePointsSource(undefined, undefined, 1250, undefined), "manual");
  // Absent + % matches the builder at the historic rate → builder.
  assert.equal(resolvePointsSource(undefined, 30, 1250, 0), "builder");
  // Absent + % overridden (doesn't match) → manual.
  assert.equal(resolvePointsSource(undefined, 30, 2000, 0), "manual");
});
