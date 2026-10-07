import { AnimatePresence, Reorder } from "framer-motion";
import { useCallback, useRef, useState } from "react";
import type { FlyOrigin } from "./FlyingPoints";
import { ChevronDownIcon, PickWhipIcon } from "./Icons";
import type { RowContext } from "./ItemRow";
import PointsBracket from "./PointsBracket";
import Tooltip from "./Tooltip";
import { usePickWhip, type WhipTarget } from "./pickWhip";
import { behaviorOf, newPiecePoints, statusOf } from "./types";
import type { AppliedModifier } from "./types";
import type { Task } from "./types";
import { useClickOutside } from "./useClickOutside";

// Break down, as a task row shows it: a strip of boxes (one per piece) beside the name and its next step
// under it ("2 of 4 · Next: Book the technician"), its pieces under that — real task rows, reorderable
// among themselves — and, while it's being broken down, the type-a-piece entry. The rules (what pieces
// are worth, when the task is done) live in the contract (pieces.ts); this is only how they look.

type SetLevel = (task: Task, level: number, origin?: FlyOrigin) => void;

export interface RowPieces {
  items: Task[]; // its pieces, in order (none ≡ not broken down yet)
  open: boolean; // its pieces shown, or folded away to the summary line
  onToggle: () => void;
  // A piece's row (a TaskItem). A piece's tick goes through `onSetLevel`, so the task can see the tick
  // that finishes it.
  render: (piece: Task, row: RowContext, onSetLevel: SetLevel) => React.ReactNode;
  onReorder: (orderedIds: string[]) => void;
  onBreakDown: (texts: string[]) => void;
  onTuck: (taskId: string) => void;
  allTasks: Task[]; // what the entry's pick-whip may tuck in
  // What a piece of it would be paid at (its task's Bounty pays its pieces) — for the pieces still being typed.
  modifiersOf: (piece: Task) => AppliedModifier[];
}

const isDone = (t: Task) => behaviorOf(t).isDone(t);
const isBlocked = (t: Task) => statusOf(t) === "blocked";

/** The strip of boxes beside a broken-down task's name: one per piece, filled once it's done. */
export function PieceStrip({ pieces, color }: { pieces: Task[]; color: string }) {
  return (
    <span className="piece-strip" style={{ "--task-color": color } as React.CSSProperties} aria-hidden="true">
      {pieces.map((p) => (
        <span key={p.id} className={`piece-box${isDone(p) ? " on" : ""}`} />
      ))}
    </span>
  );
}

/** How far along a broken-down task is and what's next — the next open piece that isn't blocked — with a
 *  mark for blocked pieces. It folds the pieces away and back. */
export function PiecesSummary({ pieces, open, onToggle }: Pick<RowPieces, "open" | "onToggle"> & { pieces: Task[] }) {
  const left = pieces.filter((p) => !isDone(p));
  const next = left.find((p) => !isBlocked(p));
  const blocked = left.filter(isBlocked).length;
  return (
    <button type="button" className={`pieces-summary${open ? " open" : ""}`} aria-expanded={open} onClick={onToggle}>
      <ChevronDownIcon size={11} />
      <span>
        {pieces.length - left.length} of {pieces.length}
        {next && (
          <>
            {" · Next: "}
            <b>{next.text}</b>
          </>
        )}
        {blocked > 0 && <span className="pieces-blocked"> · {blocked} blocked</span>}
      </span>
    </button>
  );
}

interface PieceListProps {
  task: Task;
  color: string; // its tab's colour, for the entry
  pieces: RowPieces;
  onSetLevel: SetLevel;
  breakingDown: boolean;
  onBreakingDownChange: (open: boolean) => void;
}

/** Under a task: its pieces (while open) and the Break down entry (while breaking it down). */
export function PieceList({ task, color, pieces, onSetLevel, breakingDown, onBreakingDownChange }: PieceListProps) {
  const shown = pieces.open && pieces.items.length > 0;
  if (!shown && !breakingDown) return null;
  return (
    <div className="task-pieces" style={{ "--task-color": color } as React.CSSProperties}>
      {shown && (
        <Reorder.Group
          as="ul"
          axis="y"
          values={pieces.items}
          onReorder={(items: Task[]) => pieces.onReorder(items.map((p) => p.id))}
          className="piece-list"
        >
          <AnimatePresence initial={false}>
            {pieces.items.map((piece) => pieces.render(piece, { draggable: true, noun: "pieces" }, onSetLevel))}
          </AnimatePresence>
        </Reorder.Group>
      )}
      {breakingDown && (
        <BreakDownEntry
          task={task}
          pieces={pieces}
          onDone={(texts) => {
            if (texts.length > 0) pieces.onBreakDown(texts);
            onBreakingDownChange(false);
          }}
        />
      )}
    </div>
  );
}

interface BreakDownEntryProps {
  task: Task;
  pieces: RowPieces;
  onDone: (texts: string[]) => void;
}

// Type a piece, Enter, the next one; Esc (or Enter on an empty line, or a click elsewhere) when done. The
// typed pieces wait here, each showing what it'll be worth, and are created together when it's done —
// what they're worth depends on how many there are. Or drag the whip onto a task to tuck it in as it is.
function BreakDownEntry({ task, pieces, onDone }: BreakDownEntryProps) {
  const [drafts, setDrafts] = useState<string[]>([]);
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const finish = useCallback(() => onDone(drafts), [onDone, drafts]);
  useClickOutside(ref, finish, true);
  const worth = drafts.length > 0 ? newPiecePoints(task, pieces.items, drafts.length) : [];
  // What a piece will be paid at (a Bounty's pieces at its multiplier) — shown on the drafts too.
  const draftModifiers = pieces.modifiersOf({ ...task, id: "draft", parentId: task.id, bounty: undefined, frostDays: undefined });

  // Another one-time task of this tab that holds no pieces of its own (pieces go one level deep).
  function resolve(x: number, y: number): WhipTarget | null {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-task-id]");
    const target = row ? pieces.allTasks.find((t) => t.id === row.dataset.taskId) : undefined;
    const tuckable =
      target &&
      target.id !== task.id &&
      target.parentId !== task.id &&
      target.sectionId === task.sectionId &&
      behaviorOf(target).breaksDown &&
      !pieces.allTasks.some((t) => t.parentId === target.id);
    if (!row || !target || !tuckable) return null;
    const land = (row.querySelector<HTMLElement>('input[type="checkbox"]') ?? row).getBoundingClientRect();
    return { id: target.id, cx: land.left + land.width / 2, cy: land.top + land.height / 2 };
  }
  const whip = usePickWhip(resolve, (target) => pieces.onTuck(target.id));

  return (
    <div className="break-down" ref={ref}>
      {drafts.length > 0 && (
        <ul className="break-down-drafts">
          {drafts.map((draft, i) => (
            <li key={i}>
              <span className="break-down-box" />
              <span className="points-prefix">
                <PointsBracket percents={[worth[i]]} modifiers={draftModifiers} />
              </span>
              <span className="break-down-name">{draft}</span>
            </li>
          ))}
        </ul>
      )}
      <label className="break-down-input">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const piece = text.trim();
              if (!piece) return finish();
              setDrafts((prev) => [...prev, piece]);
              setText("");
            } else if (e.key === "Escape") {
              e.preventDefault();
              finish();
            }
          }}
          placeholder={pieces.items.length + drafts.length > 0 ? "Another piece" : "First piece"}
          aria-label={`Break down “${task.text}”: type a piece and press Enter`}
          maxLength={500}
          autoComplete="off"
          autoFocus
        />
        <kbd>Enter</kbd>
      </label>
      <div className="break-down-foot">
        <Tooltip label="Drag onto a task to tuck it in as a piece" align="start">
          <button type="button" className={`whip-handle${whip.dragging ? " dragging" : ""}`} onPointerDown={whip.start}>
            <PickWhipIcon size={14} />
            <span>Tuck a task in</span>
          </button>
        </Tooltip>
        <span>Esc when done</span>
      </div>
      {whip.overlay}
    </div>
  );
}
