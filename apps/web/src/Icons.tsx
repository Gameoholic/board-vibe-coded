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

// The Freezer and frost: a six-armed snowflake. Also "Freeze" in a task's menu and frost's line.
export function SnowflakeIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5v13M2.4 4.75l11.2 6.5M2.4 11.25l11.2-6.5" />
      <path d="M6.3 2.6 8 4.1l1.7-1.5M6.3 13.4 8 11.9l1.7 1.5" />
    </svg>
  );
}

// A drop of meltwater — "Thaw": out of the Freezer and started.
export function ThawIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 2s4.2 4.6 4.2 7.7a4.2 4.2 0 0 1-8.4 0C3.8 6.6 8 2 8 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

// Cross-hairs on a mark — the Bounty's line.
export function TargetIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="8" cy="8" r="4.6" />
      <circle cx="8" cy="8" r="1.4" />
      <path d="M8 1.5v2.6M8 11.9v2.6M1.5 8h2.6M11.9 8h2.6" />
    </svg>
  );
}

// A cut crystal — Subzero's line.
export function CrystalIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="M4.8 2.5h6.4L14 6.2 8 13.8 2 6.2Z" />
      <path d="M2 6.2h12M8 13.8 5.8 6.2 7 2.5M8 13.8l2.2-7.6L9 2.5" />
    </svg>
  );
}

// Two chevrons climbing — the Booster's line, and the back of its cards.
export function BoostIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5 8 4l4.5 4.5M3.5 13 8 8.5l4.5 4.5" />
    </svg>
  );
}

// A price tag — the weekend sale's line.
export function TagIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="M2.5 3.3v4l6.2 6.2a1 1 0 0 0 1.4 0l3.4-3.4a1 1 0 0 0 0-1.4L7.3 2.5h-4a.8.8 0 0 0-.8.8Z" />
      <circle cx="5.3" cy="5.3" r="1" />
    </svg>
  );
}

// A bar part-filled — a meter, like frost's on a frozen task.
export function MeterIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <rect x="1.5" y="5.5" width="13" height="5" rx="2.5" />
      <path d="M4 8h4.5" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

// A dumbbell — how much a task takes out of you (its effort level).
export function DumbbellIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 8h5M1.75 6.5v3M14.25 6.5v3" />
      <rect x="3.25" y="4.25" width="2.25" height="7.5" rx="0.9" />
      <rect x="10.5" y="4.25" width="2.25" height="7.5" rx="0.9" />
    </svg>
  );
}

// A die — an Item reward in the shop.
export function DieIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.2" />
      <circle cx="5.6" cy="5.6" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10.4" cy="10.4" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

// A calendar page — the Age Display toggle (how long a task has waited).
export function AgeIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </svg>
  );
}

// A priority's arrows, stacked: three for High, two for Medium, one for Low. `feet` is where each arrow
// stands in the 16-unit box. Given a `color` (a theme token) it's drawn in it wherever it shows — a menu
// would otherwise dim it like any other icon; without one it takes the text's.
function StackedArrowsIcon({ size = 14, feet, color }: IconProps & { feet: readonly number[]; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={color ? { color } : undefined}>
      {feet.map((y) => (
        <path key={y} d={`M4 ${y}l4-3.5 4 3.5`} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

const ARROWS_HIGH = [6.5, 10, 13.5];
const ARROWS_MEDIUM = [8.25, 11.75];
const ARROWS_LOW = [10];

export function PriorityHighIcon({ size = 14 }: IconProps) {
  return <StackedArrowsIcon size={size} feet={ARROWS_HIGH} color="var(--pri-high)" />;
}

export function PriorityMediumIcon({ size = 14 }: IconProps) {
  return <StackedArrowsIcon size={size} feet={ARROWS_MEDIUM} color="var(--pri-med)" />;
}

export function PriorityLowIcon({ size = 14 }: IconProps) {
  return <StackedArrowsIcon size={size} feet={ARROWS_LOW} color="var(--pri-low)" />;
}

// Priority as a way to sort: the arrows, in no priority's colour.
export function PriorityIcon({ size = 14 }: IconProps) {
  return <StackedArrowsIcon size={size} feet={ARROWS_HIGH} />;
}

// A tally — "how many": a tab's task count.
export function TallyIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M3.5 3.5v9M6.5 3.5v9M9.5 3.5v9M12.5 3.5v9M2 11.5l12-7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// The theme toggle on the rail: a sun while dark (back to light), a moon while light.
export function SunIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    </svg>
  );
}

export function MoonIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="M13.2 9.8A5.6 5.6 0 0 1 6.2 2.8a5.6 5.6 0 1 0 7 7Z" />
    </svg>
  );
}

// The canvas toolbar's view switch: one tab filling the frame, or every tab laid out on the canvas.
export function OneTabIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="2" width="9" height="12" rx="1.5" />
      <path d="M6 5.2h4M6 8h4" />
    </svg>
  );
}

export function AllTabsIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <rect x="1.8" y="2" width="5.4" height="7.4" rx="1.2" />
      <rect x="9" y="3.6" width="5.2" height="5" rx="1.2" />
      <rect x="5.4" y="11.2" width="6.8" height="3" rx="1.2" />
    </svg>
  );
}

// A screen — the theme menu's Match system.
export function MonitorIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2.5" width="12" height="8.5" rx="1.3" />
      <path d="M6 14h4M8 11v3" />
    </svg>
  );
}
