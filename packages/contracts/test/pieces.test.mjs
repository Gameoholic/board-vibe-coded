import assert from "node:assert/strict";
import { test } from "node:test";
import { canBreakDown, doneFromPieces, newPiecePoints, splitPoints } from "../dist/pieces.js";

const sum = (values) => values.reduce((a, b) => a + b, 0);

test("a split lands on hundredths and always adds up to the whole", () => {
  assert.deepEqual(splitPoints(3000, 4), [750, 750, 750, 750]);
  assert.deepEqual(splitPoints(1000, 3), [340, 330, 330]);
  assert.deepEqual(splitPoints(20, 3), [10, 10, 0]);
  // A value typed to the thousandth splits in thousandths.
  assert.deepEqual(splitPoints(1001, 2), [501, 500]);
  for (const [total, n] of [[1250, 7], [10, 4], [99_990, 13], [7, 3]]) assert.equal(sum(splitPoints(total, n)), total);
});

test("new pieces split the task's own points, or add an average piece once those are gone", () => {
  assert.deepEqual(newPiecePoints({ points: 900 }, [], 3), [300, 300, 300]);
  // Points left on a task that already has pieces are split across the new ones.
  assert.deepEqual(newPiecePoints({ points: 200 }, [{ points: 500 }], 2), [100, 100]);
  assert.deepEqual(newPiecePoints({ points: 0 }, [{ points: 340 }, { points: 330 }, { points: 330 }], 2), [330, 330]);
  assert.deepEqual(newPiecePoints({ points: 0 }, [{ points: 4 }, { points: 3 }], 1), [4]);
  assert.deepEqual(newPiecePoints({ points: 0 }, [], 2), [0, 0]);
});

test("only a type that breaks down, and never a piece, can be broken down; it's done once every piece is", () => {
  assert.equal(canBreakDown({ type: "once" }), true);
  assert.equal(canBreakDown({ type: "once", parentId: "p" }), false);
  assert.equal(canBreakDown({ type: "checkbox" }), false);
  const piece = (done) => ({ type: "once", done });
  assert.equal(doneFromPieces([]), null);
  assert.equal(doneFromPieces([piece(true), piece(false)]), false);
  assert.equal(doneFromPieces([piece(true), piece(true)]), true);
});
