import { gatherGroups, Group as GroupSchema, isRetired, type Group, type Task } from "@board/contracts";

// Client-side list structure, shared by every tab kind: the group API (groups are generic over a
// section's items — see ItemList) and the pure order/membership updates the optimistic state applies.
// The board's tasks (App) and the shop's rewards (useShop) both go through these.

// `parentId` marks a piece of a broken-down task: it's listed under that task, in its own order, so the
// section-wide helpers below leave it out of the section's list.
type Listed = { id: string; groupId?: string; order?: number; parentId?: string };

// What a tab lists with no look-back view on (Completed, Pruned): its own tasks — pieces sit inside
// theirs — minus finished one-time tasks and pruned ones.
export const listedByDefault = (task: Task): boolean => !task.parentId && !isRetired(task) && !task.pruned;

// A fresh group's label until the owner renames it (the header's label is click-to-edit).
const NEW_GROUP_LABEL = "Group name";

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const groupsApi = {
  async create(sectionId: string, itemIds: string[]): Promise<Group> {
    const res = await fetch("/api/groups", jsonInit("POST", { sectionId, label: NEW_GROUP_LABEL, itemIds }));
    return GroupSchema.parse(await res.json());
  },
  addMembers: (groupId: string, itemIds: string[]) =>
    fetch(`/api/groups/${groupId}`, jsonInit("PATCH", { addItemIds: itemIds })),
  removeMembers: (groupId: string, itemIds: string[]) =>
    fetch(`/api/groups/${groupId}`, jsonInit("PATCH", { removeItemIds: itemIds })),
  relabel: (groupId: string, label: string) => fetch(`/api/groups/${groupId}`, jsonInit("PATCH", { label })),
  remove: (groupId: string) => fetch(`/api/groups/${groupId}`, { method: "DELETE" }),
};

// Stamp each listed item's position from a tab's full new order (items not in it are untouched).
export function withOrder<T extends Listed>(items: T[], orderedIds: string[]): T[] {
  const rank = new Map(orderedIds.map((id, i) => [id, i]));
  return items.map((it) => (rank.has(it.id) ? { ...it, order: rank.get(it.id) } : it));
}

// Put the given items into a group (or take them out of any, with `undefined`).
export function withMembership<T extends Listed>(items: T[], ids: string[], groupId: string | undefined): T[] {
  const set = new Set(ids);
  return items.map((it) => (set.has(it.id) ? { ...it, groupId } : it));
}

// Stable-partition one section's order so the items matching `trails` come last (relative order kept
// on both sides), stamping each item's new position — the client mirror of the server keeping retired
// one-time tasks at the end of their tab (BoardStore.settleRetired).
export function withTrailing<T extends Listed & { sectionId: string }>(
  items: T[],
  sectionId: string,
  trails: (item: T) => boolean,
): T[] {
  const ordered = sectionList(items, sectionId);
  return withOrder(items, [...ordered.filter((it) => !trails(it)), ...ordered.filter(trails)].map((it) => it.id));
}

// One section's own list, in order (its items, never a piece).
function sectionList<T extends Listed & { sectionId: string }>(items: T[], sectionId: string): T[] {
  return items.filter((it) => it.sectionId === sectionId && !it.parentId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// Gather each group of one section into a single run at its first member's place — the client mirror
// of the server's fold rule (BoardStore.settleGroups), applied after an order or membership change.
export function withGathered<T extends Listed & { sectionId: string }>(items: T[], sectionId: string): T[] {
  const ordered = sectionList(items, sectionId);
  const groupOf = new Map(ordered.map((it) => [it.id, it.groupId]));
  return withOrder(items, gatherGroups(ordered.map((it) => it.id), (id) => groupOf.get(id)));
}

// A reorder of a tab's listed items, turned back into its whole order with the unlisted ones kept in
// place — items hidden only for now (pruned tasks) must come back where they were, and with Status on,
// one band's reorder mustn't shuffle the other bands. An unlisted item inside its group's run rides with
// the group, wherever it went; any other stays beside the neighbours the drag didn't move (`moved` —
// told by the list, since a drag reorders one swap at a time and a swap alone can't say which side
// moved): after the nearest one before it, else before the nearest one after it.
export function withUnlistedKept<T extends Listed>(
  oldOrder: T[],
  listedOrder: string[],
  isListed: (item: T) => boolean,
  moved: string[],
): string[] {
  const movedIds = new Set(moved);
  const stayed = (n: T) => !movedIds.has(n.id);
  const before = new Map<string, string[]>();
  const after = new Map<string, string[]>();
  const leading: string[] = [];
  const attach = (map: Map<string, string[]>, anchor: string, id: string) => map.set(anchor, [...(map.get(anchor) ?? []), id]);
  oldOrder.forEach((item, i) => {
    if (isListed(item)) return;
    const earlier = oldOrder.slice(0, i).filter(isListed);
    const later = oldOrder.slice(i + 1).filter(isListed);
    const prev = earlier.at(-1);
    const next = later[0];
    const sameGroup = (n: T | undefined) => !!n && item.groupId !== undefined && n.groupId === item.groupId;
    if (sameGroup(prev)) return attach(after, prev!.id, item.id);
    if (sameGroup(next)) return attach(before, next!.id, item.id);
    const stayedPrev = earlier.findLast(stayed);
    const stayedNext = later.find(stayed);
    if (stayedPrev) attach(after, stayedPrev.id, item.id);
    else if (stayedNext) attach(before, stayedNext.id, item.id);
    else leading.push(item.id);
  });
  return [...leading, ...listedOrder.flatMap((id) => [...(before.get(id) ?? []), id, ...(after.get(id) ?? [])])];
}

// Every item from the first to the last of `ids` in a tab's order — a group is a contiguous run, so an
// item hidden inside the span a new group covers belongs to it too.
export function runBetween<T extends Listed>(order: T[], ids: string[]): string[] {
  const positions = ids.map((id) => order.findIndex((it) => it.id === id)).filter((i) => i >= 0);
  if (positions.length === 0) return ids;
  return order.slice(Math.min(...positions), Math.max(...positions) + 1).map((it) => it.id);
}

// A deleted group ungroups its members (they stay in the list).
export function withoutGroup<T extends Listed>(items: T[], groupId: string): T[] {
  return items.map((it) => (it.groupId === groupId ? { ...it, groupId: undefined } : it));
}
