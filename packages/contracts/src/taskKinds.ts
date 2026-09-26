import type { Task, TaskType } from "./domain.js";

// One behaviour per task type, so no consumer ever branches on `task.type` itself — they read
// through `behaviorOf(task)`. Adding a task type means adding one entry to TASK_BEHAVIORS; the row
// render, the running total, the sort orders and the streak counting all pick it up for free.
//
// The model every type shares is "a row of boxes": `boxes` of them, `filled` currently ticked, and
// a point `valueAt(filled)`. A plain checkbox is just the one-box case — and in fact a checkbox and a
// multi-box "count N times" task are the SAME type: a checkbox with an optional `count` (default 1).
// A 1-box checkbox keeps its native `<input>` + `done` toggle; only count>1 renders as boxes and
// stores its filled level in `progress` — hence `rendersAsBoxes`/`patchForLevel` take the task, not a
// constant. Points live here (a shared contract) because the server is the sole authority on scoring —
// the projection and the web counter must agree by construction, so they compute from the same functions.

/** The task-field change that sets a row's filled level — the one place level maps to storage. */
export type LevelPatch = { done?: boolean; activeTier?: number | null; progress?: number };

export interface TaskBehavior {
  /** Total boxes the row shows. */
  boxes(task: Task): number;
  /** How many are ticked right now. */
  filled(task: Task): number;
  /** Point value when exactly `filled` boxes are ticked. Frozen per completion on the server. */
  valueAt(task: Task, filled: number): number;
  /** Highest value this task can reach — used to sort by points. */
  maxValue(task: Task): number;
  /** Counts as "done" for sorting (a checkbox/tier once ticked; a count only when every box is). */
  isDone(task: Task): boolean;
  /** The `%` values shown in the row's [ ] bracket (one per distinct box value). */
  percents(task: Task): number[];
  /** Target filled level when box `i` (0-based) is clicked — encodes each type's toggle rule. */
  levelOnClick(task: Task, i: number): number;
  /** The task-field patch that sets the filled level to `level` (the level→storage mapping). */
  patchForLevel(task: Task, level: number): LevelPatch;
  /** Whether an editable amount (box count) is meaningful for this type. */
  readonly supportsQuantity: boolean;
  /** How the row's column-1 control renders: a single native checkbox, a strip of boxes
   *  (count>1/tiered), or a single count-bearing box that increments infinitely (repeatable). */
  renderKind(task: Task): "checkbox" | "boxes" | "counter";
  /** Whether `filled` has no upper bound (repeatable) — it just keeps climbing per completion. */
  readonly unbounded: boolean;
  /** Whether the row carries the elapsed-time timer that auto-advances the level (tiered only). */
  readonly supportsTimer: boolean;
}

// count>1 ⇒ a row of `progress`-driven boxes; count≤1 ⇒ a plain `done` checkbox. `filled` reads
// whichever storage the current shape uses; the click/patch helpers mirror that split so a 1-box task
// keeps emitting TaskCompleted (its history is unchanged) while a multi-box one uses TaskProgressSet.
const isMultiBox = (t: Task) => (t.count ?? 1) > 1;
const filledOf = (t: Task) => (isMultiBox(t) ? t.progress ?? 0 : t.done ? 1 : 0);

const checkbox: TaskBehavior = {
  boxes: (t) => t.count ?? 1,
  filled: filledOf,
  // Uniform boxes: each ticked box is worth `points`, so the value is simply points × filled.
  valueAt: (t, filled) => (t.points ?? 0) * filled,
  maxValue: (t) => (t.points ?? 0) * (t.count ?? 1),
  isDone: (t) => (isMultiBox(t) ? (t.progress ?? 0) >= (t.count ?? 1) : t.done),
  percents: (t) => [t.points ?? 0],
  // Clicking the topmost ticked box unticks just it; clicking any other fills up to it. Collapses to
  // the plain toggle at count 1 (box 0: done⇄undone).
  levelOnClick: (t, i) => (filledOf(t) === i + 1 ? i : i + 1),
  patchForLevel: (t, level) => (isMultiBox(t) ? { progress: level } : { done: level >= 1 }),
  supportsQuantity: true,
  renderKind: (t) => (isMultiBox(t) ? "boxes" : "checkbox"),
  unbounded: false,
  supportsTimer: false,
};

const tiered: TaskBehavior = {
  boxes: (t) => t.tiers?.length ?? 0,
  filled: (t) => (t.activeTier != null ? t.activeTier + 1 : 0),
  valueAt: (t, filled) => (filled >= 1 ? t.tiers?.[filled - 1]?.points ?? 0 : 0),
  maxValue: (t) => t.tiers?.reduce((max, tier) => Math.max(max, tier.points), 0) ?? 0,
  isDone: (t) => t.activeTier != null,
  percents: (t) => t.tiers?.map((tier) => tier.points) ?? [],
  // Clicking the active tier clears the selection; clicking any other selects it (the old dot rule).
  levelOnClick: (t, i) => ((t.activeTier != null ? t.activeTier + 1 : 0) === i + 1 ? 0 : i + 1),
  patchForLevel: (_t, level) => ({ activeTier: level === 0 ? null : level - 1 }),
  supportsQuantity: false,
  renderKind: () => "boxes",
  unbounded: false,
  supportsTimer: true,
};

// A single box you tick again and again — the whiteboard tally. Its completion count lives in
// `progress` and each increment is worth `points`. Left-click adds one; right-clicking the box
// removes one (correcting a mis-click is a gesture now, not an edit field). An optional `count` caps
// how many times it may be completed — absent ≡ no ceiling (climbs forever, never "done"); set ≡
// stops at `count` and counts as done once reached.
const repeatable: TaskBehavior = {
  boxes: () => 1,
  filled: (t) => t.progress ?? 0,
  valueAt: (t, filled) => (t.points ?? 0) * filled,
  maxValue: (t) => (t.points ?? 0) * (t.count ?? 1),
  isDone: (t) => (t.count != null ? (t.progress ?? 0) >= t.count : false),
  percents: (t) => [t.points ?? 0],
  levelOnClick: (t) => Math.min((t.progress ?? 0) + 1, t.count ?? Infinity),
  patchForLevel: (_t, level) => ({ progress: level }),
  supportsQuantity: false,
  renderKind: () => "counter",
  unbounded: true,
  supportsTimer: false,
};

const TASK_BEHAVIORS: Record<TaskType, TaskBehavior> = { checkbox, tiered, repeatable };

export function behaviorOf(task: Task): TaskBehavior {
  return TASK_BEHAVIORS[task.type];
}

/** Live point contribution of a task to the running total. */
export function taskPointValue(task: Task): number {
  const b = behaviorOf(task);
  return b.valueAt(task, b.filled(task));
}
