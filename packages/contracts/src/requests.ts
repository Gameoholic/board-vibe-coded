import { z } from "zod";
import {
  BLOCK_NOTE_MAX,
  DESCRIPTION_MAX,
  EMOJI_MAX,
  ESTIMATE_MAX,
  HexColor,
  MINUTES_MAX,
  LABEL_MAX,
  QTY_MAX,
  Section,
  StreakMatcher,
  StreakMode,
  StreakSince,
  StreakType,
  StreakView,
  Task,
  TaskStatus,
  TaskType,
  TEXT_MAX,
  TierDef,
  Timer,
} from "./domain.js";
import { BackupSettings, BountySettings, PeriodKindSchema, TaskSchedule, WindDown } from "./period.js";
import { PIECES_MAX } from "./pieces.js";
import { Points } from "./points.js";
import { PointsFormula, PointsSource } from "./pointsFormula.js";

// Request bodies, validated at the API trust boundary. Never trust a raw body — every route parses
// through one of these before the command layer sees it.

export const CreateTaskBody = z
  .object({
    sectionId: z.string().min(1),
    type: TaskType,
    text: z.string().trim().min(1).max(TEXT_MAX),
    points: Points.optional(),
    estimate: z.string().trim().max(ESTIMATE_MAX).optional(),
    estimateMinutes: z.number().nonnegative().max(MINUTES_MAX).optional(),
    estimateEffortIndex: z.number().int().nonnegative().optional(),
    pointsSource: PointsSource.optional(),
    description: z.string().trim().max(DESCRIPTION_MAX).optional(),
    tiers: z.array(TierDef).min(1).optional(),
    // Optional box count for a checkbox task (absent ≡ 1, a plain checkbox).
    count: z.number().int().min(1).max(QTY_MAX).optional(),
    // Optional per-box scheduled times (see domain Task.schedule).
    schedule: TaskSchedule.optional(),
  })
  .refine((b) => b.type === "tiered" || b.points !== undefined, {
    message: "non-tiered tasks require points",
    path: ["points"],
  })
  .refine((b) => b.type !== "tiered" || (b.tiers?.length ?? 0) > 0, {
    message: "tiered tasks require tiers",
    path: ["tiers"],
  })
  .refine((b) => b.type !== "once" || b.count === undefined, {
    message: "one-time tasks don't support a box count",
    path: ["count"],
  })
  .refine((b) => b.type !== "once" || b.schedule === undefined, {
    message: "one-time tasks don't support scheduled times",
    path: ["schedule"],
  });
export type CreateTaskBody = z.infer<typeof CreateTaskBody>;

// A task PATCH is a union of independent edits; each field is optional and applied if present.
export const PatchTaskBody = z.object({
  done: z.boolean().optional(),
  activeTier: z.number().int().nullable().optional(),
  progress: z.number().int().nonnegative().optional(),
  text: z.string().trim().min(1).max(TEXT_MAX).optional(),
  points: Points.optional(),
  estimate: z.string().trim().max(ESTIMATE_MAX).nullable().optional(),
  // Nullable so a patch can clear the estimate (null → no minutes); absent leaves it untouched.
  estimateMinutes: z.number().nonnegative().max(MINUTES_MAX).nullable().optional(),
  estimateEffortIndex: z.number().int().nonnegative().nullable().optional(),
  pointsSource: PointsSource.optional(),
  // Nullable so a patch can clear it (null → no description); absent leaves it untouched.
  description: z.string().trim().max(DESCRIPTION_MAX).nullable().optional(),
  tiers: z.array(TierDef).min(1).optional(),
  count: z.number().int().min(1).max(QTY_MAX).optional(),
  // Full per-box schedule array (absent leaves it untouched); an all-unscheduled array clears it.
  schedule: TaskSchedule.optional(),
  timer: Timer.nullable().optional(),
  // Prune (true) or unprune (false) — hidden until its tab's next day/week (see BoardStore.setPruned).
  pruned: z.boolean().optional(),
  // Move it to a Status band. `blocker` says why a blocked one waits — a note and/or the task it's
  // waiting on — so it's only meaningful with status "blocked".
  status: TaskStatus.optional(),
  blocker: z
    .object({
      note: z.string().trim().max(BLOCK_NOTE_MAX).optional(),
      taskId: z.string().min(1).optional(),
    })
    .optional(),
  // Tuck it inside another task as a piece, or (null) take a piece out into its tab's list again.
  parentId: z.string().min(1).nullable().optional(),
}).refine((b) => b.blocker === undefined || b.status === "blocked", {
  message: "a blocker only goes with status blocked",
  path: ["blocker"],
});
export type PatchTaskBody = z.infer<typeof PatchTaskBody>;

// Break a task down: the names of the pieces typed in one go, in order (see pieces.ts for what they're
// worth). Bounded like a box count, so one body can't ask for thousands.
export const BreakDownBody = z.object({
  texts: z.array(z.string().trim().min(1).max(TEXT_MAX)).min(1).max(PIECES_MAX),
});
export type BreakDownBody = z.infer<typeof BreakDownBody>;

// Create a group over a contiguous run of a section's items (a board tab's tasks or a shop tab's
// rewards). `itemIds` is the initial membership (server checks they exist, belong to the section,
// are ungrouped, and are contiguous in the current order). Relabeled via PATCH.
export const CreateGroupBody = z.object({
  sectionId: z.string().min(1),
  label: z.string().trim().max(LABEL_MAX),
  itemIds: z.array(z.string().min(1)).min(1),
});
export type CreateGroupBody = z.infer<typeof CreateGroupBody>;

export const PatchGroupBody = z.object({
  label: z.string().trim().max(LABEL_MAX).optional(),
  addItemIds: z.array(z.string().min(1)).optional(),
  removeItemIds: z.array(z.string().min(1)).optional(),
});
export type PatchGroupBody = z.infer<typeof PatchGroupBody>;

export const RecolorSectionBody = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "color must be a hex string like #6366f1"),
});
export type RecolorSectionBody = z.infer<typeof RecolorSectionBody>;

export const ReorderBody = z.object({ orderedIds: z.array(z.string()).min(1) });
export type ReorderBody = z.infer<typeof ReorderBody>;

export const CreateStreakBody = z.object({
  sectionId: z.string().min(1),
  name: z.string().trim().min(1).max(TEXT_MAX),
  type: StreakType,
  mode: StreakMode,
  since: StreakSince.default("created"),
  matcher: StreakMatcher,
});
export type CreateStreakBody = z.infer<typeof CreateStreakBody>;

// Each field optional and applied if present, mirroring PatchTaskBody's independent-edits shape.
export const PatchStreakBody = z.object({
  name: z.string().trim().min(1).max(TEXT_MAX).optional(),
  type: StreakType.optional(),
  mode: StreakMode.optional(),
  since: StreakSince.optional(),
  // Backfilled starting count + record-best floor, patched on their own from the Settings backfill list.
  legacy: z.number().int().min(0).optional(),
  legacyBest: z.number().int().min(0).optional(),
  matcher: StreakMatcher.optional(),
});
export type PatchStreakBody = z.infer<typeof PatchStreakBody>;

// Board settings are edited as a partial patch — each present field replaces that knob, the rest hold.
export const PatchSettingsBody = z.object({
  timeZone: z.string().trim().min(1).max(100).optional(),
  dayStartMinutes: z.number().int().min(0).max(1439).optional(),
  weekStartDay: z.number().int().min(0).max(6).optional(),
  weekStartMinutes: z.number().int().min(0).max(1439).optional(),
  // The client sends the whole windDown object (patchSettings shallow-merges, so a partial would drop
  // the untouched knobs); WindDown's own defaults fill any field the client happens to omit.
  windDown: WindDown.optional(),
  // Whole formula object (patchSettings shallow-merges the top-level patch, so a partial would drop the
  // untouched half); its own defaults fill anything omitted.
  pointsFormula: PointsFormula.optional(),
  // Whole object, like windDown.
  bounty: BountySettings.optional(),
  backup: BackupSettings.optional(),
});
export type PatchSettingsBody = z.infer<typeof PatchSettingsBody>;

// Change the points formula, optionally rebalancing existing builder-sourced task points to match.
// `rebalance: false` saves the formula for future tasks only. The confirm dialog previews the effect
// via BoardStore.previewFormula first (a dry run), then applies with the owner's choice.
export const ApplyFormulaBody = z.object({
  formula: PointsFormula,
  rebalance: z.boolean(),
});
export type ApplyFormulaBody = z.infer<typeof ApplyFormulaBody>;

// One value the formula change would move: a checkbox task (no tierIndex) or a specific tier.
export const FormulaChangeItem = z.object({
  taskId: z.string(),
  text: z.string(),
  tierIndex: z.number().int().nonnegative().optional(),
  tierLabel: z.string().optional(),
  oldPoints: Points,
  newPoints: Points,
});
export type FormulaChangeItem = z.infer<typeof FormulaChangeItem>;

// Dry-run result: every builder value that would move (with old→new), plus how many values are left
// untouched because they have no estimate or their % was manually overridden.
export const FormulaPreview = z.object({
  willUpdate: z.array(FormulaChangeItem),
  wontUpdateCount: z.number().int().nonnegative(),
});
export type FormulaPreview = z.infer<typeof FormulaPreview>;

// Roll (close-and-advance) the given period kind. The client only names the kind; the server owns the
// snapshot and the keys, since it's the sole authority on time and task state.
export const RollPeriodBody = z.object({ kind: PeriodKindSchema });
export type RollPeriodBody = z.infer<typeof RollPeriodBody>;

// A Bounty as its reel shows it (the recap, a reroll, one rolled when another was won): the task it
// landed on, what it multiplies, the rerolls left (the week's free ones and any bought), and other
// candidates' names for the reel (display only).
export const RolledBounty = z.object({
  taskId: z.string(),
  text: z.string(),
  multiplier: z.number(),
  rerollsLeft: z.number().int().nonnegative(),
  reel: z.array(z.string()),
});
export type RolledBounty = z.infer<typeof RolledBounty>;

// The open week's Bounties still to win, and the rerolls left (GET /api/bounty).
export const BountyStatus = z.object({
  bounties: z.array(RolledBounty),
  rerollsLeft: z.number().int().nonnegative(),
});
export type BountyStatus = z.infer<typeof BountyStatus>;

// The saved backups (GET /api/backups), newest first — each named by its file — and when the next one
// falls due (null while they're off). Times are the real clock's, never the debug clock's.
export const BackupSlot = z.object({
  name: z.string(),
  takenAt: z.string(),
  bytes: z.number().int().nonnegative(),
});
export type BackupSlot = z.infer<typeof BackupSlot>;

export const BackupList = z.object({
  slots: z.array(BackupSlot),
  nextAt: z.string().nullable(),
});
export type BackupList = z.infer<typeof BackupList>;

// A backup's board as it was saved (GET /api/backups/:name): its tabs, tasks and streaks — streaks counted
// as of when it was taken — and the points it held to spend.
export const BackupPreview = z.object({
  takenAt: z.string(),
  sections: z.array(Section),
  tasks: z.array(Task),
  streaks: z.array(StreakView),
  points: Points,
});
export type BackupPreview = z.infer<typeof BackupPreview>;

// Reroll one of this week's Bounties onto another task.
export const RerollBountyBody = z.object({ taskId: z.string().min(1) });
export type RerollBountyBody = z.infer<typeof RerollBountyBody>;

// One day of a recap: per tab (in the tab's own colour), how many tasks came out of the day ahead and
// what its ticks earned there (net, at the boost each was paid at — an untick of an earlier win counts
// against it); what the day earned and lost in all; and each purchase it made.
export const RecapTab = z.object({
  sectionId: z.string(),
  name: z.string(),
  color: HexColor,
  cleared: z.number().int().nonnegative(),
  earned: z.number().int(),
});
export type RecapTab = z.infer<typeof RecapTab>;

export const RecapPurchase = z.object({ name: z.string(), emoji: z.string(), cost: Points });
export type RecapPurchase = z.infer<typeof RecapPurchase>;

export const RecapDay = z.object({
  dayKey: z.string(),
  tabs: z.array(RecapTab),
  earned: z.number().int(),
  lost: Points,
  purchases: z.array(RecapPurchase),
});
export type RecapDay = z.infer<typeof RecapDay>;

// A streak at the start of the week (null when it's newer, or the week began before starts were
// recorded) and at its end — each as the week's start, and the next one's, froze it.
export const RecapStreak = z.object({
  streakId: z.string(),
  name: z.string(),
  type: StreakType,
  start: z.number().int().nonnegative().nullable(),
  end: z.number().int().nonnegative(),
});
export type RecapStreak = z.infer<typeof RecapStreak>;

// Recap returned after a roll: the closed period day by day (one day for a day; each day of a week),
// its totals, and — for a week — its streaks from start to end and the next week's Bounties.
export const PeriodRecap = z.object({
  kind: PeriodKindSchema,
  periodKey: z.string(),
  days: z.array(RecapDay),
  earned: z.number().int(),
  lost: Points,
  streaks: z.array(RecapStreak),
  // A week close rolls the next week's Bounties (none when they're off or nothing could be rolled, and
  // for a day).
  bounties: z.array(RolledBounty).default([]),
});
export type PeriodRecap = z.infer<typeof PeriodRecap>;

export const StreakReorderBody = z.object({
  sectionId: z.string().min(1),
  orderedIds: z.array(z.string()).min(1),
});
export type StreakReorderBody = z.infer<typeof StreakReorderBody>;

// ---- Shop ----
// A shop section's colour is the client's pick (from its palette); the server only validates it.
export const CreateShopSectionBody = z.object({
  name: z.string().trim().min(1).max(LABEL_MAX),
  color: HexColor,
});
export type CreateShopSectionBody = z.infer<typeof CreateShopSectionBody>;

export const PatchShopSectionBody = z.object({
  name: z.string().trim().min(1).max(LABEL_MAX).optional(),
  color: HexColor.optional(),
});
export type PatchShopSectionBody = z.infer<typeof PatchShopSectionBody>;

// A reward's cost is integer thousandths-of-a-percent like every point value, and must be positive —
// a free reward would be a purchase that spends nothing.
const RewardCost = Points.refine((n) => n > 0, "cost must be positive");

export const CreateRewardBody = z.object({
  shopSectionId: z.string().min(1),
  name: z.string().trim().min(1).max(TEXT_MAX),
  emoji: z.string().trim().min(1).max(EMOJI_MAX),
  cost: RewardCost,
  note: z.string().trim().max(DESCRIPTION_MAX).optional(),
});
export type CreateRewardBody = z.infer<typeof CreateRewardBody>;

export const PatchRewardBody = z.object({
  name: z.string().trim().min(1).max(TEXT_MAX).optional(),
  emoji: z.string().trim().min(1).max(EMOJI_MAX).optional(),
  cost: RewardCost.optional(),
  // Nullable so a patch can clear the note; absent leaves it untouched.
  note: z.string().trim().max(DESCRIPTION_MAX).nullable().optional(),
});
export type PatchRewardBody = z.infer<typeof PatchRewardBody>;

// Debug clock: pin the server's notion of "now" to an ISO instant to simulate opening the app at
// another time, or null to return to the real clock. A debug backdoor for a self-hosted single user.
export const DebugClockBody = z.object({ at: z.string().datetime().nullable() });
export type DebugClockBody = z.infer<typeof DebugClockBody>;

// What the debug-clock endpoints return: the pinned instant (null = real time) and the real clock now.
export const DebugClockState = z.object({ now: z.string().nullable(), real: z.string() });
export type DebugClockState = z.infer<typeof DebugClockState>;

export { LABEL_MAX };

// Auth: the one shared password, set from the terminal (`pnpm set-password`) — there is no concept
// of separate users. Bounded generously; the real limit is the hash function, not this.
export const LoginBody = z.object({ password: z.string().min(1).max(200) });
export type LoginBody = z.infer<typeof LoginBody>;
