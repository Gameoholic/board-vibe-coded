import { behaviorOf, DEFAULT_EFFORT_ID, formatPercent, parsePercent } from "@board/contracts";
import { Fragment, useCallback, useMemo, useState } from "react";
import CanvasCard, { CardAdd, CardTitle, type CardFrame } from "./CanvasCard";
import ColorPicker from "./ColorPicker";
import type { MenuPoint } from "./ActionMenu";
import type { BlockReason } from "./BlockForm";
import ItemList, { type DropOutside } from "./ItemList";
import ListPartHead from "./ListPartHead";
import type { RowContext } from "./ItemRow";
import DescriptionField from "./DescriptionField";
import Form from "./Form";
import PriorityField from "./PriorityField";
import PointsBuilder, { type BuilderEstimate, POINTS_FORM_WIDTH, TierBuilderRow, type TierRow } from "./PointsBuilder";
import Popover from "./Popover";
import ScheduleEditor, { scheduleFromRows, type Cadence, type ScheduleRow } from "./ScheduleEditor";
import StatusBand from "./StatusBand";
import StreakForm, { type StreakPayload } from "./StreakForm";
import StreakItem from "./StreakItem";
import TaskCount from "./TaskCount";
import { tabInk } from "./palette";
import { DisplayMenu, SortMenu, sortItems, tabView } from "./TabControls";
import { MODIFIER_LOOKS } from "./modifierLooks";
import { ADD_BUTTON_KEY, GROUPING_KEY, STREAKS_OFFER, taskTabOffer } from "./tabViews";
import TaskItem, { type RowReroll } from "./TaskItem";
import type { FlyOrigin } from "./FlyingPoints";
import type { RowPieces } from "./Pieces";
import { useBoardClock } from "./useBoardClock";
import type { TabPrefs } from "./useLocalConfig";
import { behaviorOfType, canBoost, canBreakDown, canPrioritise, canPrune, DEFAULT_PRIORITY, freezeRefusal, freezerOf, frostShare, isRetired, modifiersOf, payout, statusOf, wholeWorth } from "./types";
import { runBetween, withUnlistedKept } from "./listOps";
import { pruneUntil, streaksBrokenByPruning } from "./pruning";
import { bandSplits, IN_PROGRESS_NUDGE_ABOVE, STATUS_BANDS, statusLabel } from "./taskStatus";
import { uid } from "./uid";
import type { AppliedModifier, Group, Section, StreakView, Task, TaskPriority, TaskSchedule, TaskStatus, TaskType, TierDef } from "./types";

// A board tab: the shared tab base (CanvasCard — move/resize, header, sort/display controls, add
// button) around a board list. A "tasks" tab lists tasks on the shared list base (ItemList — reorder
// and grouping); a "streaks" tab lists streaks. What's specific here is only what's specific to tasks: the
// task row and the add-task form. What its Sort and Display menus offer is its tab's (tabViews.ts).

// The create/edit task payload, in one alias so the schedule field threads through every call site.
type PointsSource = "builder" | "manual";
type TaskCreatePayload = { type: TaskType; text: string; points?: number; estimate?: string; estimateMinutes?: number; estimateEffort?: string; pointsSource?: PointsSource; description?: string; tiers?: TierDef[]; count?: number; schedule?: TaskSchedule; priority?: TaskPriority };
type TaskEditPayload = { text?: string; points?: number; estimateMinutes?: number | null; estimateEffort?: string | null; pointsSource?: PointsSource; description?: string | null; tiers?: Task["tiers"]; count?: number; schedule?: TaskSchedule; priority?: TaskPriority };

const byOrder = (a: Task, b: Task) => (a.order ?? 0) - (b.order ?? 0);

// Where a task shows while the tab's Status bands are on: its band, or the Completed look-back for a
// finished one-time task (listed only while that Display toggle is on).
type Band = TaskStatus | "done";
const bandOf = (task: Task): Band => (isRetired(task) ? "done" : statusOf(task));

const isTaskDone = (task: Task): boolean => behaviorOf(task).isDone(task);

interface SectionCardProps {
  section: Section;
  tasks: Task[];
  groups: Group[];
  streaks: StreakView[];
  allTasks: Task[];
  // Every board tab — the streak form reads which streaks each task can be counted by.
  allSections: Section[];
  // Every streak on the board — Prune reads which ones a task's pruning would break.
  allStreaks: StreakView[];
  flyingTaskIds: Set<string>;
  frame: CardFrame; // placement on the board canvas (from CardCanvas)
  onAddTask: (payload: TaskCreatePayload) => void;
  onSetLevel: (task: Task, level: number, origin?: FlyOrigin) => void;
  onRemoveTask: (id: string) => void;
  onEditTask: (id: string, patch: TaskEditPayload) => void;
  onDuplicateTask: (id: string) => void;
  onSetPruned: (task: Task, pruned: boolean) => void;
  onSetStatus: (task: Task, status: TaskStatus, why?: BlockReason) => void;
  // Freeze a task into its tab's Freezer, or thaw it back out.
  onSetFrozen: (task: Task, frozen: boolean) => void;
  // Break down: pieces typed under a task, a task tucked into another (or, with null, a piece taken out
  // into the list), and a task's pieces reordered.
  onBreakDown: (task: Task, texts: string[]) => void;
  onSetParent: (taskId: string, parentId: string | null) => void;
  onReorderPieces: (parentId: string, orderedIds: string[]) => void;
  // This week's rerolls left, and rerolling one of its Bounties (from the row's menu) — and the same for its
  // Boosters, with the rerolls bought in the shop.
  rerollsLeft: number;
  onRerollBounty: (taskId: string) => void;
  boosterRerollsLeft: number;
  onRerollBooster: (taskId: string) => void;
  // Reorder posts the section's full flat task-id order (group members kept contiguous by the block).
  onReorderItems: (orderedIds: string[]) => void;
  onAddGroup: (taskIds: string[]) => void;
  onExtendGroup: (groupId: string, additionalTaskIds: string[]) => void;
  onEjectFromGroup: (taskId: string, groupId: string, newOrder: string[]) => void;
  onEditGroup: (id: string, label: string) => void;
  onRemoveGroup: (id: string) => void;
  onAddStreak: (payload: StreakPayload) => void;
  onEditStreak: (id: string, payload: StreakPayload) => void;
  onRemoveStreak: (id: string) => void;
  // Streaks are list structure too (see Groups) — reorder/group over the section's streaks, mirroring
  // onReorderItems/onAddGroup/onExtendGroup/onEjectFromGroup above. onEditGroup/onRemoveGroup are
  // shared as-is (they only ever touch the groups list itself, never a specific item kind).
  onReorderStreakItems: (orderedIds: string[]) => void;
  onAddStreakGroup: (streakIds: string[]) => void;
  onExtendStreakGroup: (groupId: string, additionalStreakIds: string[]) => void;
  onEjectStreakFromGroup: (streakId: string, groupId: string, newOrder: string[]) => void;
  onRecolor: (id: string, color: string) => void;
  // Per-tab view prefs (sort + display toggles), persisted per device in localStorage. Undefined
  // until the tab is first touched, then filled from the defaults on read (see tabView).
  prefs: TabPrefs | undefined;
  onPrefsChange: (patch: Partial<TabPrefs>) => void;
  // Sort modes pinned to the top of the Sort menu (global, from useLocalConfig), and a toggle.
}

function SectionCard({
  section,
  tasks,
  groups,
  streaks,
  allTasks,
  allSections,
  allStreaks,
  flyingTaskIds,
  frame,
  onAddTask,
  onSetLevel,
  onRemoveTask,
  onEditTask,
  onDuplicateTask,
  onSetPruned,
  onSetStatus,
  onSetFrozen,
  onBreakDown,
  onSetParent,
  onReorderPieces,
  rerollsLeft,
  onRerollBounty,
  boosterRerollsLeft,
  onRerollBooster,
  onReorderItems,
  onAddGroup,
  onExtendGroup,
  onEjectFromGroup,
  onEditGroup,
  onRemoveGroup,
  onAddStreak,
  onEditStreak,
  onRemoveStreak,
  onReorderStreakItems,
  onAddStreakGroup,
  onExtendStreakGroup,
  onEjectStreakFromGroup,
  onRecolor,
  prefs,
  onPrefsChange,
}: SectionCardProps) {
  // The tab's colour as drawn (lifted on a dark theme); the colour picker still shows the colour as picked.
  const ink = tabInk(section.color);
  const isStreaks = section.kind === "streaks";
  // A Freezer holds what froze out of its tab: no statuses, nothing done or added there — only thawed out.
  const isFreezer = !!section.freezerFor;
  // This tab's own Freezer, if it has one — its tasks can be frozen into it.
  const freezer = freezerOf(allSections, section.id);
  // Scheduled-box cadence inferred from the tab's recurrence: a "week" section schedules by weekday,
  // everything else by time-of-day. This is what makes daily/weekly automatic (not a per-task option).
  const scheduleCadence: Cadence = section.period === "week" ? "weekly" : "daily";
  // What its Sort and Display menus offer is its tab's (tabViews.ts); the choices persist per tab, per device
  // (useLocalConfig) — a display transform, not board truth. An option the tab doesn't offer reads as off.
  const taskOffer = useMemo(() => taskTabOffer(section), [section]);
  const offered = isStreaks ? STREAKS_OFFER : taskOffer;
  const view = tabView(prefs, onPrefsChange, offered);
  const showEstimate = view.shown("estimate");
  const showTimer = view.shown("timer");
  const showAddButton = view.shown(ADD_BUTTON_KEY);
  const showCompleted = view.shown("completed");
  const showPruned = view.shown("pruned");
  const showStatus = view.shown("status");
  const showAge = view.shown("age");
  const showCount = view.shown("task-count");
  const grouping = view.shown(GROUPING_KEY);
  // The row extras a tab may let you turn off — a modifier's line (a Display option keyed by the modifier's
  // id), the meter on it, the thaw bonus — show wherever the tab doesn't offer them as a toggle.
  const extraShown = (key: string) => !offered.displays.some((o) => o.key === key) || view.shown(key);
  const lines = {
    hidden: new Set(Object.keys(MODIFIER_LOOKS).filter((id) => !extraShown(id))),
    meters: extraShown("meters"),
  };
  const sortMode = view.sortMode;
  const sort = taskOffer.sorts.find((o) => o.key === sortMode);
  // A list is in the tab's own order — so its rows drag — under Manual, and under a sort that only splits it
  // into headed parts (by priority).
  const ownOrder = !sort?.compare;
  // Board clock (ticks ~1/min) — read to lock-aware-sort "Get done quick", and for what tasks pay (frost is
  // in Settings); a tick re-renders the card, which is cheap and lets a task slide up the moment it unlocks.
  const { now, settings: boardSettings, openDay } = useBoardClock();
  const sortContext = useMemo(() => ({ now, settings: boardSettings, openDay }), [now, boardSettings, openDay]);
  // The Blocked band folds to its count until opened; which row's Blocked form is open (a drop on the
  // Blocked band opens it as well as the row's own menu and pill, so the tab holds it).
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blockingId, setBlockingId] = useState<string | null>(null);

  // A broken-down task's pieces aren't items of the tab's list: they're listed under their task, in its
  // own order, and folded away with it (which tasks are folded is remembered per device).
  const topTasks = useMemo(() => tasks.filter((t) => !t.parentId), [tasks]);
  const piecesOf = useMemo(() => {
    const byParent = new Map<string, Task[]>();
    for (const t of [...tasks].sort(byOrder)) if (t.parentId) byParent.set(t.parentId, [...(byParent.get(t.parentId) ?? []), t]);
    return byParent;
  }, [tasks]);
  const collapsed = new Set(prefs?.collapsed ?? []);
  const toggleCollapsed = (id: string) =>
    onPrefsChange({ collapsed: collapsed.has(id) ? [...collapsed].filter((c) => c !== id) : [...collapsed, id] });

  // This week's Bounty, while it's an open task of this tab: pinned to the top of its list (taskList).
  const bountyId = topTasks.find((t) => t.bounty && !isRetired(t))?.id;
  // What a row's completion is paid at: what it was paid at once ticked, or — while it's open — the
  // modifiers on it now (its Bounty's or its task's, its frost, Subzero), as the server would pay it.
  const modsOf = (task: Task, inSection: Pick<Section, "freezerFor"> = section): AppliedModifier[] => {
    if (isTaskDone(task)) return task.paidWith ?? [];
    const parent = task.parentId ? tasks.find((t) => t.id === task.parentId) : undefined;
    return modifiersOf(task, { settings: boardSettings, section: inSection, ...(parent ? { parent } : {}), hasPieces: piecesOf.has(task.id) });
  };
  // Whether a Booster reroll has another habit to deal (none that's already a Booster).
  const boosterSpare = useMemo(
    () => allTasks.some((t) => !t.booster && allSections.some((s) => s.id === t.sectionId && canBoost(t, s))),
    [allTasks, allSections],
  );
  // What a row's menu can reroll, while rerolls for it are left: a Bounty still to win, or a Booster.
  const rerollOf = (task: Task): RowReroll | undefined =>
    task.bounty && !isTaskDone(task) && rerollsLeft > 0
      ? { label: "Reroll Bounty", left: rerollsLeft, onReroll: () => onRerollBounty(task.id) }
      : task.booster && boosterRerollsLeft > 0 && boosterSpare
        ? { label: "Reroll Booster", left: boosterRerollsLeft, onReroll: () => onRerollBooster(task.id) }
        : undefined;
  // What thawing a frozen task gains, said on its thaw button and menu: the thaw bonus if it has frost, and
  // what it will pay once it's out, when that's more than now (full frost: Subzero) — all of it, pieces and all.
  const thawGains = (task: Task): string | undefined => {
    const gains: string[] = [];
    if (frostShare(task, boardSettings) > 0) gains.push(`Start now for +${formatPercent(boardSettings.freezer.thawBonus)}`);
    const worth = wholeWorth(task, piecesOf.get(task.id) ?? []);
    const paysNow = payout(worth, modsOf(task));
    const paysOut = payout(worth, modsOf(task, {}));
    if (paysOut > paysNow) gains.push(`pays ${formatPercent(paysOut)}`);
    return gains.length > 0 ? gains.join(" · ") : undefined;
  };

  // Finished one-time tasks leave the list (they stay done and keep their points), and pruned tasks
  // are out of it until their tab's next day/week. The tab's Display can show either: finished ones at the
  // end of the list, as a flat look-back that doesn't reorder or group; pruned ones in a look-back list of
  // their own under it (`prunedTasks`), so the rest of the tab still drags and groups.
  const listedTasks = useMemo(
    () => topTasks.filter((t) => (showCompleted || !isRetired(t)) && !t.pruned),
    [topTasks, showCompleted],
  );
  const prunedTasks = useMemo(() => (showPruned ? topTasks.filter((t) => t.pruned).sort(byOrder) : []), [topTasks, showPruned]);
  const flatView = showCompleted;

  // A list only sees the tasks it shows, but a reorder must name the whole tab. Finished one-time tasks
  // already trail, so they're appended; the rest keep their place — pruned ones are back tomorrow, and
  // with Status on, each band's list leaves the other bands' tasks where they were.
  const sortedTasks = useMemo(() => [...topTasks].sort(byOrder), [topTasks]);
  const listedIds = useMemo(() => new Set(listedTasks.map((t) => t.id)), [listedTasks]);
  const isListed = (t: Task) => listedIds.has(t.id);
  function fullOrder(listedOrder: string[], inList: (t: Task) => boolean, moved: string[]): string[] {
    const kept = sortedTasks.filter((t) => inList(t) || !isRetired(t));
    const trailing = sortedTasks.filter((t) => !inList(t) && isRetired(t)).map((t) => t.id);
    return [...withUnlistedKept(kept, listedOrder, inList, moved), ...trailing];
  }
  const reorderTab = (orderedIds: string[], moved: string[], inList = isListed) =>
    onReorderItems(fullOrder(orderedIds, inList, moved));
  const ejectFromTabGroup = (taskId: string, groupId: string, newOrder: string[], inList = isListed) =>
    onEjectFromGroup(taskId, groupId, fullOrder(newOrder, inList, [taskId]));
  // A pruned task hidden inside the span a new group covers joins it (it's back tomorrow, inside the
  // run). Another band's task there doesn't: it isn't part of what was grouped, and the group is
  // gathered around it (the server's fold rule, mirrored in App).
  const addTabGroup = (ids: string[]) =>
    onAddGroup(runBetween(sortedTasks, ids).filter((id) => ids.includes(id) || !listedIds.has(id)));
  function extendTabGroup(groupId: string, ids: string[]) {
    const members = sortedTasks.filter((t) => t.groupId === groupId).map((t) => t.id);
    const run = runBetween(sortedTasks, [...members, ...ids]);
    // Only when the new rows already sit beside the group (a range-drag) do hidden tasks between them
    // join too; a row dragged in from afar is moved beside the group by the reorder that follows.
    const adjacent = run.every((id) => !listedIds.has(id) || members.includes(id) || ids.includes(id));
    onExtendGroup(groupId, adjacent ? run.filter((id) => !members.includes(id)) : ids);
  }

  // The tab's sort over its tasks in their own order (so Manual, and ties, keep it).
  const displayedTasks = useMemo(() => sortItems([...listedTasks].sort(byOrder), sort, sortContext), [listedTasks, sort, sortContext]);

  const displayedStreaks = useMemo(
    () => sortItems(streaks, STREAKS_OFFER.sorts.find((o) => o.key === sortMode), undefined),
    [streaks, sortMode],
  );

  // Which Status band is under a screen point (bands carry data-band; compared by rect, since the row
  // being dragged sits on top of whatever is under the pointer).
  function bandAt(at: MenuPoint): TaskStatus | null {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-band-tab="${section.id}"]`)) {
      const r = el.getBoundingClientRect();
      if (at.x >= r.left && at.x <= r.right && at.y >= r.top && at.y <= r.bottom) {
        return STATUS_BANDS.find((b) => b.status === el.dataset.band)?.status ?? null;
      }
    }
    return null;
  }
  // A row dragged out of its band and let go on another moves there — Blocked asks why first.
  const dropFrom = (from: Band): DropOutside => ({
    label: (at) => {
      const to = bandAt(at);
      return to && to !== from ? `Move to ${statusLabel(to)}` : null;
    },
    drop: (itemId, at) => {
      const to = bandAt(at);
      const task = tasks.find((t) => t.id === itemId);
      if (!to || to === from || !task) return;
      if (to === "blocked") setBlockingId(itemId);
      else onSetStatus(task, to);
    },
  });

  // A task's pieces, and what it can do with them — on a task that can be broken down.
  const piecesFor = (task: Task): RowPieces | undefined =>
    canBreakDown(task)
      ? {
          items: piecesOf.get(task.id) ?? [],
          open: !collapsed.has(task.id),
          onToggle: () => toggleCollapsed(task.id),
          render: renderTask,
          onReorder: (ids) => onReorderPieces(task.id, ids),
          onBreakDown: (texts) => onBreakDown(task, texts),
          onTuck: (taskId) => onSetParent(taskId, task.id),
          allTasks,
          modifiersOf: (piece) => modsOf(piece),
        }
      : undefined;

  // A frozen row's way out: thawing its task (a piece's is the task it sits in), saying what that gains — and the
  // thaw bonus it would pay, if it has frost.
  const frozenRow = (task: Task) => {
    const whole = (task.parentId && tasks.find((t) => t.id === task.parentId)) || task;
    const bonus = frostShare(whole, boardSettings) > 0 ? boardSettings.freezer.thawBonus : 0;
    return { onThaw: () => onSetFrozen(whole, false), gains: thawGains(whole), ...(bonus > 0 && extraShown("thaw-bonus") ? { thawBonus: bonus } : {}) };
  };

  // A task's row — a piece's too (under its task, whose tick handler it's given so the task sees the tick
  // that finishes it).
  const renderTask = (task: Task, row: RowContext, setLevel = onSetLevel) => (
    <TaskItem
      key={task.id}
      task={task}
      color={ink}
      scheduleCadence={scheduleCadence}
      showEstimate={showEstimate}
      showTimer={showTimer}
      row={row}
      pointsHidden={flyingTaskIds.has(task.id)}
      onSetLevel={setLevel}
      pieces={piecesFor(task)}
      modifiers={modsOf(task)}
      lines={lines}
      reroll={rerollOf(task)}
      onIce={isFreezer ? frozenRow(task) : undefined}
      freeze={freezer ? { onFreeze: () => onSetFrozen(task, true), refusal: freezeRefusal(task) } : undefined}
      showAge={showAge && !task.parentId}
      onMakeOwn={task.parentId ? () => onSetParent(task.id, null) : undefined}
      onRemove={onRemoveTask}
      onEdit={(patch) => onEditTask(task.id, patch)}
      onDuplicate={() => onDuplicateTask(task.id)}
      prune={
        section.period && canPrune(task, section)
          ? {
              until: pruneUntil(section.period),
              breaks: streaksBrokenByPruning(task, section.period, allStreaks).map((s) => s.name),
            }
          : undefined
      }
      onSetPruned={(pruned) => onSetPruned(task, pruned)}
      // Nothing on ice is waiting to be picked, so the Freezer shows no priority (a task keeps its own).
      priority={canPrioritise(task) && !isFreezer ? { onSet: (priority) => onEditTask(task.id, { priority }) } : undefined}
      status={
        showStatus
          ? {
              onSet: (next, why) => onSetStatus(task, next, why),
              blocking: blockingId === task.id,
              onBlockingChange: (open) => setBlockingId(open ? task.id : null),
              allTasks,
            }
          : undefined
      }
    />
  );

  // One list of the tab's tasks — the whole tab, or (with Status on) one band of it. `inList` is which of
  // the tab's tasks it shows, so its reorders keep everything else in place.
  // This week's Bounty, if it's among them, sits pinned above the rest in a list of its own — not moved in
  // the tab's order, so it's back in its place once the Bounty ends (and isn't dragged meanwhile).
  // Where the list is one a sort may `split`, a sort with parts (by priority) shows each part as a list of its
  // own under its header, in the tab's own order — so a row drags within its part, and never out of it into
  // another.
  const taskList = (
    items: Task[],
    sorted: Task[],
    {
      inList = isListed,
      emptyLabel,
      dropOutside,
      split = false,
    }: { inList?: (t: Task) => boolean; emptyLabel?: string; dropOutside?: DropOutside; split?: boolean } = {},
  ) => {
    const pinned = items.find((t) => t.id === bountyId);
    const rest = pinned ? items.filter((t) => t !== pinned) : items;
    const inRest = pinned ? (t: Task) => inList(t) && t.id !== pinned.id : inList;
    const parts = split && sort?.parts ? sort.parts(sortContext)([...rest].sort(byOrder)).filter((part) => part.items.length > 0) : [];
    return (
      <>
        {pinned && itemList([pinned], [pinned], { inList: (t) => t === pinned, emptyLabel, pinned: true })}
        {parts.length > 0
          ? parts.map((part) => {
              const ids = new Set(part.items.map((t) => t.id));
              return (
                <Fragment key={part.key}>
                  {part.label && <ListPartHead label={part.label} count={part.items.length} color={part.color} />}
                  {itemList(part.items, part.items, { inList: (t) => inRest(t) && ids.has(t.id), dropOutside })}
                </Fragment>
              );
            })
          : (rest.length > 0 || !pinned) &&
            itemList(rest, pinned ? sorted.filter((t) => t !== pinned) : sorted, { inList: inRest, emptyLabel, dropOutside })}
      </>
    );
  };
  const itemList = (
    items: Task[],
    sorted: Task[],
    { inList, emptyLabel, dropOutside, pinned = false }: { inList: (t: Task) => boolean; emptyLabel?: string; dropOutside?: DropOutside; pinned?: boolean },
  ) => (
    <ItemList
      items={items}
      // The Completed view is a flat look-back (those tasks sit ungrouped at the end), so it doesn't reorder
      // or group — that happens in the normal view. Nor does a pinned Bounty.
      manual={ownOrder && !flatView && !pinned}
      sorted={sorted}
      groups={groups}
      noun="tasks"
      emptyLabel={emptyLabel}
      renderItem={renderTask}
      onReorder={(ids, moved) => reorderTab(ids, moved, inList)}
      onAddGroup={addTabGroup}
      onExtendGroup={extendTabGroup}
      onEjectFromGroup={(taskId, groupId, order) => ejectFromTabGroup(taskId, groupId, order, inList)}
      onEditGroup={onEditGroup}
      onRemoveGroup={onRemoveGroup}
      dropOutside={dropOutside}
      grouping={grouping}
    />
  );

  // The tab's pruned tasks while its Display shows them: dimmed, under the list, a look-back in their own order
  // — no drag or grouping here (they're back in their places when their day or week ends), Unprune from a row.
  const prunedList = () => (
    <ItemList
      items={prunedTasks}
      manual={false}
      sorted={prunedTasks}
      groups={groups}
      noun="tasks"
      renderItem={renderTask}
      onReorder={() => {}}
      onAddGroup={() => {}}
      onExtendGroup={() => {}}
      onEjectFromGroup={() => {}}
      onEditGroup={onEditGroup}
      onRemoveGroup={onRemoveGroup}
      grouping={false}
    />
  );

  // Status on: the tab as bands — each the same list over its own tasks (sorted, reordered and grouped
  // like the whole tab; a group whose tasks sit in two bands shows in both), all on one grid so the [%]
  // column lines up across them. Status never moves a task in the tab's order, so a task goes back to
  // its old place in the Backlog.
  function statusBands() {
    const inBand = (band: Band) => (t: Task) => isListed(t) && bandOf(t) === band;
    const bandList = (band: Band, emptyLabel?: string) =>
      taskList(
        listedTasks.filter((t) => bandOf(t) === band),
        displayedTasks.filter((t) => bandOf(t) === band),
        { inList: inBand(band), emptyLabel, dropOutside: band === "done" ? undefined : dropFrom(band), split: band !== "done" && bandSplits(band) },
      );
    const count = (band: Band) => listedTasks.filter((t) => bandOf(t) === band).length;
    const inProgress = count("in-progress");
    return (
      <div className="status-bands" style={{ "--tab-color": ink } as React.CSSProperties}>
        <StatusBand
          tabId={section.id}
          band="in-progress"
          label={statusLabel("in-progress")}
          count={inProgress}
          hint={inProgress > IN_PROGRESS_NUDGE_ABOVE ? `${inProgress} in progress. Finish or park one?` : undefined}
        >
          {bandList("in-progress")}
        </StatusBand>
        <StatusBand tabId={section.id} band="backlog" label={statusLabel("backlog")} count={count("backlog")}>
          {bandList("backlog")}
        </StatusBand>
        {count("blocked") > 0 && (
          <StatusBand
            tabId={section.id}
            band="blocked"
            label={statusLabel("blocked")}
            count={count("blocked")}
            fold={{ open: blockedOpen, onToggle: () => setBlockedOpen((open) => !open) }}
          >
            {bandList("blocked")}
          </StatusBand>
        )}
        {count("done") > 0 && (
          <StatusBand tabId={section.id} band="done" label="Completed" count={count("done")}>
            {bandList("done")}
          </StatusBand>
        )}
      </div>
    );
  }

  // How many tasks the tab lists, under its title (finished one-time tasks aren't among them, shown or not).
  const taskCount = showCount ? <TaskCount tasks={listedTasks.filter((t) => !isRetired(t))} /> : null;

  return (
    <CanvasCard
      frame={frame}
      className={isFreezer ? "freezer-card" : undefined}
      title={
        <CardTitle name={section.name} color={ink} popoverTitle="Color" popoverWidth={172}>
          <ColorPicker value={section.color} onChange={(color) => onRecolor(section.id, color)} />
        </CardTitle>
      }
      actions={
        <>
          <SortMenu options={offered.sorts} view={view} />
          <DisplayMenu options={offered.displays} view={view} />
        </>
      }
      footer={
        // Nothing is added to a Freezer: tasks freeze into it.
        isFreezer ? undefined : (
        <CardAdd label={isStreaks ? "Add streak" : "Add task"} shown={showAddButton}>
          {(open, close) =>
            isStreaks ? (
              <Popover title="Add streak" open={open} onClose={close} align="left" width={300} scrollable>
                <StreakForm
                  allTasks={allTasks}
                  allSections={allSections}
                  accentColor={ink}
                  submitLabel="Add streak"
                  onSubmit={(payload) => {
                    onAddStreak(payload);
                    close();
                  }}
                  onCancel={close}
                />
              </Popover>
            ) : (
              <AddTaskPopover
                section={section}
                open={open}
                onClose={close}
                onCreate={(payload) => {
                  onAddTask(payload);
                  close();
                }}
              />
            )
          }
        </CardAdd>
        )
      }
    >
      {isStreaks ? (
        <ItemList
          items={streaks}
          manual={sortMode === "manual"}
          sorted={displayedStreaks}
          groups={groups}
          noun="streaks"
          emptyLabel="No streaks yet"
          renderItem={(streak, row) => (
            <StreakItem
              key={streak.id}
              streak={streak}
              allTasks={allTasks}
              allSections={allSections}
              sectionColor={ink}
              row={row}
              onEdit={(payload) => onEditStreak(streak.id, payload)}
              onRemove={onRemoveStreak}
            />
          )}
          grouping={grouping}
          onReorder={onReorderStreakItems}
          onAddGroup={onAddStreakGroup}
          onExtendGroup={onExtendStreakGroup}
          onEjectFromGroup={onEjectStreakFromGroup}
          onEditGroup={onEditGroup}
          onRemoveGroup={onRemoveGroup}
        />
      ) : showStatus ? (
        <>
          {taskCount}
          {statusBands()}
        </>
      ) : (
        <>
          {taskCount}
          <div className="list-stack">
            {taskList(listedTasks, displayedTasks, { emptyLabel: isFreezer ? "Nothing on ice" : "Nothing here yet", split: true })}
            {prunedTasks.length > 0 && prunedList()}
          </div>
        </>
      )}
    </CanvasCard>
  );
}

interface AddTaskPopoverProps {
  section: Section;
  open: boolean;
  onClose: () => void;
  onCreate: (payload: TaskCreatePayload) => void;
}

const EMPTY_EST: BuilderEstimate = { minutes: null, effort: DEFAULT_EFFORT_ID, source: "manual" };

const TYPE_LABELS: Record<TaskType, string> = { checkbox: "Checkbox", tiered: "Tiered", repeatable: "Repeatable", once: "One-time" };

function AddTaskPopover({ section, open, onClose, onCreate }: AddTaskPopoverProps) {
  const [type, setType] = useState<TaskType>(section.allowedTypes[0].type);
  const [text, setText] = useState("");
  const [description, setDescription] = useState("");
  const [points, setPoints] = useState("");
  // Builder report for a checkbox task (minutes/effort/source); minutes null ≡ no duration picked.
  const [checkboxEst, setCheckboxEst] = useState<BuilderEstimate>(EMPTY_EST);
  const [tierRows, setTierRows] = useState<TierRow[]>([{ id: uid(), points: "", est: EMPTY_EST }]);
  // Bumped on reset to remount PointsBuilder and clear its local duration/effort selections.
  const [builderKey, setBuilderKey] = useState(0);
  // A checkbox task can carry an optional box count (each box worth `points`, scored per box).
  // Defaults to 1 — a plain checkbox; bump it for a "do it N times" task.
  const [amount, setAmount] = useState("1");
  const boxCount = Math.max(1, Number(amount) || 1);
  // A repeatable task can carry an optional completion cap (stored as `count`). Blank ≡ unlimited.
  const [maxTimes, setMaxTimes] = useState("");
  // Optional per-box scheduled times (see Task.schedule) — the "do this at a certain hour" gate. The
  // cadence (daily/weekly) is inferred from the section's recurrence, not chosen here.
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);
  const scheduleCadence: Cadence = section.period === "week" ? "weekly" : "daily";
  // How much it matters, for a type that takes a priority — Low unless another is picked.
  const [priority, setPriority] = useState<TaskPriority>(DEFAULT_PRIORITY);
  const takesPriority = behaviorOfType(type).takesPriority;
  // Checkbox, repeatable and one-time tasks score a single per-completion `points`, so they use the
  // duration→points calc; tiered doesn't (each tier has its own builder).
  const usesPointsCalc = type === "checkbox" || type === "repeatable" || type === "once";

  function reset() {
    setType(section.allowedTypes[0].type);
    setText("");
    setDescription("");
    setPoints("");
    setCheckboxEst(EMPTY_EST);
    setTierRows([{ id: uid(), points: "", est: EMPTY_EST }]);
    setBuilderKey((k) => k + 1);
    setAmount("1");
    setMaxTimes("");
    setScheduleRows([]);
    setPriority(DEFAULT_PRIORITY);
  }

  // Stable (no deps) so each row's PointsBuilder gets stable callbacks — its effects depend on them.
  const setTierPoints = useCallback((id: string, points: string) => {
    setTierRows((prev) => prev.map((row) => (row.id === id ? { ...row, points } : row)));
  }, []);
  const setTierEstimate = useCallback((id: string, est: BuilderEstimate) => {
    setTierRows((prev) => prev.map((row) => (row.id === id ? { ...row, est } : row)));
  }, []);

  function addTierRow() {
    setTierRows((prev) => [...prev, { id: uid(), points: "", est: EMPTY_EST }]);
  }

  function removeTierRow(id: string) {
    setTierRows((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== id) : prev));
  }

  // The fields carry their own rules (`required`, `min`, `type=number`) and Form says what's wrong with one in
  // the app's bubble, so this only ever runs once every field is valid. The parse guards below are a
  // belt-and-braces fallback — they should never fire past that, and the server re-validates regardless.
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    // Description is optional — omit it entirely when blank so a task stays description-free.
    const withDesc = description.trim() ? { description: description.trim() } : {};
    const withPriority = takesPriority ? { priority } : {};

    if (type === "tiered") {
      const tiers: TierDef[] = [];
      for (let i = 0; i < tierRows.length; i++) {
        const value = parsePercent(tierRows[i].points);
        if (value === null) return;
        // Carry the tier's estimate only when a duration was picked (feeds the tier timer + rebalance);
        // pointsSource records whether that % came from the builder or was overridden.
        const est = tierRows[i].est;
        const estFields = est.minutes != null ? { minutes: est.minutes, effort: est.effort } : {};
        tiers.push({ label: `Tier ${i + 1}`, points: value, ...estFields, pointsSource: est.source });
      }
      onCreate({ type: "tiered", text: trimmed, tiers, ...withPriority, ...withDesc });
    } else {
      const pointsValue = parsePercent(points);
      if (pointsValue === null) return;
      // Store the estimate only when a duration was actually picked; always record whether the % came
      // from the builder (pointsSource) so a later rate/effort change knows what it may rebalance.
      const withEstimate =
        checkboxEst.minutes != null
          ? { estimateMinutes: checkboxEst.minutes, estimateEffort: checkboxEst.effort }
          : {};
      if (type === "repeatable") {
        // A repeatable task is a single tally box — no box count, no per-box schedule. An optional
        // completion cap rides in `count` (blank ≡ unlimited).
        const max = Number(maxTimes);
        const withMax = maxTimes.trim() && Number.isInteger(max) && max >= 1 ? { count: max } : {};
        onCreate({ type: "repeatable", text: trimmed, points: pointsValue, ...withMax, ...withEstimate, pointsSource: checkboxEst.source, ...withPriority, ...withDesc });
      } else if (type === "once") {
        // A one-time task is a single checkbox with no box count and no scheduled times — check it and
        // it's gone, so neither knob applies.
        onCreate({ type: "once", text: trimmed, points: pointsValue, ...withEstimate, pointsSource: checkboxEst.source, ...withPriority, ...withDesc });
      } else {
        // A count of 1 is a plain checkbox — omit it so the task stays a bare checkbox rather than
        // storing a redundant 1-box amount.
        const count = Number(amount);
        const withCount = Number.isInteger(count) && count > 1 ? { count } : {};
        // Include the schedule only if at least one box is actually scheduled (else stay a plain task).
        const schedule = scheduleFromRows(scheduleRows, scheduleCadence, boxCount);
        const withSchedule = schedule.some(Boolean) ? { schedule } : {};
        onCreate({ type: "checkbox", text: trimmed, points: pointsValue, ...withCount, ...withSchedule, ...withEstimate, pointsSource: checkboxEst.source, ...withPriority, ...withDesc });
      }
    }
    reset();
  }

  return (
    <Popover
      title="Add task"
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      align="left"
      width={POINTS_FORM_WIDTH}
      scrollable
    >
      <Form className="popover-form" onSubmit={handleSubmit}>
        {section.allowedTypes.length > 1 && (
          <div className="field">
            <span className="field-label">Type</span>
            <div className="calc-pills">
              {section.allowedTypes.map((a) => (
                <button
                  key={a.type}
                  type="button"
                  className={`calc-pill${type === a.type ? " active" : ""}`}
                  onClick={() => setType(a.type)}
                >
                  {TYPE_LABELS[a.type]}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="field">
          <span className="field-label">Name</span>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            autoFocus
            required
            data-missing="Give it a name"
          />
        </label>

        {usesPointsCalc && (
          <PointsBuilder key={builderKey} points={points} onPointsChange={setPoints} onBuilderChange={setCheckboxEst} />
        )}

        {type === "tiered" && (
          <div className="field">
            <span className="field-label">Tiers</span>
            <div className="tier-rows">
              {tierRows.map((row, i) => (
                <TierBuilderRow
                  key={row.id}
                  row={row}
                  index={i}
                  canRemove={tierRows.length > 1}
                  onPointsChange={setTierPoints}
                  onEstimateChange={setTierEstimate}
                  onRemove={removeTierRow}
                />
              ))}
            </div>
            <button type="button" className="ghost-btn form-add-btn" onClick={addTierRow}>
              + Add tier
            </button>
          </div>
        )}

        {type === "checkbox" && (
          <label className="field">
            <span className="field-label">Amount (boxes)</span>
            <input
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              data-missing="How many boxes?"
            />
          </label>
        )}

        {type === "checkbox" && (
          <ScheduleEditor count={boxCount} cadence={scheduleCadence} rows={scheduleRows} onChange={setScheduleRows} />
        )}

        {type === "repeatable" && (
          <label className="field">
            <span className="field-label">Max completions (optional)</span>
            <input
              type="number"
              min="1"
              step="1"
              placeholder="Unlimited"
              value={maxTimes}
              onChange={(e) => setMaxTimes(e.target.value)}
            />
          </label>
        )}

        {takesPriority && <PriorityField value={priority} onChange={setPriority} />}

        {/* Keyed like the builder, to fold again once a task is added — under its own name, both being this form's children. */}
        <DescriptionField key={`description-${builderKey}`} value={description} onChange={setDescription} />

        <div className="popover-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit">Add task</button>
        </div>
      </Form>
    </Popover>
  );
}

export default SectionCard;
