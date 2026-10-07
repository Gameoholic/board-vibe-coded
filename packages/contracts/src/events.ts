import { z } from "zod";
import {
  AppliedModifier,
  GameItemId,
  HexColor,
  RewardKind,
  SectionKind,
  SectionPeriod,
  StreakMatcher,
  StreakMode,
  StreakSince,
  StreakType,
  TaskPriority,
  TaskStatus,
  TierDef,
} from "./domain.js";
import { PeriodKindSchema, PeriodSnapshotEntry, Settings, TaskSchedule } from "./period.js";
import { Points } from "./points.js";
import { EffortId, PointsSource } from "./pointsFormula.js";

// The append-only event log is the sole source of truth; current state is a projection folded from
// these. History is never mutated in place — an edit or a delete is another event, and each scoring
// event freezes the resolved award (pointsAwarded) so a later rebalance can't rewrite the past.

// The "count" task type was retired — it folded into "checkbox" (which gained an optional box count).
// Stored events still carry it, and `BoardEvent.parse` runs on every row on the way out of the DB, so
// we accept it here and normalise it to "checkbox" on read (like the streak `period → type` alias) —
// no backfill, the projection sees only current-vocabulary types.
// A tier as stored. Before effort levels had ids, a tier kept its level's place in the list
// (`effortIndex`); old tiers still carry it, and the projection resolves it to the level it meant.
export const StoredTierDef = TierDef.extend({ effortIndex: z.number().int().nonnegative().optional() });
export type StoredTierDef = z.infer<typeof StoredTierDef>;

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
  estimateEffort: EffortId.nullable().optional(),
  // The pre-id form of estimateEffort (the level's place in the list) — accepted on read and resolved to
  // estimateEffort in the projection, like `target` below.
  estimateEffortIndex: z.number().int().nullable().optional(),
  pointsSource: PointsSource.optional(),
  description: z.string().nullable().optional(),
  tiers: z.array(StoredTierDef).optional(),
  // The box count. `target` is the pre-merge name — accepted on read and resolved to `count` in the
  // projection (count ?? target), so old TaskEdited events still apply with no migration.
  count: z.number().int().optional(),
  target: z.number().int().optional(),
  // Per-box scheduled times (see domain Task.schedule). The full array is sent on edit; the
  // projection normalises an all-unscheduled array back to "no schedule".
  schedule: TaskSchedule.optional(),
  // Its priority (see domain TaskPriority). `previous` always names one — Low for a task never given one.
  priority: TaskPriority.optional(),
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
  onSale: z.boolean().optional(),
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
    // The tab this one is the Freezer of (see domain Section.freezerFor); absent on every other tab.
    freezerFor: z.string().optional(),
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
    estimateEffort: EffortId.optional(),
    // The pre-id form of estimateEffort, resolved in the projection (see TaskEditFields).
    estimateEffortIndex: z.number().int().optional(),
    pointsSource: PointsSource.optional(),
    description: z.string().optional(),
    tiers: z.array(StoredTierDef).optional(),
    // Box count. `target` is the pre-merge name, resolved to `count` in the projection (count ?? target).
    count: z.number().int().optional(),
    target: z.number().int().optional(),
    // Per-box scheduled times (see domain Task.schedule); absent ≡ nothing scheduled.
    schedule: TaskSchedule.optional(),
    // The task this one was copied from by the "Duplicate" row action. History only — the projection
    // doesn't read it; absent on tasks created from scratch.
    duplicatedFrom: z.string().optional(),
    // A piece born inside a task (Break down, or a copy of a piece): listed under that task, not in its
    // tab. Absent on a task of the tab's own list.
    parentId: z.string().optional(),
    // Its priority, where it was made with one: picked in the add form, or carried over from the task it was
    // made from (a copy, a board rebuilt by reset-keep-board). Absent ≡ low.
    priority: TaskPriority.optional(),
  }),
  // `modifiers` are what the completion was paid at (a Bounty's ×2, its frost, …) — frozen here, with the
  // award they produced, so a Bounty ending or a setting changing later never re-prices it. Absent ≡ none.
  // `boost` is how a completion recorded its Bounty's factor before modifiers; kept so those still parse
  // (the fold reads it as a Bounty modifier — see fromBoost).
  z.object({
    type: z.literal("TaskCompleted"),
    taskId: z.string(),
    pointsAwarded: Points,
    modifiers: z.array(AppliedModifier).optional(),
    boost: z.number().optional(),
  }),
  z.object({ type: z.literal("TaskUncompleted"), taskId: z.string() }),
  // `modifiers` here and on TaskProgressSet are what the ticks are paid at, like TaskCompleted's (a Booster's
  // +0.5%, …) — the ones its first tick of the day was paid at, so a later tick never re-prices an earlier one.
  z.object({
    type: z.literal("TaskTierSet"),
    taskId: z.string(),
    activeTier: z.number().int().nullable(),
    pointsAwarded: Points,
    modifiers: z.array(AppliedModifier).optional(),
  }),
  // A count task's ticked-box count moved to `progress` (0..target); pointsAwarded freezes the value
  // reached at that moment (each box paid at the modifiers). Its own event, mirroring TaskTierSet.
  z.object({
    type: z.literal("TaskProgressSet"),
    taskId: z.string(),
    progress: z.number().int().nonnegative(),
    pointsAwarded: Points,
    modifiers: z.array(AppliedModifier).optional(),
  }),
  z.object({
    type: z.literal("TaskEdited"),
    taskId: z.string(),
    changes: TaskEditFields,
    previous: TaskEditFields,
  }),
  // A task's type changed (e.g. a Tasks-tab checkbox became a one-time "once" task). Its own event,
  // not a TaskEdited field, because the type is structural — it decides which fields mean anything —
  // and no UI edits it; only migrations emit it. `previousType` keeps the log self-describing.
  z.object({
    type: z.literal("TaskTypeChanged"),
    taskId: z.string(),
    taskType: StoredTaskType,
    previousType: StoredTaskType,
  }),
  // Reorders a section's tasks. When tasks are grouped they move as a block, so `orderedIds` always
  // keeps each group's members contiguous — but the event itself is just the flat task-id order.
  z.object({ type: z.literal("TasksReordered"), sectionId: z.string(), orderedIds: z.array(z.string()) }),
  z.object({ type: z.literal("TaskDeleted"), taskId: z.string() }),
  // Prune: skip a task until its tab's period rolls over. It records the period it was pruned in, so
  // the roll ends it with no event of its own (the task is pruned only while that period is open).
  z.object({ type: z.literal("TaskPruned"), taskId: z.string(), periodKey: z.string() }),
  z.object({ type: z.literal("TaskUnpruned"), taskId: z.string() }),
  // A task was tucked inside another as a piece (`parentId`), or taken out into its tab's list again
  // (`parentId: null` — "Make it its own task", which lands it right after the task it left). Pieces born
  // by Break down need no such event: their TaskCreated carries the parent. `previousParentId` keeps the
  // log self-describing (cf. TaskEdited).
  z.object({
    type: z.literal("TaskParentSet"),
    taskId: z.string(),
    parentId: z.string().nullable(),
    previousParentId: z.string().nullable(),
  }),
  // A reel for the week `periodKey`'s Bounties: the tasks on its spots, in order — the result of the server's
  // shuffle (a task on as many spots as its weight), recorded so a rebuild replays it and which spot holds
  // which task is settled before any stop. It's good for `rolls` stops. Dealt at the week close (as many
  // stops as Bounties may be on at once), when one is won (Settings' rollOnWin), or for a reroll: that one
  // `replaces` a Bounty, which stops being one, and spends a reroll from `rerollFrom` — the week's free
  // ones, else the bought ones banked. A week has one reel at a time: a new one takes the last one's place.
  z.object({
    type: z.literal("BountyReelDealt"),
    periodKey: z.string(),
    taskIds: z.array(z.string()),
    rolls: z.number().int().positive(),
    replaces: z.string().optional(),
    rerollFrom: z.enum(["week", "bank"]).optional(),
  }),
  // A Bounty for the week `periodKey`: the task on the `spot` its reel stopped on, swung by the owner. It's on until
  // that week closes; the multiplier is the setting's at the time. (Before reels, the server rolled it
  // itself — no `spot` — and a reroll was this event too: `reroll`, with the Bounty it `replaces` and where
  // its reroll was spent `rerollFrom`; one from before a week could hold several has neither, and replaced
  // the week's only Bounty from the free ones. Those still fold as they did.)
  z.object({
    type: z.literal("BountyRolled"),
    taskId: z.string(),
    periodKey: z.string(),
    multiplier: z.number(),
    spot: z.number().int().nonnegative().optional(),
    reroll: z.boolean().optional(),
    replaces: z.string().optional(),
    rerollFrom: z.enum(["week", "bank"]).optional(),
  }),
  // Rerolls granted, frozen at the time: a week's free ones (`week`: Settings' allowance as the week
  // starts — spent first, gone when it closes) or bought ones (`purchase`: banked until used, whatever the
  // week). `periodKey` is the week they were granted in.
  z.object({
    type: z.literal("BountyRerollsGranted"),
    count: z.number().int().nonnegative(),
    source: z.enum(["week", "purchase"]),
    periodKey: z.string(),
  }),
  // A week close's Booster hand for the week `periodKey`: the tasks on its cards, face down, in the order dealt
  // — the result of the server's shuffle, recorded so a rebuild replays it and which card holds which task is
  // settled before any pick. The deal is the server's to know; the owner only sees a card once it's picked.
  // A reroll's deal (`replaces`: the Booster it gives up) spends a bought reroll; the week's other Boosters
  // stay, and one card is picked from it.
  z.object({ type: z.literal("BoosterDealt"), periodKey: z.string(), taskIds: z.array(z.string()), replaces: z.string().optional() }),
  // The weekend sale started early, by hand, for the week `periodKey` — it runs until that week is ended.
  z.object({ type: z.literal("SaleStarted"), periodKey: z.string() }),
  // Booster rerolls bought in the shop, banked until used, whatever the week (cf. BountyRerollsGranted).
  z.object({ type: z.literal("BoosterRerollsGranted"), count: z.number().int().nonnegative() }),
  // One card of that hand picked: the task it held is a Booster until the week closes, adding `amount` (the
  // setting's at the time) to every tick of it.
  z.object({
    type: z.literal("BoosterPicked"),
    periodKey: z.string(),
    card: z.number().int().nonnegative(),
    taskId: z.string(),
    amount: Points,
  }),
  // Reorders one task's pieces (the counterpart of TasksReordered for the list under a task).
  z.object({ type: z.literal("PiecesReordered"), taskId: z.string(), orderedIds: z.array(z.string()) }),
  // A task moved into its tab's Freezer (`sectionId`) — by the owner, or by a week close because it waited
  // longer than Settings allow (`waited`: the whole days it had waited). Its pieces go with it; it leaves its
  // group and its status, and a thaw bonus it held is gone.
  z.object({
    type: z.literal("TaskFrozen"),
    taskId: z.string(),
    sectionId: z.string(),
    waited: z.number().int().nonnegative().optional(),
  }),
  // A task thawed out of the Freezer into its tab (`sectionId`), started: In progress, at the top. Its frost
  // stays (and stops growing). `thawBonus` freezes what it was paid for thawing — none without frost.
  z.object({ type: z.literal("TaskThawed"), taskId: z.string(), sectionId: z.string(), thawBonus: Points.optional() }),
  // A week close banked frost: the whole days each task in a Freezer spent there since its last bank, up to
  // and including `through` (the closing week's last day) — recorded, so a rebuild never counts them again.
  z.object({
    type: z.literal("FrostBanked"),
    periodKey: z.string(),
    through: z.string(),
    tasks: z.array(z.object({ taskId: z.string(), days: z.number().int().nonnegative() })),
  }),
  // The owner moved a task to another Status band (or re-said why it's blocked). A blocked one may
  // carry a note and/or the task it waits on; when that task is done the fold releases it back to where
  // it was, with no event of its own. `previousStatus` keeps the log self-describing (cf. TaskEdited).
  z.object({
    type: z.literal("TaskStatusSet"),
    taskId: z.string(),
    status: TaskStatus,
    previousStatus: TaskStatus,
    note: z.string().optional(),
    blockedBy: z.string().optional(),
  }),
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
  // A week's start also freezes where every streak stands as it begins (`streaks`) — a count is derived
  // from history, so "what it was then" has to be kept, not recomputed; the week's recap compares it with
  // the next start. Absent on a day's start and on weeks started before it was recorded.
  z.object({
    type: z.literal("PeriodStarted"),
    kind: PeriodKindSchema,
    periodKey: z.string(),
    streaks: z.array(z.object({ streakId: z.string(), count: z.number().int().nonnegative() })).optional(),
  }),
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
    // Optional so a reward from before kinds still parses: it was repeatable, and — the shop's rewards then
    // being its leisure ones — on sale. `item` is what a "game" reward gives.
    kind: RewardKind.optional(),
    item: GameItemId.optional(),
    onSale: z.boolean().optional(),
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
  // `cost` is its price then and `modifiers` what changed it (the weekend sale), frozen like a completion's —
  // both absent on purchases from before price modifiers, when what was spent was the price.
  z.object({
    type: z.literal("RewardPurchased"),
    rewardId: z.string(),
    pointsSpent: Points,
    cost: Points.optional(),
    modifiers: z.array(AppliedModifier).optional(),
  }),
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
