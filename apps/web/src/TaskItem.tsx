import { behaviorOf, parsePercent, POINTS_PER_PERCENT } from "@board/contracts";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FlyOrigin } from "./FlyingPoints";
import type { RowAction } from "./ActionMenu";
import BlockForm, { type BlockReason } from "./BlockForm";
import { BreakDownIcon, CopyIcon, EyeIcon, HourglassIcon, LockIcon, OutdentIcon, RerollIcon, ScissorsIcon } from "./Icons";
import ItemRow, { RowRemove, type RowContext } from "./ItemRow";
import { PieceList, PieceStrip, PiecesSummary, type RowPieces } from "./Pieces";
import { deleteAction, editAction } from "./rowActions";
import PointsBracket from "./PointsBracket";
import PointsBuilder, { type BuilderEstimate, TierBuilderRow, type TierRow } from "./PointsBuilder";
import Popover from "./Popover";
import ScheduleEditor, { rowsFromSchedule, scheduleFromRows, type Cadence, type ScheduleRow } from "./ScheduleEditor";
import StatusPill from "./StatusPill";
import TaskTimer from "./TaskTimer";
import { inHandLabel, pieceStatusActions, statusActions } from "./taskStatus";
import Tooltip from "./Tooltip";
import { boxScheduleLabel, isBoxLocked, isRetired, statusOf } from "./types";
import type { BoxSchedule, Task, TaskSchedule, TaskStatus, TierDef } from "./types";
import { uid } from "./uid";
import { useBoardClock } from "./useBoardClock";
import { useClickOutside } from "./useClickOutside";

// How long (seconds) a just-finished one-time task shows checked before it leaves the list — long enough
// to register the tick, short enough that it's plainly gone by the time the points land.
const RETIRE_EXIT_DELAY = 0.45;
// A broken-down task finished by its last piece lingers longer: the tick runs back up to its own box (the
// .finishing animation in App.css — this covers it) before the row goes.
const FINALE_EXIT_DELAY = 1.1;
// Ticking a broken-down task's own box ticks its open pieces one after another, this many ms apart.
const PIECE_CASCADE_MS = 100;

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
  onDuplicate: () => void;
  // Only where the task can be pruned (canPrune — a daily/weekly checkbox task): when it would come
  // back, and the streaks pruning it would break. Absent ≡ no Prune in its menu.
  prune?: { until: string; breaks: string[] };
  onSetPruned: (pruned: boolean) => void;
  // Only while its tab shows the Status bands: the row's Status controls and its band's note under the
  // name. Absent ≡ no Status on this row.
  status?: RowStatus;
  // Only on a task that can be broken down (a one-time task that isn't a piece): its pieces and what can
  // be done with them. Absent ≡ no Break down in its menu.
  pieces?: RowPieces;
  // Only on a piece: take it out of its task into the tab's list ("Make it its own task").
  onMakeOwn?: () => void;
  // What its completion is (or was) paid at, when not ×1 — a Bounty's ×2 — shown in its bracket.
  multiplier?: number;
  // Only on a Bounty still to win, while rerolls are left: its menu's Reroll, and how many are left.
  reroll?: { left: number; onReroll: () => void };
}

export interface RowStatus {
  onSet: (status: TaskStatus, why?: BlockReason) => void;
  // Whether its Blocked form is open. The tab holds this, since a drop on the Blocked band opens it too.
  blocking: boolean;
  onBlockingChange: (open: boolean) => void;
  // Every task on the board: what the Blocked form's pick-whip can link, and the name of what it waits on.
  allTasks: Task[];
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
  // A tiered task edits each tier through the same builder the add form uses. Rows follow the task's
  // tiers one-to-one (the tier count is fixed here); each builder reports its estimate on mount.
  const [tierRows, setTierRows] = useState<TierRow[]>(() =>
    (task.tiers ?? []).map((t) => ({
      id: uid(),
      points: String(t.points / POINTS_PER_PERCENT),
      est: { minutes: t.minutes ?? null, effortIndex: t.effortIndex ?? 0, source: t.pointsSource ?? "manual" },
    })),
  );
  // Stable (no deps) — each tier's builder treats them as effect dependencies.
  const setTierPoints = useCallback((id: string, value: string) => {
    setTierRows((prev) => prev.map((row) => (row.id === id ? { ...row, points: value } : row)));
  }, []);
  const setTierEstimate = useCallback((id: string, est: BuilderEstimate) => {
    setTierRows((prev) => prev.map((row) => (row.id === id ? { ...row, est } : row)));
  }, []);
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
      // Same rules as a checkbox task's builder, per tier: stamp the builder's reported source, and the
      // estimate only when a duration is currently chosen (otherwise the tier keeps what it had).
      patch.tiers = task.tiers.map((t, i) => {
        const row = tierRows[i];
        const estimate = row.est.minutes != null ? { minutes: row.est.minutes, effortIndex: row.est.effortIndex } : {};
        return { ...t, points: parsePercent(row.points) ?? t.points, pointsSource: row.est.source, ...estimate };
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
            {tierRows.map((row, i) => {
              // Seed only builder-sourced tiers, like a checkbox task's edit: a manual tier's % must
              // stay exactly as typed rather than show a duration that no longer produced it.
              const tier = task.tiers?.[i];
              const seeded = tier?.pointsSource === "builder";
              return (
                <TierBuilderRow
                  key={row.id}
                  row={row}
                  index={i}
                  onPointsChange={setTierPoints}
                  onEstimateChange={setTierEstimate}
                  initialMinutes={seeded ? tier?.minutes : undefined}
                  initialEffortIndex={seeded ? tier?.effortIndex : undefined}
                />
              );
            })}
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

// A task at its full level — every box ticked.
function ticked(task: Task): Task {
  const b = behaviorOf(task);
  return { ...task, ...b.patchForLevel(task, b.boxes(task)) };
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

function TaskItem({ task, color, scheduleCadence, showEstimate, showTimer, row, pointsHidden, onSetLevel, onRemove, onEdit, onDuplicate, prune, onSetPruned, status, pieces, onMakeOwn, multiplier, reroll }: TaskItemProps) {
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
  const [removing, setRemoving] = useState(false);
  const [inlineEditing, setInlineEditing] = useState(false);
  const [inlineText, setInlineText] = useState(task.text);
  const editRef = useRef<HTMLDivElement>(null);
  useClickOutside(editRef, () => setEditOpen(false), editOpen);
  const blockRef = useRef<HTMLDivElement>(null);
  const closeBlocking = useCallback(() => status?.onBlockingChange(false), [status]);
  useClickOutside(blockRef, closeBlocking, !!status?.blocking);
  // Set when this click finishes a task that leaves its list (one-time). The row is removed in the same
  // update, and a leaving row keeps rendering with its last props (still unchecked) — so it reads this
  // instead, showing checked + hatched through a short delayed exit before it's tossed off the list.
  // "finale" when its last piece finished it: the longer exit that plays the tick back up to its box.
  const [retiring, setRetiring] = useState<false | "tick" | "finale">(false);
  const shownDone = task.done || !!retiring;
  // Break down: the pieces it holds — every one shown ticked while its finale plays, since the leaving row's
  // last props are from before the last tick — and whether the type-a-piece entry is open under it.
  const pieceItems = (pieces?.items ?? []).map((p) => (retiring === "finale" ? ticked(p) : p));
  const [breakingDown, setBreakingDown] = useState(false);
  function startBreakDown() {
    setBreakingDown(true);
    if (pieces && !pieces.open) pieces.onToggle();
  }
  // The tick of a piece that finishes this task: the task shows checked through the same short exit as a
  // tick of its own box does (it's gone from the list in that same update).
  const pieceLevel = (piece: Task, level: number, origin?: FlyOrigin) => {
    const finishes = b.retiresWhenDone && level >= 1 && pieceItems.every((p) => p.id === piece.id || behaviorOf(p).isDone(p));
    setRetiring(finishes ? "finale" : false);
    onSetLevel(piece, level, origin);
  };
  // Ticking its own box ticks its open pieces one after another (each paying as it goes), so the tick runs
  // down them and the last one finishes it. Each tick re-renders the row, so the timers read its latest
  // state; they stop if the row goes. False when there's nothing to tick (then the box acts on its own).
  const cascade = useRef<number[]>([]);
  const latest = useRef({ pieceItems, pieceLevel });
  useLayoutEffect(() => {
    latest.current = { pieceItems, pieceLevel };
  });
  useEffect(() => {
    const timers = cascade;
    return () => timers.current.forEach((t) => window.clearTimeout(t));
  }, []);
  function tickPieces(): boolean {
    const open = pieceItems.filter((p) => !behaviorOf(p).isDone(p));
    if (open.length === 0) return false;
    if (cascade.current.length > 0) return true;
    cascade.current = open.map((piece, i) =>
      window.setTimeout(() => {
        const now = latest.current.pieceItems.find((p) => p.id === piece.id);
        if (now && !behaviorOf(now).isDone(now)) latest.current.pieceLevel(now, behaviorOf(now).boxes(now), pieceOrigin(now));
        if (i === open.length - 1) cascade.current = [];
      }, i * PIECE_CASCADE_MS),
    );
    return true;
  }

  function startInline() { setInlineText(task.text); setInlineEditing(true); }
  function commitInline() {
    const t = inlineText.trim();
    if (t && t !== task.text) onEdit({ text: t });
    setInlineEditing(false);
  }
  function cancelInline() { setInlineEditing(false); }

  const pointsRef = useRef<HTMLSpanElement>(null);
  // A broken-down task's bracket is its whole worth: its pieces' points, plus any it keeps for itself.
  const percents =
    pieceItems.length > 0 ? [pieceItems.reduce((sum, p) => sum + behaviorOf(p).maxValue(p), b.maxValue(task))] : b.percents(task);

  function pointsOrigin(): FlyOrigin | undefined {
    const el = pointsRef.current;
    return el ? { rect: el.getBoundingClientRect(), percents } : undefined;
  }
  // Where a piece's flyer leaves from: its own bracket under this row, or this row's while they're folded.
  function pieceOrigin(piece: Task): FlyOrigin | undefined {
    const own = pointsRef.current?.closest("li")?.querySelector<HTMLElement>(`li[data-task-id="${piece.id}"] > .points-prefix`);
    const el = own ?? pointsRef.current;
    return el ? { rect: el.getBoundingClientRect(), percents: behaviorOf(piece).percents(piece) } : undefined;
  }

  const removeControl = (
    <RowRemove
      label="Remove task"
      message={
        pieceItems.length > 0
          ? `Delete this task and its ${pieceItems.length === 1 ? "piece" : `${pieceItems.length} pieces`}?`
          : "Delete this task?"
      }
      confirming={removing}
      onConfirmingChange={setRemoving}
      onConfirm={() => onRemove(task.id)}
    />
  );

  const pruneActions: RowAction[] = !prune
    ? []
    : task.pruned
      ? [{ key: "prune", label: "Unprune", icon: EyeIcon, shortcut: "p", onSelect: () => onSetPruned(false) }]
      : [
          {
            key: "prune",
            label: `Prune until ${prune.until}`,
            icon: ScissorsIcon,
            shortcut: "p",
            ...(prune.breaks.length > 0 ? { warning: `Breaks ${prune.breaks.map((name) => `“${name}”`).join(", ")}` } : {}),
            onSelect: () => onSetPruned(true),
          },
        ];
  // A finished one-time task is out of the bands (it's only listed in the Completed look-back), so it
  // has no Status controls until it's unchecked.
  const rowStatus = status && !isRetired(task) ? status : undefined;
  const current = statusOf(task);
  const pickStatus = (next: TaskStatus) => {
    if (!rowStatus) return;
    if (next === "blocked") rowStatus.onBlockingChange(true);
    else if (next !== current) rowStatus.onSet(next);
  };
  // Break down on a task that can hold pieces (and isn't finished); on a piece, the way out of its task.
  // They share a group with the Status choices, which the menu captions as their own set.
  const pieceActions: RowAction[] = [
    ...(pieces && !b.isDone(task)
      ? [{ key: "break-down", label: "Break down", icon: BreakDownIcon, shortcut: "b", onSelect: startBreakDown }]
      : []),
    ...(onMakeOwn ? [{ key: "make-own", label: "Make it its own task", icon: OutdentIcon, shortcut: "m", onSelect: onMakeOwn }] : []),
  ];
  // A piece sits under its task rather than in a band, so it only takes Blocked.
  const statusChoices = !rowStatus
    ? []
    : task.parentId
      ? pieceStatusActions(task, () => pickStatus("blocked"), () => rowStatus.onSet("backlog"))
      : statusActions(task, pickStatus, () => pickStatus("blocked"));
  // A Bounty still to win can be rerolled from its menu, saying what that spends.
  const rerollActions: RowAction[] =
    reroll && task.bounty && !b.isDone(task)
      ? [{ key: "reroll", label: "Reroll Bounty", icon: RerollIcon, shortcut: "r", warning: `${reroll.left} reroll${reroll.left === 1 ? "" : "s"} left`, onSelect: reroll.onReroll }]
      : [];
  const actions: RowAction[][] = [
    [editAction(() => setEditOpen(true))],
    rerollActions,
    [...pieceActions, ...statusChoices],
    pruneActions,
    [{ key: "duplicate", label: "Duplicate", icon: CopyIcon, shortcut: "d", onSelect: onDuplicate }],
    [deleteAction(() => setRemoving(true))],
  ];
  // Row modifiers every render branch shares.
  const rowMods = `${showTimer ? " has-footer" : ""}${task.pruned ? " pruned" : ""}${pieceItems.length > 0 || breakingDown ? " has-pieces" : ""}${retiring === "finale" ? " finishing" : ""}`;
  // Shown only while the tab's "Pruned tasks" view lists it: when it comes back.
  const prunedNote = task.pruned && prune ? <span className="task-pruned-note">back {prune.until}</span> : null;
  // The band's word on this row: how long an in-progress task has been in hand (so a stalled one stands
  // out), or what a blocked one is waiting on — if it was given a reason (the band already says Blocked).
  const waitsOnName = task.blocker?.taskId
    ? rowStatus?.allTasks.find((t) => t.id === task.blocker?.taskId)?.text
    : undefined;
  const inHand = current === "in-progress" && task.statusSince ? inHandLabel(task.statusSince, now, settings) : null;
  const statusNote = !rowStatus ? null : inHand ? (
    <span className="task-status-note">{inHand}</span>
  ) : current === "blocked" && (task.blocker?.note || waitsOnName) ? (
    <span className="task-status-note">
      Waiting on {task.blocker?.note}
      {task.blocker?.note && waitsOnName && " · "}
      {waitsOnName && <span className="task-status-waits-on">{waitsOnName}</span>}
    </span>
  ) : null;
  // Hover-revealed; a touch screen reaches the same choices through the long-press menu.
  const statusPill = rowStatus && !task.parentId ? <StatusPill status={current} onPick={pickStatus} /> : null;
  // A broken-down task's progress beside and under its name, and its pieces (plus the Break down entry)
  // under the row. Only a one-time task breaks down, so only the single-checkbox layout below holds these.
  // This week's Bounty, stamped beside its name until it's won.
  const bountyStamp = task.bounty && !shownDone ? <span className="bounty-stamp">Bounty ×{task.bounty.multiplier}</span> : null;
  const pieceStrip = pieceItems.length > 0 ? <PieceStrip pieces={pieceItems} color={color} /> : null;
  const piecesSummary =
    pieces && pieceItems.length > 0 ? <PiecesSummary pieces={pieceItems} open={pieces.open} onToggle={pieces.onToggle} /> : null;
  const pieceBlock = pieces ? (
    <PieceList
      task={task}
      color={color}
      pieces={{ ...pieces, items: pieceItems }}
      onSetLevel={pieceLevel}
      breakingDown={breakingDown}
      onBreakingDownChange={setBreakingDown}
    />
  ) : null;

  // Every render branch wears the shared row base; data-task-id is the task's identity for the
  // streak pick-whip (which hit-tests task rows), separate from the list's data-item-id.
  const rowProps = { value: task, id: task.id, row, attrs: { "data-task-id": task.id }, actions };

  const pointsBracket = (
    <span className={`points-prefix${pointsHidden ? " in-flight" : ""}`} ref={pointsRef}>
      <PointsBracket percents={percents} multiplier={multiplier} />
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
      {/* Scrollable like the add form: a tiered task's builders (one per tier) can outgrow the board. */}
      <Popover title="Edit task" open={editOpen} onClose={() => setEditOpen(false)} align="right" width={300} scrollable>
        <TaskEditForm
          task={task}
          cadence={scheduleCadence}
          onSave={(patch) => { onEdit(patch); setEditOpen(false); }}
          onCancel={() => setEditOpen(false)}
        />
      </Popover>
    </div>
  );

  // Blocked asks why before it moves the task: a note, the task it waits on, or both. Opened again on a
  // blocked task, it edits the reason.
  const blockPopover = rowStatus ? (
    <div className="popover-anchor row-edit-anchor" ref={blockRef}>
      <Popover title="Blocked" open={rowStatus.blocking} onClose={closeBlocking} align="right" width={280}>
        <BlockForm
          task={task}
          allTasks={rowStatus.allTasks}
          accentColor={color}
          initial={task.blocker}
          submitLabel={current === "blocked" ? "Save" : "Block"}
          onSubmit={(why) => {
            rowStatus.onSet("blocked", why);
            closeBlocking();
          }}
          onCancel={closeBlocking}
        />
      </Popover>
    </div>
  ) : null;

  if (b.renderKind(task) === "counter") {
    // A single tally box: the box shows the completion count (starts at 0). Left-click adds one,
    // right-click removes one (down to 0) to fix a mis-click. An optional `count` caps it — once the
    // cap is reached the box is full and clicking can't add more. The "N" badge marks it repeatable.
    const count = b.filled(task);
    const atMax = task.count != null && count >= task.count;
    return (
      <ItemRow {...rowProps} className={`task-item${rowMods}`}>
        <div className="checkbox-cell counter-cell" style={{ "--task-color": color } as React.CSSProperties}>
          <button
            type="button"
            className={`counter-box${count > 0 ? " filled" : ""}${atMax ? " maxed" : ""}`}
            data-box-index={0}
            aria-label={`${task.text}: ${count} done${task.count != null ? ` of ${task.count}` : ""}, click to add one, right-click to remove one`}
            onClick={() => { if (!atMax) onSetLevel(task, b.levelOnClick(task, 0), pointsOrigin()); }}
            onContextMenu={(e) => {
              // Right-click on the box decrements — don't open the browser menu, and don't let it
              // bubble to the row's context handler (which opens the actions menu).
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
            <span className="task-text" onDoubleClick={startInline}>{task.text}{task.description && <TaskInfo text={task.description} />}{estBadge}{prunedNote}{statusNote}</span>
          )}
        </div>
        {statusPill}
        {removeControl}
        {timerFooter}
        {editPopover}
        {blockPopover}
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
      <ItemRow {...rowProps} className={`task-item${done ? " done" : ""}${rowMods}`}>
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
          <span className="task-text" onDoubleClick={startInline}>{task.text}{task.description && <TaskInfo text={task.description} />}{estBadge}{prunedNote}{statusNote}</span>
        )}
        {statusPill}
        {removeControl}
        {timerFooter}
        {editPopover}
        {blockPopover}
      </ItemRow>
    );
  }

  return (
    <ItemRow
      {...rowProps}
      className={`task-item${shownDone ? " done" : ""}${rowMods}`}
      exitDelay={retiring === "finale" ? FINALE_EXIT_DELAY : retiring ? RETIRE_EXIT_DELAY : undefined}
    >
      {(() => {
        const locked = !shownDone && boxLocked(0);
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
            checked={shownDone}
            onChange={() => {
              const level = b.levelOnClick(task, 0);
              if (level >= 1 && tickPieces()) return;
              setRetiring(b.retiresWhenDone && level >= 1 ? "tick" : false);
              onSetLevel(task, level, pointsOrigin());
            }}
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
          <span className="task-text" onDoubleClick={startInline}>{task.text}{task.description && <TaskInfo text={task.description} />}{estBadge}{bountyStamp}{pieceStrip}{prunedNote}{statusNote}</span>
        )}
        {piecesSummary}
      </div>
      {statusPill}
      {removeControl}
      {timerFooter}
      {pieceBlock}
      {editPopover}
      {blockPopover}
    </ItemRow>
  );
}

export default TaskItem;
