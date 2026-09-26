import { motion } from "framer-motion";
import PointsBracket from "./PointsBracket";
import type { PeriodKind, PeriodRecap } from "./types";

// Turn a period key ("2026-09-24" or a week's anchor date) into a friendly label. A bare date string
// is parsed as UTC midnight; we format in UTC so it reads as the intended calendar day everywhere.
function labelFor(kind: PeriodKind, periodKey: string): string {
  const d = new Date(`${periodKey}T00:00:00Z`);
  const date = d.toLocaleDateString(undefined, { day: "numeric", month: "long", timeZone: "UTC" });
  return kind === "week" ? `the week of ${date}` : date;
}

interface PeriodPromptProps {
  kind: PeriodKind;
  periodKey: string;
  // True when no period was ever open (a fresh/reset board) — the copy becomes "start" rather than
  // "wrap up", since there's no previous period to close or recap.
  isFirst: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

// The prompt shown on load when a day/week has rolled over: a large centred card over a soft scrim
// covering the board. Confirm it ended so its streaks settle, or defer — deferring only suppresses it
// for this session (App re-checks on next load). Clicking the scrim is the same as "Not yet".
export function PeriodPrompt({ kind, periodKey, isFirst, onConfirm, onDismiss }: PeriodPromptProps) {
  return (
    <div className="period-prompt-scrim" onClick={onDismiss}>
      <motion.div
        className="period-prompt-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
      >
        <span className="period-prompt-kicker">{isFirst ? `First ${kind}` : `New ${kind}`}</span>
        <h2 className="period-prompt-q">
          {isFirst ? `Start your first ${kind}?` : `Has a new ${kind} started?`}
        </h2>
        <p className="period-prompt-sub">
          {isFirst ? (
            <>
              Begin tracking <strong>{labelFor(kind, periodKey)}</strong>.
            </>
          ) : (
            <>
              Wrap up <strong>{labelFor(kind, periodKey)}</strong> to lock in your streaks and see its
              recap.
            </>
          )}
        </p>
        <div className="period-prompt-actions">
          <button type="button" className="ghost-btn" onClick={onDismiss}>
            Not yet
          </button>
          <button type="button" className="btn-primary" onClick={onConfirm}>
            {isFirst ? `Start ${kind}` : "Yes, close it"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

interface PeriodRecapCardProps {
  recap: PeriodRecap;
  onClose: () => void;
}

// The recap of the just-closed period — what got done and what it was worth. A floating card over a
// soft (never fully dark) scrim, dismissable, in keeping with the no-heavy-modal rule.
export function PeriodRecapCard({ recap, onClose }: PeriodRecapCardProps) {
  return (
    <div className="recap-scrim" onClick={onClose}>
      <motion.div
        className="recap-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
      >
        <div className="recap-head">
          <span className="recap-kicker">{recap.kind === "week" ? "Week" : "Day"} recap</span>
          <span className="recap-date">{labelFor(recap.kind, recap.periodKey)}</span>
        </div>

        {recap.items.length === 0 ? (
          <p className="recap-empty">Nothing logged this {recap.kind}.</p>
        ) : (
          <ul className="recap-list">
            {recap.items.map((item) => (
              <li key={item.taskId} className="recap-row">
                <span className="points-prefix">
                  <PointsBracket percents={[item.points]} />
                </span>
                <span className="recap-name">
                  {item.text}
                  {item.level > 1 && <span className="recap-mult"> ×{item.level}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="recap-foot">
          <span className="recap-total">
            <PointsBracket percents={[recap.totalPoints]} />
          </span>
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </motion.div>
    </div>
  );
}
