import { z } from "zod";
import {
  DESCRIPTION_MAX,
  EMOJI_MAX,
  ESTIMATE_MAX,
  HexColor,
  MINUTES_MAX,
  LABEL_MAX,
  QTY_MAX,
  StreakMatcher,
  StreakMode,
  StreakSince,
  StreakType,
  TaskType,
  TEXT_MAX,
  TierDef,
  Timer,
} from "./domain.js";
import { PeriodKindSchema, TaskSchedule, WindDown } from "./period.js";
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
    message: "checkbox and repeatable tasks require points",
    path: ["points"],
  })
  .refine((b) => b.type !== "tiered" || (b.tiers?.length ?? 0) > 0, {
    message: "tiered tasks require tiers",
    path: ["tiers"],
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
});
export type PatchTaskBody = z.infer<typeof PatchTaskBody>;

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

// Recap returned after a roll: what the just-closed period held. Points are computed from current
// config for display only (not a frozen value — see ARCHITECTURE.md on the deferred frozen-points).
export const PeriodRecap = z.object({
  kind: PeriodKindSchema,
  periodKey: z.string(),
  items: z.array(z.object({ taskId: z.string(), text: z.string(), level: z.number().int(), points: Points })),
  totalPoints: Points,
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
