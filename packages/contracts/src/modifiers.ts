import type { AppliedModifier, ModifierKind, Section, Task } from "./domain.js";
import { frostShare, isFullFrost } from "./freezer.js";
import type { Settings } from "./period.js";

// Modifiers: everything that changes what a task pays — the Bounty, frost, Subzero, and every boost the
// board grows later (see CONVENTIONS.md → "Modifiers"). Each is one entry here: when a task has it and its
// effect, which is one of four kinds. All of a task's modifiers compose into one payout, rounded once, so
// they stack by construction and none knows about the others. How each one *looks* (its tag, colour, line)
// is the web's (modifierLooks.ts), keyed by these ids — nothing else in the code knows a modifier by name.

export type ModifierId = "bounty" | "frost" | "subzero" | "booster";

export interface ModifierContext {
  settings: Settings;
  // The tab the task is in: frost pays out and Subzero applies once it's out of the Freezer.
  section: Pick<Section, "freezerFor"> | undefined;
  // A piece's task — its Bounty and its frost are the piece's too.
  parent?: Pick<Task, "bounty" | "frostDays">;
  // Whether the task is broken down (its worth is in its pieces).
  hasPieces?: boolean;
  // When paying a broken-down task's own completion: what its pieces paid. A floor is on the whole task, so
  // it counts that, and the task's own completion pays the rest.
  piecesPaid?: number;
}

interface Modifier {
  id: ModifierId;
  kind: ModifierKind;
  // Its value on `task` right now (see AppliedModifier), or null when the task doesn't have it.
  valueOn(task: Task, ctx: ModifierContext): number | null;
}

// In the order a task's lines list them.
const MODIFIERS: Modifier[] = [
  // The week's Bounty: a factor on everything else, its own or its task's (a piece's).
  {
    id: "bounty",
    kind: "factor",
    valueOn: (task, ctx) => {
      const m = task.bounty?.multiplier ?? ctx.parent?.bounty?.multiplier;
      return m !== undefined && m !== 1 ? m : null;
    },
  },
  // Frost: a share of the task's own points for its days on ice — a piece's is its task's (it waited as one).
  {
    id: "frost",
    kind: "share",
    valueOn: (task, ctx) => {
      const share = frostShare(ctx.parent ?? task, ctx.settings);
      return share > 0 && ((task.points ?? 0) > 0 || ctx.hasPieces) ? share : null;
    },
  },
  // Subzero: a task thawed with full frost pays at least the setting's minimum, whatever the rest comes to.
  {
    id: "subzero",
    kind: "floor",
    valueOn: (task, ctx) => (!ctx.section?.freezerFor && isFullFrost(task, ctx.settings) ? ctx.settings.freezer.subzeroMin : null),
  },
  // The week's Booster: a flat amount on each completion of its task — every tick of a tally, its tier.
  {
    id: "booster",
    kind: "flat",
    valueOn: (task) => task.booster?.amount ?? null,
  },
];

/** The modifiers on `task` right now, in their order — what a completion now would be paid at. A floor is
 *  the least a whole task pays: a piece pays toward its task's, never one of its own, and a broken-down
 *  task's own completion counts what its pieces paid (`ctx.piecesPaid`). */
export function modifiersOf(task: Task, ctx: ModifierContext): AppliedModifier[] {
  return MODIFIERS.flatMap((m) => {
    const value = m.valueOn(task, ctx);
    if (value === null || (m.kind === "floor" && task.parentId)) return [];
    const piecesPaid = m.kind === "floor" && ctx.piecesPaid ? { piecesPaid: ctx.piecesPaid } : {};
    return [{ id: m.id, kind: m.kind, value, ...piecesPaid }];
  });
}

/** A broken-down task's modifiers as its whole worth shows them (its bracket): its floors on all of it, not
 *  on what was left once its pieces had paid. */
export function onWholeTask(modifiers: readonly AppliedModifier[]): AppliedModifier[] {
  return modifiers.map(({ id, kind, value }) => ({ id, kind, value }));
}

/** What `points` pays under `modifiers`. Shares add up first (each a share of the task's own points), flats
 *  add after them, factors multiply the lot, and a floor is the least it pays —
 *  `max((points × (1 + Σ shares) + Σ flats) × Π factors, highest floor)` — composed into one result and
 *  rounded once, half-up, to whole thousandths. A floor less what its task's pieces already paid toward it
 *  is what's left for the task's own completion. */
export function payout(points: number, modifiers: readonly AppliedModifier[]): number {
  let shares = 0;
  let flats = 0;
  let factor = 1;
  let floor = 0;
  for (const m of modifiers) {
    if (m.kind === "share") shares += m.value;
    else if (m.kind === "flat") flats += m.value;
    else if (m.kind === "factor") factor *= m.value;
    else floor = Math.max(floor, m.value - (m.piecesPaid ?? 0));
  }
  return Math.max(Math.round((points * (1 + shares) + flats) * factor), floor);
}

/** The modifiers frozen on an old completion that only recorded a Bounty's factor (`boost`). */
export function fromBoost(boost: number | undefined): AppliedModifier[] | undefined {
  return boost !== undefined && boost !== 1 ? [{ id: "bounty", kind: "factor", value: boost }] : undefined;
}
