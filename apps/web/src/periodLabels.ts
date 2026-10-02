import type { PeriodKind } from "./types";

// Period and day keys ("2026-09-24", or a week's first day) as the owner reads them. A bare date string is
// parsed as UTC midnight and formatted in UTC, so it reads as the intended calendar day everywhere.

const DAY_MS = 86_400_000;
const dateOf = (key: string) => new Date(`${key}T00:00:00Z`);
const longDate = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "long", timeZone: "UTC" });

/** A day with its weekday ("Friday, October 2"), or a week's first and last days, each with its month
 *  ("October 4 – October 10"). */
export function labelFor(kind: PeriodKind, periodKey: string): string {
  const start = dateOf(periodKey);
  if (kind === "day") return start.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return `${longDate(start)} – ${longDate(new Date(start.getTime() + 6 * DAY_MS))}`;
}

/** A day of a week's recap: its weekday ("Sun") and day of the month ("27"). */
export function dayLabel(dayKey: string): { weekday: string; date: string } {
  const d = dateOf(dayKey);
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }),
    date: d.toLocaleDateString(undefined, { day: "numeric", timeZone: "UTC" }),
  };
}
