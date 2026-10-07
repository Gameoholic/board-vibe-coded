import type { Task, TaskPriority } from "./domain.js";
import { behaviorOf } from "./taskKinds.js";

// A task's priority — how much it matters among its tab's tasks (see domain TaskPriority). The server
// stores it and the web colours and sorts by it, both through these.

/** The priorities, highest first — the order a priority sort lists them in. */
export const PRIORITIES: readonly TaskPriority[] = ["high", "medium", "low"];

/** What a task has until it's given one. */
export const DEFAULT_PRIORITY: TaskPriority = "low";

/** A task's priority: Low when it was never given one. */
export function priorityOf(task: Pick<Task, "priority">): TaskPriority {
  return task.priority ?? DEFAULT_PRIORITY;
}

/** Whether a task takes a priority: a type that does (a to-do — see TaskBehavior.takesPriority), and a task
 *  of its tab's own list — a piece is as pressing as the task it sits in. */
export function canPrioritise(task: Task): boolean {
  return behaviorOf(task).takesPriority && !task.parentId;
}
