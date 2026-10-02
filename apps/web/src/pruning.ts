import { behaviorOf, type SectionPeriod, type StreakView, type Task } from "./types";

// What the row menu's Prune says: when the task comes back, and which streaks pruning it would cost.

export const pruneUntil = (period: SectionPeriod): string => (period === "week" ? "next week" : "tomorrow");

// The streaks that need this task in the stretch it would be hidden for, so pruning it breaks them: a
// daily/weekly streak whose condition on it isn't met yet and can't be met another way (it requires
// every condition, or this is its only one). A weekly streak on a daily task is left out — the task is
// back tomorrow, with the rest of the week still to meet it. Counters never break.
export function streaksBrokenByPruning(task: Task, period: SectionPeriod, streaks: StreakView[]): StreakView[] {
  const b = behaviorOf(task);
  return streaks.filter((s) => {
    if (s.type === "counter" || s.matcher.kind !== "tasks") return false;
    if (s.type === "weekly" && period === "day") return false;
    const condition = s.matcher.conditions.find((c) => c.taskId === task.id);
    if (!condition) return false;
    const required = condition.required === "all" ? b.boxes(task) : condition.required;
    if (b.filled(task) >= required) return false;
    return s.mode === "all" || s.matcher.conditions.length === 1;
  });
}
