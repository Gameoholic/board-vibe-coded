import type { RowAction } from "./ActionMenu";
import { BacklogIcon, BlockedIcon, InProgressIcon } from "./Icons";
import { dayKeyFor, statusOf } from "./types";
import type { Settings, Task, TaskStatus } from "./types";

// Status as the owner sees it: each band's words and icon (display strings — the ids live in the
// contract), in the order the bands stack in a tab, and the small rules a tab reads. One home, so
// retuning any of it is one edit.

type IconComponent = (props: { size?: number }) => React.ReactElement;

export const STATUS_BANDS: { status: TaskStatus; label: string; icon: IconComponent }[] = [
  { status: "in-progress", label: "In progress", icon: InProgressIcon },
  { status: "backlog", label: "Backlog", icon: BacklogIcon },
  { status: "blocked", label: "Blocked", icon: BlockedIcon },
];

export const statusLabel = (status: TaskStatus): string => STATUS_BANDS.find((b) => b.status === status)!.label;

// The Status choices' caption in the actions menu.
const STATUS_SET = "Status";

// More tasks than this in progress gets a gentle "finish or park one?" — a nudge, never a block.
export const IN_PROGRESS_NUDGE_ABOVE = 3;

// How long a task has been in hand, counted in the board's days ("in hand 3 d") — so a stalled one stands
// out. Nothing on the day it started: its band already says it's in progress.
export function inHandLabel(since: string, now: string, settings: Settings): string | null {
  const days = Math.round((Date.parse(dayKeyFor(now, settings)) - Date.parse(dayKeyFor(since, settings))) / 86_400_000);
  return days <= 0 ? null : `in hand ${days} d`;
}

// The Status choices in a task's actions menu — one set, captioned "Status" — the current one ticked. Blocked asks why (`onBlock` opens
// that form), so it reads "Blocked…" — and picking it again on a blocked task edits the reason. `leaving` is
// what moving it out of In progress costs (a thaw bonus taken back), said on the choices that do.
export function statusActions(task: Task, onSet: (status: TaskStatus) => void, onBlock: () => void, leaving?: string): RowAction[] {
  const current = statusOf(task);
  return STATUS_BANDS.map(({ status, label, icon }) => ({
    key: `status-${status}`,
    label: status === "blocked" ? `${label}…` : label,
    icon,
    checked: status === current,
    set: STATUS_SET,
    ...(leaving && current === "in-progress" && status !== "in-progress" ? { warning: leaving } : {}),
    onSelect: () => (status === "blocked" ? onBlock() : onSet(status)),
  }));
}

// A piece sits under its task, not in a band of its own, so the one Status it takes is Blocked (its task
// shows the mark) — "Blocked…" to say why, and "Unblock" once it is.
export function pieceStatusActions(task: Task, onBlock: () => void, onUnblock: () => void): RowAction[] {
  const blocked = statusOf(task) === "blocked";
  return [
    { key: "status-blocked", label: "Blocked…", icon: BlockedIcon, ...(blocked ? { checked: true } : {}), set: STATUS_SET, onSelect: onBlock },
    ...(blocked ? [{ key: "unblock", label: "Unblock", icon: BacklogIcon, set: STATUS_SET, onSelect: onUnblock }] : []),
  ];
}
