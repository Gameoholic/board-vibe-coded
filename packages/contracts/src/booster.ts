import type { Section, Task } from "./domain.js";
import { behaviorOf } from "./taskKinds.js";

// The weekly Booster: every week close deals a hand of the Registry's habits face down, and the owner picks
// from it — each picked card's task is a Booster until the next close, adding Settings' amount to every tick
// of it. The deal is the server's and recorded (BoosterDealt) with which card holds which task before any
// pick, so a pick is a real draw: the card picked decides the Booster, and every task had the same chance.
// What a Booster pays is a modifier (modifiers.ts).

/** The most cards a hand holds. A bigger Registry is dealt a random handful — every task still has the same
 *  chance, since the cards are face down. */
export const BOOSTER_HAND_MAX = 9;

/** Whether `task` may be dealt into a Booster hand: a habit you level up (a tier, a tally) in a tab that
 *  recurs — the Registry, read off its settings, never its name — and not a piece. */
export function canBoost(task: Task, section: Pick<Section, "period">): boolean {
  return behaviorOf(task).boostable && section.period != null && !task.parentId;
}

/** `items` in a uniformly random order, drawn with `random` (values in [0, 1) — the caller's randomness, so
 *  the server's deal is recorded and a test's is fixed). */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
