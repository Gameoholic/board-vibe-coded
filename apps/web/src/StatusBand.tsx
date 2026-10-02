import { ChevronDownIcon } from "./Icons";
import type { TaskStatus } from "./types";

// One band of a task tab's Status view (In progress / Backlog / Blocked, plus the Completed look-back):
// its header with a count, an optional line under it, and its list. Blocked folds to its header. A band
// is also somewhere a row can be dragged to from another band (data-band, hit-tested by the tab).

interface StatusBandProps {
  tabId: string;
  // The band's status, or "done" for finished tasks shown by the Completed look-back (not a drop target).
  band: TaskStatus | "done";
  label: string;
  count: number;
  fold?: { open: boolean; onToggle: () => void };
  hint?: string;
  children: React.ReactNode;
}

export default function StatusBand({ tabId, band, label, count, fold, hint, children }: StatusBandProps) {
  const heading = (
    <>
      <span>{label}</span>
      <span className="status-band-count">{count}</span>
    </>
  );
  const dropTarget = band === "done" ? {} : { "data-band": band, "data-band-tab": tabId };
  return (
    <section className={`status-band band-${band}`} {...dropTarget}>
      {fold ? (
        <button
          type="button"
          className={`status-band-head status-band-fold${fold.open ? " open" : ""}`}
          aria-expanded={fold.open}
          onClick={fold.onToggle}
        >
          <ChevronDownIcon size={12} />
          {heading}
        </button>
      ) : (
        <div className="status-band-head">{heading}</div>
      )}
      {hint && <p className="status-band-hint">{hint}</p>}
      {(!fold || fold.open) && children}
    </section>
  );
}
