import { Reorder, useDragControls } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import ActionMenu, { type MenuPoint, type RowAction } from "./ActionMenu";
import ConfirmPopover from "./ConfirmPopover";
import { GroupBracketIcon, TrashIcon } from "./Icons";
import Tooltip from "./Tooltip";

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
  // What the row's actions menu offers (right-click, or long-press on touch), as groups with separators
  // between them. By convention Edit comes first, so right-click → Enter edits.
  actions: RowAction[][];
  // Seconds to hold the row in place before its exit animation plays — for a row leaving because it
  // was finished, so the finished state registers before it goes. Absent ≡ leave immediately.
  exitDelay?: number;
  children: React.ReactNode;
}

// Where a right-click or a hold keeps its native meaning: inside the row's own forms (so a text field
// still gets the browser's paste menu) and on text inputs such as the inline rename.
const NATIVE_TARGETS = ".popover, .confirm-popover, textarea, input:not([type='checkbox'])";
// A hold on a drag handle is the start of a drag, not a request for the menu.
const NO_HOLD_TARGETS = `${NATIVE_TARGETS}, .drag-handle, .group-handle`;
// A row can hold rows of its own (a broken-down task's pieces): a press on one of those is that row's.
const fromNestedRow = (e: React.SyntheticEvent) => (e.target as Element).closest(".item-row") !== e.currentTarget;

// How long (ms) a touch must hold still on a row to open its menu — the touch stand-in for right-click
// (iOS never fires contextmenu), and how far (px) the finger may drift before it's a scroll instead.
const HOLD_MS = 500;
const HOLD_SLOP = 8;

function useLongPress(onHold: (at: MenuPoint) => void) {
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  // Set once a hold has opened the menu, until the next press: the lift that ends the hold would
  // otherwise land as a click on whatever is under the finger (ticking a checkbox), and Android follows
  // a hold with its own contextmenu event for a menu that's already open.
  const held = useRef(false);
  const cancel = useCallback(() => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const handlers = {
    onPointerDown(e: React.PointerEvent) {
      held.current = false;
      cancel();
      if (e.pointerType !== "touch" || (e.target as Element).closest(NO_HOLD_TARGETS) || fromNestedRow(e)) return;
      const at = { x: e.clientX, y: e.clientY };
      press.current = {
        ...at,
        timer: window.setTimeout(() => {
          press.current = null;
          held.current = true;
          onHold(at);
        }, HOLD_MS),
      };
    },
    onPointerMove(e: React.PointerEvent) {
      const p = press.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > HOLD_SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
  return { handlers, held };
}

function ItemRow<T>({ value, id, row, className, attrs, actions, exitDelay, children }: ItemRowProps<T>) {
  const controls = useDragControls();
  const rowRef = useRef<HTMLLIElement>(null);
  const [menuAt, setMenuAt] = useState<MenuPoint | null>(null);
  const closeMenu = useCallback(() => setMenuAt(null), []);
  const { handlers: holdHandlers, held } = useLongPress(setMenuAt);

  // Swallow the click that ends a hold. A native capture listener, not React's onClickCapture: React
  // derives a checkbox's onChange from the same click, and only stopping the native event before it
  // reaches React's root listener keeps the box from toggling.
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    function swallow(e: MouseEvent) {
      if (!held.current) return;
      held.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
    el.addEventListener("click", swallow, true);
    return () => el.removeEventListener("click", swallow, true);
  }, [held]);

  function onContextMenu(e: React.MouseEvent) {
    if ((e.target as Element).closest(NATIVE_TARGETS) || fromNestedRow(e)) return;
    e.preventDefault();
    if (!held.current) setMenuAt({ x: e.clientX, y: e.clientY });
  }

  const exit = exitDelay
    ? { ...itemMotionProps.exit, transition: { ...itemMotionProps.transition.default, delay: exitDelay } }
    : itemMotionProps.exit;
  return (
    <Reorder.Item
      ref={rowRef}
      value={value}
      dragListener={false}
      dragControls={controls}
      as="li"
      className={`item-row${className ? ` ${className}` : ""}${menuAt ? " menu-open" : ""}`}
      data-item-id={id}
      {...attrs}
      onContextMenu={onContextMenu}
      {...holdHandlers}
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
          onPointerDown={(e) => row.onGroupDragStart?.(id, e)}
        >
          {/* Starting at the handle, so it opens over the row rather than off the tab's edge. */}
          <Tooltip label={`Drag down to group ${row.noun}`} align="start">
            <GroupBracketIcon />
          </Tooltip>
        </span>
      )}
      {children}
      <ActionMenu at={menuAt} groups={actions} onClose={closeMenu} />
    </Reorder.Item>
  );
}

// The hover-revealed trash control at a row's end, confirmed before it fires. Its confirm is owned by
// the row kind, because the menu's Delete opens this same confirm.
interface RowRemoveProps {
  label: string;
  message: string;
  confirming: boolean;
  onConfirmingChange: (confirming: boolean) => void;
  onConfirm: () => void;
}

export function RowRemove({ label, message, confirming, onConfirmingChange, onConfirm }: RowRemoveProps) {
  return (
    <div className="remove-wrap">
      <button type="button" className="remove" aria-label={label} onClick={() => onConfirmingChange(true)}>
        <TrashIcon />
      </button>
      <ConfirmPopover open={confirming} message={message} onConfirm={onConfirm} onCancel={() => onConfirmingChange(false)} />
    </div>
  );
}

export default ItemRow;
