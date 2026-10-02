import type { Task } from "./domain.js";
import { behaviorOf, behaviorOfType } from "./taskKinds.js";

// Break down: a task that turned out bigger than it looked, split into pieces that sit inside it (one
// level deep). Each piece is a real task with its own points, so finishing one pays as you go; the task
// is done once every piece is. The server folds these rules and the web mirrors them, so both land in
// the same place by construction.

/** How many pieces one task may hold — generous, but bounded so a hostile body can't ask for thousands. */
export const PIECES_MAX = 100;

// A split lands on hundredths of a percent (the points builder's own precision), so the pieces read like
// the value they came from: 1% in three is 0.34 / 0.33 / 0.33, never 0.334.
const SPLIT_UNIT = 10;

/** Whether a task can be broken down, or take a task tucked in as a piece: its type breaks down and it
 *  isn't a piece itself — pieces go one level deep. */
export function canBreakDown(task: Pick<Task, "type" | "parentId">): boolean {
  return behaviorOfType(task.type).breaksDown && !task.parentId;
}

/** `total` split evenly across `n` pieces, the remainder going a unit each to the first ones — so the
 *  pieces always add up to exactly `total`. */
export function splitPoints(total: number, n: number): number[] {
  const unit = total % SPLIT_UNIT === 0 ? SPLIT_UNIT : 1;
  const units = total / unit;
  const base = Math.floor(units / n);
  const extra = units % n;
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) * unit);
}

/** What `n` new pieces of `task` are worth. Breaking a task down splits its own points across them, so
 *  nothing is lost or made up; once its points have all gone to pieces, a new piece is worth an average
 *  one of those already there — a piece added later adds value, because the task really did grow. */
export function newPiecePoints(task: Pick<Task, "points">, pieces: Pick<Task, "points">[], n: number): number[] {
  const own = task.points ?? 0;
  if (own > 0) return splitPoints(own, n);
  const mean = pieces.length > 0 ? pieces.reduce((sum, p) => sum + (p.points ?? 0), 0) / pieces.length : 0;
  const share = Math.round(mean / SPLIT_UNIT) * SPLIT_UNIT || Math.round(mean);
  return Array.from({ length: n }, () => share);
}

/** Whether a task with these pieces is done — once every piece is. Null when it has none: then it's a
 *  plain task, done by its own box. */
export function doneFromPieces(pieces: Task[]): boolean | null {
  return pieces.length === 0 ? null : pieces.every((p) => behaviorOf(p).isDone(p));
}

/** A task's whole worth: its own points, plus its pieces' once it's broken down — what its bracket shows,
 *  and what its frost and Subzero are on (a piece pays its task's frost as it goes; the task's own finish
 *  pays whatever a floor on the whole still asks). */
export function wholeWorth(task: Task, pieces: readonly Task[]): number {
  return pieces.reduce((sum, p) => sum + behaviorOf(p).maxValue(p), behaviorOf(task).maxValue(task));
}
