import { z } from "zod";

// Points are stored as integer thousandths of a percent: 1% === 1000. Never floats — float
// addition isn't associative, which would make the event-log rebuild-parity check flaky. `%` is
// the only unit the user ever sees; conversion to it happens only at the display edge.
export const POINTS_PER_PERCENT = 1000;

/** A point value: a non-negative integer count of thousandths-of-a-percent. */
export const Points = z.number().int().nonnegative();
export type Points = z.infer<typeof Points>;

// What a % shows is at most two decimals: points are kept in thousandths, but the display rounds them
// (half-up) to hundredths of a percent.
const SHOWN_PER_PERCENT = 100;
const toShown = (thousandths: number) => Math.round(Math.abs(thousandths) / (POINTS_PER_PERCENT / SHOWN_PER_PERCENT));

/** Trimmed percent string for a settled value, to at most two decimals: 80 → "0.08%", 2500 → "2.5%",
 *  1646 → "1.65%", 10000 → "10%". */
export function formatPercent(thousandths: number): string {
  const n = toShown(thousandths);
  const frac = n % SHOWN_PER_PERCENT;
  let out = String(Math.trunc(n / SHOWN_PER_PERCENT));
  if (frac > 0) out += "." + String(frac).padStart(2, "0").replace(/0+$/, "");
  return `${thousandths < 0 && n > 0 ? "-" : ""}${out}%`;
}

// Fraction digits formatPercent would show for a settled value (0–2). The count-up animation locks
// this once from its target so the digit count can't jump as it lands — see PointsCounter lore.
export function percentDecimals(thousandths: number): number {
  const frac = toShown(thousandths) % SHOWN_PER_PERCENT;
  if (frac === 0) return 0;
  return String(frac).padStart(2, "0").replace(/0+$/, "").length;
}

/** Percent string with a caller-fixed number of fraction digits (for the count-up animation) — from the same
 *  hundredths formatPercent shows, so the count lands on exactly its digits. */
export function formatPercentFixed(thousandths: number, decimals: number): string {
  const shown = (Math.sign(thousandths) * toShown(thousandths)) / SHOWN_PER_PERCENT;
  return `${shown.toFixed(decimals)}%`;
}

/** Parse a user-typed percent ("2.5", "0.08") into integer thousandths, or null if not a valid
 *  non-negative number. The forms speak `%`; storage is thousandths — this is the one crossing. */
export function parsePercent(input: string): number | null {
  const value = Number(input.trim());
  if (input.trim() === "" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * POINTS_PER_PERCENT);
}
