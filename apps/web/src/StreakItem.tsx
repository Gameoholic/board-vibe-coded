import { Reorder, useDragControls } from "framer-motion";
import { useRef, useState } from "react";
import ConfirmPopover from "./ConfirmPopover";
import { FlameIcon, TrashIcon } from "./Icons";
import Popover from "./Popover";
import StreakForm, { type StreakPayload } from "./StreakForm";
import { useClickOutside } from "./useClickOutside";
import type { StreakView, Task } from "./types";

interface StreakItemProps {
  streak: StreakView;
  allTasks: Task[];
  sectionColor: string;
  draggable: boolean;
  onEdit: (payload: StreakPayload) => void;
  onRemove: (id: string) => void;
}

const itemMotionProps = {
  initial: { opacity: 0, scale: 0.92, y: -6 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.9, x: -16, rotate: -2 },
  transition: {
    layout: { type: "spring" as const, stiffness: 700, damping: 45 },
    default: { type: "spring" as const, stiffness: 500, damping: 34 },
  },
  whileDrag: { scale: 1.03, boxShadow: "0 12px 28px rgba(15,23,42,0.16)", zIndex: 5 },
  dragMomentum: false,
};

function StreakItem({ streak, allTasks, sectionColor, draggable, onEdit, onRemove }: StreakItemProps) {
  const controls = useDragControls();
  const [confirming, setConfirming] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);
  useClickOutside(editRef, () => setEditOpen(false), editOpen);

  // A count of 0 reads as inactive; a positive count that isn't satisfied this period is a grace
  // day (dimmed, not broken); a satisfied current period is fully lit.
  const flameState = streak.count === 0 ? "cold" : streak.active ? "lit" : "grace";

  return (
    <Reorder.Item
      value={streak}
      dragListener={false}
      dragControls={controls}
      as="li"
      className="streak-item"
      onContextMenu={(e) => { e.preventDefault(); setEditOpen((v) => !v); }}
      {...itemMotionProps}
    >
      <span className={`drag-handle${draggable ? "" : " disabled"}`} onPointerDown={(e) => draggable && controls.start(e)}>
        ⠿
      </span>

      <span className={`streak-flame ${flameState}`} style={{ "--streak-color": sectionColor } as React.CSSProperties}>
        <FlameIcon size={16} />
        <span className="streak-count">{streak.count}</span>
      </span>

      <div className="streak-main">
        <span className="streak-name">{streak.name}</span>
      </div>

      {/* Personal-best (longest run ever). Only daily/weekly have a consecutive-run notion. */}
      {streak.type !== "counter" && (
        <span className="streak-best" title="Best run so far">
          <span className="streak-best-label">best</span>
          {streak.best}
        </span>
      )}

      <div className="popover-anchor streak-edit-anchor" ref={editRef}>
        <Popover title="Edit streak" open={editOpen} onClose={() => setEditOpen(false)} align="right" width={300} scrollable>
          <StreakForm
            allTasks={allTasks}
            accentColor={sectionColor}
            initial={{
              name: streak.name,
              type: streak.type,
              mode: streak.mode,
              since: streak.since,
              matcher: streak.matcher,
            }}
            submitLabel="Save"
            onSubmit={(payload) => {
              onEdit(payload);
              setEditOpen(false);
            }}
            onCancel={() => setEditOpen(false)}
          />
        </Popover>
      </div>

      <div className="remove-wrap">
        <button type="button" className="remove" aria-label="Remove streak" onClick={() => setConfirming(true)}>
          <TrashIcon />
        </button>
        <ConfirmPopover
          open={confirming}
          message="Delete this streak?"
          onConfirm={() => onRemove(streak.id)}
          onCancel={() => setConfirming(false)}
        />
      </div>
    </Reorder.Item>
  );
}

export default StreakItem;
