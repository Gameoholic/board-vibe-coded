import type { Task, TaskStatus } from "./domain.js";
import { waitAcross } from "./freezer.js";

// A task's Status — which band of its tab it sits in (see domain TaskStatus). The server folds these
// rules and the web mirrors them optimistically, so both land in the same place by construction.

/** A task's Status band: the backlog when it never had one. */
export function statusOf(task: Pick<Task, "status">): TaskStatus {
  return task.status ?? "backlog";
}

/** Everything a status change touches on a task. */
export type StatusFields = Pick<Task, "status" | "statusSince" | "blocker" | "waitMs" | "waitingSince" | "thawBonus">;

/** What moving `task` to `status` sets: since when (moved only when the band really changes) and — when
 *  blocked — why, with the band it goes back to once released (kept when a blocked task's reason is
 *  re-said). An absent `blocker` in the result means it's no longer blocked. It also carries the task's
 *  wait across the move (In progress pauses it — see waitAcross), and a thaw bonus only In progress keeps:
 *  moved anywhere else, it's gone for good. */
export function statusChange(task: Task, status: TaskStatus, why: { note?: string; taskId?: string }, at: string): StatusFields {
  const was = statusOf(task);
  return {
    status,
    statusSince: status === was ? task.statusSince : at,
    blocker:
      status === "blocked"
        ? {
            ...(why.note ? { note: why.note } : {}),
            ...(why.taskId ? { taskId: why.taskId } : {}),
            resume: was === "blocked" ? (task.blocker?.resume ?? "backlog") : was,
          }
        : undefined,
    ...waitAcross(task, was, status, at),
    thawBonus: status === "in-progress" ? task.thawBonus : undefined,
  };
}

/** The change that releases a task waiting on `blockerId` back to where it was before it was blocked —
 *  applied once that task is done (or deleted). Null when the task isn't waiting on it. Released for
 *  good: a daily blocker that's unchecked again by its day's reset doesn't block it again. */
export function releasedFrom(task: Task, blockerId: string, at: string): StatusFields | null {
  if (task.blocker?.taskId !== blockerId) return null;
  const resume = task.blocker.resume;
  return { status: resume, statusSince: at, blocker: undefined, ...waitAcross(task, "blocked", resume, at), thawBonus: task.thawBonus };
}
