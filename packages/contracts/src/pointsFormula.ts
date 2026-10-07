import { z } from "zod";
import { POINTS_PER_PERCENT } from "./points.js";

// The time→% conversion formula, board-wide server truth (lives in Settings). A builder value's points
// are `% = hours × ratePercentPerHour × effortMult`, rounded to 2 decimals (the only precision the %
// UI shows). Both the rate and the effort levels are editable; changing either can rebalance every
// task whose points still came from the builder (see BoardStore.previewFormula / applyFormula). Kept in
// contracts so the projection (server, the sole scorer) and the web builder compute identically.

export const DEFAULT_POINTS_RATE = 2.5; // % per hour — the historic hardcoded BASE_RATE.

// The effort levels the builder offers, lightest to hardest — that order is the scale the effort sorts
// use. A task stores its level's `id`, so a level's name and multiplier can be edited (rebalancing every
// task on it) without touching the tasks themselves. An id is permanent and says nothing: `grind` is the
// level since renamed Ugh.
export const DEFAULT_EFFORT_LEVELS = [
  { id: "casual", label: "Casual", mult: 0.75 },
  { id: "normal", label: "Normal", mult: 1 },
  { id: "grind", label: "Ugh", mult: 1.5 },
  { id: "dread", label: "Dread", mult: 2.5 },
] as const;

// The level a value with no stored effort is on, and the builder's first pick.
export const DEFAULT_EFFORT_ID = "normal";

export const EffortId = z.string().trim().min(1).max(40);

export const EffortLevel = z.object({
  id: EffortId,
  label: z.string().trim().min(1).max(40),
  mult: z.number().positive().max(100),
});
export type EffortLevel = z.infer<typeof EffortLevel>;

// Before levels had ids there were exactly two, told apart by their place in the list: the base one and
// the harder one. Old events still carry that place (`estimateEffortIndex`, a tier's `effortIndex`).
const LEGACY_EFFORT_IDS = ["normal", "grind"];

/** The level an old event's effort index meant; undefined ≡ no effort stored (the default level). */
export function legacyEffortId(index: number | null | undefined): string | undefined {
  return index == null ? undefined : LEGACY_EFFORT_IDS[index];
}

// A pre-id formula's two levels become the default list, each old level's multiplier kept on the level it
// became, so no task's points move. The new names replace the old ones, which were never renamed.
function fromLegacyLevels(raw: unknown): unknown {
  if (!Array.isArray(raw) || raw.every((l) => typeof (l as { id?: unknown })?.id === "string")) return raw;
  return DEFAULT_EFFORT_LEVELS.map((level) => {
    const old: unknown = raw[LEGACY_EFFORT_IDS.indexOf(level.id)];
    const mult = (old as { mult?: unknown } | undefined)?.mult;
    return typeof mult === "number" ? { ...level, mult } : { ...level };
  });
}

export const PointsFormula = z
  .object({
    ratePercentPerHour: z.number().positive().max(1000).default(DEFAULT_POINTS_RATE),
    effortLevels: z
      .preprocess(
        fromLegacyLevels,
        z
          .array(EffortLevel)
          .min(1)
          .max(10)
          .refine((levels) => new Set(levels.map((l) => l.id)).size === levels.length, "effort level ids must be unique"),
      )
      .default(DEFAULT_EFFORT_LEVELS.map((l) => ({ ...l }))),
  })
  .default({});
export type PointsFormula = z.infer<typeof PointsFormula>;

export const DEFAULT_POINTS_FORMULA: PointsFormula = PointsFormula.parse({});

// The only formula values from before `pointsSource` existed were ever priced under: 2.5%/hr, the base
// level ×1 and the harder one ×1.5. Pinned here rather than read off the defaults, so retuning a default
// can never reclassify those values (see resolvePointsSource).
const HISTORIC_POINTS_FORMULA: PointsFormula = {
  ratePercentPerHour: 2.5,
  effortLevels: [
    { id: "normal", label: "Normal", mult: 1 },
    { id: "grind", label: "Challenging", mult: 1.5 },
  ],
};

// Whether a value's % came from the builder's time calc ("builder") or was typed/overridden ("manual").
// Stored per checkbox task and per tier — never re-derived from the current formula, so declining a
// bulk rebalance can't silently flip a value's provenance.
export const PointsSource = z.enum(["builder", "manual"]);
export type PointsSource = z.infer<typeof PointsSource>;

/** The multiplier of a stored level; absent ≡ the default level, and an unknown id falls back to 1. */
export function effortMultOf(formula: PointsFormula, effort: string | undefined): number {
  const id = effort ?? DEFAULT_EFFORT_ID;
  return formula.effortLevels.find((l) => l.id === id)?.mult ?? 1;
}

/** Where a stored level sits on the scale, lightest first (absent ≡ the default level); -1 if unknown. */
export function effortRank(formula: PointsFormula, effort: string | undefined): number {
  const id = effort ?? DEFAULT_EFFORT_ID;
  return formula.effortLevels.findIndex((l) => l.id === id);
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
 * When absent (pre-feature values), derive once against the *historic* formula (the only one those
 * values were ever created under), so a value with no estimate is "manual" and one whose % matches the
 * builder at the old rate is "builder". Callers must not pass the *current* formula here for the
 * fallback, or a rate change would misclassify untouched values.
 */
export function resolvePointsSource(
  stored: PointsSource | undefined,
  minutes: number | undefined,
  points: number | undefined,
  effort: string | undefined,
  formula: PointsFormula = HISTORIC_POINTS_FORMULA,
): PointsSource {
  if (stored) return stored;
  if (minutes == null || points == null) return "manual";
  return points === pointsFromMinutes(minutes, effortMultOf(formula, effort), formula) ? "builder" : "manual";
}
