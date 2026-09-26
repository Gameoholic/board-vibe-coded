import { z } from "zod";

// Points are stored as integer thousandths of a percent: 1% === 1000. Never floats — float
// addition isn't associative, which would make the event-log rebuild-parity check flaky. `%` is
// the only unit the user ever sees; conversion to it happens only at the display edge.
export const POINTS_PER_PERCENT = 1000;

/** A point value: a non-negative integer count of thousandths-of-a-percent. */
export const Points = z.number().int().nonnegative();
export type Points = z.infer<typeof Points>;

/** Trimmed percent string for a settled value: 80 → "0.08%", 2500 → "2.5%", 10000 → "10%". */
export function formatPercent(thousandths: number): string {
  const negative = thousandths < 0;
  const n = Math.abs(Math.round(thousandths));
  const whole = Math.trunc(n / POINTS_PER_PERCENT);
  const frac = n % POINTS_PER_PERCENT;
  let out = String(whole);
  if (frac > 0) out += "." + String(frac).padStart(3, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${out}%`;
}

// Fraction digits formatPercent would show for a settled value (0–3). The count-up animation locks
// this once from its target so the digit count can't jump as it lands — see PointsCounter lore.
export function percentDecimals(thousandths: number): number {
  const frac = Math.abs(Math.round(thousandths)) % POINTS_PER_PERCENT;
  if (frac === 0) return 0;
  return String(frac).padStart(3, "0").replace(/0+$/, "").length;
}

/** Percent string with a caller-fixed number of fraction digits (for the count-up animation). */
export function formatPercentFixed(thousandths: number, decimals: number): string {
  return `${(thousandths / POINTS_PER_PERCENT).toFixed(decimals)}%`;
}

/** Parse a user-typed percent ("2.5", "0.08") into integer thousandths, or null if not a valid
 *  non-negative number. The forms speak `%`; storage is thousandths — this is the one crossing. */
export function parsePercent(input: string): number | null {
  const value = Number(input.trim());
  if (input.trim() === "" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * POINTS_PER_PERCENT);
}
