import { Group as GroupSchema, type Group } from "@board/contracts";

// Client-side list structure, shared by every tab kind: the group API (groups are generic over a
// section's items — see ItemList) and the pure order/membership updates the optimistic state applies.
// The board's tasks (App) and the shop's rewards (useShop) both go through these.

type Listed = { id: string; groupId?: string; order?: number };

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
  const ordered = items.filter((it) => it.sectionId === sectionId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return withOrder(items, [...ordered.filter((it) => !trails(it)), ...ordered.filter(trails)].map((it) => it.id));
}

// A deleted group ungroups its members (they stay in the list).
export function withoutGroup<T extends Listed>(items: T[], groupId: string): T[] {
  return items.map((it) => (it.groupId === groupId ? { ...it, groupId: undefined } : it));
}
