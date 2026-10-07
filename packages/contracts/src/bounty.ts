import { shuffled } from "./booster.js";
import type { Section, Task } from "./domain.js";
import { waitDays } from "./freezer.js";
import { behaviorOf } from "./taskKinds.js";

// The weekly Bounty: every week close deals a reel of the Freezer's tasks, and the owner swings it — the spot it
// stops on is a Bounty (as many as Settings allow at once), worth a multiplier until the next close. A Bounty
// stays frozen until the owner thaws it. The reel is the server's and recorded (BountyReelDealt) with which
// spot holds which task before any stop, so a stop is a real draw; a rebuild replays it and never deals again.
// These are the shared rules: what may be rolled, how likely, and which rerolls a reroll spends. What a Bounty
// pays is a modifier (modifiers.ts).

/** The most spots a reel holds. A fuller Freezer's is cut to a random handful of its spots — each as likely to
 *  make the cut as any other, so a task's chance stays its share of them. */
export const BOUNTY_REEL_MAX = 48;

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

/** A reel of `candidates`: each on as many spots as its weight — every spot is as likely to be stopped on as
 *  any other, so that's its chance — in a random order drawn with `random` (the caller's randomness, so the
 *  server's reel is recorded and a test's is fixed). */
export function bountyReel<T>(candidates: readonly T[], weight: (c: T) => number, random: () => number): T[] {
  const spots = candidates.flatMap((c) => Array.from({ length: weight(c) }, () => c));
  return shuffled(spots, random).slice(0, BOUNTY_REEL_MAX);
}

/** Which rerolls a reroll spends: the week's free ones first (they're gone when the week closes), then
 *  bought ones banked from the shop; null with neither left. */
export function rerollSource(freeLeft: number, banked: number): "week" | "bank" | null {
  return freeLeft > 0 ? "week" : banked > 0 ? "bank" : null;
}
