import type { RowAction } from "./ActionMenu";
import { PencilIcon, TrashIcon } from "./Icons";

// The actions every row kind's menu offers, built once so their label, icon and key read the same on
// tasks, streaks and rewards. A row kind adds its own (Duplicate, …) between them.

export const editAction = (onSelect: () => void): RowAction => ({
  key: "edit",
  label: "Edit…",
  icon: PencilIcon,
  shortcut: "e",
  onSelect,
});

export const deleteAction = (onSelect: () => void): RowAction => ({
  key: "delete",
  label: "Delete…",
  icon: TrashIcon,
  shortcut: "Delete",
  danger: true,
  onSelect,
});
