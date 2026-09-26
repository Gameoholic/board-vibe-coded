import type { FormulaPreview } from "./types";

// Confirm dialog for a points-formula change (over the app's soft scrim, not a heavy modal). Shows how
// many builder values will move and how many won't (no estimate / manually overridden), a scrollable
// old→new list, and three choices: rebalance now (Yes), save the formula for future tasks only (No),
// or cancel the change entirely.
interface RebalanceConfirmProps {
  preview: FormulaPreview;
  onYes: () => void;
  onNo: () => void;
  onCancel: () => void;
}

const pct = (thousandths: number) => `${thousandths / 1000}%`;

function RebalanceConfirm({ preview, onYes, onNo, onCancel }: RebalanceConfirmProps) {
  const { willUpdate, wontUpdateCount } = preview;
  return (
    <div className="recap-scrim" onClick={onCancel}>
      <div className="rebalance-card" onClick={(e) => e.stopPropagation()}>
        <div className="recap-head">
          <span className="recap-kicker">Points formula</span>
          <span className="recap-date">Update existing tasks?</span>
        </div>

        <p className="settings-note">
          <strong>{willUpdate.length}</strong> {willUpdate.length === 1 ? "value" : "values"} came from the
          builder and will be recomputed to the new formula. <strong>{wontUpdateCount}</strong> will stay
          as {wontUpdateCount === 1 ? "it is" : "they are"} (no time estimate, or the % was set by hand).
        </p>

        {willUpdate.length > 0 && (
          <ul className="rebalance-list">
            {willUpdate.map((it) => (
              <li className="rebalance-row" key={`${it.taskId}:${it.tierIndex ?? "c"}`}>
                <span className="rebalance-name">
                  {it.text}
                  {it.tierLabel && <span className="rebalance-tier"> · {it.tierLabel}</span>}
                </span>
                <span className="rebalance-change">
                  {pct(it.oldPoints)} <span className="rebalance-arrow">→</span> {pct(it.newPoints)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="rebalance-actions">
          <button type="button" className="ghost-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ghost-btn" onClick={onNo}>
            No, future tasks only
          </button>
          <button type="button" className="btn-primary" onClick={onYes} disabled={willUpdate.length === 0}>
            Yes, update {willUpdate.length}
          </button>
        </div>
      </div>
    </div>
  );
}

export default RebalanceConfirm;
