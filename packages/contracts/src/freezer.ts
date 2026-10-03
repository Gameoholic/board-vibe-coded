import type { Section, Task, TaskStatus } from "./domain.js";
import { dayKeyFor, type Settings, weekKeyFor } from "./period.js";
import { behaviorOf } from "./taskKinds.js";
import { statusOf } from "./taskStatus.js";

// The Freezer: a tab of tasks left waiting. A week close freezes a task that's waited in its tab's Backlog
// longer than Settings allow; on ice it gathers frost — a share of its own points for each day there, banked
// at each week's end, up to a cap — and a task whose frost is full is Subzero. Thawing it starts it again in
// its tab. These are the shared rules: the server folds them and the web reads them, so both agree.

const DAY_MS = 86_400_000;

/** How long a task has waited, in ms: in the Freezer, the Backlog, and while Blocked. In progress pauses the
 *  count (it carries on from there afterwards); freezing or thawing starts it again from nothing. */
export function waitedMs(task: Pick<Task, "waitMs" | "waitingSince">, now: string): number {
  const running = task.waitingSince ? Math.max(0, Date.parse(now) - Date.parse(task.waitingSince)) : 0;
  return (task.waitMs ?? 0) + running;
}

/** The whole days of that wait — a task's age, as its Age chip shows it. */
export function waitDays(task: Pick<Task, "waitMs" | "waitingSince">, now: string): number {
  return Math.floor(waitedMs(task, now) / DAY_MS);
}

/** The wait across a status change: going In progress pauses it (keeping the stretch so far), leaving In
 *  progress starts the next stretch. Any other move leaves it running. */
export function waitAcross(
  task: Pick<Task, "waitMs" | "waitingSince">,
  was: TaskStatus,
  next: TaskStatus,
  at: string,
): Pick<Task, "waitMs" | "waitingSince"> {
  if (was !== "in-progress" && next === "in-progress") {
    const stretch = task.waitingSince ? Math.max(0, Date.parse(at) - Date.parse(task.waitingSince)) : 0;
    return { waitMs: (task.waitMs ?? 0) + stretch, waitingSince: undefined };
  }
  if (was === "in-progress" && next !== "in-progress") return { waitMs: task.waitMs ?? 0, waitingSince: at };
  return { waitMs: task.waitMs, waitingSince: task.waitingSince };
}

/** Whole days from `since` to `now`. */
export function daysSince(since: string, now: string): number {
  return Math.max(0, Math.floor((Date.parse(now) - Date.parse(since)) / DAY_MS));
}

/** The share of its own points a task's frost adds (0.4 ≡ +40%): its banked days on ice × the weekly rate
 *  ÷ 7, capped. A share of its *own* points only, so frost never compounds with a Bounty or itself. */
export function frostShare(task: Pick<Task, "frostDays">, settings: Settings): number {
  const { frostPerWeek, frostCap } = settings.freezer;
  return Math.min(((task.frostDays ?? 0) * frostPerWeek) / 7, frostCap) / 100;
}

/** Whether a task's frost has reached the cap — it's Subzero. */
export function isFullFrost(task: Pick<Task, "frostDays">, settings: Settings): boolean {
  const { frostPerWeek, frostCap } = settings.freezer;
  return (task.frostDays ?? 0) > 0 && ((task.frostDays ?? 0) * frostPerWeek) / 7 >= frostCap;
}

/** How full a task's frost is, 0 to 1 — what its frost bar shows, and how big its effects are. */
export function frostFill(task: Pick<Task, "frostDays">, settings: Settings): number {
  return Math.min(1, (frostShare(task, settings) * 100) / settings.freezer.frostCap);
}

/** The tab that is `sectionId`'s Freezer, if it has one. */
export function freezerOf<S extends Pick<Section, "id" | "freezerFor">>(sections: S[], sectionId: string): S | undefined {
  return sections.find((s) => s.freezerFor === sectionId);
}

/** Why a task can't be frozen by hand right now — null when it can. (Its tab having a Freezer is the
 *  caller's to check.) A piece goes with its task; a Bounty stays where it's being chased; a blocked one
 *  is waiting on something, not being avoided. */
export function freezeRefusal(task: Task): string | null {
  if (task.parentId) return "A piece goes with its task";
  if (task.bounty) return "A Bounty can't be frozen";
  if (statusOf(task) === "blocked") return "Blocked tasks can't be frozen";
  if (behaviorOf(task).isDone(task)) return "It's already done";
  return null;
}

/** Whether a week close at `now` freezes `task` (in a tab with a Freezer): it's in the Backlog — not In
 *  progress or Blocked — not the Bounty, and has waited longer than Settings allow. */
export function freezesAtWeekEnd(task: Task, now: string, settings: Settings): boolean {
  return (
    !task.parentId &&
    !task.bounty &&
    !behaviorOf(task).isDone(task) &&
    statusOf(task) === "backlog" &&
    waitDays(task, now) > settings.freezer.freezeAfterDays
  );
}

/** Whole days left in the week `now` falls in, counting today — what a task still waits before the close. */
export function daysLeftInWeek(now: string, settings: Settings): number {
  const into = Math.round((Date.parse(dayKeyFor(now, settings)) - Date.parse(weekKeyFor(now, settings))) / DAY_MS);
  return Math.max(1, 7 - into);
}

/** Whether the coming week close will freeze `task` if it stays as it is — said beside it beforehand. */
export function willFreezeAtWeekEnd(task: Task, now: string, settings: Settings): boolean {
  const close = new Date(Date.parse(now) + daysLeftInWeek(now, settings) * DAY_MS).toISOString();
  return freezesAtWeekEnd(task, close, settings);
}
