import type { PeriodKind, PeriodStatus } from "./types";

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

const addDays = (key: string, days: number) => new Date(dateOf(key).getTime() + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((dateOf(to).getTime() - dateOf(from).getTime()) / DAY_MS);

/** What was never opened between the day left open and today, as the prompt lists it: the days
 *  ("October 3 – October 15 · 13 days") and any whole weeks among them ("Week of October 4 – October 10").
 *  Empty when nothing was skipped. */
export function skippedSince(status: PeriodStatus): string[] {
  const { day, week } = status;
  const lines: string[] = [];
  const days = day.openKey ? daysBetween(day.openKey, day.currentKey) - 1 : 0;
  if (days === 1) lines.push(labelFor("day", addDays(day.openKey!, 1)));
  if (days > 1) lines.push(`${longDate(dateOf(addDays(day.openKey!, 1)))} – ${longDate(dateOf(addDays(day.currentKey, -1)))} · ${days} days`);
  const weeks = week.openKey ? daysBetween(week.openKey, week.currentKey) / 7 - 1 : 0;
  if (weeks === 1) lines.push(`Week of ${labelFor("week", addDays(week.openKey!, 7))}`);
  if (weeks > 1) {
    const last = addDays(week.currentKey, -1);
    lines.push(`Weeks of ${longDate(dateOf(addDays(week.openKey!, 7)))} – ${longDate(dateOf(last))} · ${weeks} weeks`);
  }
  return lines;
}

/** A day of a week's recap: its weekday ("Sun") and day of the month ("27"). */
export function dayLabel(dayKey: string): { weekday: string; date: string } {
  const d = dateOf(dayKey);
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }),
    date: d.toLocaleDateString(undefined, { day: "numeric", timeZone: "UTC" }),
  };
}

/** A day by its date alone ("October 3"). */
export function dateLabel(dayKey: string): string {
  return longDate(dateOf(dayKey));
}
