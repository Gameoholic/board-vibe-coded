import { z } from "zod";
import { POINTS_PER_PERCENT } from "./points.js";

// The time→% conversion formula, board-wide server truth (lives in Settings). A builder value's points
// are `% = hours × ratePercentPerHour × effortMult`, rounded to 2 decimals (the only precision the %
// UI shows). Both the rate and the effort presets are editable; changing either can rebalance every
// task whose points still came from the builder (see BoardStore.previewFormula / applyFormula). Kept in
// contracts so the projection (server, the sole scorer) and the web builder compute identically.

export const DEFAULT_POINTS_RATE = 2.5; // % per hour — the historic hardcoded BASE_RATE.
// The effort presets the builder offers. Order is stable: a task stores the *index* it picked, so
// editing a preset's multiplier rebalances every task that used it (index → new mult).
export const DEFAULT_EFFORT_LEVELS = [
  { label: "Normal", mult: 1.0 },
  { label: "Challenging", mult: 1.5 },
] as const;

export const EffortLevel = z.object({
  label: z.string().trim().min(1).max(40),
  mult: z.number().positive().max(100),
});
export type EffortLevel = z.infer<typeof EffortLevel>;

export const PointsFormula = z
  .object({
    ratePercentPerHour: z.number().positive().max(1000).default(DEFAULT_POINTS_RATE),
    effortLevels: z.array(EffortLevel).min(1).max(10).default([...DEFAULT_EFFORT_LEVELS]),
  })
  .default({});
export type PointsFormula = z.infer<typeof PointsFormula>;

export const DEFAULT_POINTS_FORMULA: PointsFormula = PointsFormula.parse({});

// Whether a value's % came from the builder's time calc ("builder") or was typed/overridden ("manual").
// Stored per checkbox task and per tier — never re-derived from the current formula, so declining a
// bulk rebalance can't silently flip a value's provenance.
export const PointsSource = z.enum(["builder", "manual"]);
export type PointsSource = z.infer<typeof PointsSource>;

/** The effort multiplier for a stored index; out-of-range (a since-removed preset) falls back to 1. */
export function effortMultOf(formula: PointsFormula, index: number | undefined): number {
  if (index === undefined) return 1;
  return formula.effortLevels[index]?.mult ?? 1;
}

/**
 * Points (integer thousandths of a %) a builder value earns: `hours × rate × effortMult`, rounded to
 * 2 decimals then scaled to thousandths — matching the builder's `suggestPoints`, so the stored value
 * and a fresh recompute agree exactly (no rebuild-parity drift).
 */
export function pointsFromMinutes(minutes: number, effortMult: number, formula: PointsFormula): number {
  const pct = (minutes / 60) * formula.ratePercentPerHour * effortMult;
  return Math.round(pct * 100) * (POINTS_PER_PERCENT / 100); // 2-dec % → thousandths
}

/**
 * A value's source: the stored flag wins (never re-derived — declining a rebalance can't flip it).
 * When absent (pre-feature values), derive once against the *historic* default formula (which is the
 * only formula those values were ever created under), so a value with no estimate is "manual" and one
 * whose % matches the builder at the old rate is "builder". Callers must not pass the *current* formula
 * here for the fallback, or a rate change would misclassify untouched values.
 */
export function resolvePointsSource(
  stored: PointsSource | undefined,
  minutes: number | undefined,
  points: number | undefined,
  effortIndex: number | undefined,
  formula: PointsFormula = DEFAULT_POINTS_FORMULA,
): PointsSource {
  if (stored) return stored;
  if (minutes == null || points == null) return "manual";
  return points === pointsFromMinutes(minutes, effortMultOf(formula, effortIndex), formula) ? "builder" : "manual";
}
