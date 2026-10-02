import { formatPercent } from "@board/contracts";
import type { FormulaChangeItem, FormulaPreview, Section, Task } from "./types";

// Confirm dialog for a points-formula change (over the app's soft scrim, not a heavy modal). Says what
// saving does, lists every price that would move (old → new, grouped by tab), and offers three choices:
// reprice them now, save the formula for new tasks only, or cancel the change entirely.
interface RebalanceConfirmProps {
  preview: FormulaPreview;
  // The board's tabs and tasks, to group the preview the way the board reads.
  sections: Section[];
  tasks: Task[];
  onYes: () => void;
  onNo: () => void;
  onCancel: () => void;
}

// The moving prices by tab, in the board's tab order; tabs with none are left out.
function byTab(items: FormulaChangeItem[], sections: Section[], tasks: Task[]) {
  const sectionOf = new Map(tasks.map((t) => [t.id, t.sectionId]));
  return sections
    .map((section) => ({ section, items: items.filter((it) => sectionOf.get(it.taskId) === section.id) }))
    .filter((group) => group.items.length > 0);
}

function RebalanceConfirm({ preview, sections, tasks, onYes, onNo, onCancel }: RebalanceConfirmProps) {
  const { willUpdate, wontUpdateCount } = preview;
  const moving = willUpdate.length;
  return (
    <div className="recap-scrim" onClick={onCancel}>
      <div className="rebalance-card" onClick={(e) => e.stopPropagation()}>
        <div className="recap-head">
          <span className="recap-kicker">Points</span>
          <span className="recap-date">Reprice your tasks?</span>
        </div>

        <p className="settings-note">
          Every task you add from now on is priced this way.{" "}
          {moving === 0 ? (
            "None of your current prices change."
          ) : moving === 1 ? (
            "The price below came from its task's time, so it can be repriced too."
          ) : (
            <>
              The <strong>{moving}</strong> prices below came from their task's time, so they can be repriced too.
            </>
          )}
          {wontUpdateCount > 0 && (
            <>
              {" "}
              <strong>{wontUpdateCount}</strong> {wontUpdateCount === 1 ? "keeps its" : "keep their"} % either way: a %
              you typed, or no time set.
            </>
          )}{" "}
          Points you've already earned never change.
        </p>

        {moving > 0 && (
          <ul className="rebalance-list">
            {byTab(willUpdate, sections, tasks).map(({ section, items }) => (
              <li className="rebalance-group" key={section.id}>
                <span className="rebalance-tab">{section.name}</span>
                <ul>
                  {items.map((it) => (
                    <li className="rebalance-row" key={`${it.taskId}:${it.tierIndex ?? "c"}`}>
                      <span className="rebalance-name">
                        {it.text}
                        {it.tierLabel && <span className="rebalance-tier"> · {it.tierLabel}</span>}
                      </span>
                      <span className={it.newPoints > it.oldPoints ? "rebalance-change up" : "rebalance-change down"}>
                        <span className="rebalance-old">{formatPercent(it.oldPoints)} →</span> {formatPercent(it.newPoints)}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <div className="rebalance-actions">
          <button type="button" className="ghost-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ghost-btn" onClick={onNo}>
            Only new tasks
          </button>
          <button type="button" className="btn-primary" onClick={onYes} disabled={moving === 0}>
            Reprice {moving}
          </button>
        </div>
      </div>
    </div>
  );
}

export default RebalanceConfirm;
