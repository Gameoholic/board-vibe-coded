import type { Section, Task } from "./domain.js";
import { waitDays } from "./freezer.js";
import { behaviorOf } from "./taskKinds.js";

// The weekly Bounty: every week close rolls tasks from the Freezer (as many as Settings allow at once), each
// worth a multiplier until the next close. A Bounty stays frozen until the owner thaws it. The roll is the
// server's — its result is recorded (BountyRolled) and a rebuild replays it, never rolls again. These are
// the shared rules: what may be rolled, how likely, and which rerolls a reroll spends. What a Bounty pays is
// a modifier (modifiers.ts).

/** Whether `task` may be the Bounty: an open task of a type that's done once, in a Freezer — what's being
 *  avoided — and not a piece (a broken-down task's pieces share its Bounty). */
export function canBounty(task: Task, section: Pick<Section, "freezerFor">): boolean {
  const b = behaviorOf(task);
  return section.freezerFor != null && b.retiresWhenDone && !b.isDone(task) && !task.parentId;
}

/** How likely a candidate is to be rolled: one more chance for each whole week it's been on ice, so the roll
 *  leans a little toward what's been avoided longest. */
export function bountyWeight(task: Pick<Task, "waitMs" | "waitingSince">, now: string): number {
  return 1 + Math.floor(waitDays(task, now) / 7);
}

/** A weighted pick: `r` in [0, 1) — the caller's randomness — lands on one candidate; null with none. */
export function pickWeighted<T>(candidates: T[], weight: (c: T) => number, r: number): T | null {
  const total = candidates.reduce((sum, c) => sum + weight(c), 0);
  let at = r * total;
  for (const c of candidates) {
    at -= weight(c);
    if (at < 0) return c;
  }
  return candidates.at(-1) ?? null;
}

/** Which rerolls a reroll spends: the week's free ones first (they're gone when the week closes), then
 *  bought ones banked from the shop; null with neither left. */
export function rerollSource(freeLeft: number, banked: number): "week" | "bank" | null {
  return freeLeft > 0 ? "week" : banked > 0 ? "bank" : null;
}
