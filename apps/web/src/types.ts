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
  BountyReel,
  BountyStatus,
  BountyStopped,
  BoosterHand,
  BoosterPick,
  BoosterStatus,
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
  TaskPriority,
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
// A task's priority (Low until it's given one), the order they list in, and which tasks take one.
export { canPrioritise, DEFAULT_PRIORITY, PRIORITIES, priorityOf } from "@board/contracts";
// Break down: which tasks can hold pieces, what new pieces are worth, and when a task with pieces is done —
// the rules the server folds, mirrored so the optimistic state lands where the server will.
export { canBreakDown, doneFromPieces, newPiecePoints, wholeWorth } from "@board/contracts";
// Modifiers — what changes what a task pays (the Bounty, frost, Subzero, the Booster) — and the one payout
// they compose into, as the server pays a completion.
export { modifiersOf, onWholeTask, payout } from "@board/contracts";
// The shop: what a reward costs now (its price under the weekend sale), and whether a one-time one is bought.
export { isBought, priceModifiersOf, priceOf, saleOn } from "@board/contracts";
// Which habits a Booster hand may deal.
export { canBoost } from "@board/contracts";
export type { GameItemId, InventoryItem, PriceContext, RewardKind, SaleSettings, SaleWeek } from "@board/contracts";
export type { AppliedModifier, ModifierContext, ModifierId, RecapFrost, RecapFrozen, FreezerSettings } from "@board/contracts";
// The Freezer: the wait clock, frost, and who may freeze — the rules the server folds.
export { daysSince, freezeRefusal, freezerOf, frostFill, frostShare, isFullFrost, waitDays, waitedMs, willFreezeAtWeekEnd } from "@board/contracts";
// Pure per-box schedule gate + its human label — the display-only "do this at a certain hour" lock.
export { isBoxLocked, boxScheduleLabel } from "@board/contracts";
// Which streaks can count a task (a daily streak a daily tab's, a weekly one a weekly tab's, a counter any
// that resets — none a one-time task), and why not.
export { streakCanCount, streakRefusal } from "@board/contracts";
// Pure timing curve for the screen-off wind-down nudge (idle → ramp → takeover) — see WindDownOverlay.
export { windDownState, dayKeyFor } from "@board/contracts";
export type { WindDownPhase, WindDownState } from "@board/contracts";
