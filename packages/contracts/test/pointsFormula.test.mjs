import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_POINTS_FORMULA,
  effortMultOf,
  effortRank,
  legacyEffortId,
  PointsFormula,
  pointsFromMinutes,
  resolvePointsSource,
} from "../dist/pointsFormula.js";

const F = DEFAULT_POINTS_FORMULA; // 2.5%/hr, [Casual ×0.75, Normal ×1, Ugh ×1.5, Dread ×2.5]

test("pointsFromMinutes matches the builder rate (thousandths, 2-dec rounded)", () => {
  assert.equal(pointsFromMinutes(30, 1, F), 1250); // 30m → 1.25%
  assert.equal(pointsFromMinutes(60, 1, F), 2500); // 1h → 2.5%
  assert.equal(pointsFromMinutes(15, 1, F), 630); // 15m → 0.625 → 0.63%
  assert.equal(pointsFromMinutes(60, 1.5, F), 3750); // 1h Ugh → 3.75%
});

test("effortMultOf reads a level by id: absent is the default level, an unknown id is ×1", () => {
  assert.equal(effortMultOf(F, undefined), 1);
  assert.equal(effortMultOf(F, "casual"), 0.75);
  assert.equal(effortMultOf(F, "grind"), 1.5);
  assert.equal(effortMultOf(F, "dread"), 2.5);
  assert.equal(effortMultOf(F, "nope"), 1);
  // Absent follows the default level's multiplier, not a fixed 1.
  const tuned = { ...F, effortLevels: F.effortLevels.map((l) => (l.id === "normal" ? { ...l, mult: 1.2 } : l)) };
  assert.equal(effortMultOf(tuned, undefined), 1.2);
});

test("effortRank is a level's place on the scale, lightest first", () => {
  assert.deepEqual(["casual", undefined, "grind", "dread", "nope"].map((id) => effortRank(F, id)), [0, 1, 2, 3, -1]);
});

test("a pre-id formula becomes the four levels, each old multiplier kept on the level it became", () => {
  const legacy = PointsFormula.parse({ ratePercentPerHour: 3, effortLevels: [{ label: "Normal", mult: 1 }, { label: "Challenging", mult: 1.3 }] });
  assert.equal(legacy.ratePercentPerHour, 3);
  assert.deepEqual(legacy.effortLevels, [
    { id: "casual", label: "Casual", mult: 0.75 },
    { id: "normal", label: "Normal", mult: 1 },
    { id: "grind", label: "Ugh", mult: 1.3 },
    { id: "dread", label: "Dread", mult: 2.5 },
  ]);
  // An old index means the level it became; no index is the default level.
  assert.deepEqual([0, 1, 7, undefined, null].map(legacyEffortId), ["normal", "grind", undefined, undefined, undefined]);
  // A formula that has ids parses as it is.
  assert.deepEqual(PointsFormula.parse(F), F);
  assert.throws(() => PointsFormula.parse({ effortLevels: [{ id: "a", label: "A", mult: 1 }, { id: "a", label: "B", mult: 2 }] }));
});

test("a doubled rate doubles the computed points", () => {
  const F2 = { ...F, ratePercentPerHour: 5 };
  assert.equal(pointsFromMinutes(30, 1, F2), 2500); // 30m → 2.5% at 5%/hr
});

test("resolvePointsSource: stored flag wins; else derive vs historic formula", () => {
  // Explicit stored flag is returned untouched (never re-derived).
  assert.equal(resolvePointsSource("manual", 30, 1250, undefined, F), "manual");
  assert.equal(resolvePointsSource("builder", 30, 999, undefined, F), "builder");
  // Absent + no estimate → manual.
  assert.equal(resolvePointsSource(undefined, undefined, 1250, undefined), "manual");
  // Absent + % matches the builder at the historic rate → builder.
  assert.equal(resolvePointsSource(undefined, 30, 1250, "normal"), "builder");
  assert.equal(resolvePointsSource(undefined, 60, 3750, "grind"), "builder"); // the old harder level, ×1.5
  // Absent + % overridden (doesn't match) → manual.
  assert.equal(resolvePointsSource(undefined, 30, 2000, undefined), "manual");
});
