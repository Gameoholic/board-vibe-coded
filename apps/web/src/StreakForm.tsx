import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PickWhipIcon } from "./Icons";
import { usePickWhip, type WhipTarget } from "./pickWhip";
import { behaviorOf, streakCanCount } from "./types";
import type { Section, StreakMatcher, StreakMode, StreakSince, StreakType, Task, TaskCondition, TaskRequirement } from "./types";

export interface StreakPayload {
  name: string;
  type: StreakType;
  mode: StreakMode;
  since: StreakSince;
  matcher: StreakMatcher;
}

interface StreakFormProps {
  allTasks: Task[];
  // Every board tab — what a task resets with decides which streaks can count it (streakCanCount).
  allSections: Section[];
  // Display-only accent (the Streaks tab's color) for the condition dots and whip handle — streaks
  // no longer carry their own color, they inherit their section's.
  accentColor: string;
  initial?: StreakPayload;
  submitLabel: string;
  onSubmit: (payload: StreakPayload) => void;
  onCancel: () => void;
}

const TYPES: { value: StreakType; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "counter", label: "Counter" },
];

// What dropping the pick-whip on a task links: `required` is what the condition would demand — a
// number when hovering a specific box of a count task, "all" when over the row of a count task (every
// box, tracked live), or 1 for a plain single-box task. The line lands on that box (`cx`/`cy`).
interface StreakWhipTarget extends WhipTarget {
  required: TaskRequirement;
}

// Add/edit a streak. Renders the form body only — the caller wraps it in a Popover so add and
// per-row edit share one implementation. Streaks match by task conditions; the matcher union still
// carries a `filter` variant server-side, but it has no UI (it was an inert debug preview, removed).
function StreakForm({ allTasks, allSections, accentColor, initial, submitLabel, onSubmit, onCancel }: StreakFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<StreakType>(initial?.type ?? "daily");
  // "all" = every condition must be met (AND), "any" = at least one (OR). This IS the connector the
  // builder shows between condition rows, Notion-style: one shared join for the whole group.
  const [mode, setMode] = useState<StreakMode>(initial?.mode ?? "all");
  // Where counting begins: "Now" (from creation, windowed) or "All time" (whole history, honest via
  // settled snapshots). Applies to every type incl. counter ("Now" = live sum, "all" = lifetime total).
  const [since, setSince] = useState<StreakSince>(initial?.since ?? "created");
  const [conditions, setConditions] = useState<TaskCondition[]>(
    initial?.matcher.kind === "tasks" ? initial.matcher.conditions : [],
  );
  const [errors, setErrors] = useState<{ name?: string; conditions?: string }>({});

  // Whip drag runs on window listeners; those closures capture state, so read the live values off
  // refs to avoid staleness mid-gesture.
  const conditionsRef = useRef(conditions);
  conditionsRef.current = conditions;

  const taskName = (id: string) => allTasks.find((t) => t.id === id)?.text ?? "(deleted task)";
  // A counter sums each linked task independently, so AND/OR doesn't apply — the join is a fixed,
  // non-interactive "+". Daily/weekly show the toggleable AND/OR connector that drives `mode`.
  const isCounter = type === "counter";
  const connector = isCounter ? "+" : mode === "all" ? "and" : "or";

  // A daily streak counts only daily tasks, a weekly one only weekly ones (a counter, anything) — the whip
  // won't link another, and one already linked that the type no longer fits is marked to remove.
  const fits = (taskId: string): boolean => {
    const task = allTasks.find((t) => t.id === taskId);
    const section = task && allSections.find((s) => s.id === task.sectionId);
    return !section || streakCanCount(type, section);
  };
  const refusal = `${type === "daily" ? "Daily" : "Weekly"} streaks only take ${type} tasks`;
  const misfits = conditions.some((c) => !fits(c.taskId));

  // How many completions a condition demands, as a short label — only for tasks with more than one
  // box (a plain checkbox's "once" is implicit, so it stays unlabelled to avoid clutter).
  function requirementLabel(cond: TaskCondition): string | null {
    // A counter attaches to whole tasks (any completion counts) — no per-box amount, so no badge.
    if (isCounter) return null;
    const task = allTasks.find((t) => t.id === cond.taskId);
    if (!task || behaviorOf(task).boxes(task) <= 1) return null;
    return cond.required === "all" ? "all" : `×${cond.required}`;
  }

  // Resolve the screen point under the pointer to a drop target: the row's task, the box being
  // hovered (count tasks track "do it N times"; the whole row means "all", live), and where to land
  // the line. Non-quantity tasks always resolve to a single completion, matching the old behaviour.
  function resolveTarget(px: number, py: number): StreakWhipTarget | null {
    const el = document.elementFromPoint(px, py);
    const row = el?.closest<HTMLElement>("[data-task-id]");
    if (!row) return null;
    const id = row.dataset.taskId as string;
    const task = allTasks.find((t) => t.id === id);
    if (!fits(id)) {
      const r = (row.querySelector<HTMLElement>('input[type="checkbox"]') ?? row).getBoundingClientRect();
      return { id, cx: r.left + r.width / 2, cy: r.top + r.height / 2, required: 1, refused: refusal };
    }
    const quantity = task ? behaviorOf(task).supportsQuantity : false;
    let box = el?.closest<HTMLElement>("[data-box-index]") ?? null;
    // Buffer between dots: if the pointer is in the tier-dots container but not on a dot,
    // snap to the nearest dot by horizontal distance so rapid mouse movement between boxes
    // doesn't accidentally fall back to "whole row".
    if (!box && quantity) {
      const dotsContainer = row.querySelector<HTMLElement>(".tier-dots");
      if (dotsContainer) {
        const cr = dotsContainer.getBoundingClientRect();
        if (px >= cr.left && px <= cr.right && py >= cr.top - 4 && py <= cr.bottom + 4) {
          const dots = Array.from(dotsContainer.querySelectorAll<HTMLElement>("[data-box-index]"));
          box = dots.reduce<HTMLElement | null>((nearest, dot) => {
            const r = dot.getBoundingClientRect();
            const dist = Math.abs(r.left + r.width / 2 - px);
            if (!nearest) return dot;
            const nr = nearest.getBoundingClientRect();
            return dist < Math.abs(nr.left + nr.width / 2 - px) ? dot : nearest;
          }, null);
        }
      }
    }
    let required: TaskRequirement;
    let landEl: HTMLElement;
    let filledUpTo: number | undefined;
    // A counter attaches to the whole task (any completion counts, summed by level), never a single
    // box — so skip per-box resolution and link the whole row regardless of where the drop landed.
    if (!isCounter && quantity && box && row.contains(box)) {
      const boxIdx = Number(box.dataset.boxIndex);
      required = boxIdx + 1;
      filledUpTo = boxIdx;
      landEl = box;
    } else {
      required = isCounter || quantity ? "all" : 1;
      landEl = row.querySelector<HTMLElement>('input[type="checkbox"]') ?? row;
    }
    const rr = landEl.getBoundingClientRect();
    const dupe = conditionsRef.current.some((c) => c.taskId === id);
    // Preview fill: a specific box fills boxes 0..that one; the row fills every box.
    return { id, cx: rr.left + rr.width / 2, cy: rr.top + rr.height / 2, dupe, required, fillUpTo: filledUpTo ?? Infinity };
  }

  // Link a task by pick-whipping its row. A drop upserts: re-dropping a linked task updates its
  // required amount rather than duplicating it.
  const whip = usePickWhip(resolveTarget, ({ id, required }) => {
    setConditions((prev) =>
      prev.some((c) => c.taskId === id)
        ? prev.map((c) => (c.taskId === id ? { taskId: id, required } : c))
        : [...prev, { taskId: id, required }],
    );
    setErrors((p) => ({ ...p, conditions: undefined }));
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    const errs: { name?: string; conditions?: string } = {};
    if (!trimmed) errs.name = "Name is required";
    if (conditions.length === 0) errs.conditions = "Link at least one task";
    else if (misfits) errs.conditions = `${refusal} — remove the marked ones or change the type`;
    if (Object.keys(errs).length) { setErrors(errs); return; }
    const matcher: StreakMatcher = { kind: "tasks", conditions };
    onSubmit({ name: trimmed, type, mode, since, matcher });
  }

  return (
    <form className="popover-form" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field-label">Name</span>
        <input type="text" value={name} onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: undefined })); }} autoComplete="off" autoFocus />
        {errors.name && <span className="field-error">{errors.name}</span>}
      </label>

      <div className="field">
        <span className="field-label">Type</span>
        <div className="calc-pills">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`calc-pill${type === t.value ? " active" : ""}`}
              onClick={() => setType(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Count from</span>
        <div className="calc-pills">
          <button
            type="button"
            className={`calc-pill${since === "created" ? " active" : ""}`}
            onClick={() => setSince("created")}
          >
            Now
          </button>
          <button
            type="button"
            className={`calc-pill${since === "all" ? " active" : ""}`}
            onClick={() => setSince("all")}
          >
            All time
          </button>
        </div>
      </div>

      <div className="field">
        <span className="field-label">Counts when you complete</span>
        <div className="cond-builder">
          <AnimatePresence initial={false}>
            {conditions.map((cond, i) => (
              <motion.div
                key={cond.taskId}
                layout
                className="cond-block"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
                transition={{ duration: 0.16, ease: "easeOut" }}
              >
                {i > 0 && (
                  <div className="cond-connector-wrap">
                    {i === 1 && !isCounter ? (
                      // Only the first join is interactive; the rest mirror it (the group shares one
                      // AND/OR). Toggling it flips `mode` for the whole streak.
                      <button
                        type="button"
                        className="cond-connector"
                        onClick={() => setMode((m) => (m === "all" ? "any" : "all"))}
                        title="Switch between AND / OR"
                      >
                        {connector}
                        <span className="cond-connector-hint">⇅</span>
                      </button>
                    ) : (
                      <span className="cond-connector static">{connector}</span>
                    )}
                  </div>
                )}
                <div
                  className={fits(cond.taskId) ? "cond-row" : "cond-row misfit"}
                  style={{ "--cond-color": accentColor } as React.CSSProperties}
                  title={fits(cond.taskId) ? undefined : refusal}
                >
                  <span className="cond-dot" />
                  <span className="cond-name">{taskName(cond.taskId)}</span>
                  {requirementLabel(cond) && <span className="cond-req">{requirementLabel(cond)}</span>}
                  <button
                    type="button"
                    className="cond-remove"
                    aria-label="Remove condition"
                    onClick={() => setConditions((prev) => prev.filter((c) => c.taskId !== cond.taskId))}
                  >
                    ✕
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          <button
            type="button"
            className={`whip-handle${whip.dragging ? " dragging" : ""}`}
            onPointerDown={whip.start}
            title="Drag onto a task on your board to link it"
          >
            <PickWhipIcon />
            <span>{conditions.length ? "Drag to link another task" : "Drag onto a task to link it"}</span>
          </button>
          {errors.conditions && <span className="field-error">{errors.conditions}</span>}
        </div>
      </div>

      <div className="popover-actions">
        <button type="button" className="ghost-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit">{submitLabel}</button>
      </div>

      {whip.overlay}
    </form>
  );
}

export default StreakForm;
