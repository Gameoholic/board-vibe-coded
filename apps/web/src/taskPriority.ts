import type { RowAction } from "./ActionMenu";
import { PriorityHighIcon, PriorityLowIcon, PriorityMediumIcon } from "./Icons";
import { PRIORITIES, priorityOf } from "./types";
import type { Task, TaskPriority } from "./types";

// Priority as the owner sees it: each one's word, its arrows and its colour (display — the ids live in the
// contract), and the small rules a row reads. One home, so retuning any of it is one edit.

type IconComponent = (props: { size?: number }) => React.ReactElement;

interface PriorityLook {
  label: string;
  // Its arrows, in its colour: three for High, two for Medium, one for Low.
  icon: IconComponent;
  // A theme token (theme.css), so every theme has it.
  color: string;
  // Whether a row of this priority wears its colour. Low is what every task starts as, so colouring it
  // would colour most of a tab.
  onRow: boolean;
}

export const PRIORITY_LOOKS: Record<TaskPriority, PriorityLook> = {
  high: { label: "High", icon: PriorityHighIcon, color: "var(--pri-high)", onRow: true },
  medium: { label: "Medium", icon: PriorityMediumIcon, color: "var(--pri-med)", onRow: true },
  low: { label: "Low", icon: PriorityLowIcon, color: "var(--pri-low)", onRow: false },
};

// The Priority choices' caption in the actions menu.
const PRIORITY_SET = "Priority";

/** The colour a task's row wears for its priority — none for one that isn't coloured on its row. */
export function priorityInk(task: Task): string | undefined {
  const look = PRIORITY_LOOKS[priorityOf(task)];
  return look.onRow ? look.color : undefined;
}

/** The Priority choices in a task's actions menu — one set, captioned "Priority" — the current one ticked. */
export function priorityActions(task: Task, onSet: (priority: TaskPriority) => void): RowAction[] {
  const current = priorityOf(task);
  return PRIORITIES.map((priority) => ({
    key: `priority-${priority}`,
    label: PRIORITY_LOOKS[priority].label,
    icon: PRIORITY_LOOKS[priority].icon,
    checked: priority === current,
    set: PRIORITY_SET,
    onSelect: () => onSet(priority),
  }));
}
