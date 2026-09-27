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
  PeriodStatus,
  Reward,
  Section,
  SectionKind,
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
export { behaviorOf, behaviorOfType, isRetired, taskPointValue } from "@board/contracts";
// Pure per-box schedule gate + its human label — the display-only "do this at a certain hour" lock.
export { isBoxLocked, boxScheduleLabel } from "@board/contracts";
// Pure timing curve for the screen-off wind-down nudge (idle → ramp → takeover) — see WindDownOverlay.
export { windDownState, dayKeyFor } from "@board/contracts";
export type { WindDownPhase, WindDownState } from "@board/contracts";
