import { STATUS_BANDS } from "./taskStatus";
import type { TaskStatus } from "./types";

// A task row's Status at a glance, shown on hover: the three bands' icons side by side, the current one
// filled in the tab's colour, each named in a hover bubble (the tier-dot label style). Icons, not words,
// so it stays small enough not to hide the task's name in a narrow tab. One click moves the task
// (Blocked asks why first — the row opens its form).

interface StatusPillProps {
  status: TaskStatus;
  onPick: (status: TaskStatus) => void;
}

export default function StatusPill({ status, onPick }: StatusPillProps) {
  return (
    <div className="status-pill" role="group" aria-label="Status">
      {STATUS_BANDS.map((band) => (
        <button
          key={band.status}
          type="button"
          className={band.status === status ? "on" : undefined}
          aria-label={band.label}
          aria-pressed={band.status === status}
          data-label={band.label}
          onClick={() => onPick(band.status)}
        >
          <band.icon size={13} />
        </button>
      ))}
    </div>
  );
}
