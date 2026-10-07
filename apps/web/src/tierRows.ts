import { DEFAULT_EFFORT_ID, parsePercent, POINTS_PER_PERCENT } from "@board/contracts";
import type { BuilderEstimate } from "./PointsBuilder";
import type { TierDef } from "./types";
import { uid } from "./uid";

// A tiered task's tiers while a form holds them: one row a tier, edited through TiersField (PointsBuilder.tsx).
// The add form starts from one blank row, the edit form from the task's saved tiers, and both turn their
// rows back into tiers here — so a tier is read and written one way.

// What a builder reports before anything is picked or typed in it.
export const EMPTY_ESTIMATE: BuilderEstimate = { minutes: null, effort: DEFAULT_EFFORT_ID, source: "manual" };

// One tier in a form: a stable id (so removing a tier never shifts the wrong builder), its % text, its
// builder's report — minutes null ≡ no duration picked → no estimate stored — and the saved tier it edits
// (none for a tier added in the form).
export interface TierRow {
  id: string;
  points: string;
  est: BuilderEstimate;
  tier?: TierDef;
}

/** A blank tier, as a form adds one. */
export const newTierRow = (): TierRow => ({ id: uid(), points: "", est: EMPTY_ESTIMATE });

/** A saved tier, as the edit form opens it. */
export const tierRowOf = (tier: TierDef): TierRow => ({
  id: uid(),
  points: String(tier.points / POINTS_PER_PERCENT),
  est: { minutes: tier.minutes ?? null, effort: tier.effort ?? DEFAULT_EFFORT_ID, source: tier.pointsSource ?? "manual" },
  tier,
});

/** A tier's label is its place among its task's tiers, so it's renumbered as tiers come and go — unless it
 *  was given words of its own (boards from before the builder carry tiers like "1hr"). */
export const tierLabel = (index: number) => `Tier ${index + 1}`;
const PLACE_LABEL = /^Tier \d+$/;

/** The tiers a form's rows come to — null while one has no % (the form says so under its field first). A row
 *  that edits a saved tier keeps what the form doesn't set. */
export function tiersFromRows(rows: TierRow[]): TierDef[] | null {
  const tiers: TierDef[] = [];
  for (const [i, row] of rows.entries()) {
    const points = parsePercent(row.points) ?? row.tier?.points;
    if (points === undefined) return null;
    // The estimate only when a duration is picked (it feeds the tier timer and a rebalance); without one a
    // saved tier keeps what it had. pointsSource says whether the % is still the builder's.
    const estimate = row.est.minutes != null ? { minutes: row.est.minutes, effort: row.est.effort } : {};
    const label = row.tier && !PLACE_LABEL.test(row.tier.label) ? row.tier.label : tierLabel(i);
    tiers.push({ ...row.tier, label, points, pointsSource: row.est.source, ...estimate });
  }
  return tiers;
}
