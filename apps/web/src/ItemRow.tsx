import { Reorder, useDragControls } from "framer-motion";
import { useState } from "react";
import ConfirmPopover from "./ConfirmPopover";
import { GroupBracketIcon, TrashIcon } from "./Icons";

// The shared base of every row in a tab's list (a task, a reward, …): a framer Reorder.Item with the
// row chrome that makes list structure work — the move handle and the group handle — so ItemList can
// reorder and group any item kind. The row kind supplies the cells; they auto-place into the list's
// column tracks (`.item-list` / `.item-row` subgrid), so rows of every kind share one layout system.

// What a row needs from its list for its position in it — handed down by ItemList per row.
export interface RowContext {
  // Manual order only: other sorts would scramble a stored order, so rows can't be dragged then.
  draggable: boolean;
  // Plural noun for this list's items ("tasks", "rewards") — handle labels and confirm copy.
  noun: string;
  // Ungrouped top-level rows only: pressing the group handle starts a range-drag that bundles a
  // contiguous run of items into a group. ItemList owns the drag.
  onGroupDragStart?: (itemId: string, e: React.PointerEvent) => void;
  // Grouped rows only: called on move-handle pointerdown so GroupBlock can register its capture-phase
  // listeners before framer's and eject the row on release.
  onDragHandleDown?: () => void;
}

export const itemMotionProps = {
  initial: { opacity: 0, scale: 0.92, y: -6 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.9, x: -16, rotate: -2 },
  transition: {
    layout: { type: "spring" as const, stiffness: 700, damping: 45 },
    default: { type: "spring" as const, stiffness: 500, damping: 34 },
  },
  whileDrag: { scale: 1.03, boxShadow: "0 12px 28px rgba(15,23,42,0.16)", zIndex: 5 },
  dragMomentum: false,
};

interface ItemRowProps<T> {
  value: T; // the framer Reorder value (the item itself)
  id: string;
  row: RowContext;
  className?: string; // the row kind's modifiers (e.g. "task-item done")
  // Extra DOM attributes a row kind needs for its own features (e.g. a task row's data-task-id, which
  // the streak pick-whip hit-tests). List mechanics use data-item-id, set here for every kind.
  attrs?: Record<string, string>;
  onContextMenu?: (e: React.MouseEvent) => void;
  // Seconds to hold the row in place before its exit animation plays — for a row leaving because it
  // was finished, so the finished state registers before it goes. Absent ≡ leave immediately.
  exitDelay?: number;
  children: React.ReactNode;
}

function ItemRow<T>({ value, id, row, className, attrs, onContextMenu, exitDelay, children }: ItemRowProps<T>) {
  const controls = useDragControls();
  const exit = exitDelay
    ? { ...itemMotionProps.exit, transition: { ...itemMotionProps.transition.default, delay: exitDelay } }
    : itemMotionProps.exit;
  return (
    <Reorder.Item
      value={value}
      dragListener={false}
      dragControls={controls}
      as="li"
      className={`item-row${className ? ` ${className}` : ""}`}
      data-item-id={id}
      {...attrs}
      onContextMenu={onContextMenu}
      {...itemMotionProps}
      exit={exit}
    >
      <span
        className={`drag-handle${row.draggable ? "" : " disabled"}`}
        onPointerDown={(e) => {
          if (!row.draggable) return;
          row.onDragHandleDown?.();
          controls.start(e);
        }}
      >
        ⠿
      </span>
      {/* Group handle: press and drag down across rows to bundle a contiguous run into a group. */}
      {row.onGroupDragStart && (
        <span
          className="group-handle"
          aria-label={`Drag to group ${row.noun}`}
          title={`Drag down to group ${row.noun}`}
          onPointerDown={(e) => row.onGroupDragStart?.(id, e)}
        >
          <GroupBracketIcon />
        </span>
      )}
      {children}
    </Reorder.Item>
  );
}

// The hover-revealed trash control at a row's end, confirmed before it fires.
export function RowRemove({ label, message, onConfirm }: { label: string; message: string; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="remove-wrap">
      <button type="button" className="remove" aria-label={label} onClick={() => setConfirming(true)}>
        <TrashIcon />
      </button>
      <ConfirmPopover open={confirming} message={message} onConfirm={onConfirm} onCancel={() => setConfirming(false)} />
    </div>
  );
}

export default ItemRow;
