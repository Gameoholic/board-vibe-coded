import { PRIORITY_LOOKS } from "./taskPriority";
import { canPrioritise, PRIORITIES, priorityOf } from "./types";
import type { Task } from "./types";

// How many tasks a tab lists, under its title (Display → Task count): by priority where its tasks have
// more than one ("3 high · 4 medium · 7 low", each number in its priority's colour), else just how many.

export default function TaskCount({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return null;
  const byPriority = PRIORITIES.map((priority) => ({
    priority,
    count: tasks.filter((t) => canPrioritise(t) && priorityOf(t) === priority).length,
  })).filter((p) => p.count > 0);
  // One priority (or none that take one) is no breakdown at all.
  const split = byPriority.length > 1 && tasks.every(canPrioritise);
  return (
    <p className="task-count">
      {split ? (
        byPriority.map(({ priority, count }) => (
          <span key={priority} className="task-count-part" style={{ "--c": PRIORITY_LOOKS[priority].color } as React.CSSProperties}>
            <b>{count}</b> {PRIORITY_LOOKS[priority].label.toLowerCase()}
          </span>
        ))
      ) : (
        <span>
          {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </span>
      )}
    </p>
  );
}
