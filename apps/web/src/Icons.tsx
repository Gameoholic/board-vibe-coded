interface IconProps {
  size?: number;
}

export function TrashIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M2.5 4h11M6 4V2.75A.75.75 0 0 1 6.75 2h2.5a.75.75 0 0 1 .75.75V4m2 0-.6 9a1 1 0 0 1-1 .93H5.35a1 1 0 0 1-1-.93L3.75 4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6.4 7v4.2M9.6 7v4.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function BoardIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function GearIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M6.7 1.6h2.6l.4 1.7a5 5 0 0 1 1.3.75l1.65-.55 1.3 2.25-1.25 1.15a5 5 0 0 1 0 1.5l1.25 1.15-1.3 2.25-1.65-.55a5 5 0 0 1-1.3.75l-.4 1.7H6.7l-.4-1.7a5 5 0 0 1-1.3-.75l-1.65.55-1.3-2.25 1.25-1.15a5 5 0 0 1 0-1.5L2.05 5.75l1.3-2.25L5 4.05a5 5 0 0 1 1.3-.75l.4-1.7Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function BagIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M3.5 5h9l-.7 8.2a1 1 0 0 1-1 .8H5.2a1 1 0 0 1-1-.8L3.5 5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5.8 5V4a2.2 2.2 0 0 1 4.4 0v1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function SortIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M4.5 3v10M4.5 3 2.5 5M4.5 3l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.5 13V3M11.5 13l2-2M11.5 13l-2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// An eye — signifies "what's shown" for the per-tab Display toggles.
export function EyeIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function CheckIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M3 8.5 6.2 12 13 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ZapIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M8.5 2 3.5 9h3.5l-1 5 5-7H7.5l1-5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function PinIcon({ size = 13, filled = false }: IconProps & { filled?: boolean }) {
  // A push-pin (thumbtack): filled when the sort is pinned to the top of the menu, outline when not.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 17v5" />
      <path
        d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"
        fill={filled ? "currentColor" : "none"}
      />
    </svg>
  );
}

export function ChevronDownIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SparkleIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M8 2.2c.35 2.2 1.15 3 3.35 3.35-2.2.35-3 1.15-3.35 3.35-.35-2.2-1.15-3-3.35-3.35C6.85 5.2 7.65 4.4 8 2.2Z"
        fill="currentColor"
      />
      <path
        d="M12.6 9.2c.2 1.25.65 1.7 1.9 1.9-1.25.2-1.7.65-1.9 1.9-.2-1.25-.65-1.7-1.9-1.9 1.25-.2 1.7-.65 1.9-1.9Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ArrowUpIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 13V3M8 3 4 7M8 3l4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowDownIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 3v10M8 13l-4-4M8 13l4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Reroll: two arrows chasing round.
export function RerollIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 6.5A5 5 0 0 0 4 4.2L2.8 5.4" />
      <path d="M2.8 2.6v2.8h2.8" />
      <path d="M3 9.5a5 5 0 0 0 9 2.3l1.2-1.2" />
      <path d="M13.2 13.4v-2.8h-2.8" />
    </svg>
  );
}

export function CircleIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function CircleCheckIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.6 8.2 7.2 9.8 10.4 6.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FlameIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M8 1.5s3.5 2.7 3.5 6.2A3.5 3.5 0 0 1 8 11.2 3.5 3.5 0 0 1 4.5 7.7c0-1.3.6-2.3.6-2.3s.4 1 1.2 1.3c0-1.8 1.7-3.5 1.7-5.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function PencilIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M11.5 2.5 13.5 4.5 5.5 12.5 3 13l.5-2.5 8-8Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Two stacked sheets — "Duplicate" in a row's actions menu.
export function CopyIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10.5 3.5v-.5A1 1 0 0 0 9.5 2H3.5A1.5 1.5 0 0 0 2 3.5v6a1 1 0 0 0 1 1h.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// Scissors — "Prune": snip a daily/weekly task out of this cycle (its menu action and Display toggle).
export function ScissorsIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="4" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="11.5" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.7 5.6 13.5 12.5M5.7 10.4 13.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// A left-bracket [ shape — the drag-to-group handle affordance on ungrouped task rows.
export function GroupBracketIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 16" fill="none">
      <path
        d="M7.5 2H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h2.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Two boxes pulling apart — "ungroup": the group splits back into separate tasks (nothing deleted).
export function UngroupIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="4.5" width="5" height="7" rx="1.3" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9.5" y="4.5" width="5" height="7" rx="1.3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 8h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeDasharray="0.1 2.3" />
    </svg>
  );
}

export function LockIcon({ size = 10 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.3" fill="currentColor" />
      <path d="M5.3 7V5.2a2.7 2.7 0 0 1 5.4 0V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function TimerIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M6.2 1.6h3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M8 3.4v1.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="8" cy="9" r="5.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 6v3l2.2 1.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// An hourglass — used for the "time estimate" feature, kept visually distinct from the stopwatch
// TimerIcon (the live timer) so the two Display toggles don't read as the same thing.
export function HourglassIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M4 2h8M4 14h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M4.5 2.5 8 8 4.5 13.5M11.5 2.5 8 8 11.5 13.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlusIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// A reticle with a lead — the pick-whip handle (drag a line onto a task to link it).
export function PickWhipIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="6" cy="6" r="1.4" fill="currentColor" />
      <path d="M9 9 L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// The three Status bands: a half-filled circle (under way), a dashed one (not started), a barred one
// (can't go on). Also the Status Display toggle's icon (the half circle).
export function InProgressIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 4.5a3.5 3.5 0 0 1 0 7Z" fill="currentColor" />
    </svg>
  );
}

export function BacklogIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.2 1.9" />
    </svg>
  );
}

export function BlockedIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.2 11.8 11.8 4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

// A line with pieces hanging off it — "Break down": split a task into the pieces inside it.
export function BreakDownIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M2.5 3.5h11M4.5 3.5V12M4.5 7.5h2.5M4.5 12h2.5M9.5 7.5h4M9.5 12h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

// Outdent — "Make it its own task": a piece steps out of its task into the list.
export function OutdentIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M7 4h6.5M7 8h6.5M7 12h6.5M4.5 5.5 2.5 8l2 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
