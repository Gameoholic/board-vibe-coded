import { z } from "zod";
import { Points } from "./points.js";
import { TaskSchedule } from "./period.js";
import { PointsSource } from "./pointsFormula.js";

// Trust-boundary caps: generous for a personal board, but bounded so a malformed or hostile body
// can't store unbounded strings. `%` values are validated as integer thousandths (see points.ts).
const TEXT_MAX = 500;
const ESTIMATE_MAX = 200;
// A task's estimated duration in minutes, bounded so a hostile body can't store an absurd number.
// Generous (~69 days) for a personal board — the cap is a guard, not a product limit.
const MINUTES_MAX = 100_000;
const LABEL_MAX = 100;
// A task's optional free-text description — prose, so roomier than the one-line name.
const DESCRIPTION_MAX = 1000;
// A task's box count / a streak requirement is bounded so a hostile body can't ask for a
// million boxes. Generous for a personal board.
const QTY_MAX = 100;
// Why a blocked task is waiting ("the insurance letter") — a short note, not prose.
const BLOCK_NOTE_MAX = 200;

// A task's type. "checkbox" is the general case — a row of `count` boxes (default 1, i.e. a plain
// checkbox), each worth `points`; "tiered" is a pick-one ladder; "repeatable" is a single box that
// can be completed infinitely, storing its completion count in `progress` (unbounded) and worth
// `points` per completion — the whiteboard tally. "once" is a single-completion checkbox for tasks
// that are done exactly once and then gone (the Tasks tab) — behaviorally a 1-box checkbox, but its
// own type so it never carries a box count or scheduled times, and the add/edit forms never offer
// those controls for it (see taskKinds.ts). The retired "count" type folded into "checkbox"
// (which grew the optional box count) — legacy events carrying it are normalised to "checkbox" on
// read (see events.ts), so no migration was needed.
export const TaskType = z.enum(["checkbox", "tiered", "repeatable", "once"]);
export type TaskType = z.infer<typeof TaskType>;

export const AllowedType = z.object({ type: TaskType });
export type AllowedType = z.infer<typeof AllowedType>;

export const TierDef = z.object({
  label: z.string().trim().min(1).max(LABEL_MAX),
  points: Points,
  // Optional estimated duration in minutes, captured from the tier's points builder. Feeds the tier
  // timer's auto-advance thresholds (see TierTimer) — previously those were scraped from the tier
  // label, which is auto-generated ("Tier 1") and so never matched. Absent ≡ no estimate for this tier.
  minutes: z.number().nonnegative().max(MINUTES_MAX).optional(),
  // Which effort preset (index into Settings.pointsFormula.effortLevels) this tier's builder used, so a
  // rate/effort change can recompute its %. Absent ≡ Normal (index 0).
  effortIndex: z.number().int().nonnegative().optional(),
  // Whether this tier's % came from the builder's time calc or was overridden — see PointsSource.
  // Absent on tiers with no estimate; the projection defaults it (derive-once) for pre-feature tiers.
  pointsSource: PointsSource.optional(),
});
export type TierDef = z.infer<typeof TierDef>;

export const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "color must be a hex string like #6366f1");

// Where a task stands in its tab's Status bands: being worked on, waiting its turn (the default — a
// task that never had a status is in the backlog), or stuck on something. Organisation only: it never
// touches points, order or progress. The words the owner sees are display labels, not these ids.
export const TaskStatus = z.enum(["in-progress", "backlog", "blocked"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

// Why a task is blocked: a short note, the task it's waiting on (which releases it once done), or both.
// `resume` is the status it goes back to when that task is done — where it was before it was blocked.
export const TaskBlocker = z.object({
  note: z.string().max(BLOCK_NOTE_MAX).optional(),
  taskId: z.string().optional(),
  resume: TaskStatus.exclude(["blocked"]),
});
export type TaskBlocker = z.infer<typeof TaskBlocker>;

export const Timer = z.object({
  elapsedMs: z.number().nonnegative(),
  isRunning: z.boolean(),
  startedAt: z.number().optional(),
});
export type Timer = z.infer<typeof Timer>;

// A tab is either a list of tasks or a list of streaks. Fixed in the seed (users can't create tabs),
// so `kind` is authored server-side; it defaults to "tasks" so events predating streaks project fine.
export const SectionKind = z.enum(["tasks", "streaks"]);
export type SectionKind = z.infer<typeof SectionKind>;

// A section's recurrence cadence, seed-authored (like `kind`): "day" (its tasks recur daily) or
// "week" (weekly). It's what a scheduled box's cadence is *inferred* from — a task in a "day" section
// schedules by time only, a "week" section by weekday (+ optional time) — so daily/weekly is read off
// the tab, never chosen per task. It's also what a period roll resets: a new day unchecks every task
// in a "day" tab, a new week every task in a "week" tab. Optional: a section without one schedules
// daily by default and is never reset.
export const SectionPeriod = z.enum(["day", "week"]);
export type SectionPeriod = z.infer<typeof SectionPeriod>;

export const Section = z.object({
  id: z.string(),
  name: z.string(),
  color: HexColor,
  kind: SectionKind.default("tasks"),
  period: SectionPeriod.optional(),
  allowedTypes: z.array(AllowedType).min(1),
  // Seed-authored, like `kind`: this tab is the Freezer of that tab — where its tasks freeze when they've
  // waited too long, and thaw back from (see freezer.ts). The code knows the pairing, never a tab's name.
  freezerFor: z.string().optional(),
});
export type Section = z.infer<typeof Section>;

// A modifier as it applied to a task (see modifiers.ts): which one, its kind, and its value — a share of
// the task's own points (0.4 ≡ +40%), a flat amount or a floor (in points), or a factor (2 ≡ ×2). Frozen on
// a completion so it's paid at what applied then. The id is a plain string here, so an event naming a
// modifier that's since been retired still parses.
export const ModifierKind = z.enum(["share", "flat", "factor", "floor"]);
export type ModifierKind = z.infer<typeof ModifierKind>;
// `piecesPaid` is on a floor of a broken-down task's own completion: a floor is on the whole task, so it
// counts what the pieces had paid, and the task's own completion pays the rest.
export const AppliedModifier = z.object({ id: z.string(), kind: ModifierKind, value: z.number(), piecesPaid: Points.optional() });
export type AppliedModifier = z.infer<typeof AppliedModifier>;

// The task read-model (a projection of the event log). Scoring fields (points/tiers) are the task's
// *current* config; the frozen award for any given completion lives on the event, not here.
export const Task = z.object({
  id: z.string(),
  sectionId: z.string(),
  type: TaskType,
  text: z.string().max(TEXT_MAX),
  done: z.boolean(),
  // Position within its section, server-derived from the section order (never evented). Optional so a
  // hand-built Task literal (tests) needn't set it — the projection always does.
  order: z.number().int().optional(),
  // The group this task belongs to, if any (see Group). A group is a contiguous run of tasks sharing
  // this id; membership is set when the group is created and cleared when it's deleted.
  groupId: z.string().optional(),
  points: Points.optional(),
  estimate: z.string().max(ESTIMATE_MAX).optional(),
  // Optional estimated duration in minutes for a checkbox task, derived from its points builder (a
  // duration was picked). Absent ≡ no estimate. Tiered tasks store their estimate per-tier (TierDef).
  estimateMinutes: z.number().nonnegative().max(MINUTES_MAX).optional(),
  // Which effort preset (index into Settings.pointsFormula.effortLevels) a checkbox task's builder used.
  // Absent ≡ Normal (index 0). Lets a rate/effort change recompute the % from the estimate.
  estimateEffortIndex: z.number().int().nonnegative().optional(),
  // Whether a checkbox task's % came from the builder's time calc or was overridden (see PointsSource).
  // Stored, not re-derived. Absent for tiered tasks and pre-feature tasks (projection derives once).
  pointsSource: PointsSource.optional(),
  // Optional free-text note shown behind an info affordance on the row (absent ≡ none).
  description: z.string().max(DESCRIPTION_MAX).optional(),
  tiers: z.array(TierDef).optional(),
  activeTier: z.number().int().nullable().optional(),
  // Checkbox tasks: `count` boxes (absent ≡ 1, a plain checkbox), each worth `points`. A 1-box task
  // ticks via `done`; a multi-box one via `progress` (how many are ticked, 0..count). See taskKinds.ts.
  count: z.number().int().min(1).max(QTY_MAX).optional(),
  // Completions so far: 0..count for a multi-box checkbox; unbounded for a "repeatable" task (which
  // has no `count`), where each increment is one completion worth `points`.
  progress: z.number().int().nonnegative().optional(),
  // Optional per-box scheduled time ("do this box at a certain hour"). Indexed by box; a null slot is
  // unscheduled. Duck-typed onto any checkbox task — a locked box shows a lock until its time arrives
  // (see isBoxLocked). Absent ≡ no box is scheduled.
  schedule: TaskSchedule.optional(),
  timer: Timer.optional(),
  // Pruned: skipped until its tab's current day/week rolls over, and hidden from the list until then.
  // Server-derived on read (never stored on the task) — absent ≡ not pruned.
  pruned: z.boolean().optional(),
  // Its Status band (absent ≡ backlog), when it last changed band, and — only while blocked — why.
  status: TaskStatus.optional(),
  statusSince: z.string().optional(),
  blocker: TaskBlocker.optional(),
  // A piece of a broken-down task: the task it sits inside (one level deep — a piece never has pieces).
  // Pieces aren't items of their tab's list; they're listed under their task, in its own order.
  parentId: z.string().optional(),
  // This week's Bounty, while it's on this task: its multiplier and the week it was rolled for. Derived
  // on read (it ends with that week) — absent ≡ not the Bounty.
  bounty: z.object({ multiplier: z.number(), periodKey: z.string() }).optional(),
  // This week's Booster, while it's on this task: what it adds to each tick and the week it was picked for.
  // Derived on read (it ends with that week) — absent ≡ not a Booster.
  booster: z.object({ amount: Points, periodKey: z.string() }).optional(),
  // The modifiers its current completion was paid at (a Bounty's ×2, its frost, a Booster's +0.5%, …), frozen
  // on the event that ticked it so a Bounty ending or a setting changing later never re-prices it. Absent ≡
  // none.
  paidWith: z.array(AppliedModifier).optional(),
  // Frost: the whole days it has spent in the Freezer, banked at each week's end (see freezer.ts). It stays
  // when the task thaws and carries on from there if it freezes again. Absent ≡ none.
  frostDays: z.number().int().nonnegative().optional(),
  // When it last froze or thawed — since when it's been in its tab. Absent ≡ never: since it was created.
  tabSince: z.string().optional(),
  // How long it has waited (see waitDays): the stretches already over, in ms, and when the current one
  // began — absent while In progress pauses it. Freezing or thawing starts it again from nothing.
  waitMs: z.number().nonnegative().optional(),
  waitingSince: z.string().optional(),
  // The thaw bonus it was paid when it thawed with frost — part of its points while it stays In progress
  // or is done, taken back for good once it leaves In progress. Absent ≡ none.
  thawBonus: Points.optional(),
  // Data-silo timestamps, server-authored. Additive — the UI may ignore them.
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type Task = z.infer<typeof Task>;

// A group bundles a contiguous run of a section's items under one label — a generic, user-editable
// primitive (never a hardcoded group). It's list structure, so it works the same over any list: a
// board tab's tasks or a shop tab's rewards (`sectionId` is whichever tab it's in). It carries no
// scoring and has no position of its own; its place is wherever its members sit (they must stay
// contiguous and move as a block). Membership lives on the items (`groupId`), set when the group is
// created and cleared when it's deleted. History-wise it mirrors a task: created / edited / deleted
// events, no frozen values.
export const Group = z.object({
  id: z.string(),
  sectionId: z.string(),
  label: z.string().max(LABEL_MAX),
});
export type Group = z.infer<typeof Group>;

// ---- Streaks ----
// A streak is a separate entity that lives in a "streaks" section and points at tasks by id. Its
// count is never stored — it's derived from the completion history in the event log (see streak.ts).
// A streak's type. "daily"/"weekly" count consecutive satisfied periods; "counter" is a running
// tally of matched completions (per task, per local day, so a same-day re-check isn't double-counted)
// with no consecutiveness. Named "type" (was "period") since a counter isn't a period — stored events
// may still carry the old "period" key, which is accepted on read (see events.ts / projection.ts).
export const StreakType = z.enum(["daily", "weekly", "counter"]);
export type StreakType = z.infer<typeof StreakType>;

// Whether a period counts when ALL required tasks were completed in it, or just ANY. Per-streak.
// Ignored by "counter" streaks, which sum each task's satisfied days independently (additive, no AND/OR).
export const StreakMode = z.enum(["all", "any"]);
export type StreakMode = z.infer<typeof StreakMode>;

// Where a streak begins counting (shown in the UI as "Now" vs "All time"). "created" (labelled
// "Now"; default) windows the fold to the streak's createdAt, so a fresh streak starts from zero.
// "all" drops that window and counts the linked tasks' whole history — trustworthy because settled
// (closed) periods snapshot only what was genuinely done, so a checked-then-unchecked box a week ago
// never inflates it. A "counter" honours this too: "Now" = the live sum of currently-ticked boxes,
// "all" = the lifetime tick total (each day's reached level, honest via those same snapshots).
export const StreakSince = z.enum(["created", "all"]);
export type StreakSince = z.infer<typeof StreakSince>;

// A single filter-mode rule. Only tag matching exists as a shape today and nothing evaluates it yet
// (the filter matcher is a debug-only UX shell) — it lights up once tags + a filter engine land.
export const StreakFilterRule = z.object({
  field: z.enum(["tag"]),
  op: z.enum(["is"]),
  value: z.string().max(LABEL_MAX),
});
export type StreakFilterRule = z.infer<typeof StreakFilterRule>;

// How many completions of a tracked task a period needs. A number means "at least N times this
// period" (whip dropped on box N); "all" means "every box", resolved live against the task's current
// box count — so changing a count task's amount later moves the requirement with it (whip on the row).
export const TaskRequirement = z.union([z.number().int().min(1).max(QTY_MAX), z.literal("all")]);
export type TaskRequirement = z.infer<typeof TaskRequirement>;

export const TaskCondition = z.object({
  taskId: z.string(),
  required: TaskRequirement.default("all"),
});
export type TaskCondition = z.infer<typeof TaskCondition>;

// How a streak selects the tasks it tracks. "tasks" is an explicit condition list (functional today);
// "filter" is the deferred tag-driven mode, stored but not yet evaluated. Legacy events stored a bare
// `taskIds` array — it's normalised to conditions requiring one completion (exactly the old "was it
// done this period?" behaviour), so pre-existing streaks project unchanged with no migration.
const TasksMatcher = z
  .object({
    kind: z.literal("tasks"),
    taskIds: z.array(z.string()).max(50).optional(),
    conditions: z.array(TaskCondition).max(50).optional(),
  })
  .transform((m) => ({
    kind: "tasks" as const,
    conditions:
      m.conditions ?? (m.taskIds ?? []).map((taskId) => ({ taskId, required: 1 as const })),
  }));

export const StreakMatcher = z.union([
  TasksMatcher,
  z.object({ kind: z.literal("filter"), rules: z.array(StreakFilterRule).max(20) }),
]);
export type StreakMatcher = z.infer<typeof StreakMatcher>;

export const Streak = z.object({
  id: z.string(),
  sectionId: z.string(),
  name: z.string().max(TEXT_MAX),
  type: StreakType,
  mode: StreakMode,
  // Absent on events predating the feature → "created", the original behaviour, so old streaks
  // project unchanged with no migration.
  since: StreakSince.default("created"),
  // A one-time backfilled starting value — the count carried over from before the app (e.g. a streak
  // kept on the physical whiteboard). Being the *pre-app history*, it's added to the computed value
  // only when counting from "all" (All time); counting from "created" (Now) starts fresh and ignores
  // it. Editing it (from Settings) shifts only that baseline term. Absent on pre-feature events → 0,
  // so old streaks project unchanged with no migration.
  legacy: z.number().int().min(0).default(0),
  // Backfill for the "best" (record longest run) — a static floor, NOT additive: the displayed best is
  // `max(legacyBest, longest run in app history)`. So it seeds a pre-app record the app then only ever
  // beats. Daily/weekly only (a counter has no run). Absent on old events → 0, no migration.
  legacyBest: z.number().int().min(0).default(0),
  matcher: StreakMatcher,
  // List structure, exactly as on a task or reward: the group it's in (if any) and its position in
  // its section (server-derived from the section's item order, never evented). See Group.
  groupId: z.string().optional(),
  order: z.number().int().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Streak = z.infer<typeof Streak>;

// The read shape the API serves: the definition plus the derived count and whether the current
// period is already satisfied (a lit flame vs. a grace day). Both are computed, never persisted.
export const StreakView = Streak.extend({
  count: z.number().int().nonnegative(),
  active: z.boolean(),
  // Longest run ever (daily/weekly), floored by legacyBest; 0 for counters. Derived, never stored.
  best: z.number().int().nonnegative(),
});
export type StreakView = z.infer<typeof StreakView>;

// ---- Shop ----
// The shop spends the board's own points on rewards the owner defines. Shop sections are the shop's
// tabs: purely organisational shelves (no behaviour differs between them) that — unlike the board's
// fixed tabs — are created, renamed, recoloured and deleted from the UI. Nothing here is hardcoded.
// A single glyph can span several UTF-16 units (ZWJ sequences, skin tones), hence the headroom.
const EMOJI_MAX = 16;

export const ShopSection = z.object({
  id: z.string(),
  name: z.string().max(LABEL_MAX),
  color: HexColor,
});
export type ShopSection = z.infer<typeof ShopSection>;

// What a reward is: bought again and again (a video, a film); bought once and then yours (headphones, a
// trip — it leaves its shelf, like a one-time task); or an Item, whose purchase gives you a game
// mechanic (a Bounty reroll). Every reward from before kinds was repeatable, so absent reads as that.
export const RewardKind = z.enum(["repeatable", "once", "game"]);
export type RewardKind = z.infer<typeof RewardKind>;

// The items a "game" reward (an Item) can give. What buying one does is the server's (BoardStore's item
// grants); its name, emoji and price are the owner's, like any reward's.
export const GameItemId = z.enum(["bounty-reroll", "booster-reroll"]);
export type GameItemId = z.infer<typeof GameItemId>;

export const Reward = z.object({
  id: z.string(),
  shopSectionId: z.string(),
  name: z.string().max(TEXT_MAX),
  emoji: z.string().max(EMOJI_MAX),
  // Its price before modifiers (the weekend sale) — what it costs now is priceOf (modifiers.ts).
  cost: Points,
  note: z.string().max(DESCRIPTION_MAX).optional(),
  kind: RewardKind,
  // The item a "game" reward gives (absent on every other kind).
  item: GameItemId.optional(),
  // Whether the weekend sale takes its share off this reward (Settings → Weekend sale).
  onSale: z.boolean(),
  // Times bought, and when it last was — derived from RewardPurchased events, never stored.
  redeemed: z.number().int().nonnegative(),
  boughtAt: z.string().optional(),
  // List structure, exactly as on a task: the group it's in (if any) and its position in its shop
  // section (server-derived from the section order, never evented). See Group.
  groupId: z.string().optional(),
  order: z.number().int().optional(),
  createdAt: z.string(),
});
export type Reward = z.infer<typeof Reward>;

/** Whether a reward has left its shelf: a one-time reward once it's bought. It isn't deleted — it's still
 *  in the shop's state and history, just not listed (the tab's Display can show it). */
export const isBought = (reward: Pick<Reward, "kind" | "redeemed">): boolean => reward.kind === "once" && reward.redeemed > 0;

// One item the owner has: those bought and not yet used (kept from week to week), and the open
// week's free ones left (a Bounty reroll's — gone when the week ends).
export const InventoryItem = z.object({
  item: GameItemId,
  owned: z.number().int().nonnegative(),
  free: z.number().int().nonnegative(),
});
export type InventoryItem = z.infer<typeof InventoryItem>;

// The shop read model in one payload. `spent` is the sum of every purchase's frozen pointsSpent —
// the client shows the owner's points as the board's live total minus it. `groups` are the shop
// sections' groups (the board's are served by /api/groups). `inventory` is every item and how
// many the owner has; `saleStarted` whether the weekend sale was started early this week.
export const Shop = z.object({
  sections: z.array(ShopSection),
  rewards: z.array(Reward),
  groups: z.array(Group),
  spent: Points,
  inventory: z.array(InventoryItem).default([]),
  saleStarted: z.boolean().default(false),
});
export type Shop = z.infer<typeof Shop>;

export { TEXT_MAX, ESTIMATE_MAX, MINUTES_MAX, DESCRIPTION_MAX, LABEL_MAX, QTY_MAX, EMOJI_MAX, BLOCK_NOTE_MAX };
