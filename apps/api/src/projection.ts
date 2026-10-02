import { randomUUID } from "node:crypto";
import {
  type AllowedType,
  behaviorOf,
  behaviorOfType,
  type BoardEvent,
  boosted,
  boostOf,
  bountyWeight,
  canBounty,
  canBreakDown,
  canPrune,
  type ClosedPeriod,
  type CompletionRecord,
  computeCounter,
  computeStreak,
  type CreateGroupBody,
  type CreateRewardBody,
  type CreateShopSectionBody,
  type CreateStreakBody,
  type CreateTaskBody,
  dayKeyFor,
  DEFAULT_SETTINGS,
  doneFromPieces,
  effortMultOf,
  type FormulaPreview,
  gatherGroups,
  type Group,
  isRetired,
  newPiecePoints,
  type PatchSettingsBody,
  type PointsFormula,
  pointsFromMinutes,
  resolvePointsSource,
  type PeriodKind,
  type PeriodRecap,
  type RecapDay,
  type RecapPurchase,
  periodKeyFor,
  type PeriodStatus,
  pickWeighted,
  rerollSource,
  PIECES_MAX,
  releasedFrom,
  type Reward,
  type RolledBounty,
  type BountyStatus,
  type RewardEditFields,
  type Section,
  type SectionKind,
  type SectionPeriod,
  type Settings,
  type Shop,
  type ShopSection,
  type ShopSectionEditFields,
  type StoredEvent,
  type Streak,
  type StreakEditFields,
  type StreakView,
  statusChange,
  statusOf,
  type Task,
  type TaskEditFields,
  taskPointValue,
  type TaskStatus,
  type TaskType,
  type TierDef,
  type Timer,
} from "@board/contracts";
import { now as clockNow } from "./clock.js";
import type { AppendResult, EventStore } from "./db.js";
import { badRequest, notFound } from "./errors.js";

// The 2m floor (the builder's smallest bucket, shown as "<2m") is enforced at input, but events
// predating it may carry a sub-2m duration. Clamp on read so folded state never holds one — the log
// stays immutable, we just normalise the value the way TaskType normalises legacy "count" on read.
// Undefined ≡ no estimate, left untouched.
const MIN_ESTIMATE_MINUTES = 2;
function floorMinutes(m: number | undefined): number | undefined {
  return m === undefined ? undefined : Math.max(m, MIN_ESTIMATE_MINUTES);
}
function floorTiers(tiers: TierDef[]): TierDef[] {
  return tiers.map((t) =>
    t.minutes != null && t.minutes < MIN_ESTIMATE_MINUTES ? { ...t, minutes: MIN_ESTIMATE_MINUTES } : t,
  );
}

type TaskCreated = Extract<BoardEvent, { type: "TaskCreated" }>;

// A task's definition as TaskCreated carries it: every field that says what the task *is*, none of its
// progress (done, tier, boxes ticked, timer). The one list of those fields for every command that
// re-creates a task from an existing one (Duplicate, reset-keep-board).
function taskDefinition(t: Task): Omit<TaskCreated, "type" | "taskId" | "sectionId"> {
  return {
    taskType: t.type,
    text: t.text,
    ...(t.points !== undefined ? { points: t.points } : {}),
    ...(t.estimate ? { estimate: t.estimate } : {}),
    ...(t.estimateMinutes !== undefined ? { estimateMinutes: t.estimateMinutes } : {}),
    ...(t.estimateEffortIndex != null ? { estimateEffortIndex: t.estimateEffortIndex } : {}),
    ...(t.pointsSource !== undefined ? { pointsSource: t.pointsSource } : {}),
    ...(t.description ? { description: t.description } : {}),
    ...(t.tiers ? { tiers: t.tiers } : {}),
    ...(t.count !== undefined ? { count: t.count } : {}),
    ...(t.schedule?.some(Boolean) ? { schedule: t.schedule } : {}),
    ...(t.parentId ? { parentId: t.parentId } : {}),
  };
}

// The list a task is ordered in: its tab's, or — for a piece — the task it sits inside.
const listOf = (t: Pick<Task, "sectionId" | "parentId">): string => t.parentId ?? t.sectionId;

// The shape shared by everything a section can list (tasks, rewards): enough for order and groups.
interface ListItem {
  id: string;
  groupId?: string;
}

// The read model: current board state, folded from the event log. `apply` is the single fold used
// both to rebuild on boot and to advance state after each new append, so live state and a from-
// scratch replay can never disagree. Timers are the one exception — transient, never evented (they
// reset on restart, matching the product's "ephemeral timer" rule), so they live in a side map.

export class BoardStore {
  private sections: Section[] = [];
  private tasks: Task[] = [];
  // Labeled bundles of contiguous tasks. A group has no position of its own — membership lives on the
  // tasks (`task.groupId`); the group just holds the label.
  private groups: Group[] = [];
  // Per-section task id order — the single source of truth for row order in a section. Rebuilt from
  // the log (TaskCreated appends, TasksReordered sets); selectors read each task's `order` from it.
  private itemOrder = new Map<string, string[]>();
  private streaks: Streak[] = [];
  private timers = new Map<string, Timer>();
  // Pruned tasks → the period key each was pruned in. A task is pruned only while that period is its
  // tab's open one (see isPruned), so a period roll ends it without an event; stale keys are harmless.
  private prunedIn = new Map<string, string>();
  // Every moment a box was checked, in log order. Streak counts fold over this (see computeStreak).
  // Unchecking doesn't remove a record — the day was still checked, which is what a streak counts.
  private completions: CompletionRecord[] = [];
  // Board-wide settings (timezone, day/week boundaries) — server truth, latest wins. Defaults until a
  // SettingsChanged event lands, so a board with none behaves exactly as before.
  private settings: Settings = DEFAULT_SETTINGS;
  // Whether any SettingsChanged has been applied — so seedSettings only writes defaults on a truly
  // fresh board (and never overwrites a board that predates settings on migration).
  private settingsSeeded = false;
  // The currently-open period of each kind (its key + when it started). Set by PeriodStarted.
  private openPeriods: Partial<Record<PeriodKind, { key: string; startedAt: string }>> = {};
  // Settled (closed) periods → frozen per-task filled level at close. Streaks read these so a box
  // unchecked before close never counts (see computeStreak). One map per kind.
  private settled: Record<PeriodKind, Map<string, Map<string, number>>> = { day: new Map(), week: new Map() };
  // The shop: its tabs, their rewards (with a derived bought-count), and the running total of every
  // purchase's frozen pointsSpent. A deleted reward's purchases stay in `spent` — spending is a past fact.
  private shopSections: ShopSection[] = [];
  private rewards: Reward[] = [];
  private spent = 0;
  // Points kept from tasks a period roll unchecked — the sum of every TasksReset's frozen pointsBanked.
  private banked = 0;
  // Boxes kept the same way, per task: the filled level each task held whenever a roll unchecked it,
  // summed. An "all time" counter adds this to the live level (see computeCounter).
  private bankedLevels = new Map<string, number>();
  // The week's Bounties, per week key, in the order rolled: the task each is on now (a reroll swaps it)
  // and its multiplier. They're on while their week is the open one (see bountyOn), so a week close ends
  // them with no event.
  private bounties = new Map<string, { taskId: string; multiplier: number }[]>();
  // Every task each week has had as a Bounty, rerolled away or not — a roll leaves them be while it can.
  private bountiedIn = new Map<string, Set<string>>();
  // Rerolls (see rerollsLeft): each week's free ones as granted at its start (null for a week from before
  // grants were recorded — Settings' allowance stands in) and how many it spent; and bought ones, banked
  // until used.
  private freeRerolls = new Map<string, { granted: number | null; used: number }>();
  private bankedRerolls = 0;
  // What each open period has seen so far, for its recap, day by day: per task, the net points its ticks
  // gained (at the boost each was paid at), and each purchase. Started afresh with each period.
  private tallies: Record<PeriodKind, PeriodTally> = { day: newTally(), week: newTally() };
  // Every streak's count as the open week started (frozen on its PeriodStarted) — the recap's start.
  private weekStartStreaks: Map<string, number> | null = null;

  // `random` is the Bounty roll's randomness (its result is recorded; a rebuild never calls it) —
  // injectable so tests can roll deterministically.
  constructor(
    private readonly store: EventStore,
    private readonly random: () => number = Math.random,
  ) {
    for (const stored of this.store.readAll()) this.apply(stored);
  }

  // ---- selectors ----

  listSections(): Section[] {
    return this.sections.map((s) => ({ ...s }));
  }

  listTasks(sectionId?: string): Task[] {
    const rows = sectionId ? this.tasks.filter((t) => t.sectionId === sectionId) : this.tasks;
    return rows.map((t) => this.readTask(t)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  getTask(id: string): Task {
    return this.readTask(this.requireTask(id));
  }

  // The board tabs' groups (a shop tab's groups ship with the shop — see getShop).
  listGroups(sectionId?: string): Group[] {
    const boardIds = new Set(this.sections.map((s) => s.id));
    const rows = sectionId
      ? this.groups.filter((g) => g.sectionId === sectionId)
      : this.groups.filter((g) => boardIds.has(g.sectionId));
    return rows.map((g) => ({ ...g }));
  }

  getGroup(id: string): Group {
    return { ...this.requireGroup(id) };
  }

  // `now` is when to count them at — a backup's are counted as of when it was taken.
  listStreaks(sectionId?: string, now: Date = clockNow()): StreakView[] {
    const rows = sectionId ? this.streaks.filter((s) => s.sectionId === sectionId) : this.streaks;
    return rows.map((s) => this.readStreak(s, now)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  getStreak(id: string): StreakView {
    return this.readStreak(this.requireStreak(id));
  }

  isEmpty(): boolean {
    return this.sections.length === 0;
  }

  getShop(): Shop {
    const shopIds = new Set(this.shopSections.map((s) => s.id));
    return {
      sections: this.shopSections.map((s) => ({ ...s })),
      rewards: this.rewards.map((r) => this.readReward(r)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      groups: this.groups.filter((g) => shopIds.has(g.sectionId)).map((g) => ({ ...g })),
      spent: this.spent,
    };
  }

  // A reward as served: its position in its shop section stamped on, like readTask does for tasks.
  private readReward(reward: Reward): Reward {
    return { ...reward, order: this.orderIndex(reward.shopSectionId, reward.id) };
  }

  // The owner's spendable points: what the board currently holds plus what period rolls banked, minus
  // everything the shop has spent. Computed here (never trusted from the client) since the server is
  // the sole authority on points.
  pointsAvailable(): number {
    return this.tasks.reduce((sum, t) => sum + taskPointValue(t), 0) + this.banked - this.spent;
  }

  // The count/active are derived here — never stored — so a rebuild and live state can't disagree.
  private readStreak(streak: Streak, now: Date = clockNow()): StreakView {
    // Position in its section, server-derived from the section's item order (never evented), like
    // readTask/readReward.
    const order = this.orderIndex(streak.sectionId, streak.id);
    // A counter lives in current state: the sum of its linked tasks' currently-ticked boxes, so it
    // rises on a tick and falls on an untick. Daily/weekly instead fold completion history.
    if (streak.type === "counter") {
      const levels = new Map(this.tasks.map((t) => [t.id, behaviorOf(t).filled(t)]));
      // "Now" needs only the live levels; "all time" adds what every period roll banked on unticking.
      const { count, active, best } = computeCounter(streak, levels, this.bankedLevels);
      return { ...streak, count, active, best, order };
    }
    // Box count per task (for `required: "all"`) and live filled level (for the current open period,
    // so an uncheck today drops the streak instead of the raw log keeping it).
    const boxCounts = new Map(this.tasks.map((t) => [t.id, behaviorOf(t).boxes(t)]));
    const currentLevels = new Map(this.tasks.map((t) => [t.id, behaviorOf(t).filled(t)]));
    const settled = streak.type === "weekly" ? this.settled.week : this.settled.day;
    const { count, active, best } = computeStreak(this.completions, streak, now, boxCounts, this.settings.timeZone, {
      settings: this.settings,
      settled,
      currentLevels,
    });
    return { ...streak, count, active, best, order };
  }

  getSettings(): Settings {
    return { ...this.settings };
  }

  private requireStreak(id: string): Streak {
    const streak = this.streaks.find((s) => s.id === id);
    if (!streak) throw notFound("streak");
    return streak;
  }

  private readTask(task: Task): Task {
    const timer = this.timers.get(task.id);
    const order = this.orderIndex(listOf(task), task.id);
    // Always return a concrete pointsSource: the stored flag if present, else derived once against the
    // historic default formula (pre-feature values). Same per tier. Never derived against the *current*
    // formula, so a rate change never silently reclassifies an untouched value (see resolvePointsSource).
    const pointsSource = resolvePointsSource(task.pointsSource, task.estimateMinutes, task.points, task.estimateEffortIndex);
    const tiers = task.tiers?.map((tier) => ({
      ...tier,
      pointsSource: resolvePointsSource(tier.pointsSource, tier.minutes, tier.points, tier.effortIndex),
    }));
    const pruned = this.isPruned(task);
    const bounty = this.bountyOn(task);
    return {
      ...task,
      ...(tiers ? { tiers } : {}),
      pointsSource,
      order,
      ...(timer ? { timer } : {}),
      ...(pruned ? { pruned } : {}),
      ...(bounty ? { bounty } : {}),
    };
  }

  // A Bounty on `task`, if it has one: rolled for the week that's still open, while Bounties are on.
  private bountyOn(task: Pick<Task, "id">): Task["bounty"] {
    const week = this.openPeriods.week?.key;
    if (!week || !this.settings.bounty.enabled) return undefined;
    const bounty = this.bounties.get(week)?.find((b) => b.taskId === task.id);
    return bounty ? { multiplier: bounty.multiplier, periodKey: week } : undefined;
  }

  // The open week's Bounties still to win, in the order rolled.
  private activeBounties(): Task[] {
    const week = this.openPeriods.week?.key;
    if (!week || !this.settings.bounty.enabled) return [];
    return (this.bounties.get(week) ?? []).flatMap((b) => {
      const task = this.tasks.find((t) => t.id === b.taskId);
      return task && !behaviorOf(task).isDone(task) ? [task] : [];
    });
  }

  // A task's completion, paid at its boost (its Bounty's, or its parent's — boostOf), the award frozen on
  // the event with the factor that produced it.
  private completion(task: Task): BoardEvent {
    const parent = task.parentId ? this.tasks.find((t) => t.id === task.parentId) : undefined;
    const boost = boostOf({ bounty: this.bountyOn(task) }, parent ? { bounty: this.bountyOn(parent) } : undefined);
    return {
      type: "TaskCompleted",
      taskId: task.id,
      pointsAwarded: boosted(task.points ?? 0, boost),
      ...(boost !== 1 ? { boost } : {}),
    };
  }

  private isPruned(task: Task): boolean {
    const periodKey = this.prunedIn.get(task.id);
    const kind = this.sections.find((s) => s.id === task.sectionId)?.period;
    return periodKey !== undefined && kind !== undefined && this.openPeriods[kind]?.key === periodKey;
  }

  private requireGroup(id: string): Group {
    const group = this.groups.find((g) => g.id === id);
    if (!group) throw notFound("group");
    return group;
  }

  // The items a section lists — a board tab's tasks or streaks, or a shop tab's rewards (live
  // references, so the group fold can tag them). Order and groups are list structure, identical for
  // every kind, so the commands and the fold are written once over this rather than once per item kind.
  // A piece isn't one of its tab's items: it's listed under its task.
  private sectionItems(sectionId: string): ListItem[] {
    const section = this.sections.find((s) => s.id === sectionId);
    if (section) {
      return section.kind === "streaks"
        ? this.streaks.filter((s) => s.sectionId === sectionId)
        : this.tasks.filter((t) => t.sectionId === sectionId && !t.parentId);
    }
    if (this.shopSections.some((s) => s.id === sectionId)) {
      return this.rewards.filter((r) => r.shopSectionId === sectionId);
    }
    throw notFound("section");
  }

  // Every groupable item, of every kind — what the group fold tags and untags.
  private allItems(): ListItem[] {
    return [...this.tasks, ...this.streaks, ...this.rewards];
  }

  // Drop a group once its last member is gone, so no empty rail lingers.
  private dropGroupIfEmpty(groupId: string | undefined): void {
    if (groupId && !this.allItems().some((i) => i.groupId === groupId)) {
      this.groups = this.groups.filter((g) => g.id !== groupId);
    }
  }

  private requireShopSection(id: string): ShopSection {
    const section = this.shopSections.find((s) => s.id === id);
    if (!section) throw notFound("shop section");
    return section;
  }

  private requireReward(id: string): Reward {
    const reward = this.rewards.find((r) => r.id === id);
    if (!reward) throw notFound("reward");
    return reward;
  }

  // The section's task id order (TaskCreated appends, TasksReordered replaces it).
  private orderList(sectionId: string): string[] {
    let list = this.itemOrder.get(sectionId);
    if (!list) {
      list = [];
      this.itemOrder.set(sectionId, list);
    }
    return list;
  }

  // A task's position in its section. Unknown ids trail (shouldn't happen — every task is appended to
  // the order on create), matching orderBy's Infinity-rank fallback.
  private orderIndex(sectionId: string, id: string): number {
    const i = this.orderList(sectionId).indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  }

  private removeFromOrder(sectionId: string, id: string): void {
    const list = this.itemOrder.get(sectionId);
    if (!list) return;
    const i = list.indexOf(id);
    if (i !== -1) list.splice(i, 1);
  }

  private requireSection(id: string): Section {
    const section = this.sections.find((s) => s.id === id);
    if (!section) throw notFound("section");
    return section;
  }

  private requireTask(id: string): Task {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw notFound("task");
    return task;
  }

  // A task's pieces, in their order under it (none ≡ it isn't broken down).
  private piecesOf(id: string): Task[] {
    const order = this.itemOrder.get(id) ?? [];
    return order.map((pieceId) => this.tasks.find((t) => t.id === pieceId)).filter((t): t is Task => !!t);
  }

  // ---- commands (validate → append → apply) ----

  seedSection(name: string, color: string, allowedTypes: AllowedType[], kind: SectionKind = "tasks", period?: SectionPeriod): Section {
    const event: BoardEvent = { type: "SectionCreated", sectionId: randomUUID(), name, color, kind, allowedTypes, ...(period ? { period } : {}) };
    this.commit(event);
    return this.requireSection(event.sectionId);
  }

  // Sets a section's recurrence cadence. No user UI (sections are static) — the command behind the
  // SectionPeriodSet event, used by the seed migration that backfills pre-existing Daily/Weekly/Registry tabs.
  setSectionPeriod(id: string, period: SectionPeriod): Section {
    this.requireSection(id);
    this.commit({ type: "SectionPeriodSet", sectionId: id, period });
    return this.requireSection(id);
  }

  // Replaces a section's allowed types. There's no UI for it (sections are static once created) —
  // it's the command behind the SectionAllowedTypesSet event, used by seed migrations (see
  // ensureRegistryTieredOnly).
  setSectionAllowedTypes(id: string, allowedTypes: AllowedType[]): Section {
    this.requireSection(id);
    this.commit({ type: "SectionAllowedTypesSet", sectionId: id, allowedTypes });
    return { ...this.requireSection(id) };
  }

  recolorSection(id: string, color: string, idempotencyKey?: string | null): Section {
    this.requireSection(id);
    this.commit({ type: "SectionRecolored", sectionId: id, color }, idempotencyKey);
    return { ...this.requireSection(id) };
  }

  reorderSections(orderedIds: string[], idempotencyKey?: string | null): Section[] {
    this.assertPermutation(orderedIds, this.sections.map((s) => s.id), "section");
    this.commit({ type: "SectionsReordered", orderedIds }, idempotencyKey);
    return this.listSections();
  }

  createTask(body: CreateTaskBody, idempotencyKey?: string | null): Task {
    const section = this.requireSection(body.sectionId);
    if (!section.allowedTypes.some((a) => a.type === body.type)) {
      throw badRequest(`section does not allow ${body.type} tasks`);
    }
    const event: BoardEvent = {
      type: "TaskCreated",
      taskId: randomUUID(),
      sectionId: body.sectionId,
      taskType: body.type,
      text: body.text,
      ...(body.points !== undefined ? { points: body.points } : {}),
      ...(body.estimate ? { estimate: body.estimate } : {}),
      ...(body.estimateMinutes !== undefined ? { estimateMinutes: body.estimateMinutes } : {}),
      ...(body.estimateEffortIndex !== undefined ? { estimateEffortIndex: body.estimateEffortIndex } : {}),
      ...(body.pointsSource !== undefined ? { pointsSource: body.pointsSource } : {}),
      ...(body.description ? { description: body.description } : {}),
      ...(body.tiers ? { tiers: body.tiers } : {}),
      ...(body.count !== undefined ? { count: body.count } : {}),
      ...(body.schedule?.some(Boolean) ? { schedule: body.schedule } : {}),
    };
    this.commit(event, idempotencyKey);
    return this.readTask(this.requireTask(event.taskId));
  }

  // "Duplicate": a new task with the source's definition — never its progress — placed right after the
  // source and in its group, so the copy appears beside it rather than at the end of the tab. The
  // placement events only follow a copy that was actually created; a retried request just returns it.
  duplicateTask(id: string, idempotencyKey?: string | null): Task {
    const source = this.requireTask(id);
    const event: TaskCreated = {
      type: "TaskCreated",
      taskId: randomUUID(),
      sectionId: source.sectionId,
      ...taskDefinition(source),
      duplicatedFrom: id,
    };
    const result = this.commit(event, idempotencyKey);
    const stored = result.stored.event;
    const copyId = stored.type === "TaskCreated" ? stored.taskId : event.taskId;
    if (result.created) {
      // Into the group first: placed beside a middle member while still ungrouped, the copy would split
      // the group's run, and the fold (settleGroups) would push it out past the group's end.
      if (source.groupId) this.commit({ type: "GroupMembersAdded", groupId: source.groupId, addedItemIds: [copyId] });
      // Right after its source, in the list they share: the tab's, or the pieces of the task a piece is in.
      const order = this.orderList(listOf(source)).filter((taskId) => taskId !== copyId);
      order.splice(order.indexOf(id) + 1, 0, copyId);
      this.commit(
        source.parentId
          ? { type: "PiecesReordered", taskId: source.parentId, orderedIds: order }
          : { type: "TasksReordered", sectionId: source.sectionId, orderedIds: order },
      );
      // A broken-down task's copy comes with copies of its pieces — without them it would be an empty shell.
      for (const piece of this.piecesOf(id)) {
        this.commit({
          type: "TaskCreated",
          taskId: randomUUID(),
          sectionId: piece.sectionId,
          ...taskDefinition(piece),
          parentId: copyId,
          duplicatedFrom: piece.id,
        });
      }
      // A copied piece is open, so a finished task it's copied into (from the Completed look-back) reopens.
      this.settleParent(source.parentId);
    }
    return this.readTask(this.requireTask(copyId));
  }

  // Break down: the pieces typed in one go become tasks inside this one. They take its own points, split
  // evenly so nothing is lost or made up; a task whose points already went to its pieces gets pieces worth
  // an average one of those instead — it grew (newPiecePoints). Returns the task, then all its pieces.
  breakDown(id: string, texts: string[], idempotencyKey?: string | null): Task[] {
    const task = this.requireTask(id);
    if (!canBreakDown(task)) throw badRequest("this task can't be broken down");
    if (behaviorOf(task).isDone(task)) throw badRequest("a finished task can't be broken down");
    const pieces = this.piecesOf(id);
    if (pieces.length + texts.length > PIECES_MAX) throw badRequest(`a task holds at most ${PIECES_MAX} pieces`);
    const points = newPiecePoints(task, pieces, texts.length);
    // Its own points move into the pieces. Manual, so a points-formula rebalance never gives it its old
    // value back on top of theirs.
    if ((task.points ?? 0) > 0) this.editTask(id, { points: 0, pointsSource: "manual" }, subKey(idempotencyKey, "split"));
    texts.forEach((text, i) => {
      this.commit(
        {
          type: "TaskCreated",
          taskId: randomUUID(),
          sectionId: task.sectionId,
          taskType: task.type,
          text,
          points: points[i],
          pointsSource: "manual",
          parentId: id,
        },
        subKey(idempotencyKey, `piece-${i}`),
      );
    });
    return [this.readTask(this.requireTask(id)), ...this.piecesOf(id).map((p) => this.readTask(p))];
  }

  // Tuck a task inside another as a piece, or (null) take a piece out into its tab's list — "Make it its
  // own task", which lands it right after the task it left. One level deep: the task it goes into can't
  // be a piece, and a task with pieces of its own can't become one. Either task's done may follow.
  setParent(id: string, parentId: string | null, idempotencyKey?: string | null): Task {
    const task = this.requireTask(id);
    const previousParentId = task.parentId ?? null;
    if (parentId === previousParentId) return this.readTask(task);
    if (parentId !== null) {
      const parent = this.tasks.find((t) => t.id === parentId);
      if (!parent) throw badRequest("the task to tuck it into doesn't exist");
      if (parent.id === id) throw badRequest("a task can't be tucked into itself");
      if (parent.sectionId !== task.sectionId) throw badRequest("a piece stays in its own tab");
      if (!canBreakDown(parent) || !behaviorOf(task).breaksDown) throw badRequest("that task can't hold it as a piece");
      if (this.piecesOf(id).length > 0) throw badRequest("a task with pieces of its own can't be a piece");
      if (behaviorOf(parent).isDone(parent)) throw badRequest("that task is already done");
      if (this.piecesOf(parentId).length >= PIECES_MAX) throw badRequest(`a task holds at most ${PIECES_MAX} pieces`);
    }
    this.commit({ type: "TaskParentSet", taskId: id, parentId, previousParentId }, idempotencyKey);
    this.settleParent(previousParentId);
    this.settleParent(parentId);
    return this.readTask(this.requireTask(id));
  }

  // Reorders a task's pieces; `orderedIds` must be exactly its pieces (cf. reorderTasks).
  reorderPieces(id: string, orderedIds: string[], idempotencyKey?: string | null): Task[] {
    this.requireTask(id);
    this.assertPermutation(orderedIds, this.piecesOf(id).map((p) => p.id), "piece");
    this.commit({ type: "PiecesReordered", taskId: id, orderedIds }, idempotencyKey);
    return this.piecesOf(id).map((p) => this.readTask(p));
  }

  // Status: move a task to another band of its tab. A blocked one says why — a short note, the task it
  // waits on, or both. That task must be another one that isn't done yet: the fold releases the wait
  // once it's done (releaseDependents). Saying again exactly what's already set is a no-op.
  setStatus(
    id: string,
    status: TaskStatus,
    blocker: { note?: string; taskId?: string } = {},
    idempotencyKey?: string | null,
  ): Task {
    const task = this.requireTask(id);
    const note = status === "blocked" && blocker.note ? blocker.note : undefined;
    const blockedBy = status === "blocked" ? blocker.taskId : undefined;
    if (blockedBy !== undefined) {
      if (blockedBy === id) throw badRequest("a task can't wait on itself");
      const waitedOn = this.tasks.find((t) => t.id === blockedBy);
      if (!waitedOn) throw badRequest("the task it waits on doesn't exist");
      if (behaviorOf(waitedOn).isDone(waitedOn)) throw badRequest("the task it waits on is already done");
    }
    const previousStatus = statusOf(task);
    const same = previousStatus === status && task.blocker?.note === note && task.blocker?.taskId === blockedBy;
    if (!same) {
      this.commit(
        {
          type: "TaskStatusSet",
          taskId: id,
          status,
          previousStatus,
          ...(note ? { note } : {}),
          ...(blockedBy ? { blockedBy } : {}),
        },
        idempotencyKey,
      );
    }
    return this.readTask(this.requireTask(id));
  }

  // Prune: skip a task until its tab's current day/week rolls over. Only where canPrune allows (a
  // prunable type in a recurring tab) and while that period is open — it's recorded against it. It
  // changes nothing else: done, progress, points and streak counting all stay exactly as they were.
  setPruned(id: string, pruned: boolean, idempotencyKey?: string | null): Task {
    const task = this.requireTask(id);
    if (!pruned) {
      if (this.isPruned(task)) this.commit({ type: "TaskUnpruned", taskId: id }, idempotencyKey);
      return this.readTask(task);
    }
    const section = this.requireSection(task.sectionId);
    const kind = section.period;
    if (!kind || !canPrune(task, section)) throw badRequest("this task can't be pruned");
    const open = this.openPeriods[kind];
    if (!open) throw badRequest("no day or week has started yet");
    if (!this.isPruned(task)) this.commit({ type: "TaskPruned", taskId: id, periodKey: open.key }, idempotencyKey);
    return this.readTask(task);
  }

  setDone(id: string, done: boolean, idempotencyKey?: string | null): Task {
    const task = this.requireTask(id);
    const pieces = this.piecesOf(id);
    const bountiesBefore = this.activeBounties().length;
    if (pieces.length > 0) {
      // A broken-down task's box is all of its pieces at once: ticking it finishes every piece still open
      // (each paying its own points), unticking it reopens them all — and the task follows them. Each is
      // a real change of its own, so a retry finds nothing left to do.
      for (const piece of pieces) {
        if (behaviorOf(piece).isDone(piece) === done) continue;
        this.commit(
          done
            ? this.completion(piece)
            : { type: "TaskUncompleted", taskId: piece.id },
        );
      }
      this.settleParent(id);
      this.rollAfterWin(bountiesBefore);
      return this.readTask(this.requireTask(id));
    }
    const event: BoardEvent = done
      ? this.completion(task)
      : { type: "TaskUncompleted", taskId: id };
    this.commit(event, idempotencyKey);
    this.settleParent(task.parentId);
    this.rollAfterWin(bountiesBefore);
    return this.readTask(this.requireTask(id));
  }

  setTier(id: string, activeTier: number | null, idempotencyKey?: string | null): Task {
    const task = this.requireTask(id);
    if (activeTier !== null && !task.tiers?.[activeTier]) throw badRequest("invalid activeTier");
    const pointsAwarded = activeTier !== null ? (task.tiers?.[activeTier]?.points ?? 0) : 0;
    this.commit({ type: "TaskTierSet", taskId: id, activeTier, pointsAwarded }, idempotencyKey);
    return this.readTask(this.requireTask(id));
  }

  setProgress(id: string, progress: number, idempotencyKey?: string | null): Task {
    const task = this.requireTask(id);
    // A repeatable task climbs per completion — uncapped unless it carries an optional `count` max;
    // a multi-box checkbox caps at its box count.
    const max = behaviorOf(task).unbounded ? (task.count ?? Infinity) : (task.count ?? 1);
    if (progress < 0 || progress > max) throw badRequest("invalid progress");
    // Uniform boxes: each ticked box is worth `points`, so the value reached is points × progress.
    const pointsAwarded = (task.points ?? 0) * progress;
    this.commit({ type: "TaskProgressSet", taskId: id, progress, pointsAwarded }, idempotencyKey);
    return this.readTask(this.requireTask(id));
  }

  editTask(id: string, changes: TaskEditFields, idempotencyKey?: string | null): Task {
    const task = this.requireTask(id);
    const previous: TaskEditFields = {};
    if (changes.text !== undefined) previous.text = task.text;
    if (changes.points !== undefined) previous.points = task.points;
    if (changes.estimate !== undefined) previous.estimate = task.estimate ?? null;
    if (changes.estimateMinutes !== undefined) previous.estimateMinutes = task.estimateMinutes ?? null;
    if (changes.estimateEffortIndex !== undefined) previous.estimateEffortIndex = task.estimateEffortIndex ?? null;
    if (changes.pointsSource !== undefined) previous.pointsSource = task.pointsSource;
    if (changes.description !== undefined) previous.description = task.description ?? null;
    if (changes.tiers !== undefined) previous.tiers = task.tiers;
    if (changes.count !== undefined) previous.count = task.count;
    if (changes.schedule !== undefined) previous.schedule = task.schedule;
    this.commit({ type: "TaskEdited", taskId: id, changes, previous }, idempotencyKey);
    return this.readTask(this.requireTask(id));
  }

  // Changes a task's type. No UI calls this — it's the command behind TaskTypeChanged, used by seed
  // migrations (see ensureTasksTabOnceType). Refuses a type the task's section doesn't allow, and a
  // type that can't hold the task's current data (a box count or schedule on a type without quantity)
  // rather than silently dropping it.
  changeTaskType(id: string, type: TaskType): Task {
    const task = this.requireTask(id);
    if (task.type === type) return this.readTask(task);
    const section = this.requireSection(task.sectionId);
    if (!section.allowedTypes.some((a) => a.type === type)) throw badRequest(`section does not allow ${type} tasks`);
    if (!behaviorOfType(type).supportsQuantity && ((task.count ?? 1) > 1 || task.schedule)) {
      throw badRequest(`a task with a box count or schedule can't become ${type}`);
    }
    this.commit({ type: "TaskTypeChanged", taskId: id, taskType: type, previousType: task.type });
    return this.readTask(this.requireTask(id));
  }

  // Reorders a section's tasks. `orderedIds` must be a permutation of its task ids. Grouped tasks move
  // as a block on the client, so the order it sends always keeps each group's members contiguous.
  reorderTasks(sectionId: string, orderedIds: string[], idempotencyKey?: string | null): Task[] {
    this.requireSection(sectionId);
    // The tab's own list: pieces are ordered under their task (reorderPieces).
    const currentIds = this.tasks.filter((t) => t.sectionId === sectionId && !t.parentId).map((t) => t.id);
    this.assertPermutation(orderedIds, currentIds, "task");
    this.commit({ type: "TasksReordered", sectionId, orderedIds }, idempotencyKey);
    return this.listTasks(sectionId);
  }

  deleteTask(id: string, idempotencyKey?: string | null): void {
    const task = this.requireTask(id);
    // A broken-down task goes with its pieces — each deleted in its own right, so the log says so.
    for (const piece of this.piecesOf(id)) this.commit({ type: "TaskDeleted", taskId: piece.id });
    this.commit({ type: "TaskDeleted", taskId: id }, idempotencyKey);
    // The pieces left in the task a deleted piece was in may now all be done.
    this.settleParent(task.parentId);
  }

  // ---- group commands ----

  // Bundle a section's ungrouped items (tasks, streaks or rewards) under one label. Validates the members
  // exist, belong to the section and aren't already grouped. They needn't be contiguous: the fold
  // gathers them into one run at the first member's place (settleGroups) — a run the owner sees in one
  // Status band can have another band's tasks between its members in the tab's full order.
  createGroup(body: CreateGroupBody, idempotencyKey?: string | null): Group {
    const items = this.sectionItems(body.sectionId);
    for (const id of body.itemIds) {
      const item = items.find((i) => i.id === id);
      if (!item) throw badRequest("item is not in this section");
      if (item.groupId) throw badRequest("item is already in a group");
    }
    const event: BoardEvent = {
      type: "GroupCreated",
      groupId: randomUUID(),
      sectionId: body.sectionId,
      label: body.label,
      itemIds: body.itemIds,
    };
    this.commit(event, idempotencyKey);
    return { ...this.requireGroup(event.groupId) };
  }

  editGroup(id: string, label: string, idempotencyKey?: string | null): Group {
    const group = this.requireGroup(id);
    this.commit({ type: "GroupEdited", groupId: id, label, previousLabel: group.label }, idempotencyKey);
    return { ...this.requireGroup(id) };
  }

  addGroupMembers(id: string, addedItemIds: string[], idempotencyKey?: string | null): Group {
    const group = this.requireGroup(id);
    const items = this.sectionItems(group.sectionId);
    for (const itemId of addedItemIds) {
      const item = items.find((i) => i.id === itemId);
      if (!item) throw badRequest("item is not in this section");
      if (item.groupId && item.groupId !== id) throw badRequest("item is already in another group");
    }
    this.commit({ type: "GroupMembersAdded", groupId: id, addedItemIds }, idempotencyKey);
    return { ...this.requireGroup(id) };
  }

  removeGroupMembers(id: string, removedItemIds: string[], idempotencyKey?: string | null): Group {
    this.requireGroup(id);
    this.commit({ type: "GroupMembersRemoved", groupId: id, removedItemIds }, idempotencyKey);
    return { ...this.requireGroup(id) };
  }

  deleteGroup(id: string, idempotencyKey?: string | null): void {
    this.requireGroup(id);
    this.commit({ type: "GroupDeleted", groupId: id }, idempotencyKey);
  }

  // ---- streak commands ----

  createStreak(body: CreateStreakBody, idempotencyKey?: string | null): StreakView {
    const section = this.requireSection(body.sectionId);
    if (section.kind !== "streaks") throw badRequest("section does not hold streaks");
    const event: BoardEvent = {
      type: "StreakCreated",
      streakId: randomUUID(),
      sectionId: body.sectionId,
      name: body.name,
      streakType: body.type,
      mode: body.mode,
      since: body.since,
      matcher: body.matcher,
    };
    this.commit(event, idempotencyKey);
    return this.readStreak(this.requireStreak(event.streakId));
  }

  editStreak(id: string, changes: StreakEditFields, idempotencyKey?: string | null): StreakView {
    const streak = this.requireStreak(id);
    const previous: StreakEditFields = {};
    if (changes.name !== undefined) previous.name = streak.name;
    if (changes.type !== undefined) previous.type = streak.type;
    if (changes.mode !== undefined) previous.mode = streak.mode;
    if (changes.since !== undefined) previous.since = streak.since;
    if (changes.legacy !== undefined) previous.legacy = streak.legacy;
    if (changes.legacyBest !== undefined) previous.legacyBest = streak.legacyBest;
    if (changes.matcher !== undefined) previous.matcher = streak.matcher;
    this.commit({ type: "StreakEdited", streakId: id, changes, previous }, idempotencyKey);
    return this.readStreak(this.requireStreak(id));
  }

  reorderStreaks(sectionId: string, orderedIds: string[], idempotencyKey?: string | null): StreakView[] {
    this.requireSection(sectionId);
    const currentIds = this.streaks.filter((s) => s.sectionId === sectionId).map((s) => s.id);
    this.assertPermutation(orderedIds, currentIds, "streak");
    this.commit({ type: "StreaksReordered", sectionId, orderedIds }, idempotencyKey);
    return this.listStreaks(sectionId);
  }

  deleteStreak(id: string, idempotencyKey?: string | null): void {
    this.requireStreak(id);
    this.commit({ type: "StreakDeleted", streakId: id }, idempotencyKey);
  }

  // ---- shop commands ----

  createShopSection(body: CreateShopSectionBody, idempotencyKey?: string | null): ShopSection {
    const event: BoardEvent = {
      type: "ShopSectionCreated",
      shopSectionId: randomUUID(),
      name: body.name,
      color: body.color,
    };
    this.commit(event, idempotencyKey);
    return { ...this.requireShopSection(event.shopSectionId) };
  }

  editShopSection(id: string, changes: ShopSectionEditFields, idempotencyKey?: string | null): ShopSection {
    const section = this.requireShopSection(id);
    const previous: ShopSectionEditFields = {};
    if (changes.name !== undefined) previous.name = section.name;
    if (changes.color !== undefined) previous.color = section.color;
    this.commit({ type: "ShopSectionEdited", shopSectionId: id, changes, previous }, idempotencyKey);
    return { ...this.requireShopSection(id) };
  }

  // Takes the section's rewards with it (the fold drops them); past purchases stay spent.
  deleteShopSection(id: string, idempotencyKey?: string | null): void {
    this.requireShopSection(id);
    this.commit({ type: "ShopSectionDeleted", shopSectionId: id }, idempotencyKey);
  }

  createReward(body: CreateRewardBody, idempotencyKey?: string | null): Reward {
    this.requireShopSection(body.shopSectionId);
    const event: BoardEvent = {
      type: "RewardCreated",
      rewardId: randomUUID(),
      shopSectionId: body.shopSectionId,
      name: body.name,
      emoji: body.emoji,
      cost: body.cost,
      ...(body.note ? { note: body.note } : {}),
    };
    this.commit(event, idempotencyKey);
    return this.readReward(this.requireReward(event.rewardId));
  }

  editReward(id: string, changes: RewardEditFields, idempotencyKey?: string | null): Reward {
    const reward = this.requireReward(id);
    const previous: RewardEditFields = {};
    if (changes.name !== undefined) previous.name = reward.name;
    if (changes.emoji !== undefined) previous.emoji = reward.emoji;
    if (changes.cost !== undefined) previous.cost = reward.cost;
    if (changes.note !== undefined) previous.note = reward.note ?? null;
    this.commit({ type: "RewardEdited", rewardId: id, changes, previous }, idempotencyKey);
    return this.readReward(this.requireReward(id));
  }

  deleteReward(id: string, idempotencyKey?: string | null): void {
    this.requireReward(id);
    this.commit({ type: "RewardDeleted", rewardId: id }, idempotencyKey);
  }

  // Reorder a shop section's rewards; `orderedIds` must be exactly its reward ids (cf. reorderTasks).
  reorderRewards(shopSectionId: string, orderedIds: string[], idempotencyKey?: string | null): Shop {
    this.requireShopSection(shopSectionId);
    const currentIds = this.rewards.filter((r) => r.shopSectionId === shopSectionId).map((r) => r.id);
    this.assertPermutation(orderedIds, currentIds, "reward");
    this.commit({ type: "RewardsReordered", shopSectionId, orderedIds }, idempotencyKey);
    return this.getShop();
  }

  // Buy a reward. Affordability is checked against the server's own view of the points (the client is
  // never trusted for them), then the cost is frozen onto the purchase. Returns the whole shop so the
  // client reconciles `spent` and the bought-count in one go.
  purchaseReward(id: string, idempotencyKey?: string | null): Shop {
    const reward = this.requireReward(id);
    if (this.pointsAvailable() < reward.cost) throw badRequest("not enough points");
    this.commit({ type: "RewardPurchased", rewardId: id, pointsSpent: reward.cost }, idempotencyKey);
    return this.getShop();
  }

  // ---- settings & period commands ----

  // Merge a partial patch over current settings and log the full result (SettingsChanged is a
  // snapshot, not a delta). Changing the timezone / boundaries re-derives streak keys live on read.
  patchSettings(patch: PatchSettingsBody, idempotencyKey?: string | null): Settings {
    const next: Settings = { ...this.settings, ...patch };
    this.commit({ type: "SettingsChanged", settings: next }, idempotencyKey);
    return { ...this.settings };
  }

  seedSettings(): void {
    if (this.settingsSeeded) return;
    this.commit({ type: "SettingsChanged", settings: DEFAULT_SETTINGS });
  }

  // Every builder-sourced value (a checkbox or one-time task, or a tiered task's tier) that carries a time estimate,
  // with the points it would earn under `formula`. Manual and estimate-less values are excluded — those
  // are what "won't update". pointsSource is resolved (stored flag, else derived vs the historic formula).
  private builderValues(
    formula: PointsFormula,
  ): Array<{ task: Task; tierIndex?: number; text: string; tierLabel?: string; oldPoints: number; newPoints: number }> {
    const out: Array<{ task: Task; tierIndex?: number; text: string; tierLabel?: string; oldPoints: number; newPoints: number }> = [];
    for (const t of this.tasks) {
      if (t.type === "checkbox" || t.type === "once") {
        const source = resolvePointsSource(t.pointsSource, t.estimateMinutes, t.points, t.estimateEffortIndex);
        if (source !== "builder" || t.estimateMinutes == null) continue;
        const newPoints = pointsFromMinutes(t.estimateMinutes, effortMultOf(formula, t.estimateEffortIndex), formula);
        out.push({ task: t, text: t.text, oldPoints: t.points ?? 0, newPoints });
      } else if (t.type === "tiered" && t.tiers) {
        t.tiers.forEach((tier, i) => {
          const source = resolvePointsSource(tier.pointsSource, tier.minutes, tier.points, tier.effortIndex);
          if (source !== "builder" || tier.minutes == null) return;
          const newPoints = pointsFromMinutes(tier.minutes, effortMultOf(formula, tier.effortIndex), formula);
          out.push({ task: t, tierIndex: i, text: t.text, tierLabel: tier.label, oldPoints: tier.points, newPoints });
        });
      }
    }
    return out;
  }

  // Dry run: what a formula change would move (old→new per value) and how many values it would leave
  // alone (manual or no estimate). No writes — the confirm dialog shows this before the owner chooses.
  previewFormula(formula: PointsFormula): FormulaPreview {
    const values = this.builderValues(formula);
    const willUpdate = values
      .filter((v) => v.newPoints !== v.oldPoints)
      .map((v) => ({
        taskId: v.task.id,
        text: v.text,
        ...(v.tierIndex !== undefined ? { tierIndex: v.tierIndex, tierLabel: v.tierLabel } : {}),
        oldPoints: v.oldPoints,
        newPoints: v.newPoints,
      }));
    const totalValues = this.tasks.reduce((n, t) => n + (t.type === "tiered" ? t.tiers?.length ?? 0 : 1), 0);
    return { willUpdate, wontUpdateCount: totalValues - values.length };
  }

  // Save the new formula (future tasks + builder use it), and — when `rebalance` — recompute every
  // builder value's points to match it, via TaskEdited (so past completion awards, frozen on their own
  // events, are untouched). Each rebalanced value is re-stamped pointsSource:"builder" so a rebuild
  // keeps its provenance rather than re-deriving against the now-changed formula.
  applyFormula(formula: PointsFormula, rebalance: boolean): void {
    this.patchSettings({ pointsFormula: formula });
    if (!rebalance) return;
    const changed = this.builderValues(formula).filter((v) => v.newPoints !== v.oldPoints);
    const tieredTasks = new Map<string, Task>();
    for (const v of changed) {
      if (v.tierIndex === undefined) {
        this.editTask(v.task.id, { points: v.newPoints, pointsSource: "builder" });
      } else {
        tieredTasks.set(v.task.id, v.task);
      }
    }
    // One edit per tiered task, rebuilding its whole tiers array (only builder tiers move; manual and
    // estimate-less tiers pass through untouched).
    for (const task of tieredTasks.values()) {
      const tiers = (task.tiers ?? []).map((tier) => {
        const source = resolvePointsSource(tier.pointsSource, tier.minutes, tier.points, tier.effortIndex);
        if (source !== "builder" || tier.minutes == null) return tier;
        const np = pointsFromMinutes(tier.minutes, effortMultOf(formula, tier.effortIndex), formula);
        return np === tier.points ? tier : { ...tier, points: np, pointsSource: "builder" as const };
      });
      this.editTask(task.id, { tiers });
    }
  }

  // Whether each kind of period is waiting on the owner — the client polls this on load to prompt.
  // Periods are NOT auto-started: a fresh/reset board has no open period, which is itself "due" (you
  // consciously start your first day/week). After that, due once `now` moves past the open period.
  periodStatus(now: Date = clockNow()): PeriodStatus {
    const one = (kind: PeriodKind) => {
      const openKey = this.openPeriods[kind]?.key ?? null;
      const currentKey = periodKeyFor(now.toISOString(), kind, this.settings);
      return { openKey, currentKey, due: openKey !== currentKey };
    };
    return { day: one("day"), week: one("week"), banked: this.banked };
  }

  // Advance a period. If one is open, close it (freezing a snapshot of live task levels), uncheck the
  // tasks of every tab recurring on this cadence (banking their points), and open the one `now` falls
  // in. If none is open (fresh/reset board), just start the current one — there's nothing to close, so
  // the recap is empty and the UI skips it. Missed intermediate periods get no snapshot and so fall
  // back to raw history — correctly empty for a period you never opened.
  rollPeriod(kind: PeriodKind, now: Date = clockNow()): { recap: PeriodRecap; streaks: StreakView[]; week?: PeriodRecap } {
    const open = this.openPeriods[kind];
    const currentKey = periodKeyFor(now.toISOString(), kind, this.settings);
    const closedKey = open?.key ?? currentKey;
    const snapshot = this.tasks.map((t) => ({ taskId: t.id, level: behaviorOf(t).filled(t) }));
    // Read before the close: the new period starts its own tally (and, for a week, its own streak start).
    const tally = this.tallies[kind];
    const streaksAtStart = this.weekStartStreaks;
    let streaksAtEnd: StreakView[] = [];
    // A week starts by freezing where every streak stands — counted once the last week is closed and
    // reset, so a tick still up from it isn't counted for both weeks.
    const start = () => {
      if (kind === "week") streaksAtEnd = this.listStreaks();
      this.commit({
        type: "PeriodStarted",
        kind,
        periodKey: currentKey,
        ...(kind === "week" ? { streaks: streaksAtEnd.map((st) => ({ streakId: st.id, count: st.count })) } : {}),
      });
    };

    if (open) {
      if (open.key !== currentKey) {
        this.commit({ type: "PeriodClosed", kind, periodKey: open.key, snapshot });
        // After the snapshot, so streaks and the recap still see what the closed period reached.
        const recurring = new Set(this.sections.filter((s) => s.period === kind).map((s) => s.id));
        const reset = this.tasks.filter((t) => recurring.has(t.sectionId) && behaviorOf(t).filled(t) > 0);
        if (reset.length > 0) {
          const pointsBanked = reset.reduce((sum, t) => sum + taskPointValue(t), 0);
          this.commit({ type: "TasksReset", taskIds: reset.map((t) => t.id), pointsBanked });
        }
        start();
        // A week close rolls the new week's Bounties (a first start closes nothing, so it doesn't).
        if (kind === "week") this.startWeekBounties(currentKey, now);
      }
    } else {
      start();
    }

    // A day is one day, whatever it saw; a week is each of its days (and any later one it ran into).
    const days =
      kind === "week"
        ? [...new Set([...Array.from({ length: 7 }, (_, i) => addDays(closedKey, i)), ...tally.keys()])]
            .sort()
            .map((dayKey) => this.recapDay(dayKey, tally.has(dayKey) ? [tally.get(dayKey)!] : []))
        : [this.recapDay(closedKey, [...tally.values()])];
    const recap: Omit<PeriodRecap, "bounties"> = {
      kind,
      periodKey: closedKey,
      days,
      earned: days.reduce((sum, d) => sum + d.earned, 0),
      lost: days.reduce((sum, d) => sum + d.lost, 0),
      streaks: streaksAtEnd.map((st) => ({
        streakId: st.id,
        name: st.name,
        type: st.type,
        start: streaksAtStart?.get(st.id) ?? null,
        end: st.count,
      })),
    };
    const bounties = kind === "week" && open && open.key !== currentKey ? this.bountiesView(now) : [];
    // The week ends with the day that ends it: once the week a day was in is over, ending the day ends the
    // week too — a follow-up of the owner's one answer, so a week is never asked about. Its recap comes
    // along (a first week only starts, with nothing to recap).
    if (kind === "day" && this.periodStatus(now).week.due) {
      const weekWasOpen = this.openPeriods.week !== undefined;
      const week = this.rollPeriod("week", now);
      return { recap: { ...recap, bounties }, streaks: week.streaks, ...(weekWasOpen ? { week: week.recap } : {}) };
    }
    return { recap: { ...recap, bounties }, streaks: this.listStreaks() };
  }

  // One day of a recap from its tally (or several, for a day that ran on): per tab, in the tab's order,
  // the tasks that came out ahead and what its ticks earned; the day's totals; its purchases.
  private recapDay(dayKey: string, parts: DayTally[]): RecapDay {
    const gains = new Map<string, number>();
    for (const part of parts) for (const [id, gain] of part.gains) gains.set(id, (gains.get(id) ?? 0) + gain);
    const purchases = parts.flatMap((part) => part.purchases);
    const tabs = this.sections.flatMap((section) => {
      const own = [...gains].filter(([id]) => this.tasks.find((t) => t.id === id)?.sectionId === section.id).map(([, g]) => g);
      const cleared = own.filter((g) => g > 0).length;
      const earned = own.reduce((sum, g) => sum + g, 0);
      return cleared > 0 || earned !== 0 ? [{ sectionId: section.id, name: section.name, color: section.color, cleared, earned }] : [];
    });
    return {
      dayKey,
      tabs,
      earned: tabs.reduce((sum, t) => sum + t.earned, 0),
      lost: purchases.reduce((sum, p) => sum + p.cost, 0),
      purchases,
    };
  }

  // A new week's Bounties, while they're on: its free rerolls granted (frozen, so a later change to the
  // setting leaves this week's alone), then as many Bounties as may be on at once.
  private startWeekBounties(periodKey: string, now: Date): void {
    const { enabled, max, rerolls } = this.settings.bounty;
    if (!enabled) return;
    this.commit({ type: "BountyRerollsGranted", count: rerolls, source: "week", periodKey });
    for (let i = 0; i < max; i++) if (!this.rollBounty(periodKey, now)) break;
  }

  // Winning a Bounty rolls another when Settings say so (rollOnWin) — up to the most that may be on at
  // once — as a follow-up of the command that won it. Only a win: `before` is how many were still to win
  // before it, so an untick-and-retick can't farm new ones.
  private rollAfterWin(before: number, now: Date = clockNow()): void {
    const week = this.openPeriods.week?.key;
    const { enabled, rollOnWin, max } = this.settings.bounty;
    if (!week || !enabled || !rollOnWin) return;
    let active = this.activeBounties().length;
    if (active >= before) return;
    while (active < max && this.rollBounty(week, now)) active++;
  }

  // Roll a Bounty for `periodKey`: one candidate (canBounty) not already one of its Bounties, weighted by
  // how long it's been on the board — recorded, never re-rolled. A reroll `replaces` one, spending from
  // `rerollFrom`. Returns the task it landed on (null: nothing to roll).
  private rollBounty(
    periodKey: string,
    now: Date,
    reroll?: { replaces: string; rerollFrom: "week" | "bank" },
    idempotencyKey?: string | null,
  ): string | null {
    const taken = new Set((this.bounties.get(periodKey) ?? []).map((b) => b.taskId));
    const open = this.bountyCandidates().filter((t) => !taken.has(t.id));
    // Never a task the week's already had (a reroll would just bring the last one back) — unless there's
    // nothing else left.
    const had = this.bountiedIn.get(periodKey);
    const fresh = open.filter((t) => !had?.has(t.id));
    const candidates = fresh.length > 0 ? fresh : open;
    const pick = pickWeighted(candidates, (t) => bountyWeight(t, now.toISOString()), this.random());
    if (!pick) return null;
    this.commit({
      type: "BountyRolled",
      taskId: pick.id,
      periodKey,
      multiplier: this.settings.bounty.multiplier,
      ...(reroll ? { reroll: true, ...reroll } : {}),
    }, idempotencyKey);
    return pick.id;
  }

  // Rerolls left: the open week's free ones (granted at its start), and bought ones banked.
  private rerollsLeft(): { free: number; banked: number } {
    const week = this.openPeriods.week?.key;
    const own = week ? this.freeRerolls.get(week) : undefined;
    const free = week ? Math.max(0, (own?.granted ?? this.settings.bounty.rerolls) - (own?.used ?? 0)) : 0;
    return { free, banked: Math.max(0, this.bankedRerolls) };
  }

  private bountyCandidates(): Task[] {
    return this.tasks.filter((t) => {
      const section = this.sections.find((s) => s.id === t.sectionId);
      return !!section && canBounty(t, section);
    });
  }

  // A Bounty as its reel shows it, with other candidates' names for the reel (the most avoided first —
  // display only, nothing random).
  private bountyView(task: Task, now: Date = clockNow()): RolledBounty {
    const { free, banked } = this.rerollsLeft();
    const reel = this.bountyCandidates()
      .filter((t) => t.id !== task.id)
      .sort((a, b) => bountyWeight(b, now.toISOString()) - bountyWeight(a, now.toISOString()))
      .slice(0, 7)
      .map((t) => t.text);
    return { taskId: task.id, text: task.text, multiplier: this.bountyOn(task)?.multiplier ?? 1, rerollsLeft: free + banked, reel };
  }

  private bountiesView(now: Date = clockNow()): RolledBounty[] {
    return this.activeBounties().map((task) => this.bountyView(task, now));
  }

  // The open week's Bounties still to win, and the rerolls left.
  bountyStatus(now: Date = clockNow()): BountyStatus {
    const { free, banked } = this.rerollsLeft();
    return { bounties: this.bountiesView(now), rerollsLeft: free + banked };
  }

  // Reroll one of this week's Bounties onto another candidate — while rerolls are left (the week's free
  // ones first, then bought ones), and only before it's won (otherwise a finished Bounty could be traded
  // for another). Returns the new one.
  rerollBounty(taskId: string, idempotencyKey?: string | null, now: Date = clockNow()): RolledBounty {
    const week = this.openPeriods.week?.key;
    const bounty = week && this.settings.bounty.enabled ? this.bounties.get(week)?.find((b) => b.taskId === taskId) : undefined;
    if (!week || !bounty) throw badRequest("that task isn't a Bounty this week");
    const task = this.tasks.find((t) => t.id === taskId);
    if (task && behaviorOf(task).isDone(task)) throw badRequest("this Bounty is already won");
    const { free, banked } = this.rerollsLeft();
    const rerollFrom = rerollSource(free, banked);
    if (!rerollFrom) throw badRequest("no rerolls left");
    const picked = this.rollBounty(week, now, { replaces: taskId, rerollFrom }, idempotencyKey);
    if (!picked) throw badRequest("there's nothing else to roll");
    return this.bountyView(this.requireTask(picked), now);
  }

  // "Reset progress, keep the board": wipe all history/state but rebuild the board from its CURRENT
  // definitions — same tabs, tasks, streaks, shop tabs and rewards (their ids preserved so links stay
  // valid), just with every completion, progress, tier, timer, period and purchase gone and streaks
  // back at zero. Destructive (clears the log) but re-seeds from what's here now rather than the demo
  // or an empty board.
  reseedFromCurrent(): void {
    // Snapshot definitions before the wipe. Only definition fields — done/progress/tier/timer are
    // state and are intentionally dropped (TaskCreated re-projects them fresh: not done, progress 0).
    const sections = this.sections.map((s) => ({ ...s, allowedTypes: [...s.allowedTypes] }));
    const taskById = new Map(
      this.tasks.map((t) => [t.id, { id: t.id, sectionId: t.sectionId, definition: taskDefinition(t) }]),
    );
    // Groups: label + member ids (tasks or rewards), so they can be recreated once their items exist.
    const groups = this.groups.map((g) => ({
      id: g.id,
      sectionId: g.sectionId,
      label: g.label,
      itemIds: this.allItems().filter((i) => i.groupId === g.id).map((i) => i.id),
    }));
    // Per-section item id order (tasks and rewards alike). Re-emitting the creates in this order
    // restores each sequence with no separate reorder event.
    const orderBySection = new Map([...this.itemOrder].map(([s, ids]) => [s, [...ids]]));
    const streakById = new Map(this.streaks.map((s) => [s.id, { ...s }]));
    // The shop's definitions (its tabs and rewards) are kept like the board's; purchases are progress,
    // so they go with everything else — `spent` restarts at zero alongside the points.
    const shopSections = this.shopSections.map((s) => ({ ...s }));
    const rewards = this.rewards.map((r) => ({ ...r }));
    const settings = this.settings;

    this.clearAll();

    this.commit({ type: "SettingsChanged", settings });
    for (const s of sections) {
      this.commit({
        type: "SectionCreated",
        sectionId: s.id,
        name: s.name,
        color: s.color,
        kind: s.kind,
        ...(s.period ? { period: s.period } : {}),
        allowedTypes: s.allowedTypes,
      });
    }
    for (const s of sections) {
      for (const id of orderBySection.get(s.id) ?? []) {
        const t = taskById.get(id);
        if (!t) continue;
        this.commit({ type: "TaskCreated", taskId: t.id, sectionId: t.sectionId, ...t.definition });
        // Its pieces right after it, in their order under it (each definition carries its parentId).
        for (const pieceId of orderBySection.get(id) ?? []) {
          const piece = taskById.get(pieceId);
          if (piece) this.commit({ type: "TaskCreated", taskId: piece.id, sectionId: piece.sectionId, ...piece.definition });
        }
      }
    }
    for (const s of sections) {
      for (const id of orderBySection.get(s.id) ?? []) {
        const st = streakById.get(id);
        if (!st) continue;
        this.commit({
          type: "StreakCreated",
          streakId: st.id,
          sectionId: st.sectionId,
          name: st.name,
          streakType: st.type,
          mode: st.mode,
          since: st.since,
          legacy: st.legacy,
          legacyBest: st.legacyBest,
          matcher: st.matcher,
        });
      }
    }
    const rewardById = new Map(rewards.map((r) => [r.id, r]));
    for (const s of shopSections) {
      this.commit({ type: "ShopSectionCreated", shopSectionId: s.id, name: s.name, color: s.color });
      for (const id of orderBySection.get(s.id) ?? []) {
        const r = rewardById.get(id);
        if (!r) continue;
        this.commit({
          type: "RewardCreated",
          rewardId: r.id,
          shopSectionId: r.shopSectionId,
          name: r.name,
          emoji: r.emoji,
          cost: r.cost,
          ...(r.note ? { note: r.note } : {}),
        });
      }
    }
    // Groups after all their items exist — each re-tags its members' groupId.
    for (const g of groups) {
      if (g.itemIds.length > 0) {
        this.commit({ type: "GroupCreated", groupId: g.id, sectionId: g.sectionId, label: g.label, itemIds: g.itemIds });
      }
    }
    // No periods started: a reset leaves you to consciously start your first day/week (the prompt).
  }

  // Wipe everything — used by the "reset board" setting. The caller re-seeds afterwards. Destructive
  // and deliberate: it clears the append-only log itself, the one place we ever do so.
  clearAll(): void {
    this.store.clear();
    this.sections = [];
    this.tasks = [];
    this.groups = [];
    this.itemOrder.clear();
    this.streaks = [];
    this.timers.clear();
    this.prunedIn.clear();
    this.completions = [];
    this.settings = DEFAULT_SETTINGS;
    this.settingsSeeded = false;
    this.openPeriods = {};
    this.settled = { day: new Map(), week: new Map() };
    this.shopSections = [];
    this.rewards = [];
    this.spent = 0;
    this.banked = 0;
    this.bankedLevels.clear();
    this.bounties.clear();
    this.bountiedIn.clear();
    this.freeRerolls.clear();
    this.bankedRerolls = 0;
    this.tallies = { day: newTally(), week: newTally() };
    this.weekStartStreaks = null;
  }

  // Timers are client-ephemeral: updated in place, never logged, gone on restart.
  setTimer(id: string, timer: Timer | null): Task {
    const task = this.requireTask(id);
    if (timer === null) this.timers.delete(id);
    else this.timers.set(id, timer);
    return this.readTask(task);
  }

  // ---- internals ----

  private commit(event: BoardEvent, idempotencyKey?: string | null): AppendResult {
    // Stamp with the (possibly debug-pinned) clock so a completion made under a faked time buckets
    // into that day/week — keeping the simulation coherent end to end.
    const result = this.store.append(event, clockNow().toISOString(), idempotencyKey);
    if (result.created) this.apply(result.stored);
    return result;
  }

  private assertPermutation(given: string[], expected: string[], noun: string): void {
    const same =
      given.length === expected.length && expected.every((id) => given.includes(id));
    if (!same) throw badRequest(`orderedIds must match all ${noun} ids exactly`);
  }

  // The fold, with the open periods' tallies kept around it, each day by day (the board's day it happened
  // in): a tick's gain is the task's value after it less before (so its boost, and anything a tick
  // settles, is in it), and a purchase is what it froze, under the reward's name then. TasksReset is
  // banking, not a tick, so a period's own reset never counts against it.
  private apply(stored: StoredEvent): void {
    const { event, occurredAt } = stored;
    const ticked = TICKS.has(event.type) && "taskId" in event ? event.taskId : null;
    const before = ticked ? this.valueOf(ticked) : 0;
    this.applyEvent(stored);
    const dayKey = dayKeyFor(occurredAt, this.settings);
    const dayOf = (tally: PeriodTally): DayTally => {
      let day = tally.get(dayKey);
      if (!day) tally.set(dayKey, (day = { gains: new Map(), purchases: [] }));
      return day;
    };
    if (ticked) {
      const gain = this.valueOf(ticked) - before;
      for (const tally of Object.values(this.tallies)) {
        const day = dayOf(tally);
        day.gains.set(ticked, (day.gains.get(ticked) ?? 0) + gain);
      }
    }
    if (event.type === "RewardPurchased") {
      const reward = this.rewards.find((r) => r.id === event.rewardId);
      const purchase: RecapPurchase = { name: reward?.name ?? "A reward", emoji: reward?.emoji ?? "", cost: event.pointsSpent };
      for (const tally of Object.values(this.tallies)) dayOf(tally).purchases.push(purchase);
    }
    // A deleted task's points are gone from the board, so they aren't the period's either.
    if (event.type === "TaskDeleted") {
      for (const tally of Object.values(this.tallies)) for (const day of tally.values()) day.gains.delete(event.taskId);
    }
    if (event.type === "PeriodStarted") this.tallies[event.kind] = newTally();
    if (event.type === "PeriodStarted" && event.kind === "week") {
      this.weekStartStreaks = event.streaks ? new Map(event.streaks.map((st) => [st.streakId, st.count])) : null;
    }
  }

  private valueOf(taskId: string): number {
    const task = this.tasks.find((t) => t.id === taskId);
    return task ? taskPointValue(task) : 0;
  }

  private applyEvent(stored: StoredEvent): void {
    const { event, occurredAt } = stored;
    switch (event.type) {
      case "SectionCreated":
        this.sections.push({
          id: event.sectionId,
          name: event.name,
          color: event.color,
          kind: event.kind ?? "tasks",
          ...(event.period ? { period: event.period } : {}),
          allowedTypes: event.allowedTypes,
        });
        this.itemOrder.set(event.sectionId, []);
        return;
      case "SectionRecolored": {
        const section = this.sections.find((s) => s.id === event.sectionId);
        if (section) section.color = event.color;
        return;
      }
      case "SectionPeriodSet": {
        const section = this.sections.find((s) => s.id === event.sectionId);
        if (section) section.period = event.period;
        return;
      }
      case "SectionAllowedTypesSet": {
        const section = this.sections.find((s) => s.id === event.sectionId);
        if (section) section.allowedTypes = event.allowedTypes;
        return;
      }
      case "SectionsReordered":
        this.sections = orderBy(this.sections, (s) => s.id, event.orderedIds);
        return;
      case "TaskCreated": {
        // `count` is the box count; `target` is its pre-merge name (count ?? target). A multi-box
        // task starts its ticks in `progress`; a plain checkbox (count absent/1) uses `done`.
        const count = event.count ?? event.target;
        this.tasks.push({
          id: event.taskId,
          sectionId: event.sectionId,
          type: event.taskType,
          text: event.text,
          done: false,
          ...(event.points !== undefined ? { points: event.points } : {}),
          ...(event.estimate ? { estimate: event.estimate } : {}),
          ...(event.estimateMinutes !== undefined ? { estimateMinutes: floorMinutes(event.estimateMinutes) } : {}),
          ...(event.estimateEffortIndex != null ? { estimateEffortIndex: event.estimateEffortIndex } : {}),
          ...(event.pointsSource !== undefined ? { pointsSource: event.pointsSource } : {}),
          ...(event.description ? { description: event.description } : {}),
          ...(event.tiers ? { tiers: floorTiers(event.tiers), activeTier: null } : {}),
          ...(count !== undefined ? { count } : {}),
          ...(count !== undefined && count > 1 ? { progress: 0 } : {}),
          ...(event.schedule?.some(Boolean) ? { schedule: event.schedule } : {}),
          ...(event.parentId ? { parentId: event.parentId } : {}),
          createdAt: occurredAt,
          updatedAt: occurredAt,
          completedAt: null,
        });
        this.orderList(event.parentId ?? event.sectionId).push(event.taskId);
        // A new task lands at the end of the listed run, ahead of any retired tasks.
        this.settleRetired(event.sectionId);
        return;
      }
      case "TaskCompleted":
        this.completions.push({ taskId: event.taskId, occurredAt });
        this.mutateTask(event.taskId, occurredAt, (t) => {
          t.done = true;
          t.completedAt = occurredAt;
          if (event.boost !== undefined && event.boost !== 1) t.boost = event.boost;
          else delete t.boost;
        });
        this.settleDoneChange(event.taskId);
        this.releaseDependents(event.taskId, occurredAt);
        return;
      case "TaskUncompleted":
        this.mutateTask(event.taskId, occurredAt, (t) => {
          t.done = false;
          t.completedAt = null;
          delete t.boost;
        });
        // An unchecked one-time task rejoins the listed run, at its end.
        this.settleDoneChange(event.taskId);
        return;
      case "TaskTierSet":
        // Selecting any tier is a completion moment for streak purposes; clearing it is not.
        if (event.activeTier !== null) this.completions.push({ taskId: event.taskId, occurredAt });
        this.mutateTask(event.taskId, occurredAt, (t) => {
          t.activeTier = event.activeTier;
          t.completedAt = event.activeTier !== null ? occurredAt : null;
        });
        this.releaseDependents(event.taskId, occurredAt);
        return;
      case "TaskProgressSet":
        // Reaching a box count is a completion moment for streaks; the level reached is recorded so a
        // streak can require "done N times". Clearing back to 0 is not a completion.
        if (event.progress > 0)
          this.completions.push({ taskId: event.taskId, occurredAt, count: event.progress });
        this.mutateTask(event.taskId, occurredAt, (t) => {
          t.progress = event.progress;
          t.completedAt = t.count != null && event.progress >= t.count ? occurredAt : null;
        });
        this.releaseDependents(event.taskId, occurredAt);
        return;
      case "TaskEdited":
        this.mutateTask(event.taskId, occurredAt, (t) => {
          const c = event.changes;
          if (c.text !== undefined) t.text = c.text;
          if (c.points !== undefined) t.points = c.points;
          if (c.estimate !== undefined) t.estimate = c.estimate ?? undefined;
          if (c.estimateMinutes !== undefined) t.estimateMinutes = floorMinutes(c.estimateMinutes ?? undefined);
          if (c.estimateEffortIndex !== undefined) t.estimateEffortIndex = c.estimateEffortIndex ?? undefined;
          if (c.pointsSource !== undefined) t.pointsSource = c.pointsSource;
          if (c.description !== undefined) t.description = c.description ?? undefined;
          if (c.tiers !== undefined) t.tiers = floorTiers(c.tiers);
          // `count` is canonical; `target` is the pre-merge alias on old events. Shrinking the box
          // count below what's already ticked clamps progress so state stays valid.
          const nextCount = c.count ?? c.target;
          if (nextCount !== undefined) {
            t.count = nextCount;
            if ((t.progress ?? 0) > nextCount) t.progress = nextCount;
          }
          // An all-unscheduled array clears the schedule; otherwise it replaces it wholesale.
          if (c.schedule !== undefined) t.schedule = c.schedule.some(Boolean) ? c.schedule : undefined;
        });
        // Lowering a box count to what's already ticked finishes the task.
        this.releaseDependents(event.taskId, occurredAt);
        return;
      case "TaskTypeChanged":
        this.mutateTask(event.taskId, occurredAt, (t) => {
          t.type = event.taskType;
        });
        // A task that was already done when it became one-time retires now.
        this.settleDoneChange(event.taskId);
        return;
      case "TasksReordered":
        // orderedIds is the section's full task permutation; it becomes the new order. Any id not
        // listed (defensive) trails, matching orderBy's fallback. Groups are gathered and retired tasks
        // re-settled to the end, so no posted order can split a group or strand a retired task.
        this.itemOrder.set(
          event.sectionId,
          orderBy(this.orderList(event.sectionId), (id) => id, event.orderedIds),
        );
        this.settleGroups(event.sectionId);
        this.settleRetired(event.sectionId);
        return;
      case "TaskDeleted": {
        const task = this.tasks.find((t) => t.id === event.taskId);
        if (task) this.removeFromOrder(listOf(task), event.taskId);
        this.itemOrder.delete(event.taskId);
        this.tasks = this.tasks.filter((t) => t.id !== event.taskId);
        this.timers.delete(event.taskId);
        this.prunedIn.delete(event.taskId);
        this.dropGroupIfEmpty(task?.groupId);
        // Nothing is left to wait on, so whatever waited on it goes back to where it was.
        this.releaseDependents(event.taskId, occurredAt, true);
        return;
      }
      case "TaskPruned":
        this.prunedIn.set(event.taskId, event.periodKey);
        return;
      case "TaskUnpruned":
        this.prunedIn.delete(event.taskId);
        return;
      case "TaskParentSet": {
        const task = this.tasks.find((t) => t.id === event.taskId);
        if (!task) return;
        this.removeFromOrder(listOf(task), task.id);
        if (event.parentId) {
          // In as the task's last piece. A piece isn't an item of its tab's list, so it leaves its group.
          const groupId = task.groupId;
          task.parentId = event.parentId;
          task.groupId = undefined;
          this.dropGroupIfEmpty(groupId);
          this.orderList(event.parentId).push(task.id);
        } else {
          // Out into its tab's list, right after the task it left (at the end if that's gone); then the
          // tab's own rules settle it: groups gathered, finished one-time tasks trailing.
          delete task.parentId;
          const list = this.orderList(task.sectionId);
          const at = event.previousParentId ? list.indexOf(event.previousParentId) : -1;
          list.splice(at === -1 ? list.length : at + 1, 0, task.id);
          this.settleGroups(task.sectionId);
          this.settleRetired(task.sectionId);
        }
        task.updatedAt = occurredAt;
        return;
      }
      case "BountyRolled": {
        // A reroll swaps the one it replaces (an older one, the week's only one); any other roll adds one.
        const week = this.bounties.get(event.periodKey) ?? [];
        const at = event.replaces !== undefined ? week.findIndex((b) => b.taskId === event.replaces) : event.reroll ? week.length - 1 : -1;
        const rolled = { taskId: event.taskId, multiplier: event.multiplier };
        this.bounties.set(event.periodKey, at >= 0 ? week.map((b, i) => (i === at ? rolled : b)) : [...week, rolled]);
        this.bountiedIn.set(event.periodKey, new Set(this.bountiedIn.get(event.periodKey)).add(event.taskId));
        if (event.reroll && event.rerollFrom === "bank") this.bankedRerolls -= 1;
        else if (event.reroll) {
          const own = this.freeRerolls.get(event.periodKey) ?? { granted: null, used: 0 };
          this.freeRerolls.set(event.periodKey, { ...own, used: own.used + 1 });
        }
        return;
      }
      case "BountyRerollsGranted": {
        if (event.source === "purchase") this.bankedRerolls += event.count;
        else this.freeRerolls.set(event.periodKey, { granted: event.count, used: this.freeRerolls.get(event.periodKey)?.used ?? 0 });
        return;
      }
      case "PiecesReordered":
        this.itemOrder.set(event.taskId, orderBy(this.orderList(event.taskId), (id) => id, event.orderedIds));
        return;
      case "TaskStatusSet":
        this.mutateTask(event.taskId, occurredAt, (t) => {
          const change = statusChange(t, event.status, { note: event.note, taskId: event.blockedBy }, occurredAt);
          t.status = change.status;
          if (change.statusSince) t.statusSince = change.statusSince;
          if (change.blocker) t.blocker = change.blocker;
          else delete t.blocker;
        });
        return;
      case "GroupCreated": {
        this.groups.push({ id: event.groupId, sectionId: event.sectionId, label: event.label });
        const members = new Set(event.itemIds ?? event.taskIds ?? []);
        for (const item of this.allItems()) if (members.has(item.id)) item.groupId = event.groupId;
        this.settleGroups(event.sectionId);
        return;
      }
      case "GroupEdited": {
        const group = this.groups.find((g) => g.id === event.groupId);
        if (group) group.label = event.label;
        return;
      }
      case "GroupMembersAdded": {
        const added = new Set(event.addedItemIds ?? event.addedTaskIds ?? []);
        for (const item of this.allItems()) if (added.has(item.id)) item.groupId = event.groupId;
        const sectionId = this.groups.find((g) => g.id === event.groupId)?.sectionId;
        if (sectionId) this.settleGroups(sectionId);
        return;
      }
      case "GroupMembersRemoved": {
        const removed = new Set(event.removedItemIds ?? event.removedTaskIds ?? []);
        for (const item of this.allItems()) if (removed.has(item.id)) item.groupId = undefined;
        return;
      }
      case "GroupDeleted":
        this.groups = this.groups.filter((g) => g.id !== event.groupId);
        for (const item of this.allItems()) if (item.groupId === event.groupId) item.groupId = undefined;
        return;
      case "StreakCreated":
        this.streaks.push({
          id: event.streakId,
          sectionId: event.sectionId,
          name: event.name,
          // New events carry streakType; pre-rename events carry period (daily/weekly). Default guards
          // a malformed row (matches how `kind` defaults) — neither field should be absent in practice.
          type: event.streakType ?? event.period ?? "daily",
          mode: event.mode,
          since: event.since ?? "created",
          legacy: event.legacy ?? 0,
          legacyBest: event.legacyBest ?? 0,
          matcher: event.matcher,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        });
        this.orderList(event.sectionId).push(event.streakId);
        return;
      case "StreakEdited": {
        const streak = this.streaks.find((s) => s.id === event.streakId);
        if (!streak) return;
        const c = event.changes;
        if (c.name !== undefined) streak.name = c.name;
        // `type` is canonical; `period` is the pre-rename alias on old events (see StreakEditFields).
        if ((c.type ?? c.period) !== undefined) streak.type = c.type ?? c.period!;
        if (c.mode !== undefined) streak.mode = c.mode;
        if (c.since !== undefined) streak.since = c.since;
        if (c.legacy !== undefined) streak.legacy = c.legacy;
        if (c.legacyBest !== undefined) streak.legacyBest = c.legacyBest;
        if (c.matcher !== undefined) streak.matcher = c.matcher;
        streak.updatedAt = occurredAt;
        return;
      }
      case "StreaksReordered":
        // Same pattern as TasksReordered: orderedIds becomes the section's new item order, tracked in
        // the shared itemOrder map rather than the streaks array itself (so streaks are list structure
        // like tasks/rewards — reorderable and groupable through the same generic commands).
        this.itemOrder.set(
          event.sectionId,
          orderBy(this.orderList(event.sectionId), (id) => id, event.orderedIds),
        );
        this.settleGroups(event.sectionId);
        return;
      case "StreakDeleted": {
        const streak = this.streaks.find((s) => s.id === event.streakId);
        if (streak) this.removeFromOrder(streak.sectionId, event.streakId);
        this.streaks = this.streaks.filter((s) => s.id !== event.streakId);
        this.dropGroupIfEmpty(streak?.groupId);
        return;
      }
      case "SettingsChanged":
        this.settings = event.settings;
        this.settingsSeeded = true;
        return;
      case "PeriodStarted":
        this.openPeriods[event.kind] = { key: event.periodKey, startedAt: occurredAt };
        // A week starting starts its Bounties and free rerolls afresh — the debug clock can reopen a week,
        // and whatever an earlier run of it held ended when that run closed.
        if (event.kind === "week") {
          this.bounties.delete(event.periodKey);
          this.bountiedIn.delete(event.periodKey);
          this.freeRerolls.delete(event.periodKey);
        }
        return;
      case "PeriodClosed":
        this.settled[event.kind].set(
          event.periodKey,
          new Map(event.snapshot.map((s) => [s.taskId, s.level])),
        );
        return;
      case "TasksReset":
        // Back to level 0 through the one level→storage mapping; the frozen value moves to `banked`, and
        // the level it held to `bankedLevels`.
        for (const id of event.taskIds) {
          this.mutateTask(id, occurredAt, (t) => {
            this.bankedLevels.set(id, (this.bankedLevels.get(id) ?? 0) + behaviorOf(t).filled(t));
            Object.assign(t, behaviorOf(t).patchForLevel(t, 0));
            delete t.boost;
            t.completedAt = null;
          });
        }
        this.banked += event.pointsBanked;
        return;
      case "ShopSectionCreated":
        this.shopSections.push({ id: event.shopSectionId, name: event.name, color: event.color });
        return;
      case "ShopSectionEdited": {
        const section = this.shopSections.find((s) => s.id === event.shopSectionId);
        if (!section) return;
        if (event.changes.name !== undefined) section.name = event.changes.name;
        if (event.changes.color !== undefined) section.color = event.changes.color;
        return;
      }
      case "ShopSectionDeleted":
        this.shopSections = this.shopSections.filter((s) => s.id !== event.shopSectionId);
        this.rewards = this.rewards.filter((r) => r.shopSectionId !== event.shopSectionId);
        this.groups = this.groups.filter((g) => g.sectionId !== event.shopSectionId);
        this.itemOrder.delete(event.shopSectionId);
        return;
      case "RewardCreated":
        this.rewards.push({
          id: event.rewardId,
          shopSectionId: event.shopSectionId,
          name: event.name,
          emoji: event.emoji,
          cost: event.cost,
          ...(event.note ? { note: event.note } : {}),
          redeemed: 0,
          createdAt: occurredAt,
        });
        this.orderList(event.shopSectionId).push(event.rewardId);
        return;
      case "RewardsReordered":
        this.itemOrder.set(
          event.shopSectionId,
          orderBy(this.orderList(event.shopSectionId), (id) => id, event.orderedIds),
        );
        this.settleGroups(event.shopSectionId);
        return;
      case "RewardEdited": {
        const reward = this.rewards.find((r) => r.id === event.rewardId);
        if (!reward) return;
        const { name, emoji, cost, note } = event.changes;
        if (name !== undefined) reward.name = name;
        if (emoji !== undefined) reward.emoji = emoji;
        if (cost !== undefined) reward.cost = cost;
        if (note !== undefined) reward.note = note ?? undefined;
        return;
      }
      case "RewardDeleted": {
        const reward = this.rewards.find((r) => r.id === event.rewardId);
        if (reward) this.removeFromOrder(reward.shopSectionId, event.rewardId);
        this.rewards = this.rewards.filter((r) => r.id !== event.rewardId);
        this.dropGroupIfEmpty(reward?.groupId);
        return;
      }
      case "RewardPurchased": {
        // The frozen pointsSpent, not the reward's current cost — a later price edit never rewrites it.
        this.spent += event.pointsSpent;
        const reward = this.rewards.find((r) => r.id === event.rewardId);
        if (reward) reward.redeemed += 1;
        return;
      }
    }
  }

  private mutateTask(id: string, occurredAt: string, fn: (task: Task) => void): void {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    fn(task);
    task.updatedAt = occurredAt;
  }

  // Finished one-time tasks leave their list (TaskBehavior.retiresWhenDone) but stay in state — still
  // done, still worth their points. Two derived rules keep the list base working around them, both
  // fold rules over the log rather than events, so a rebuild lands exactly here too:
  //  - a task that retires drops out of its group (a hidden member would split the group's run), and
  //  - a section's retired tasks always trail its order (a stable partition), so the tasks still
  //    listed are one contiguous run that reorders and groups without a hidden task stranded inside.
  private settleDoneChange(taskId: string): void {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (isRetired(task) && task.groupId) {
      const groupId = task.groupId;
      task.groupId = undefined;
      this.dropGroupIfEmpty(groupId);
    }
    this.settleRetired(task.sectionId);
  }

  private settleRetired(sectionId: string): void {
    const retired = new Set(
      this.tasks.filter((t) => t.sectionId === sectionId && isRetired(t)).map((t) => t.id),
    );
    if (retired.size === 0) return;
    const list = this.orderList(sectionId);
    this.itemOrder.set(sectionId, [...list.filter((id) => !retired.has(id)), ...list.filter((id) => retired.has(id))]);
  }

  // A group is one contiguous run of its list, by construction: after anything that can change an order
  // or a membership, its members are gathered at the first one's place (see gatherGroups). A fold rule,
  // so a rebuild lands here too.
  private settleGroups(sectionId: string): void {
    const groupOf = new Map(this.allItems().map((item) => [item.id, item.groupId]));
    this.itemOrder.set(sectionId, gatherGroups(this.orderList(sectionId), (id) => groupOf.get(id)));
  }

  // A broken-down task is done once every piece is, and open again once one isn't — whatever changed a
  // piece (ticked, unticked, added, deleted, tucked in or taken out), the task's own TaskCompleted /
  // TaskUncompleted follows, committed here so its award is frozen on an event like any other. A task
  // left with no pieces is a plain task again, done by its own box.
  private settleParent(id: string | null | undefined): void {
    const parent = id ? this.tasks.find((t) => t.id === id) : undefined;
    if (!parent) return;
    const done = doneFromPieces(this.piecesOf(parent.id));
    if (done === null || done === behaviorOf(parent).isDone(parent)) return;
    this.commit(
      done
        ? this.completion(parent)
        : { type: "TaskUncompleted", taskId: parent.id },
    );
  }

  // Whatever waits on `blockerId` goes back to the band it was in once that task is done — or `gone`.
  // A fold rule over the completion rather than an event (only the owner's own choices are events), and
  // it releases for good: a daily blocker unchecked by its day's reset doesn't block it again.
  private releaseDependents(blockerId: string, occurredAt: string, gone = false): void {
    const blocker = this.tasks.find((t) => t.id === blockerId);
    if (!gone && !(blocker && behaviorOf(blocker).isDone(blocker))) return;
    for (const task of this.tasks) {
      const release = releasedFrom(task, blockerId, occurredAt);
      if (!release) continue;
      this.mutateTask(task.id, occurredAt, (t) => {
        t.status = release.status;
        t.statusSince = release.statusSince;
        delete t.blocker;
      });
    }
  }
}

// The owner's ticks: what a period's recap counts as earned (never a reset, an edit or a rebalance).
const TICKS = new Set<BoardEvent["type"]>(["TaskCompleted", "TaskUncompleted", "TaskTierSet", "TaskProgressSet"]);

interface DayTally {
  gains: Map<string, number>;
  purchases: RecapPurchase[];
}
// By day key.
type PeriodTally = Map<string, DayTally>;
const newTally = (): PeriodTally => new Map();

/** The day key `days` after `key` ("2026-09-27" + 6 → "2026-10-03"). */
function addDays(key: string, days: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The idempotency key for one of several events a single request commits (null without a key). */
function subKey(key: string | null | undefined, tag: string): string | null {
  return key ? `${key}:${tag}` : null;
}

/** Reorder `items` to follow `order` (a list of keys); items whose key isn't listed keep trailing. */
function orderBy<T>(items: T[], key: (item: T) => string, order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (rank.get(key(a)) ?? Infinity) - (rank.get(key(b)) ?? Infinity));
}
