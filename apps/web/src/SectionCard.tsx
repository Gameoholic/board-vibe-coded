import { behaviorOf, parsePercent } from "@board/contracts";
import { AnimatePresence, Reorder } from "framer-motion";
import { useCallback, useMemo, useState } from "react";
import CanvasCard, { CardAdd, CardTitle, type CardFrame } from "./CanvasCard";
import ColorPicker from "./ColorPicker";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleCheckIcon,
  CircleIcon,
  HourglassIcon,
  SparkleIcon,
  TimerIcon,
  ZapIcon,
} from "./Icons";
import ItemList from "./ItemList";
import PointsBuilder, { type BuilderEstimate } from "./PointsBuilder";
import Popover from "./Popover";
import ScheduleEditor, { scheduleFromRows, type Cadence, type ScheduleRow } from "./ScheduleEditor";
import StreakForm, { type StreakPayload } from "./StreakForm";
import StreakItem from "./StreakItem";
import { DisplayMenu, SortMenu, tabView, type DisplayOption, type SortOption } from "./TabControls";
import TaskItem from "./TaskItem";
import type { FlyOrigin } from "./FlyingPoints";
import { useBoardClock } from "./useBoardClock";
import type { TabPrefs } from "./useLocalConfig";
import { isBoxLocked } from "./types";
import { uid } from "./uid";
import type { Group, Section, Settings, StreakView, Task, TaskSchedule, TaskType, TierDef } from "./types";

// A board tab: the shared tab base (CanvasCard — move/resize, header, sort/display controls, add
// button) around a board list. A "tasks" tab lists tasks on the shared list base (ItemList — reorder
// and grouping); a "streaks" tab lists streaks. What's specific here is only what's specific to tasks:
// their sorts and display toggles, the task row, and the add-task form.

// The create/edit task payload, in one alias so the schedule field threads through every call site.
type PointsSource = "builder" | "manual";
type TaskCreatePayload = { type: TaskType; text: string; points?: number; estimate?: string; estimateMinutes?: number; estimateEffortIndex?: number; pointsSource?: PointsSource; description?: string; tiers?: TierDef[]; count?: number; schedule?: TaskSchedule };
type TaskEditPayload = { text?: string; points?: number; estimateMinutes?: number | null; estimateEffortIndex?: number | null; pointsSource?: PointsSource; description?: string | null; tiers?: Task["tiers"]; count?: number; schedule?: TaskSchedule };

type SortMode = "manual" | "quick" | "points-desc" | "points-asc" | "status-incomplete" | "status-complete" | "time-asc" | "time-desc" | "added-newest" | "added-oldest";
type StreakSortMode = "manual" | "count-desc" | "count-asc";
type AnySortMode = SortMode | StreakSortMode;

const SORT_OPTIONS: SortOption[] = [
  { mode: "manual", label: "Recommended", icon: SparkleIcon },
  { mode: "quick", label: "Get done quick", icon: ZapIcon },
  { mode: "points-desc", label: "Points: high to low", icon: ArrowDownIcon },
  { mode: "points-asc", label: "Points: low to high", icon: ArrowUpIcon },
  { mode: "status-incomplete", label: "Incomplete first", icon: CircleIcon },
  { mode: "status-complete", label: "Completed first", icon: CircleCheckIcon },
  { mode: "time-asc", label: "Time: short to long", icon: TimerIcon },
  { mode: "time-desc", label: "Time: long to short", icon: TimerIcon },
  { mode: "added-newest", label: "Date added: newest", icon: ArrowDownIcon },
  { mode: "added-oldest", label: "Date added: oldest", icon: ArrowUpIcon },
];

const STREAK_SORT_OPTIONS: SortOption[] = [
  { mode: "manual", label: "Recommended", icon: SparkleIcon },
  { mode: "count-desc", label: "Streak: high to low", icon: ArrowDownIcon },
  { mode: "count-asc", label: "Streak: low to high", icon: ArrowUpIcon },
];

// A task tab's optional row extras (the Display menu). Keys are what TabPrefs.display stores.
const TASK_DISPLAY: DisplayOption[] = [
  { key: "estimate", label: "Time estimate", icon: HourglassIcon },
  { key: "timer", label: "Timer", icon: TimerIcon },
];

// Sort by a task's ceiling (its highest reachable value) and completion — both read from the type's
// behaviour so no sort logic branches on task.type.
const maxValue = (task: Task): number => behaviorOf(task).maxValue(task);
const isTaskDone = (task: Task): boolean => behaviorOf(task).isDone(task);
// A checkbox task's estimated minutes (tiered tasks store their estimate per-tier, not at task level).
const estMinutes = (task: Task): number | undefined => task.estimateMinutes;
// Whether the box you'd act on next is currently schedule-locked (its time-of-day / weekday hasn't
// come). Used by the "Get done quick" sort to sink not-yet-doable tasks — you can't knock them out now.
const taskLocked = (task: Task, now: string, settings: Settings): boolean => {
  const entry = task.schedule?.[behaviorOf(task).filled(task)];
  return !!entry && isBoxLocked(entry, now, settings);
};

interface SectionCardProps {
  section: Section;
  tasks: Task[];
  groups: Group[];
  streaks: StreakView[];
  allTasks: Task[];
  flyingTaskIds: Set<string>;
  frame: CardFrame; // placement on the board canvas (from CardCanvas)
  onAddTask: (payload: TaskCreatePayload) => void;
  onSetLevel: (task: Task, level: number, origin?: FlyOrigin) => void;
  onRemoveTask: (id: string) => void;
  onEditTask: (id: string, patch: TaskEditPayload) => void;
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
  onReorderStreaks: (ordered: StreakView[]) => void;
  onRecolor: (id: string, color: string) => void;
  // Per-tab view prefs (sort + display toggles), persisted per device in localStorage. Undefined
  // until the tab is first touched, then filled from the defaults on read (see tabView).
  prefs: TabPrefs | undefined;
  onPrefsChange: (patch: Partial<TabPrefs>) => void;
  // Sort modes pinned to the top of the Sort menu (global, from useLocalConfig), and a toggle.
  pinnedSorts: string[];
  onTogglePin: (mode: string) => void;
}

function SectionCard({
  section,
  tasks,
  groups,
  streaks,
  allTasks,
  flyingTaskIds,
  frame,
  onAddTask,
  onSetLevel,
  onRemoveTask,
  onEditTask,
  onReorderItems,
  onAddGroup,
  onExtendGroup,
  onEjectFromGroup,
  onEditGroup,
  onRemoveGroup,
  onAddStreak,
  onEditStreak,
  onRemoveStreak,
  onReorderStreaks,
  onRecolor,
  prefs,
  onPrefsChange,
  pinnedSorts,
  onTogglePin,
}: SectionCardProps) {
  const isStreaks = section.kind === "streaks";
  // Scheduled-box cadence inferred from the tab's recurrence: a "week" section schedules by weekday,
  // everything else by time-of-day. This is what makes daily/weekly automatic (not a per-task option).
  const scheduleCadence: Cadence = section.period === "week" ? "weekly" : "daily";
  // Sort + display toggles come from the persisted per-tab prefs (see useLocalConfig). They're a
  // pure display transform, not board truth, so they live per device — but survive reloads.
  const view = tabView(prefs, onPrefsChange, isStreaks ? [] : TASK_DISPLAY);
  const sortMode = view.sortMode as AnySortMode;
  const showEstimate = view.shown("estimate");
  const showTimer = view.shown("timer");

  // Board clock (ticks ~1/min) — only read to lock-aware-sort "Get done quick"; a tick re-renders the
  // card, which is cheap and lets a task slide up the moment it unlocks.
  const { now, settings: boardSettings } = useBoardClock();

  const displayedTasks = useMemo(() => {
    // "Get done quick": shortest doable tasks first so you can knock them out. Ranked in bands —
    // 0 doable+timed (sorted by time asc), 1 schedule-locked (not yet unlockable — sunk to just above
    // the untimed), 2 no time assigned, 3 completed (very bottom). Within a band, shorter time first.
    if (sortMode === "quick") {
      const rank = (t: Task) =>
        isTaskDone(t) ? 3 : taskLocked(t, now, boardSettings) ? 1 : estMinutes(t) == null ? 2 : 0;
      return [...tasks].sort(
        (a, b) => rank(a) - rank(b) || (estMinutes(a) ?? Infinity) - (estMinutes(b) ?? Infinity),
      );
    }
    if (sortMode === "points-desc") return [...tasks].sort((a, b) => maxValue(b) - maxValue(a));
    if (sortMode === "points-asc") return [...tasks].sort((a, b) => maxValue(a) - maxValue(b));
    if (sortMode === "status-incomplete")
      return [...tasks].sort((a, b) => Number(isTaskDone(a)) - Number(isTaskDone(b)));
    if (sortMode === "status-complete")
      return [...tasks].sort((a, b) => Number(isTaskDone(b)) - Number(isTaskDone(a)));
    // Time sorts: tasks without an estimate sink to the bottom either way.
    if (sortMode === "time-asc")
      return [...tasks].sort((a, b) => (estMinutes(a) ?? Infinity) - (estMinutes(b) ?? Infinity));
    if (sortMode === "time-desc")
      return [...tasks].sort((a, b) => (estMinutes(b) ?? -1) - (estMinutes(a) ?? -1));
    // Date added: createdAt is an ISO string, so lexicographic compare is chronological.
    if (sortMode === "added-newest")
      return [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (sortMode === "added-oldest")
      return [...tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return tasks;
  }, [tasks, sortMode, now, boardSettings]);

  const displayedStreaks = useMemo(() => {
    if (sortMode === "count-desc") return [...streaks].sort((a, b) => b.count - a.count);
    if (sortMode === "count-asc") return [...streaks].sort((a, b) => a.count - b.count);
    return streaks;
  }, [streaks, sortMode]);

  return (
    <CanvasCard
      frame={frame}
      title={
        <CardTitle name={section.name} color={section.color} popoverTitle="Color" popoverWidth={172}>
          <ColorPicker value={section.color} onChange={(color) => onRecolor(section.id, color)} />
        </CardTitle>
      }
      actions={
        <>
          {/* Streak tabs only have three sorts — no need to condense, so they show them all. Task tabs
              pin a top set (plus the active sort) and tuck the rest under "Show more". */}
          <SortMenu
            options={isStreaks ? STREAK_SORT_OPTIONS : SORT_OPTIONS}
            mode={sortMode}
            onSelect={view.setSortMode}
            pinned={isStreaks ? undefined : { modes: pinnedSorts, onToggle: onTogglePin }}
          />
          {!isStreaks && <DisplayMenu options={TASK_DISPLAY} shown={view.shown} onToggle={view.setShown} />}
        </>
      }
      footer={
        <CardAdd label={isStreaks ? "Add streak" : "Add task"}>
          {(open, close) =>
            isStreaks ? (
              <Popover title="Add streak" open={open} onClose={close} align="left" width={300} scrollable>
                <StreakForm
                  allTasks={allTasks}
                  accentColor={section.color}
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
      }
    >
      {isStreaks ? (
        <Reorder.Group
          as="ul"
          axis="y"
          values={displayedStreaks}
          onReorder={onReorderStreaks}
          className="streak-list"
        >
          <AnimatePresence initial={false}>
            {streaks.length === 0 && <li className="empty">No streaks yet</li>}
            {displayedStreaks.map((streak) => (
              <StreakItem
                key={streak.id}
                streak={streak}
                allTasks={allTasks}
                sectionColor={section.color}
                draggable={sortMode === "manual"}
                onEdit={(payload) => onEditStreak(streak.id, payload)}
                onRemove={onRemoveStreak}
              />
            ))}
          </AnimatePresence>
        </Reorder.Group>
      ) : (
        <ItemList
          items={tasks}
          manual={sortMode === "manual"}
          sorted={displayedTasks}
          groups={groups}
          noun="tasks"
          emptyLabel="Nothing here yet"
          renderItem={(task, row) => (
            <TaskItem
              key={task.id}
              task={task}
              color={section.color}
              scheduleCadence={scheduleCadence}
              showEstimate={showEstimate}
              showTimer={showTimer}
              row={row}
              pointsHidden={flyingTaskIds.has(task.id)}
              onSetLevel={onSetLevel}
              onRemove={onRemoveTask}
              onEdit={(patch) => onEditTask(task.id, patch)}
            />
          )}
          onReorder={onReorderItems}
          onAddGroup={onAddGroup}
          onExtendGroup={onExtendGroup}
          onEjectFromGroup={onEjectFromGroup}
          onEditGroup={onEditGroup}
          onRemoveGroup={onRemoveGroup}
        />
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

// Each tier row carries a stable id so its PointsBuilder's callbacks (effect deps there) can be stable
// per-row, and so remove/reorder keys don't shift the wrong builder. `est` is the tier's builder
// report (minutes/effortIndex/source); minutes null ≡ none picked → no estimate stored.
interface TierRow {
  id: string;
  points: string;
  est: BuilderEstimate;
}

const EMPTY_EST: BuilderEstimate = { minutes: null, effortIndex: 0, source: "manual" };

const TYPE_LABELS: Record<TaskType, string> = { checkbox: "Checkbox", tiered: "Tiered", repeatable: "Repeatable" };

// One tier's builder: the same PointsBuilder (Points% + Duration + Effort) the checkbox form uses,
// plus a remove control. Its own component so onPointsChange is a stable per-row callback (the
// builder treats it as an effect dependency) and its internal duration/effort state stays isolated.
interface TierBuilderRowProps {
  row: TierRow;
  index: number;
  canRemove: boolean;
  onPointsChange: (id: string, points: string) => void;
  onEstimateChange: (id: string, est: BuilderEstimate) => void;
  onRemove: (id: string) => void;
}

function TierBuilderRow({ row, index, canRemove, onPointsChange, onEstimateChange, onRemove }: TierBuilderRowProps) {
  const handlePoints = useCallback((v: string) => onPointsChange(row.id, v), [row.id, onPointsChange]);
  const handleBuilder = useCallback((est: BuilderEstimate) => onEstimateChange(row.id, est), [row.id, onEstimateChange]);
  return (
    <div className="tier-builder-row">
      <div className="tier-builder-head">
        <span className="tier-row-label">Tier {index + 1}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Remove tier"
          onClick={() => onRemove(row.id)}
          disabled={!canRemove}
        >
          ✕
        </button>
      </div>
      <PointsBuilder points={row.points} onPointsChange={handlePoints} onBuilderChange={handleBuilder} />
    </div>
  );
}

function AddTaskPopover({ section, open, onClose, onCreate }: AddTaskPopoverProps) {
  const [type, setType] = useState<TaskType>(section.allowedTypes[0].type);
  const [text, setText] = useState("");
  const [description, setDescription] = useState("");
  const [points, setPoints] = useState("");
  // Builder report for a checkbox task (minutes/effortIndex/source); minutes null ≡ no duration picked.
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
  // Checkbox and repeatable score a single per-completion `points`, so they use the duration→points
  // calc; tiered doesn't (each tier has its own builder).
  const usesPointsCalc = type === "checkbox" || type === "repeatable";

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

  // Validation is the browser's job now: `required`/`min`/`type=number` on the inputs raise the
  // native constraint bubble (the same component the user sees for step/range), so the form's submit
  // handler only ever runs once every field is valid. The parse guards below are a belt-and-braces
  // fallback — they should never fire past native validation, and the server re-validates regardless.
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    // Description is optional — omit it entirely when blank so a task stays description-free.
    const withDesc = description.trim() ? { description: description.trim() } : {};

    if (type === "tiered") {
      const tiers: TierDef[] = [];
      for (let i = 0; i < tierRows.length; i++) {
        const value = parsePercent(tierRows[i].points);
        if (value === null) return;
        // Carry the tier's estimate only when a duration was picked (feeds the tier timer + rebalance);
        // pointsSource records whether that % came from the builder or was overridden.
        const est = tierRows[i].est;
        const estFields = est.minutes != null ? { minutes: est.minutes, effortIndex: est.effortIndex } : {};
        tiers.push({ label: `Tier ${i + 1}`, points: value, ...estFields, pointsSource: est.source });
      }
      onCreate({ type: "tiered", text: trimmed, tiers, ...withDesc });
    } else {
      const pointsValue = parsePercent(points);
      if (pointsValue === null) return;
      // Store the estimate only when a duration was actually picked; always record whether the % came
      // from the builder (pointsSource) so a later rate/effort change knows what it may rebalance.
      const withEstimate =
        checkboxEst.minutes != null
          ? { estimateMinutes: checkboxEst.minutes, estimateEffortIndex: checkboxEst.effortIndex }
          : {};
      if (type === "repeatable") {
        // A repeatable task is a single tally box — no box count, no per-box schedule. An optional
        // completion cap rides in `count` (blank ≡ unlimited).
        const max = Number(maxTimes);
        const withMax = maxTimes.trim() && Number.isInteger(max) && max >= 1 ? { count: max } : {};
        onCreate({ type: "repeatable", text: trimmed, points: pointsValue, ...withMax, ...withEstimate, pointsSource: checkboxEst.source, ...withDesc });
      } else {
        // A count of 1 is a plain checkbox — omit it so the task stays a bare checkbox rather than
        // storing a redundant 1-box amount.
        const count = Number(amount);
        const withCount = Number.isInteger(count) && count > 1 ? { count } : {};
        // Include the schedule only if at least one box is actually scheduled (else stay a plain task).
        const schedule = scheduleFromRows(scheduleRows, scheduleCadence, boxCount);
        const withSchedule = schedule.some(Boolean) ? { schedule } : {};
        onCreate({ type: "checkbox", text: trimmed, points: pointsValue, ...withCount, ...withSchedule, ...withEstimate, pointsSource: checkboxEst.source, ...withDesc });
      }
    }
    reset();
  }

  const refButton = (
    <div className="calc-ref-trigger">
      <button type="button" className="icon-btn calc-ref-btn" aria-label="Points reference">?</button>
      <div className="calc-ref-tooltip" role="tooltip">
        <div className="calc-ref-section">
          <span className="calc-ref-heading">Duration → %</span>
          <span>5 min → 0.21%</span>
          <span>15 min → 0.63%</span>
          <span>30 min → 1.25%</span>
          <span>1 hr → 2.5%</span>
          <span>2 hr → 5%</span>
        </div>
        <div className="calc-ref-section">
          <span className="calc-ref-heading">Effort multiplier</span>
          <span>Normal ×1.0</span>
          <span>Challenging ×1.5</span>
        </div>
      </div>
    </div>
  );

  return (
    <Popover
      title="Add task"
      titleExtra={refButton}
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      align="left"
      width={300}
      scrollable
    >
      <form className="popover-form" onSubmit={handleSubmit}>
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
          />
        </label>

        <label className="field">
          <span className="field-label">Description (optional)</span>
          <textarea
            className="field-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            autoComplete="off"
          />
        </label>

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
            <button type="button" className="ghost-btn add-tier-btn" onClick={addTierRow}>
              + Add tier
            </button>
          </div>
        )}

        <div className="popover-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit">Add task</button>
        </div>
      </form>
    </Popover>
  );
}

export default SectionCard;
