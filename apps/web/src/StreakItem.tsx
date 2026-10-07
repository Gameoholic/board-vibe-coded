import { useRef, useState } from "react";
import { FlameIcon } from "./Icons";
import ItemRow, { RowRemove, type RowContext } from "./ItemRow";
import { deleteAction, editAction } from "./rowActions";
import Popover from "./Popover";
import StreakForm, { type StreakPayload } from "./StreakForm";
import Tooltip from "./Tooltip";
import { useClickOutside } from "./useClickOutside";
import type { Section, StreakView, Task } from "./types";

interface StreakItemProps {
  streak: StreakView;
  allTasks: Task[];
  allSections: Section[];
  sectionColor: string;
  // This row's place in its list (drag / group handles) — from ItemList, via the shared ItemRow base
  // (the same one TaskItem and RewardItem render on, so drag/reorder/grouping is one implementation).
  row: RowContext;
  onEdit: (payload: StreakPayload) => void;
  onRemove: (id: string) => void;
}

function StreakItem({ streak, allTasks, allSections, sectionColor, row, onEdit, onRemove }: StreakItemProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);
  useClickOutside(editRef, () => setEditOpen(false), editOpen);

  // A count of 0 reads as inactive; a positive count that isn't satisfied this period is a grace
  // day (dimmed, not broken); a satisfied current period is fully lit.
  const flameState = streak.count === 0 ? "cold" : streak.active ? "lit" : "grace";
  const hasBest = streak.type !== "counter";

  return (
    <ItemRow
      value={streak}
      id={streak.id}
      row={row}
      className="streak-item"
      actions={[[editAction(() => setEditOpen(true))], [deleteAction(() => setRemoving(true))]]}
    >
      <span className={`streak-flame ${flameState}`} style={{ "--streak-color": sectionColor } as React.CSSProperties}>
        <FlameIcon size={16} />
        <span className="streak-count">{streak.count}</span>
      </span>

      {/* Personal-best (longest run ever) — only daily/weekly have a consecutive-run notion. Always
          rendered (empty for a counter) so it keeps its own column, like every other row's fixed-
          position value slot (points-prefix, price pill). */}
      <Tooltip className={`streak-best${hasBest ? "" : " empty"}`} label={hasBest ? "Best run so far" : undefined}>
        {hasBest && (
          <>
            <span className="streak-best-label">best</span>
            {streak.best}
          </>
        )}
      </Tooltip>

      <div className="streak-main">
        <span className="streak-name">{streak.name}</span>
      </div>

      <RowRemove
        label="Remove streak"
        message="Delete this streak?"
        confirming={removing}
        onConfirmingChange={setRemoving}
        onConfirm={() => onRemove(streak.id)}
      />

      {/* Zero-size, right-edge-anchored like every other row's edit popover (row-edit-anchor) so it
          doesn't take a subgrid column of its own. */}
      <div className="popover-anchor row-edit-anchor" ref={editRef}>
        <Popover title="Edit streak" open={editOpen} onClose={() => setEditOpen(false)} align="right" width={300} scrollable>
          <StreakForm
            allTasks={allTasks}
            allSections={allSections}
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
    </ItemRow>
  );
}

export default StreakItem;
