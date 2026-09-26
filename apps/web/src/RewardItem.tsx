import { formatPercent, POINTS_PER_PERCENT } from "@board/contracts";
import { useRef, useState } from "react";
import ItemRow, { RowRemove, type RowContext } from "./ItemRow";
import Popover from "./Popover";
import type { Reward } from "./types";
import { useClickOutside } from "./useClickOutside";
import type { RewardInput } from "./useShop";

// One reward in a shop tab, on the shared row base (ItemRow — move/group handles, reorder, grouping).
// Its cells sit in the same four list columns a task row uses — [emoji] [price] [name] [remove] —
// and it edits the same way (right-click opens the edit popover), so shop rows read and behave like
// board rows. The price tag is the buy button, in the tab's colour (a task's checkbox counterpart).

interface RewardItemProps {
  reward: Reward;
  color: string;
  row: RowContext;
  affordable: boolean;
  showNote: boolean;
  showBought: boolean;
  onBuy: () => void;
  onEdit: (input: RewardInput) => void;
  onRemove: () => void;
}

function RewardItem({ reward, color, row, affordable, showNote, showBought, onBuy, onEdit, onRemove }: RewardItemProps) {
  const [editOpen, setEditOpen] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);
  useClickOutside(editRef, () => setEditOpen(false), editOpen);

  return (
    <ItemRow
      value={reward}
      id={reward.id}
      row={row}
      className="reward-item"
      onContextMenu={(e) => {
        e.preventDefault();
        setEditOpen((v) => !v);
      }}
    >
      <span className="reward-emoji" aria-hidden="true">
        {reward.emoji}
      </span>
      <button
        type="button"
        className="shop-buy"
        style={{ "--task-color": color } as React.CSSProperties}
        disabled={!affordable}
        aria-label={`Buy ${reward.name} for ${formatPercent(reward.cost)}`}
        onClick={onBuy}
      >
        {formatPercent(reward.cost)}
      </button>
      <div className="reward-main">
        <span className="reward-name">
          {reward.name}
          {showBought && reward.redeemed > 0 && <span className="reward-redeemed">×{reward.redeemed}</span>}
        </span>
        {showNote && reward.note && <span className="reward-note">{reward.note}</span>}
      </div>
      <RowRemove label="Remove reward" message={`Remove "${reward.name}"?`} onConfirm={onRemove} />
      <div className="popover-anchor row-edit-anchor" ref={editRef}>
        <Popover title="Edit reward" open={editOpen} onClose={() => setEditOpen(false)} align="right" width={280}>
          <RewardForm
            initial={reward}
            submitLabel="Save"
            onCancel={() => setEditOpen(false)}
            onSave={(input) => {
              onEdit(input);
              setEditOpen(false);
            }}
          />
        </Popover>
      </div>
    </ItemRow>
  );
}

// A reward's cost is stored, like all point values, as integer thousandths-of-a-percent (never
// floats — see @board/contracts points.ts). The form takes the percent the owner types ("2.5").
const toThousandths = (text: string): number => Math.round(parseFloat(text) * POINTS_PER_PERCENT);

// The add/edit form for one reward. Cost is a percent > 0 (down to a thousandth); name and cost gate
// the save.
export function RewardForm({
  initial,
  submitLabel,
  onSave,
  onCancel,
}: {
  initial?: RewardInput;
  submitLabel: string;
  onSave: (input: RewardInput) => void;
  onCancel: () => void;
}) {
  const [emoji, setEmoji] = useState(initial?.emoji ?? "🎁");
  const [name, setName] = useState(initial?.name ?? "");
  const [cost, setCost] = useState(initial ? String(initial.cost / POINTS_PER_PERCENT) : "");
  const [note, setNote] = useState(initial?.note ?? "");
  const costValue = toThousandths(cost);
  const valid = name.trim() !== "" && Number.isInteger(costValue) && costValue > 0;

  return (
    <form
      className="popover-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSave({ emoji: emoji.trim() || "🎁", name: name.trim(), cost: costValue, note: note.trim() || undefined });
      }}
    >
      <div className="field">
        <span className="field-label">Reward</span>
        <div className="reward-form-name">
          <input type="text" className="reward-form-emoji" value={emoji} maxLength={2} aria-label="Emoji" onChange={(e) => setEmoji(e.target.value)} />
          <input type="text" placeholder="Name" aria-label="Name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <label className="field">
        <span className="field-label">Cost</span>
        <div className="reward-form-cost">
          <input type="number" min={0} step="any" placeholder="0" value={cost} onChange={(e) => setCost(e.target.value)} />
          <span>%</span>
        </div>
      </label>
      <label className="field">
        <span className="field-label">Note (optional)</span>
        <textarea className="field-textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="popover-actions">
        <button type="button" className="ghost-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={!valid}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export default RewardItem;
