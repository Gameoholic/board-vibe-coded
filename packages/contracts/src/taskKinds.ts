import type { Section, Task, TaskType } from "./domain.js";
import { boosted } from "./points.js";

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
  /** Whether a finished task leaves its list (one-time tasks: done means gone). It stays in the
   *  board's state — still done, still worth its points — it just isn't listed any more. */
  readonly retiresWhenDone: boolean;
  /** Whether a task of this type can be pruned — skipped until its tab's next day/week. The other half
   *  of the rule is the tab: it must recur (see canPrune). */
  readonly prunable: boolean;
  /** Whether a task of this type can be broken down into pieces (see pieces.ts). Its pieces are tasks of
   *  the same type, so a type that breaks down is also one a piece can be. */
  readonly breaksDown: boolean;
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
  retiresWhenDone: false,
  prunable: true,
  breaksDown: false,
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
  retiresWhenDone: false,
  prunable: false,
  breaksDown: false,
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
  retiresWhenDone: false,
  prunable: false,
  breaksDown: false,
};

// A single "do it once" checkbox — the Tasks tab's kind: check it and it's gone. Scores exactly like
// a 1-box checkbox (same native toggle); it differs in two ways: no box count or scheduled times
// (`supportsQuantity: false` — neither means anything for a one-off), and a finished one leaves its
// list (`retiresWhenDone`) instead of sitting there hatched like a daily task waiting for tomorrow. A
// one-off that turns out bigger than it looked can be broken down into pieces (`breaksDown`).
const once: TaskBehavior = { ...checkbox, supportsQuantity: false, retiresWhenDone: true, prunable: false, breaksDown: true };

const TASK_BEHAVIORS: Record<TaskType, TaskBehavior> = { checkbox, tiered, repeatable, once };

export function behaviorOf(task: Task): TaskBehavior {
  return TASK_BEHAVIORS[task.type];
}

/** A finished task of a type that leaves its list once done (one-time tasks) — hidden, not deleted. */
export function isRetired(task: Task): boolean {
  const b = behaviorOf(task);
  return b.retiresWhenDone && b.isDone(task);
}

/** Whether a task can be pruned where it lives: a prunable type in a tab that recurs (a `period`), so
 *  there's a next day/week for it to come back in. The one rule — server and client both read it. */
export function canPrune(task: Task, section: Pick<Section, "period">): boolean {
  return behaviorOf(task).prunable && section.period != null;
}

/** A type's behaviour before any task of it exists — for config-level questions (what a tab offers). */
export function behaviorOfType(type: TaskType): TaskBehavior {
  return TASK_BEHAVIORS[type];
}

/** Live point contribution of a task to the running total — at the factor its completion was paid at
 *  (`boost`, frozen when it was ticked: a Bounty's ×2 stays after the Bounty ends). */
export function taskPointValue(task: Task): number {
  const b = behaviorOf(task);
  return boosted(b.valueAt(task, b.filled(task)), task.boost ?? 1);
}
