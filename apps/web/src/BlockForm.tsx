import { useState } from "react";
import Form from "./Form";
import { PickWhipIcon } from "./Icons";
import { usePickWhip, type WhipTarget } from "./pickWhip";
import { behaviorOf } from "./types";
import type { Task } from "./types";

// Why a task is blocked: a short note ("the insurance letter"), the task it's waiting on — linked with
// the pick-whip the streak form uses, and released by itself once that task is done — or both. Neither
// is required. The form body only; the row wraps it in its Popover, like the edit form.

export interface BlockReason {
  note?: string;
  taskId?: string;
}

interface BlockFormProps {
  task: Task; // the task being blocked
  allTasks: Task[];
  accentColor: string; // its tab's colour, for the linked task's dot (as in the streak form)
  initial?: BlockReason;
  submitLabel: string;
  onSubmit: (why: BlockReason) => void;
  onCancel: () => void;
}

export default function BlockForm({ task, allTasks, accentColor, initial, submitLabel, onSubmit, onCancel }: BlockFormProps) {
  const [note, setNote] = useState(initial?.note ?? "");
  const [waitsOn, setWaitsOn] = useState<string | undefined>(initial?.taskId);
  const waitsOnName = waitsOn ? allTasks.find((t) => t.id === waitsOn)?.text ?? "(deleted task)" : null;

  // Any other task that isn't done yet — a done one has nothing left to wait for.
  function resolve(x: number, y: number): WhipTarget | null {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-task-id]");
    const target = row ? allTasks.find((t) => t.id === row.dataset.taskId) : undefined;
    if (!row || !target || target.id === task.id || behaviorOf(target).isDone(target)) return null;
    const land = (row.querySelector<HTMLElement>('input[type="checkbox"], .tier-dot, .counter-box') ?? row).getBoundingClientRect();
    return { id: target.id, cx: land.left + land.width / 2, cy: land.top + land.height / 2, dupe: target.id === waitsOn };
  }
  const whip = usePickWhip(resolve, (target) => setWaitsOn(target.id));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = note.trim();
    onSubmit({ ...(trimmed ? { note: trimmed } : {}), ...(waitsOn ? { taskId: waitsOn } : {}) });
  }

  return (
    <Form className="popover-form" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field-label">Waiting on</span>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. the insurance letter"
          maxLength={200}
          autoComplete="off"
          autoFocus
        />
      </label>

      <div className="field">
        <span className="field-label">Or a task</span>
        {waitsOnName ? (
          <div className="cond-row" style={{ "--cond-color": accentColor } as React.CSSProperties}>
            <span className="cond-dot" />
            <span className="cond-name">{waitsOnName}</span>
            <button type="button" className="cond-remove" aria-label="Unlink the task" onClick={() => setWaitsOn(undefined)}>
              ✕
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className={`whip-handle${whip.dragging ? " dragging" : ""}`}
          onPointerDown={whip.start}
        >
          <PickWhipIcon />
          <span>{waitsOnName ? "Drag to link a different task" : "Drag onto the task it's waiting on"}</span>
        </button>
        <span className="field-hint">It unblocks by itself when that task is done.</span>
      </div>

      <div className="popover-actions">
        <button type="button" className="ghost-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit">{submitLabel}</button>
      </div>

      {whip.overlay}
    </Form>
  );
}
