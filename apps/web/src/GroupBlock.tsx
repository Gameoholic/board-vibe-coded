import { Reorder, useDragControls } from "framer-motion";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { MenuPoint } from "./ActionMenu";
import ConfirmPopover from "./ConfirmPopover";
import { UngroupIcon } from "./Icons";
import type { RowContext } from "./ItemRow";
import type { ListItem } from "./ItemList";
import type { Group } from "./types";

interface GroupBlockProps<T extends ListItem> {
  group: Group;
  // The group's members, in order. They render inside the rail and move with it as one block.
  items: T[];
  draggable: boolean;
  noun: string;
  renderItem: (item: T, row: RowContext) => React.ReactNode;
  onReorderMembers: (orderedIds: string[]) => void;
  onEditLabel: (label: string) => void;
  onUngroup: (groupId: string) => void;
  // Called when a member is dragged out of the group's bounds. `direction` says which side.
  onEjectItem: (itemId: string, direction: "above" | "below") => void;
  // A drag starts: what it moves — one member, or (by the header's handle) the whole block.
  onDragStart: (itemIds: string[]) => void;
  // A member dragged out of the list altogether, onto another list of the tab (see ItemList's
  // DropOutside): what letting go there would do (null ≡ nothing), and doing it — instead of an eject,
  // so the member keeps its group wherever it goes.
  outsideLabel?: (itemId: string, x: number, y: number) => string | null;
  onDropOutside?: (itemId: string, at: MenuPoint) => void;
}

// A labeled bundle of contiguous items, drawn as a left rail spanning them with a header (the label).
// The whole block is one framer Reorder.Item in the tab's outer list, so it moves as a unit; a nested
// Reorder.Group lets the members reorder among themselves without leaving the block. Deleting the
// group ungroups its items (they aren't removed). Item-kind agnostic: members render via renderItem.
function GroupBlock<T extends ListItem>({
  group,
  items,
  draggable,
  noun,
  renderItem,
  onReorderMembers,
  onEditLabel,
  onUngroup,
  onEjectItem,
  onDragStart,
  outsideLabel,
  onDropOutside,
}: GroupBlockProps<T>) {
  const controls = useDragControls();
  // Tracks pending eject state during a drag — direction if outside bounds, null if inside.
  const pendingEjectRef = useRef<{ itemId: string; direction: "above" | "below" } | null>(null);
  // DOM node for the floating "leave group" hint shown while dragging outside bounds.
  const hintRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(group.label);

  // Called from the drag handle's onPointerDown (before framer's controls.start) so our
  // capture-phase listeners fire before framer's bubble-phase ones. flushSync on release
  // forces React to update the DOM before framer can spring the item back.
  function handleDragHandleDown(itemId: string) {
    pendingEjectRef.current = null;
    // This block, found from the dragged member (it's in the block for the whole drag) — not a page-wide
    // lookup by group id, since one group can show in more than one list of a tab (its tasks split
    // across Status bands).
    const groupEl = document.querySelector(`[data-item-id="${itemId}"]`)?.closest(".group-block") ?? null;

    // Show/hide the floating hint label next to the cursor.
    function showHint(y: number, x: number, text: string) {
      if (!hintRef.current) {
        const el = document.createElement("div");
        el.className = "group-eject-hint";
        document.body.appendChild(el);
        hintRef.current = el;
      }
      hintRef.current.textContent = text;
      hintRef.current.style.top = `${y + 16}px`;
      hintRef.current.style.left = `${x + 16}px`;
      hintRef.current.style.opacity = "1";
    }
    function hideHint() {
      if (hintRef.current) {
        hintRef.current.style.opacity = "0";
      }
    }

    function onMove(e: PointerEvent) {
      const rect = groupEl?.getBoundingClientRect();
      if (!rect) return;
      const outside = outsideLabel?.(itemId, e.clientX, e.clientY);
      if (outside) {
        // Off to another list: the member goes there and keeps its group, so it's no eject.
        pendingEjectRef.current = null;
        groupEl?.classList.remove("group-ejecting");
        showHint(e.clientY, e.clientX, outside);
      } else if (e.clientY < rect.top - 12 || e.clientY > rect.bottom + 12) {
        const dir = e.clientY < rect.top ? "above" : "below";
        pendingEjectRef.current = { itemId, direction: dir };
        groupEl?.classList.add("group-ejecting");
        showHint(e.clientY, e.clientX, "Leave group");
      } else {
        if (pendingEjectRef.current?.itemId === itemId) pendingEjectRef.current = null;
        groupEl?.classList.remove("group-ejecting");
        hideHint();
      }
    }

    function onUp(e: PointerEvent) {
      window.removeEventListener("pointermove", onMove, { capture: true });
      window.removeEventListener("pointerup", onUp, { capture: true });
      groupEl?.classList.remove("group-ejecting");
      hideHint();
      if (hintRef.current) {
        hintRef.current.remove();
        hintRef.current = null;
      }
      const pending = pendingEjectRef.current;
      pendingEjectRef.current = null;
      if (onDropOutside && outsideLabel?.(itemId, e.clientX, e.clientY)) {
        flushSync(() => onDropOutside(itemId, { x: e.clientX, y: e.clientY }));
      } else if (pending?.itemId === itemId) {
        flushSync(() => onEjectItem(itemId, pending.direction));
      }
    }

    window.addEventListener("pointermove", onMove, { capture: true });
    window.addEventListener("pointerup", onUp, { capture: true });
  }
  const [confirming, setConfirming] = useState(false);

  function commit() {
    setEditing(false);
    const next = label.trim();
    // A group always carries a value; an emptied field reverts rather than saving blank.
    if (!next) {
      setLabel(group.label);
      return;
    }
    if (next !== group.label) onEditLabel(next);
  }

  return (
    <Reorder.Item
      value={group}
      dragListener={false}
      dragControls={controls}
      as="li"
      className="group-block"
      data-group-id={group.id}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ type: "spring", stiffness: 500, damping: 34 }}
    >
      <div className="group-header" data-group-id={group.id}>
        <span
          className={`drag-handle${draggable ? "" : " disabled"}`}
          onPointerDown={(e) => {
            if (!draggable) return;
            onDragStart(items.map((it) => it.id));
            controls.start(e);
          }}
        >
          ⠿
        </span>
        {editing ? (
          <input
            className="group-label-input"
            value={label}
            autoFocus
            placeholder="Group name"
            onChange={(e) => setLabel(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                setLabel(group.label);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button type="button" className="group-label" onClick={() => setEditing(true)}>
            {group.label}
          </button>
        )}
        <span className="group-rule" />
        <div className="remove-wrap">
          <button type="button" className="remove" aria-label={`Ungroup ${noun}`} onClick={() => setConfirming(true)}>
            <UngroupIcon />
          </button>
          <ConfirmPopover
            open={confirming}
            message={`Ungroup these ${noun}?`}
            onConfirm={() => onUngroup(group.id)}
            onCancel={() => setConfirming(false)}
          />
        </div>
      </div>

      <Reorder.Group
        as="ul"
        axis="y"
        values={items}
        onReorder={(ordered: T[]) => onReorderMembers(ordered.map((i) => i.id))}
        className="group-tasks"
      >
        {items.map((item) =>
          renderItem(item, {
            draggable,
            noun,
            onDragHandleDown: () => {
              onDragStart([item.id]);
              handleDragHandleDown(item.id);
            },
          }),
        )}
      </Reorder.Group>
    </Reorder.Item>
  );
}

export default GroupBlock;
