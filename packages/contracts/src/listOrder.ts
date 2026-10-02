// List structure shared by every list (a board tab's tasks or streaks, a shop tab's rewards).

/** A list's order with each group's members gathered at its first member's place, their relative order
 *  kept — so a group is one contiguous run by construction, whatever reorder or membership change came
 *  before (a Status band, say, sees only part of the list, so its reorders can't know every neighbour).
 *  The server folds every list order through it; the web mirrors it optimistically. */
export function gatherGroups(order: string[], groupOf: (id: string) => string | undefined): string[] {
  const members = new Map<string, string[]>();
  for (const id of order) {
    const group = groupOf(id);
    if (group) members.set(group, [...(members.get(group) ?? []), id]);
  }
  return order.flatMap((id) => {
    const group = groupOf(id);
    if (!group) return [id];
    const run = members.get(group)!;
    return run[0] === id ? run : [];
  });
}
