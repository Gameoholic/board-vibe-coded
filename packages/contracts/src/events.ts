import { z } from "zod";
import {
  HexColor,
  SectionKind,
  SectionPeriod,
  StreakMatcher,
  StreakMode,
  StreakSince,
  StreakType,
  TierDef,
} from "./domain.js";
import { PeriodKindSchema, PeriodSnapshotEntry, Settings, TaskSchedule } from "./period.js";
import { Points } from "./points.js";
import { PointsSource } from "./pointsFormula.js";

// The append-only event log is the sole source of truth; current state is a projection folded from
// these. History is never mutated in place — an edit or a delete is another event, and each scoring
// event freezes the resolved award (pointsAwarded) so a later rebalance can't rewrite the past.

// The "count" task type was retired — it folded into "checkbox" (which gained an optional box count).
// Stored events still carry it, and `BoardEvent.parse` runs on every row on the way out of the DB, so
// we accept it here and normalise it to "checkbox" on read (like the streak `period → type` alias) —
// no backfill, the projection sees only current-vocabulary types.
const StoredTaskType = z
  .enum(["checkbox", "tiered", "count", "repeatable", "once"])
  .transform((t) => (t === "count" ? ("checkbox" as const) : t));

// Section allowed-types as stored: fold the retired "count" into "checkbox", then dedupe (a pre-merge
// Weekly listed both, which now collapse to a single "checkbox").
const StoredAllowedTypes = z
  .array(z.object({ type: StoredTaskType }))
  .min(1)
  .transform((arr) => {
    const seen = new Set<string>();
    return arr.filter((a) => (seen.has(a.type) ? false : (seen.add(a.type), true)));
  });

// The subset of a task's fields an edit can change. `changes` holds the new values; `previous` holds
// what they were, so the log answers "what did this become, and from what" without a diff pass.
export const TaskEditFields = z.object({
  text: z.string().optional(),
  points: Points.optional(),
  estimate: z.string().nullable().optional(),
  estimateMinutes: z.number().nullable().optional(),
  estimateEffortIndex: z.number().int().nullable().optional(),
  pointsSource: PointsSource.optional(),
  description: z.string().nullable().optional(),
  tiers: z.array(TierDef).optional(),
  // The box count. `target` is the pre-merge name — accepted on read and resolved to `count` in the
  // projection (count ?? target), so old TaskEdited events still apply with no migration.
  count: z.number().int().optional(),
  target: z.number().int().optional(),
  // Per-box scheduled times (see domain Task.schedule). The full array is sent on edit; the
  // projection normalises an all-unscheduled array back to "no schedule".
  schedule: TaskSchedule.optional(),
});
export type TaskEditFields = z.infer<typeof TaskEditFields>;

// The subset of a streak an edit can change; `previous` mirrors it so history is self-describing.
export const StreakEditFields = z.object({
  name: z.string().optional(),
  type: StreakType.optional(),
  // Legacy alias: edits logged before the rename stored `period`. Kept optional so old StreakEdited
  // events still parse; the projection reads `type ?? period` when applying (no migration).
  period: StreakType.optional(),
  mode: StreakMode.optional(),
  since: StreakSince.optional(),
  // Backfilled starting count / record-best floor (edited from Settings). Optional so most edits omit.
  legacy: z.number().int().min(0).optional(),
  legacyBest: z.number().int().min(0).optional(),
  matcher: StreakMatcher.optional(),
});
export type StreakEditFields = z.infer<typeof StreakEditFields>;

// The subsets of a shop section / reward an edit can change; `previous` mirrors them (cf. TaskEdited).
export const ShopSectionEditFields = z.object({
  name: z.string().optional(),
  color: HexColor.optional(),
});
export type ShopSectionEditFields = z.infer<typeof ShopSectionEditFields>;

export const RewardEditFields = z.object({
  name: z.string().optional(),
  emoji: z.string().optional(),
  cost: Points.optional(),
  // Nullable so an edit can clear the note (and `previous` can record that there was none).
  note: z.string().nullable().optional(),
});
export type RewardEditFields = z.infer<typeof RewardEditFields>;

export const BoardEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("SectionCreated"),
    sectionId: z.string(),
    name: z.string(),
    color: HexColor,
    // Optional so events written before streaks existed still parse; the projection defaults to "tasks".
    kind: SectionKind.optional(),
    // Recurrence cadence (see domain SectionPeriod); optional — absent ≡ no cadence (daily default).
    period: SectionPeriod.optional(),
    allowedTypes: StoredAllowedTypes,
  }),
  z.object({ type: z.literal("SectionRecolored"), sectionId: z.string(), color: HexColor }),
  // Sets a section's recurrence cadence. Not exposed in the UI (sections are static by design) — used
  // only by the seed migration that backfills `period` onto pre-existing Daily/Weekly/Registry tabs.
  z.object({ type: z.literal("SectionPeriodSet"), sectionId: z.string(), period: SectionPeriod }),
  // Replaces a section's allowed task types. Not exposed in the UI (sections are static by design) —
  // used only by seed migrations that backfill a newly-added type onto pre-existing boards.
  z.object({
    type: z.literal("SectionAllowedTypesSet"),
    sectionId: z.string(),
    allowedTypes: StoredAllowedTypes,
  }),
  z.object({ type: z.literal("SectionsReordered"), orderedIds: z.array(z.string()) }),
  z.object({
    type: z.literal("TaskCreated"),
    taskId: z.string(),
    sectionId: z.string(),
    taskType: StoredTaskType,
    text: z.string(),
    points: Points.optional(),
    estimate: z.string().optional(),
    estimateMinutes: z.number().optional(),
    estimateEffortIndex: z.number().int().optional(),
    pointsSource: PointsSource.optional(),
    description: z.string().optional(),
    tiers: z.array(TierDef).optional(),
    // Box count. `target` is the pre-merge name, resolved to `count` in the projection (count ?? target).
    count: z.number().int().optional(),
    target: z.number().int().optional(),
    // Per-box scheduled times (see domain Task.schedule); absent ≡ nothing scheduled.
    schedule: TaskSchedule.optional(),
  }),
  z.object({ type: z.literal("TaskCompleted"), taskId: z.string(), pointsAwarded: Points }),
  z.object({ type: z.literal("TaskUncompleted"), taskId: z.string() }),
  z.object({
    type: z.literal("TaskTierSet"),
    taskId: z.string(),
    activeTier: z.number().int().nullable(),
    pointsAwarded: Points,
  }),
  // A count task's ticked-box count moved to `progress` (0..target); pointsAwarded freezes the value
  // reached at that moment (points × progress). Its own event, mirroring TaskTierSet.
  z.object({
    type: z.literal("TaskProgressSet"),
    taskId: z.string(),
    progress: z.number().int().nonnegative(),
    pointsAwarded: Points,
  }),
  z.object({
    type: z.literal("TaskEdited"),
    taskId: z.string(),
    changes: TaskEditFields,
    previous: TaskEditFields,
  }),
  // Reorders a section's tasks. When tasks are grouped they move as a block, so `orderedIds` always
  // keeps each group's members contiguous — but the event itself is just the flat task-id order.
  z.object({ type: z.literal("TasksReordered"), sectionId: z.string(), orderedIds: z.array(z.string()) }),
  z.object({ type: z.literal("TaskDeleted"), taskId: z.string() }),
  // A group (a labeled bundle of a list's contiguous items) was created / relabeled / removed. Groups are
  // list structure, not task structure: the members are whatever the section lists — a board tab's
  // tasks or a shop tab's rewards. It carries no scoring, so no frozen values. `itemIds` on create is
  // the initial membership (each gets groupId); delete clears groupId on its members. `previousLabel`
  // keeps an edit self-describing (cf. TaskEdited).
  // Member ids were named `taskIds` / `addedTaskIds` / `removedTaskIds` when only tasks could be
  // grouped. New events write the `item` names; the old ones stay optional so logged events still
  // parse, and the projection resolves `itemIds ?? taskIds` (the streak `streakType ?? period` pattern).
  z.object({
    type: z.literal("GroupCreated"),
    groupId: z.string(),
    sectionId: z.string(),
    label: z.string(),
    itemIds: z.array(z.string()).optional(),
    taskIds: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal("GroupEdited"), groupId: z.string(), label: z.string(), previousLabel: z.string() }),
  z.object({
    type: z.literal("GroupMembersAdded"),
    groupId: z.string(),
    addedItemIds: z.array(z.string()).optional(),
    addedTaskIds: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal("GroupMembersRemoved"),
    groupId: z.string(),
    removedItemIds: z.array(z.string()).optional(),
    removedTaskIds: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal("GroupDeleted"), groupId: z.string() }),
  z.object({
    type: z.literal("StreakCreated"),
    streakId: z.string(),
    sectionId: z.string(),
    name: z.string(),
    // New events write `streakType`; events logged before the rename wrote `period` (daily/weekly
    // only). Both optional here so old rows still parse — the projection resolves streakType ?? period.
    streakType: StreakType.optional(),
    period: StreakType.optional(),
    mode: StreakMode,
    // Absent on events predating the "count from all time" option → "created" in the projection.
    since: StreakSince.optional(),
    // Backfilled starting count + record-best floor. Absent on pre-feature events / normal creates → 0.
    // Carried here so reset-progress-keep-board (which re-emits StreakCreated) preserves them.
    legacy: z.number().int().min(0).optional(),
    legacyBest: z.number().int().min(0).optional(),
    matcher: StreakMatcher,
  }),
  z.object({
    type: z.literal("StreakEdited"),
    streakId: z.string(),
    changes: StreakEditFields,
    previous: StreakEditFields,
  }),
  z.object({ type: z.literal("StreaksReordered"), sectionId: z.string(), orderedIds: z.array(z.string()) }),
  z.object({ type: z.literal("StreakDeleted"), streakId: z.string() }),
  // Board settings changed (timezone, day-start, week-start). A full snapshot, not a delta — the
  // projection keeps only the latest, so there's nothing to diff and a rebuild lands on the last one.
  z.object({ type: z.literal("SettingsChanged"), settings: Settings }),
  // A day/week period became the current open one. Its occurredAt is when it started; the key is the
  // day/week it represents (server-computed from settings at the time, then frozen on the event).
  z.object({ type: z.literal("PeriodStarted"), kind: PeriodKindSchema, periodKey: z.string() }),
  // A period was closed: its snapshot freezes every task's filled level at close time — the honest
  // record a streak counts (a box unchecked before close simply isn't in it). Every task is included
  // so a streak added later can still reach back into this period.
  z.object({
    type: z.literal("PeriodClosed"),
    kind: PeriodKindSchema,
    periodKey: z.string(),
    snapshot: z.array(PeriodSnapshotEntry),
  }),
  // A period close unchecked the tasks of the tabs that recur on that cadence (a new day clears the
  // "day" tabs, a new week the "week" ones). `pointsBanked` freezes what those tasks held at that
  // moment, so the owner keeps the points the unchecking takes off the board (cf. pointsSpent).
  z.object({ type: z.literal("TasksReset"), taskIds: z.array(z.string()), pointsBanked: Points }),
  // ---- Shop ---- spending the board's points on owner-defined rewards. Shop sections (the shop's
  // tabs) and rewards mirror groups/tasks: created / edited (changes + previous) / deleted; deleting a
  // shop section removes its rewards with it. A purchase freezes what it cost (`pointsSpent`, the
  // counterpart of `pointsAwarded`), so editing or deleting the reward later never rewrites what was
  // paid — and because spending lives in its own events, lifetime points earned stay derivable from the
  // scoring events alone, independent of anything spent.
  z.object({ type: z.literal("ShopSectionCreated"), shopSectionId: z.string(), name: z.string(), color: HexColor }),
  z.object({
    type: z.literal("ShopSectionEdited"),
    shopSectionId: z.string(),
    changes: ShopSectionEditFields,
    previous: ShopSectionEditFields,
  }),
  z.object({ type: z.literal("ShopSectionDeleted"), shopSectionId: z.string() }),
  z.object({
    type: z.literal("RewardCreated"),
    rewardId: z.string(),
    shopSectionId: z.string(),
    name: z.string(),
    emoji: z.string(),
    cost: Points,
    note: z.string().optional(),
  }),
  z.object({
    type: z.literal("RewardEdited"),
    rewardId: z.string(),
    changes: RewardEditFields,
    previous: RewardEditFields,
  }),
  z.object({ type: z.literal("RewardDeleted"), rewardId: z.string() }),
  // Reorders a shop section's rewards — the reward counterpart of TasksReordered (a group's members
  // are kept contiguous by the client, so this is just the flat reward-id order).
  z.object({ type: z.literal("RewardsReordered"), shopSectionId: z.string(), orderedIds: z.array(z.string()) }),
  z.object({ type: z.literal("RewardPurchased"), rewardId: z.string(), pointsSpent: Points }),
]);
export type BoardEvent = z.infer<typeof BoardEvent>;
export type BoardEventType = BoardEvent["type"];

/** An event as persisted: the envelope the store stamps around a BoardEvent. */
export interface StoredEvent {
  seq: number;
  id: string;
  occurredAt: string;
  event: BoardEvent;
  idempotencyKey: string | null;
}
