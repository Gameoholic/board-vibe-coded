import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPercent, formatPercentFixed, percentDecimals } from "../dist/points.js";

// Points are kept in thousandths of a percent, but a % never shows more than two decimals: the display rounds
// (half-up) to hundredths and trims, and the counter's count-up lands on exactly those digits.
test("a % shows at most two decimals, rounded half-up and trimmed", () => {
  const cases = [[0, "0%"], [80, "0.08%"], [500, "0.5%"], [1646, "1.65%"], [1005, "1.01%"], [1004, "1%"], [10000, "10%"], [99995, "100%"], [4, "0%"], [-1646, "-1.65%"], [-4, "0%"]];
  for (const [thousandths, shown] of cases) assert.equal(formatPercent(thousandths), shown, `${thousandths}`);
});

test("the count-up lands on the same digits", () => {
  for (const thousandths of [0, 80, 500, 1646, 1005, 2500, 99995, -1646]) {
    assert.equal(formatPercentFixed(thousandths, percentDecimals(thousandths)), formatPercent(thousandths), `${thousandths}`);
  }
  assert.equal(percentDecimals(1646), 2);
  assert.equal(percentDecimals(2500), 1);
  assert.equal(percentDecimals(1004), 0);
});
