import { AnimatePresence, Reorder } from "framer-motion";
import { useMemo, useState } from "react";
import { flushSync } from "react-dom";
import type { MenuPoint } from "./ActionMenu";
import GroupBlock from "./GroupBlock";
import type { RowContext } from "./ItemRow";
import type { Group } from "./types";

// The shared base of every tab's list: a reorderable column of rows where a contiguous run of items
// can be bundled into a labeled group, dragged into a group, or dragged out of one. It's written over
// any item kind — anything with an id, an optional groupId and a stored order (tasks, rewards) — so
// a list feature lands in every tab at once. The row kind renders its rows (on the ItemRow base).

export interface ListItem {
  id: string;
  groupId?: string;
  order?: number;
}

// A list renders as a sequence of rows: a lone ungrouped item, or a group block wrapping a contiguous
// run of items. Both are framer Reorder values, so the group moves as one unit.
type Row<T> = { kind: "item"; item: T } | { kind: "group"; group: Group; items: T[] };

// Somewhere else in the tab a row can be dragged to, out of this list — another list shown beside it (a
// Status band). `label` says what letting go at a point would do ("Move to Backlog"), shown by the
// pointer — null when nothing takes a row there; `drop` does it.
export interface DropOutside {
  label: (at: MenuPoint) => string | null;
  drop: (itemId: string, at: MenuPoint) => void;
}

const byOrder = (a: ListItem, b: ListItem) => (a.order ?? 0) - (b.order ?? 0);

interface ItemListProps<T extends ListItem> {
  items: T[]; // the tab's items, in any order
  // Manual order shows groups and allows dragging; any other sort flattens the list into `sorted`
  // (groups hidden, since a sort would scramble a group's run).
  manual: boolean;
  sorted: T[];
  groups: Group[];
  noun: string; // plural, for labels ("tasks", "rewards")
  emptyLabel: string;
  renderItem: (item: T, row: RowContext) => React.ReactNode; // must return a keyed ItemRow
  // Posts the list's new flat item-id order (group members kept contiguous by the block), with the ids
  // the drag moved — a row, or a whole group's members — so the tab can keep the items this list doesn't
  // show beside the ones that stayed (see withUnlistedKept).
  onReorder: (orderedIds: string[], moved: string[]) => void;
  onAddGroup: (itemIds: string[]) => void;
  onExtendGroup: (groupId: string, itemIds: string[]) => void;
  onEjectFromGroup: (itemId: string, groupId: string, newOrder: string[]) => void;
  onEditGroup: (id: string, label: string) => void;
  onRemoveGroup: (id: string) => void;
  dropOutside?: DropOutside;
  // Whether new groups can be made here: the group handle's range-drag and dragging a row into a group.
  // Groups already in the list show either way (and can still be ungrouped from their header). Default on.
  grouping?: boolean;
}

function ItemList<T extends ListItem>({
  items,
  manual,
  sorted,
  groups,
  noun,
  emptyLabel,
  renderItem,
  onReorder,
  onAddGroup,
  onExtendGroup,
  onEjectFromGroup,
  onEditGroup,
  onRemoveGroup,
  dropOutside,
  grouping = true,
}: ItemListProps<T>) {
  // The tab's items in manual order (the stored order). Group membership + this order define the rows.
  const ordered = useMemo(() => [...items].sort(byOrder), [items]);
  // What the drag in progress is moving (set when its handle is pressed): framer reorders one swap at a
  // time, and a swap alone can't say which of its two sides moved.
  const [dragged, setDragged] = useState<string[]>([]);
  // The list a dragged row is in, found from the row (it stays in its list for the whole drag). Groups
  // are looked up inside it, never across the page: one group can show in more than one list of a tab
  // (a group whose tasks sit in two Status bands).
  const listOf = (itemId: string) => document.querySelector(`[data-item-id="${itemId}"]`)?.closest(".item-list") ?? null;

  // What letting go of a dragged row at a point would do out of its list altogether, if anything (see
  // DropOutside).
  function outsideLabel(itemId: string, x: number, y: number): string | null {
    const r = listOf(itemId)?.getBoundingClientRect();
    if (!dropOutside || !r || (y >= r.top && y <= r.bottom && x >= r.left && x <= r.right)) return null;
    return dropOutside.label({ x, y });
  }

  // Build the render rows: a run of consecutive items sharing a groupId collapses into one group
  // block; every other item is its own row. Only in manual order — otherwise groups are hidden.
  const rows = useMemo<Row<T>[]>(() => {
    if (!manual) return sorted.map((item) => ({ kind: "item", item }));
    const byId = new Map(groups.map((g) => [g.id, g]));
    const out: Row<T>[] = [];
    for (let i = 0; i < ordered.length; ) {
      const it = ordered[i];
      const g = it.groupId ? byId.get(it.groupId) : undefined;
      if (g) {
        const members: T[] = [];
        while (i < ordered.length && ordered[i].groupId === it.groupId) members.push(ordered[i++]);
        out.push({ kind: "group", group: g, items: members });
      } else {
        out.push({ kind: "item", item: it });
        i++;
      }
    }
    return out;
  }, [manual, sorted, ordered, groups]);

  // framer tracks rows by their values: an item row's value is the item, a group row's is its group.
  // On reorder, groups expand back to their member ids for the flat order.
  const rowValue = (r: Row<T>) => (r.kind === "group" ? r.group : r.item);
  const rowOf = new Map<T | Group, Row<T>>(rows.map((r) => [rowValue(r), r]));

  // A group block reorders its members internally: splice the new member order into the tab's full
  // order (members stay where the block sits) and post the flat result.
  function reorderMembers(orderedMemberIds: string[]) {
    const memberSet = new Set(orderedMemberIds);
    const queue = [...orderedMemberIds];
    onReorder(
      ordered.map((it) => (memberSet.has(it.id) ? queue.shift()! : it.id)),
      dragged,
    );
  }

  // Ejection: remove an item from its group and reinsert it adjacent to the group.
  function ejectItem(itemId: string, groupId: string, direction: "above" | "below") {
    const ids = ordered.map((it) => it.id);
    const without = ids.filter((id) => id !== itemId);
    const remaining = ordered.filter((it) => it.groupId === groupId && it.id !== itemId);
    let insertAt: number;
    if (direction === "above") {
      const first = remaining[0]?.id;
      insertAt = first ? without.indexOf(first) : 0;
    } else {
      const last = remaining[remaining.length - 1]?.id;
      insertAt = last ? without.indexOf(last) + 1 : without.length;
    }
    onEjectFromGroup(itemId, groupId, [...without.slice(0, insertAt), itemId, ...without.slice(insertAt)]);
  }

  // Drag-into-group (and out of the list altogether, see DropOutside): capture-phase pointer listeners
  // so we fire before framer's reorder cleanup. Uses rect comparison (not elementFromPoint) because the
  // dragged row sits on top of whatever is under the pointer.
  function handleUngroupedDragHandleDown(itemId: string) {
    let targetGroupId: string | null = null;
    let hintEl: HTMLDivElement | null = null;
    const list = listOf(itemId);
    const groupEl = (groupId: string) => {
      const el = list?.querySelector(`[data-group-id="${groupId}"]`);
      return el?.closest(".group-block") ?? el ?? null;
    };

    // Find which of this list's group blocks (if any) the pointer is over, by comparing rects.
    // data-group-id lives on .group-header (a plain div, reliably forwarded to DOM).
    // Walk up to .group-block for the full group bounds (includes header + members).
    function groupAtPoint(x: number, y: number): string | null {
      for (const el of list?.querySelectorAll("[data-group-id]") ?? []) {
        const block = el.closest(".group-block") ?? el;
        const r = block.getBoundingClientRect();
        if (y >= r.top && y <= r.bottom && x >= r.left && x <= r.right) return el.getAttribute("data-group-id");
      }
      return null;
    }

    function setHint(y: number, x: number, text: string | null) {
      if (!text) {
        if (hintEl) hintEl.style.opacity = "0";
        document.querySelectorAll(".group-drag-over").forEach((el) => el.classList.remove("group-drag-over"));
        return;
      }
      if (!hintEl) {
        hintEl = document.createElement("div");
        hintEl.className = "group-eject-hint";
        document.body.appendChild(hintEl);
      }
      hintEl.textContent = text;
      hintEl.style.top = `${y + 16}px`;
      hintEl.style.left = `${x + 16}px`;
      hintEl.style.opacity = "1";
    }

    function onMove(e: PointerEvent) {
      const gId = grouping ? groupAtPoint(e.clientX, e.clientY) : null;
      targetGroupId = gId;
      document.querySelectorAll(".group-drag-over").forEach((el) => el.classList.remove("group-drag-over"));
      const outside = outsideLabel(itemId, e.clientX, e.clientY);
      if (outside) {
        setHint(e.clientY, e.clientX, outside);
      } else if (gId) {
        groupEl(gId)?.classList.add("group-drag-over");
        const label = groups.find((g) => g.id === gId)?.label ?? "group";
        setHint(e.clientY, e.clientX, `Add to ${label}`);
      } else {
        setHint(0, 0, null);
      }
    }

    function onUp(e: PointerEvent) {
      window.removeEventListener("pointermove", onMove, { capture: true });
      window.removeEventListener("pointerup", onUp, { capture: true });
      setHint(0, 0, null);
      if (hintEl) {
        hintEl.remove();
        hintEl = null;
      }
      if (dropOutside && outsideLabel(itemId, e.clientX, e.clientY)) {
        flushSync(() => dropOutside.drop(itemId, { x: e.clientX, y: e.clientY }));
        return;
      }
      // Only this list's groups can take the item (a group in another tab isn't a valid target).
      if (!targetGroupId || !groups.some((g) => g.id === targetGroupId)) return;
      const gId = targetGroupId;
      const without = ordered.map((it) => it.id).filter((id) => id !== itemId);
      const members = ordered.filter((it) => it.groupId === gId);
      const last = members[members.length - 1]?.id;
      const insertAt = last ? without.indexOf(last) + 1 : without.length;
      const newOrder = [...without.slice(0, insertAt), itemId, ...without.slice(insertAt)];
      flushSync(() => {
        onExtendGroup(gId, [itemId]);
        onReorder(newOrder, [itemId]);
      });
    }

    window.addEventListener("pointermove", onMove, { capture: true });
    window.addEventListener("pointerup", onUp, { capture: true });
  }

  // Group creation/extension by range-drag. Returns either:
  //   { valid: true, extending: null }               → create a new group (all ungrouped)
  //   { valid: true, extending: { groupId, newIds } } → extend one existing group with adjacent items
  //   { valid: false }                                → invalid (multiple groups or partial overlap)
  function analyzeRange(min: number, max: number) {
    const slice = ordered.slice(min, max + 1);
    const groupIds = [...new Set(slice.map((it) => it.groupId).filter(Boolean))] as string[];
    if (groupIds.length === 0) return { valid: true, extending: null };
    if (groupIds.length > 1) return { valid: false, extending: null };
    // Exactly one group in range — valid only if ALL its members are covered (no partial overlap).
    const groupId = groupIds[0];
    const covered = ordered
      .filter((it) => it.groupId === groupId)
      .every((m) => {
        const idx = ordered.findIndex((it) => it.id === m.id);
        return idx >= min && idx <= max;
      });
    if (!covered) return { valid: false, extending: null };
    const newIds = slice.filter((it) => !it.groupId).map((it) => it.id);
    if (newIds.length === 0) return { valid: false, extending: null };
    return { valid: true, extending: { groupId, newIds } };
  }

  function highlightRange(min: number, max: number, valid: boolean) {
    ordered.forEach((it, i) => {
      const el = document.querySelector(`[data-item-id="${it.id}"]`);
      if (!el) return;
      const inRange = i >= min && i <= max;
      el.classList.toggle("group-selecting", inRange);
      el.classList.toggle("group-selecting-invalid", inRange && !valid);
    });
  }
  function clearHighlight() {
    document
      .querySelectorAll(".group-selecting")
      .forEach((el) => el.classList.remove("group-selecting", "group-selecting-invalid"));
  }

  function startGroupDrag(anchorId: string, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const anchorIdx = ordered.findIndex((it) => it.id === anchorId);
    if (anchorIdx < 0) return;
    let range = { min: anchorIdx, max: anchorIdx, ...analyzeRange(anchorIdx, anchorIdx) };
    function onMove(ev: PointerEvent) {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-item-id]");
      const id = el?.getAttribute("data-item-id");
      const idx = id ? ordered.findIndex((it) => it.id === id) : -1;
      const cur = idx >= 0 ? idx : anchorIdx;
      const min = Math.min(anchorIdx, cur);
      const max = Math.max(anchorIdx, cur);
      range = { min, max, ...analyzeRange(min, max) };
      highlightRange(min, max, range.valid);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      clearHighlight();
      if (!range.valid || range.max === range.min) return;
      if (range.extending) {
        onExtendGroup(range.extending.groupId, range.extending.newIds);
      } else {
        onAddGroup(ordered.slice(range.min, range.max + 1).map((it) => it.id));
      }
    }
    highlightRange(anchorIdx, anchorIdx, range.valid);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <Reorder.Group
      as="ul"
      axis="y"
      values={rows.map(rowValue)}
      onReorder={(vals: (T | Group)[]) => {
        const flat: string[] = [];
        for (const v of vals) {
          const r = rowOf.get(v);
          if (r?.kind === "group") flat.push(...r.items.map((it) => it.id));
          else if (r) flat.push(r.item.id);
        }
        onReorder(flat, dragged);
      }}
      className="item-list"
    >
      <AnimatePresence initial={false}>
        {rows.length === 0 && <li className="empty">{emptyLabel}</li>}
        {rows.map((r) =>
          r.kind === "group" ? (
            <GroupBlock
              key={r.group.id}
              group={r.group}
              items={r.items}
              draggable={manual}
              noun={noun}
              renderItem={renderItem}
              onReorderMembers={reorderMembers}
              onEditLabel={(label) => onEditGroup(r.group.id, label)}
              onUngroup={onRemoveGroup}
              onEjectItem={(itemId, dir) => ejectItem(itemId, r.group.id, dir)}
              onDragStart={setDragged}
              outsideLabel={outsideLabel}
              onDropOutside={dropOutside?.drop}
            />
          ) : (
            renderItem(r.item, {
              draggable: manual,
              noun,
              onGroupDragStart: manual && grouping ? startGroupDrag : undefined,
              onDragHandleDown: manual
                ? () => {
                    setDragged([r.item.id]);
                    if ((grouping && groups.length > 0) || dropOutside) handleUngroupedDragHandleDown(r.item.id);
                  }
                : undefined,
            })
          ),
        )}
      </AnimatePresence>
    </Reorder.Group>
  );
}

export default ItemList;
