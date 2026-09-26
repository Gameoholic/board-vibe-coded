import { behaviorOf, parsePercent, POINTS_PER_PERCENT } from "@board/contracts";
import { Fragment, useRef, useState } from "react";
import type { FlyOrigin } from "./FlyingPoints";
import { HourglassIcon, LockIcon } from "./Icons";
import ItemRow, { RowRemove, type RowContext } from "./ItemRow";
import PointsBracket from "./PointsBracket";
import PointsBuilder, { type BuilderEstimate } from "./PointsBuilder";
import Popover from "./Popover";
import ScheduleEditor, { rowsFromSchedule, scheduleFromRows, type Cadence, type ScheduleRow } from "./ScheduleEditor";
import TaskTimer from "./TaskTimer";
import Tooltip from "./Tooltip";
import { boxScheduleLabel, isBoxLocked } from "./types";
import type { BoxSchedule, Task, TaskSchedule, TierDef } from "./types";
import { useBoardClock } from "./useBoardClock";
import { useClickOutside } from "./useClickOutside";

// The task-edit / add-task patch shape, shared by the row callbacks (kept in one alias so the
// schedule field is threaded through every call site consistently).
type TaskPatch = { text?: string; points?: number; estimateMinutes?: number | null; estimateEffortIndex?: number | null; pointsSource?: "builder" | "manual"; description?: string | null; tiers?: TierDef[]; count?: number; progress?: number; schedule?: TaskSchedule };

interface TaskItemProps {
  task: Task;
  color: string;
  // Scheduled-box cadence, inferred from the section's `period` (day → daily, week → weekly).
  scheduleCadence: Cadence;
  // When on (per-tab Display toggle), a checkbox task shows its estimated duration beside the name.
  showEstimate: boolean;
  // When on (per-tab Display toggle), every row shows a timer footer: a plain stopwatch, plus the
  // tier auto-advance + Submit for tiered tasks.
  showTimer: boolean;
  // This row's place in its list (drag / group handles) — from ItemList, via the ItemRow base.
  row: RowContext;
  pointsHidden: boolean;
  onSetLevel: (task: Task, level: number, origin?: FlyOrigin) => void;
  onRemove: (id: string) => void;
  onEdit: (patch: TaskPatch) => void;
}

// The inline "ℹ" affordance on a task with a description. The note lives in a CSS-driven bubble that
// reveals on hover and on focus (so a tap, which focuses the button, works on touch too) — no JS state.
function TaskInfo({ text }: { text: string }) {
  return (
    <button type="button" className="task-info" aria-label="Show description">
      <span aria-hidden="true">i</span>
      <span className="task-info-bubble" role="tooltip">{text}</span>
    </button>
  );
}

interface TaskEditFormProps {
  task: Task;
  cadence: Cadence;
  onSave: (patch: TaskPatch) => void;
  onCancel: () => void;
}

function TaskEditForm({ task, cadence, onSave, onCancel }: TaskEditFormProps) {
  const b = behaviorOf(task);
  const [name, setName] = useState(task.text);
  const [description, setDescription] = useState(task.description ?? "");
  const [points, setPoints] = useState(String((task.points ?? 0) / POINTS_PER_PERCENT));
  const [tierPoints, setTierPoints] = useState(
    (task.tiers ?? []).map((t) => String(t.points / POINTS_PER_PERCENT)),
  );
  const [amount, setAmount] = useState(String(task.count ?? 1));
  const boxCount = Math.max(1, Number(amount) || 1);
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>(() => rowsFromSchedule(task.schedule, boxCount));
  // The builder's report during this edit (minutes/effortIndex/source). The builder is seeded from a
  // builder-sourced task so it reports "builder" on mount; a manual task's isn't seeded (so seeding
  // can't overwrite its %). On save we stamp the reported source + estimate.
  const [editEst, setEditEst] = useState<BuilderEstimate | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const patch: TaskPatch = {};
    const trimmed = name.trim();
    if (trimmed) patch.text = trimmed;
    // Only send description when it actually changed; empty clears it (null).
    const trimmedDesc = description.trim();
    if (trimmedDesc !== (task.description ?? "")) patch.description = trimmedDesc || null;
    if (task.tiers) {
      patch.tiers = task.tiers.map((t, i) => {
        const v = parsePercent(tierPoints[i]);
        // A hand-edited tier % (this bare form has no builder) is an override → mark that tier manual.
        const overridden = v !== null && v !== t.points;
        return { ...t, points: v ?? t.points, ...(overridden ? { pointsSource: "manual" as const } : {}) };
      });
    } else {
      const v = parsePercent(points);
      if (v !== null) patch.points = v;
      // Stamp the builder's reported source + estimate (builder if untouched/matching, manual if the %
      // was overridden). estimateMinutes/effort only when a duration is currently chosen.
      if (editEst) {
        patch.pointsSource = editEst.source;
        if (editEst.minutes != null) {
          patch.estimateMinutes = editEst.minutes;
          patch.estimateEffortIndex = editEst.effortIndex;
        }
      }
    }
    if (b.supportsQuantity) {
      const v = Number(amount);
      if (Number.isInteger(v) && v >= 1) patch.count = v;
      // Always send the schedule so clearing all times persists (server drops an all-empty array).
      patch.schedule = scheduleFromRows(scheduleRows, cadence, boxCount);
    }
    onSave(patch);
  }

  return (
    <form className="popover-form" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field-label">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          autoComplete="off"
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

      {task.tiers ? (
        <div className="field">
          <span className="field-label">Tiers</span>
          <div className="tier-rows">
            {task.tiers.map((_, i) => (
              <div key={i} className="tier-row-inputs">
                <span className="tier-row-label">Tier {i + 1}</span>
                <input
                  type="number"
                  placeholder="%"
                  step="any"
                  className="tier-points-input"
                  value={tierPoints[i] ?? ""}
                  onChange={(e) =>
                    setTierPoints((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                  }
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <PointsBuilder
          points={points}
          onPointsChange={setPoints}
          onBuilderChange={setEditEst}
          initialMinutes={task.pointsSource === "builder" ? task.estimateMinutes : undefined}
          initialEffortIndex={task.pointsSource === "builder" ? task.estimateEffortIndex : undefined}
        />
      )}

      {b.supportsQuantity && (
        <label className="field">
          <span className="field-label">Amount (boxes)</span>
          <input
            type="number"
            min="1"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
      )}

      {b.supportsQuantity && (
        <ScheduleEditor count={boxCount} cadence={cadence} rows={scheduleRows} onChange={setScheduleRows} />
      )}

      <div className="popover-actions">
        <button type="button" className="ghost-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit">Save</button>
      </div>
    </form>
  );
}

// A task's estimated minutes as a compact "1h 30m" / "45m" / "2h" string.
// 2m is the builder's smallest bucket, labeled "<2m" — mirror that here.
function formatMinutes(total: number): string {
  if (total === 2) return "<2m";
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function TaskItem({ task, color, scheduleCadence, showEstimate, showTimer, row, pointsHidden, onSetLevel, onRemove, onEdit }: TaskItemProps) {
  const b = behaviorOf(task);
  const { now, settings } = useBoardClock();
  // A scheduled box shows a lock until its time arrives — but only on checkbox tasks (the gate is
  // meaningless for tiered ladders) and never on a box that's already ticked.
  const entryFor = (i: number): BoxSchedule | undefined => (b.supportsQuantity ? task.schedule?.[i] ?? undefined : undefined);
  function boxLocked(i: number): boolean {
    const entry = entryFor(i);
    return !!entry && isBoxLocked(entry, now, settings);
  }
  // Hover text for a scheduled box: "Unlocks …" while it's still gated, otherwise "For …" — so an
  // already-open timed box still tells you which time it belongs to (undefined ⇒ box has no schedule).
  function boxTip(i: number, locked: boolean): string | undefined {
    const entry = entryFor(i);
    return entry ? `${locked ? "Unlocks" : "For"} ${boxScheduleLabel(entry)}` : undefined;
  }
  const [editOpen, setEditOpen] = useState(false);
  const [inlineEditing, setInlineEditing] = useState(false);
  const [inlineText, setInlineText] = useState(task.text);
  const editRef = useRef<HTMLDivElement>(null);
  useClickOutside(editRef, () => setEditOpen(false), editOpen);

  function startInline() { setInlineText(task.text); setInlineEditing(true); }
  function commitInline() {
    const t = inlineText.trim();
    if (t && t !== task.text) onEdit({ text: t });
    setInlineEditing(false);
  }
  function cancelInline() { setInlineEditing(false); }

  const pointsRef = useRef<HTMLSpanElement>(null);
  const percents = b.percents(task);

  function pointsOrigin(): FlyOrigin | undefined {
    const el = pointsRef.current;
    return el ? { rect: el.getBoundingClientRect(), percents } : undefined;
  }

  function openEdit(e: React.MouseEvent) {
    e.preventDefault();
    setEditOpen((v) => !v);
  }

  const removeControl = <RowRemove label="Remove task" message="Delete this task?" onConfirm={() => onRemove(task.id)} />;

  // Every render branch wears the shared row base; data-task-id is the task's identity for the
  // streak pick-whip (which hit-tests task rows), separate from the list's data-item-id.
  const rowProps = { value: task, id: task.id, row, attrs: { "data-task-id": task.id }, onContextMenu: openEdit };

  const pointsBracket = (
    <span className={`points-prefix${pointsHidden ? " in-flight" : ""}`} ref={pointsRef}>
      <PointsBracket percents={percents} />
    </span>
  );

  // The estimated-duration clock beside the name (checkbox tasks only — tiered store their estimate
  // per tier, not at task level, so they simply have no `estimateMinutes`). Lives inside the name
  // cell so it doesn't take its own subgrid column. Shown only when the tab's Display toggle is on.
  const estBadge =
    showEstimate && task.estimateMinutes != null ? (
      <span className="task-est" title="Estimated time">
        <HourglassIcon size={11} />
        {formatMinutes(task.estimateMinutes)}
      </span>
    ) : null;

  // The timer footer — a full-width second grid row, shown on any task when the tab's Timer
  // display toggle is on. A plain stopwatch on most tasks; a tiered task also passes its tiers so
  // the timer can auto-advance and offer a Submit that locks in the reached tier (as it does today).
  const timerFooter = showTimer ? (
    <div className="task-footer">
      <TaskTimer
        taskId={task.id}
        color={color}
        timer={task.timer}
        tiers={b.supportsTimer ? task.tiers ?? [] : undefined}
        activeTier={task.activeTier}
        onSetTier={
          b.supportsTimer
            ? (tierIndex) => onSetLevel(task, tierIndex == null ? 0 : tierIndex + 1, pointsOrigin())
            : undefined
        }
      />
    </div>
  ) : null;

  // Popover anchor is position:absolute so it doesn't affect the subgrid layout.
  const editPopover = (
    <div className="popover-anchor row-edit-anchor" ref={editRef}>
      <Popover title="Edit task" open={editOpen} onClose={() => setEditOpen(false)} align="right" width={280}>
        <TaskEditForm
          task={task}
          cadence={scheduleCadence}
          onSave={(patch) => { onEdit(patch); setEditOpen(false); }}
          onCancel={() => setEditOpen(false)}
        />
      </Popover>
    </div>
  );

  if (b.renderKind(task) === "counter") {
    // A single tally box: the box shows the completion count (starts at 0). Left-click adds one,
    // right-click removes one (down to 0) to fix a mis-click. An optional `count` caps it — once the
    // cap is reached the box is full and clicking can't add more. The "N" badge marks it repeatable.
    const count = b.filled(task);
    const atMax = task.count != null && count >= task.count;
    return (
      <ItemRow {...rowProps} className={`task-item${showTimer ? " has-footer" : ""}`}>
        <div className="checkbox-cell counter-cell" style={{ "--task-color": color } as React.CSSProperties}>
          <button
            type="button"
            className={`counter-box${count > 0 ? " filled" : ""}${atMax ? " maxed" : ""}`}
            data-box-index={0}
            aria-label={`${task.text}: ${count} done${task.count != null ? ` of ${task.count}` : ""}, click to add one, right-click to remove one`}
            onClick={() => { if (!atMax) onSetLevel(task, b.levelOnClick(task, 0), pointsOrigin()); }}
            onContextMenu={(e) => {
              // Right-click on the box decrements — don't open the browser menu, and don't let it
              // bubble to the row's context handler (which opens the edit popover).
              e.preventDefault();
              e.stopPropagation();
              if (count > 0) onSetLevel(task, Math.max(0, count - 1));
            }}
          >
            {count}
          </button>
          <span className="counter-badge" aria-hidden="true">N</span>
        </div>
        {pointsBracket}
        <div className="task-main">
          {inlineEditing ? (
            <input
              className="task-inline-input"
              value={inlineText}
              autoFocus
              onChange={(e) => setInlineText(e.target.value)}
              onBlur={commitInline}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitInline(); } else if (e.key === "Escape") { e.preventDefault(); cancelInline(); } }}
            />
          ) : (
            <span className="task-text" onDoubleClick={startInline}>{task.text}{task.description && <TaskInfo text={task.description} />}{estBadge}</span>
          )}
        </div>
        {removeControl}
        {timerFooter}
        {editPopover}
      </ItemRow>
    );
  }

  if (b.renderKind(task) === "boxes") {
    const boxes = b.boxes(task);
    const filled = b.filled(task);
    // A multi-box checkbox (it has a `count`) gets the single checkbox's done look once every box is
    // ticked. Tiered rows share this branch but deliberately don't: picking a tier isn't "finished" —
    // a higher one may still come.
    const done = task.count != null && b.isDone(task);
    return (
      <ItemRow {...rowProps} className={`task-item${done ? " done" : ""}${showTimer ? " has-footer" : ""}`}>
        <div className="tier-dots" style={{ "--task-color": color } as React.CSSProperties}>
          {Array.from({ length: boxes }, (_, i) => {
            const locked = i >= filled && boxLocked(i);
            const tip = boxTip(i, locked);
            const tier = task.tiers?.[i];
            // Hover bubble shows the tier's estimated time; falls back to its label ("Tier N") when
            // the tier carries no estimate.
            const dotLabel = tier?.minutes != null ? formatMinutes(tier.minutes) : tier?.label;
            // aria-disabled + a click guard (not the `disabled` attribute) so the element still
            // receives hover/focus and its Tooltip shows — and the pick-whip can still hit-test it.
            const dot = (
              <button
                type="button"
                data-label={dotLabel}
                data-box-index={i}
                className={`tier-dot${i < filled ? " filled" : ""}${locked ? " locked" : ""}`}
                aria-label={tip ?? `Set box ${i + 1}`}
                aria-disabled={locked || undefined}
                onClick={() => { if (locked) return; onSetLevel(task, b.levelOnClick(task, i), pointsOrigin()); }}
              >
                {locked && <span className="box-lock"><LockIcon /></span>}
              </button>
            );
            // A scheduled box (locked or already open) gets the hover tip; an unscheduled one doesn't.
            return tip ? (
              <Tooltip key={i} label={tip}>{dot}</Tooltip>
            ) : (
              <Fragment key={i}>{dot}</Fragment>
            );
          })}
        </div>
        {pointsBracket}
        {inlineEditing ? (
          <input
            className="task-inline-input"
            value={inlineText}
            autoFocus
            onChange={(e) => setInlineText(e.target.value)}
            onBlur={commitInline}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitInline(); } else if (e.key === "Escape") { e.preventDefault(); cancelInline(); } }}
          />
        ) : (
          <span className="task-text" onDoubleClick={startInline}>{task.text}{task.description && <TaskInfo text={task.description} />}{estBadge}</span>
        )}
        {removeControl}
        {timerFooter}
        {editPopover}
      </ItemRow>
    );
  }

  return (
    <ItemRow {...rowProps} className={`task-item${task.done ? " done" : ""}${showTimer ? " has-footer" : ""}`}>
      {(() => {
        const locked = !task.done && boxLocked(0);
        const tip = boxTip(0, locked);
        if (locked) {
          // Scheduled, not-yet-due: locked with a lock badge and an "Unlocks …" tooltip. The Tooltip
          // wrapper carries .checkbox-cell so it stays a single column-1 grid child (subgrid intact).
          return (
            <Tooltip className="checkbox-cell locked" label={tip ?? ""}>
              <input type="checkbox" checked={false} disabled readOnly style={{ "--task-color": color } as React.CSSProperties} />
              <span className="box-lock"><LockIcon /></span>
            </Tooltip>
          );
        }
        const input = (
          <input
            type="checkbox"
            checked={task.done}
            onChange={() => onSetLevel(task, b.levelOnClick(task, 0), pointsOrigin())}
            style={{ "--task-color": color } as React.CSSProperties}
          />
        );
        // A scheduled-but-open checkbox still shows "For <time>" on hover so you know what it's for.
        // The .checkbox-cell wrapper keeps it a single column-1 grid child (subgrid alignment intact).
        return tip ? <Tooltip className="checkbox-cell" label={tip}>{input}</Tooltip> : input;
      })()}
      {pointsBracket}
      <div className="task-main">
        {inlineEditing ? (
          <input
            className="task-inline-input"
            value={inlineText}
            autoFocus
            onChange={(e) => setInlineText(e.target.value)}
            onBlur={commitInline}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitInline(); } else if (e.key === "Escape") { e.preventDefault(); cancelInline(); } }}
          />
        ) : (
          <span className="task-text" onDoubleClick={startInline}>{task.text}{task.description && <TaskInfo text={task.description} />}{estBadge}</span>
        )}
      </div>
      {removeControl}
      {timerFooter}
      {editPopover}
    </ItemRow>
  );
}

export default TaskItem;
