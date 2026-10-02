// Single source of truth for these shapes is the shared @board/contracts package (the same Zod
// schemas the API validates against). Re-exported here so existing `./types` import sites stay put.
export type {
  AllowedType,
  BoxSchedule,
  TaskSchedule,
  ClosedPeriod,
  Group,
  PeriodKind,
  PeriodRecap,
  RecapDay,
  RecapPurchase,
  RecapStreak,
  RecapTab,
  PeriodStatus,
  Reward,
  RolledBounty,
  BountyStatus,
  BackupList,
  BackupPreview,
  BackupSettings,
  BackupSlot,
  Section,
  SectionKind,
  SectionPeriod,
  Settings,
  Shop,
  ShopSection,
  Streak,
  StreakMatcher,
  StreakMode,
  StreakSince,
  StreakType,
  StreakView,
  Task,
  TaskBehavior,
  TaskCondition,
  TaskRequirement,
  TaskBlocker,
  TaskStatus,
  TaskType,
  TierDef,
  Timer,
  WindDown,
  DisplayTrigger,
  PointsFormula,
  PointsSource,
  EffortLevel,
  FormulaPreview,
  FormulaChangeItem,
} from "@board/contracts";
// The per-type behaviour registry — consumers read board state through this instead of switching
// on `task.type`, so adding a type is one entry in the contract, not edits scattered across the UI.
export { behaviorOf, behaviorOfType, canPrune, isRetired, taskPointValue } from "@board/contracts";
// A task's Status band, and the release of a task waiting on another once that one is done — the same
// rules the server folds, so the optimistic state lands where the server will.
export { statusOf, statusChange, releasedFrom } from "@board/contracts";
// Break down: which tasks can hold pieces, what new pieces are worth, and when a task with pieces is done —
// the rules the server folds, mirrored so the optimistic state lands where the server will.
export { canBreakDown, doneFromPieces, newPiecePoints } from "@board/contracts";
// The weekly Bounty: the factor a completion is paid at (its Bounty's, or its parent's) — as the server
// freezes it on the completion.
export { boostOf } from "@board/contracts";
// Pure per-box schedule gate + its human label — the display-only "do this at a certain hour" lock.
export { isBoxLocked, boxScheduleLabel } from "@board/contracts";
// Pure timing curve for the screen-off wind-down nudge (idle → ramp → takeover) — see WindDownOverlay.
export { windDownState, dayKeyFor } from "@board/contracts";
export type { WindDownPhase, WindDownState } from "@board/contracts";
