import { motion } from "framer-motion";
import { labelFor } from "./periodLabels";

interface PeriodPromptProps {
  dayKey: string;
  // True when no day was ever open (a fresh/reset board) — it offers to start one instead, since there's
  // nothing to end.
  isFirst: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

// The prompt shown on load once a day has rolled over: a large centred card over a soft scrim covering
// the board. It asks one plain question — has it ended? — and "Yes, end it" ends it (and its week, when
// that's over too — never asked about on its own); or defer — deferring only suppresses it for this
// session (App re-checks on next load). Clicking the scrim is the same as "Not yet".
export function PeriodPrompt({ dayKey, isFirst, onConfirm, onDismiss }: PeriodPromptProps) {
  const label = labelFor("day", dayKey);
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
        <span className="period-prompt-kicker">{isFirst ? "First day" : "End of the day"}</span>
        {isFirst ? (
          <>
            <h2 className="period-prompt-q">Start your first day?</h2>
            <p className="period-prompt-sub">
              <strong>{label}</strong>
            </p>
          </>
        ) : (
          <h2 className="period-prompt-q">Has {label} ended?</h2>
        )}
        <div className="period-prompt-actions">
          <button type="button" className="ghost-btn" onClick={onDismiss}>
            Not yet
          </button>
          <button type="button" className="btn-primary" onClick={onConfirm}>
            {isFirst ? "Start day" : "Yes, end it"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
