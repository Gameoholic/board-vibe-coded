import { randomUUID } from "node:crypto";
import {
  type AllowedType,
  behaviorOf,
  type BoardEvent,
  type ClosedPeriod,
  type CompletionRecord,
  computeCounter,
  computeStreak,
  type CreateGroupBody,
  type CreateRewardBody,
  type CreateShopSectionBody,
  type CreateStreakBody,
  type CreateTaskBody,
  DEFAULT_SETTINGS,
  effortMultOf,
  type FormulaPreview,
  type Group,
  type PatchSettingsBody,
  type PointsFormula,
  pointsFromMinutes,
  resolvePointsSource,
  type PeriodKind,
  type PeriodRecap,
  periodKeyFor,
  type PeriodStatus,
  type Reward,
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
  type Task,
  type TaskEditFields,
  taskPointValue,
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

  constructor(private readonly store: EventStore) {
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

  listStreaks(sectionId?: string): StreakView[] {
    const rows = sectionId ? this.streaks.filter((s) => s.sectionId === sectionId) : this.streaks;
    return rows.map((s) => this.readStreak(s));
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
  private pointsAvailable(): number {
    return this.tasks.reduce((sum, t) => sum + taskPointValue(t), 0) + this.banked - this.spent;
  }

  // The count/active are derived here — never stored — so a rebuild and live state can't disagree.
  private readStreak(streak: Streak): StreakView {
    // A counter lives in current state: the sum of its linked tasks' currently-ticked boxes, so it
    // rises on a tick and falls on an untick. Daily/weekly instead fold completion history.
    if (streak.type === "counter") {
      const levels = new Map(this.tasks.map((t) => [t.id, behaviorOf(t).filled(t)]));
      // "Now" needs only the live levels; "all time" also folds history (honest via day snapshots).
      const { count, active, best } = computeCounter(streak, levels, {
        completions: this.completions,
        settled: this.settled.day,
        settings: this.settings,
        now: clockNow(),
      });
      return { ...streak, count, active, best };
    }
    // Box count per task (for `required: "all"`) and live filled level (for the current open period,
    // so an uncheck today drops the streak instead of the raw log keeping it).
    const boxCounts = new Map(this.tasks.map((t) => [t.id, behaviorOf(t).boxes(t)]));
    const currentLevels = new Map(this.tasks.map((t) => [t.id, behaviorOf(t).filled(t)]));
    const settled = streak.type === "weekly" ? this.settled.week : this.settled.day;
    const { count, active, best } = computeStreak(this.completions, streak, clockNow(), boxCounts, this.settings.timeZone, {
      settings: this.settings,
      settled,
      currentLevels,
    });
    return { ...streak, count, active, best };
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
    const order = this.orderIndex(task.sectionId, task.id);
    // Always return a concrete pointsSource: the stored flag if present, else derived once against the
    // historic default formula (pre-feature values). Same per tier. Never derived against the *current*
    // formula, so a rate change never silently reclassifies an untouched value (see resolvePointsSource).
    const pointsSource = resolvePointsSource(task.pointsSource, task.estimateMinutes, task.points, task.estimateEffortIndex);
    const tiers = task.tiers?.map((tier) => ({
      ...tier,
      pointsSource: resolvePointsSource(tier.pointsSource, tier.minutes, tier.points, tier.effortIndex),
    }));
    return { ...task, ...(tiers ? { tiers } : {}), pointsSource, order, ...(timer ? { timer } : {}) };
  }

  private requireGroup(id: string): Group {
    const group = this.groups.find((g) => g.id === id);
    if (!group) throw notFound("group");
    return group;
  }

  // The items a section lists — a board tab's tasks or a shop tab's rewards (live references, so the
  // group fold can tag them). Order and groups are list structure, identical for both kinds, so the
  // commands and the fold are written once over this rather than once per item kind.
  private sectionItems(sectionId: string): ListItem[] {
    if (this.sections.some((s) => s.id === sectionId)) return this.tasks.filter((t) => t.sectionId === sectionId);
    if (this.shopSections.some((s) => s.id === sectionId)) {
      return this.rewards.filter((r) => r.shopSectionId === sectionId);
    }
    throw notFound("section");
  }

  // Every groupable item, of every kind — what the group fold tags and untags.
  private allItems(): ListItem[] {
    return [...this.tasks, ...this.rewards];
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

  setDone(id: string, done: boolean, idempotencyKey?: string | null): Task {
    const task = this.requireTask(id);
    const event: BoardEvent = done
      ? { type: "TaskCompleted", taskId: id, pointsAwarded: task.points ?? 0 }
      : { type: "TaskUncompleted", taskId: id };
    this.commit(event, idempotencyKey);
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

  // Reorders a section's tasks. `orderedIds` must be a permutation of its task ids. Grouped tasks move
  // as a block on the client, so the order it sends always keeps each group's members contiguous.
  reorderTasks(sectionId: string, orderedIds: string[], idempotencyKey?: string | null): Task[] {
    this.requireSection(sectionId);
    const currentIds = this.tasks.filter((t) => t.sectionId === sectionId).map((t) => t.id);
    this.assertPermutation(orderedIds, currentIds, "task");
    this.commit({ type: "TasksReordered", sectionId, orderedIds }, idempotencyKey);
    return this.listTasks(sectionId);
  }

  deleteTask(id: string, idempotencyKey?: string | null): void {
    this.requireTask(id);
    this.commit({ type: "TaskDeleted", taskId: id }, idempotencyKey);
  }

  // ---- group commands ----

  // Bundle a contiguous run of a section's ungrouped items (tasks or rewards) under one label.
  // Validates the members exist, belong to the section, aren't already grouped, and are contiguous in
  // the current order.
  createGroup(body: CreateGroupBody, idempotencyKey?: string | null): Group {
    const items = this.sectionItems(body.sectionId);
    const order = this.orderList(body.sectionId);
    const positions = body.itemIds.map((id) => {
      const item = items.find((i) => i.id === id);
      if (!item) throw badRequest("item is not in this section");
      if (item.groupId) throw badRequest("item is already in a group");
      return order.indexOf(id);
    });
    const min = Math.min(...positions);
    const max = Math.max(...positions);
    // Unique positions spanning exactly `count` slots ⇒ a gapless contiguous run.
    if (max - min + 1 !== body.itemIds.length) throw badRequest("group items must be contiguous");
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

  // Every builder-sourced value (a checkbox task, or a tiered task's tier) that carries a time estimate,
  // with the points it would earn under `formula`. Manual and estimate-less values are excluded — those
  // are what "won't update". pointsSource is resolved (stored flag, else derived vs the historic formula).
  private builderValues(
    formula: PointsFormula,
  ): Array<{ task: Task; tierIndex?: number; text: string; tierLabel?: string; oldPoints: number; newPoints: number }> {
    const out: Array<{ task: Task; tierIndex?: number; text: string; tierLabel?: string; oldPoints: number; newPoints: number }> = [];
    for (const t of this.tasks) {
      if (t.type === "checkbox") {
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
  rollPeriod(kind: PeriodKind, now: Date = clockNow()): { recap: PeriodRecap; streaks: StreakView[] } {
    const open = this.openPeriods[kind];
    const currentKey = periodKeyFor(now.toISOString(), kind, this.settings);
    const closedKey = open?.key ?? currentKey;
    const snapshot = this.tasks.map((t) => ({ taskId: t.id, level: behaviorOf(t).filled(t) }));

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
        this.commit({ type: "PeriodStarted", kind, periodKey: currentKey });
      }
    } else {
      this.commit({ type: "PeriodStarted", kind, periodKey: currentKey });
    }

    const items = snapshot
      .filter((s) => s.level > 0)
      .map((s) => {
        const task = this.tasks.find((t) => t.id === s.taskId)!;
        return { taskId: s.taskId, text: task.text, level: s.level, points: behaviorOf(task).valueAt(task, s.level) };
      });
    const recap: PeriodRecap = {
      kind,
      periodKey: closedKey,
      items,
      totalPoints: items.reduce((sum, i) => sum + i.points, 0),
    };
    return { recap, streaks: this.listStreaks() };
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
      this.tasks.map((t) => [
        t.id,
        {
          id: t.id,
          sectionId: t.sectionId,
          type: t.type,
          text: t.text,
          points: t.points,
          estimate: t.estimate,
          estimateMinutes: t.estimateMinutes,
          estimateEffortIndex: t.estimateEffortIndex,
          pointsSource: t.pointsSource,
          description: t.description,
          tiers: t.tiers,
          count: t.count,
          schedule: t.schedule,
        },
      ]),
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
    const streaks = this.streaks.map((s) => ({ ...s }));
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
        this.commit({
          type: "TaskCreated",
          taskId: t.id,
          sectionId: t.sectionId,
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
        });
      }
    }
    for (const s of streaks) {
      this.commit({
        type: "StreakCreated",
        streakId: s.id,
        sectionId: s.sectionId,
        name: s.name,
        streakType: s.type,
        mode: s.mode,
        since: s.since,
        legacy: s.legacy,
        legacyBest: s.legacyBest,
        matcher: s.matcher,
      });
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
    this.completions = [];
    this.settings = DEFAULT_SETTINGS;
    this.settingsSeeded = false;
    this.openPeriods = {};
    this.settled = { day: new Map(), week: new Map() };
    this.shopSections = [];
    this.rewards = [];
    this.spent = 0;
    this.banked = 0;
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

  private apply(stored: StoredEvent): void {
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
          createdAt: occurredAt,
          updatedAt: occurredAt,
          completedAt: null,
        });
        this.orderList(event.sectionId).push(event.taskId);
        return;
      }
      case "TaskCompleted":
        this.completions.push({ taskId: event.taskId, occurredAt });
        this.mutateTask(event.taskId, occurredAt, (t) => {
          t.done = true;
          t.completedAt = occurredAt;
        });
        return;
      case "TaskUncompleted":
        this.mutateTask(event.taskId, occurredAt, (t) => {
          t.done = false;
          t.completedAt = null;
        });
        return;
      case "TaskTierSet":
        // Selecting any tier is a completion moment for streak purposes; clearing it is not.
        if (event.activeTier !== null) this.completions.push({ taskId: event.taskId, occurredAt });
        this.mutateTask(event.taskId, occurredAt, (t) => {
          t.activeTier = event.activeTier;
          t.completedAt = event.activeTier !== null ? occurredAt : null;
        });
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
        return;
      case "TasksReordered":
        // orderedIds is the section's full task permutation; it becomes the new order. Any id not
        // listed (defensive) trails, matching orderBy's fallback.
        this.itemOrder.set(
          event.sectionId,
          orderBy(this.orderList(event.sectionId), (id) => id, event.orderedIds),
        );
        return;
      case "TaskDeleted": {
        const task = this.tasks.find((t) => t.id === event.taskId);
        if (task) this.removeFromOrder(task.sectionId, event.taskId);
        this.tasks = this.tasks.filter((t) => t.id !== event.taskId);
        this.timers.delete(event.taskId);
        this.dropGroupIfEmpty(task?.groupId);
        return;
      }
      case "GroupCreated": {
        this.groups.push({ id: event.groupId, sectionId: event.sectionId, label: event.label });
        const members = new Set(event.itemIds ?? event.taskIds ?? []);
        for (const item of this.allItems()) if (members.has(item.id)) item.groupId = event.groupId;
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
        this.streaks = orderBy(this.streaks, (s) => s.id, event.orderedIds);
        return;
      case "StreakDeleted":
        this.streaks = this.streaks.filter((s) => s.id !== event.streakId);
        return;
      case "SettingsChanged":
        this.settings = event.settings;
        this.settingsSeeded = true;
        return;
      case "PeriodStarted":
        this.openPeriods[event.kind] = { key: event.periodKey, startedAt: occurredAt };
        return;
      case "PeriodClosed":
        this.settled[event.kind].set(
          event.periodKey,
          new Map(event.snapshot.map((s) => [s.taskId, s.level])),
        );
        return;
      case "TasksReset":
        // Back to level 0 through the one level→storage mapping; the frozen value moves to `banked`.
        for (const id of event.taskIds) {
          this.mutateTask(id, occurredAt, (t) => {
            Object.assign(t, behaviorOf(t).patchForLevel(t, 0));
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
}

/** Reorder `items` to follow `order` (a list of keys); items whose key isn't listed keep trailing. */
function orderBy<T>(items: T[], key: (item: T) => string, order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (rank.get(key(a)) ?? Infinity) - (rank.get(key(b)) ?? Infinity));
}
