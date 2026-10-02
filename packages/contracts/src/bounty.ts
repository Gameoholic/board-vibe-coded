import type { Section, Task } from "./domain.js";
import { behaviorOf } from "./taskKinds.js";
import { statusOf } from "./taskStatus.js";

// The weekly Bounty: every week close rolls open tasks (as many as Settings allow at once), each worth a
// multiplier until the next close. The roll is the server's — its result is recorded (BountyRolled) and a
// rebuild replays it, never rolls again. These are the shared rules: what may be rolled, how likely, what
// a completion is worth while it's on, and which rerolls a reroll spends.

const DAY_MS = 86_400_000;

/** Whether `task` may be the Bounty: an open task of a type that's done once, in a tab that never resets
 *  (so it can sit there being avoided), not Blocked, and not a piece — a broken-down task's pieces share
 *  its Bounty. */
export function canBounty(task: Task, section: Pick<Section, "period">): boolean {
  const b = behaviorOf(task);
  return section.period == null && b.retiresWhenDone && !b.isDone(task) && statusOf(task) !== "blocked" && !task.parentId;
}

/** How likely a candidate is to be rolled: one more for every day it's been on the board, so the roll
 *  leans toward what's been avoided longest. */
export function bountyWeight(task: Pick<Task, "createdAt">, now: string): number {
  return Math.max(0, Math.floor((Date.parse(now) - Date.parse(task.createdAt)) / DAY_MS)) + 1;
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

/** The factor a completion of `task` is paid at right now: its own Bounty's multiplier, else its
 *  parent's (a broken-down task's Bounty boosts its remaining pieces), else 1. Frozen on the completion
 *  as its `boost`, so the Bounty ending later never re-prices it. */
export function boostOf(task: Pick<Task, "bounty">, parent?: Pick<Task, "bounty">): number {
  return task.bounty?.multiplier ?? parent?.bounty?.multiplier ?? 1;
}
