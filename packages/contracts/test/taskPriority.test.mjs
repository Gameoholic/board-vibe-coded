import assert from "node:assert/strict";
import { test } from "node:test";
import { canPrioritise, DEFAULT_PRIORITY, PRIORITIES, priorityOf } from "../dist/taskPriority.js";
import { CreateTaskBody, PatchTaskBody } from "../dist/requests.js";

// A task's priority: which tasks take one, what one has before it's given one, and the order they list in.

test("a task never given a priority is Low", () => {
  assert.equal(DEFAULT_PRIORITY, "low");
  assert.equal(priorityOf({}), "low");
  assert.equal(priorityOf({ priority: "high" }), "high");
});

test("priorities list highest first", () => {
  assert.deepEqual(PRIORITIES, ["high", "medium", "low"]);
});

test("a to-do takes a priority; a habit and a piece don't", () => {
  assert.equal(canPrioritise({ type: "once" }), true);
  assert.equal(canPrioritise({ type: "once", parentId: "t1" }), false);
  for (const type of ["checkbox", "tiered", "repeatable"]) assert.equal(canPrioritise({ type }), false);
});

test("a task patch takes one of the three priorities, and nothing else", () => {
  assert.equal(PatchTaskBody.parse({ priority: "medium" }).priority, "medium");
  assert.throws(() => PatchTaskBody.parse({ priority: "urgent" }));
  assert.throws(() => PatchTaskBody.parse({ priority: null }));
});

test("a new task may name its priority", () => {
  const body = { sectionId: "s1", type: "once", text: "Renew passport", points: 500 };
  assert.equal(CreateTaskBody.parse({ ...body, priority: "high" }).priority, "high");
  assert.equal(CreateTaskBody.parse(body).priority, undefined);
  assert.throws(() => CreateTaskBody.parse({ ...body, priority: "urgent" }));
});
