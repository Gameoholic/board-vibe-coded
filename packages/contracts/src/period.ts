import { z } from "zod";
import { Points } from "./points.js";
import { PointsFormula } from "./pointsFormula.js";

// Board-wide settings and the pure period-key logic that turns an instant into the day/week it
// belongs to. This is SERVER TRUTH, not a client display preference: the day/week a completion falls
// in decides streak counting, and the server is the sole authority on time (see ARCHITECTURE.md).
// Everything here is pure — an instant + settings in, a stable string key out — so the projection and
// the streak fold agree by construction and a rebuild is deterministic.

// The owner is in Israel; this was a hardcoded constant until settings made it configurable. Kept as
// the default so a board with no SettingsChanged event still behaves exactly as before.
export const DEFAULT_TIME_ZONE = "Asia/Jerusalem";

// The optional "wind-down" nudge: an escalating full-screen prompt that grows as a chosen time
// approaches, to physically pressure the owner into shutting their screens off by then (see the
// WindDownOverlay). Board-wide truth so it's the same on every device. It is *not* tied to any task —
// a generic time-based nudge over its own config (prime directive: never hardcode the board), so the
// message defaults generic and the owner supplies their own if they want.
// When the full-screen message pops up: at a number of minutes before the target, or on every page
// refresh (once we're already within the window). A user-editable list — see WindDown.displayTriggers.
export const DisplayTrigger = z.union([
  z.object({ kind: z.literal("before"), minutes: z.number().int().min(0).max(1439) }),
  z.object({ kind: z.literal("refresh") }),
]);
export type DisplayTrigger = z.infer<typeof DisplayTrigger>;

export const WindDown = z.object({
  enabled: z.boolean().default(false),
  // Minutes past local midnight you want to be off your screens by. Default 21:00.
  targetMinutes: z.number().int().min(0).max(1439).default(21 * 60),
  // Optional custom headline; blank falls back to a generic default in the UI.
  message: z.string().trim().max(200).default(""),
  // When the full-screen message shows. Defaults: 30 / 15 / 5 min before, and on refresh. Fully
  // editable in Settings (delete any, add your own). The earliest "before" also defines the window in
  // which the candle lives and "on refresh" is allowed to fire.
  displayTriggers: z
    .array(DisplayTrigger)
    .max(24)
    .default([
      { kind: "before", minutes: 30 },
      { kind: "before", minutes: 15 },
      { kind: "before", minutes: 5 },
      { kind: "refresh" },
    ]),
});
export type WindDown = z.infer<typeof WindDown>;

// The lead window (minutes before target) is the largest "before" trigger — that's when the candle
// window opens and an "on refresh" trigger becomes eligible. 0 when there are no "before" triggers.
export function windDownLeadMinutes(wd: WindDown): number {
  return wd.displayTriggers.reduce((mx, t) => (t.kind === "before" ? Math.max(mx, t.minutes) : mx), 0);
}

// The weekly Bounty's knobs (Settings → Bounty): whether week closes roll Bounties at all, how many may
// be on at once, what one multiplies a task's points by, the free rerolls each week brings (bought ones
// come on top — see BountyRerollsGranted), and whether winning one rolls another in its place.
export const BountySettings = z.object({
  enabled: z.boolean().default(true),
  max: z.number().int().min(1).max(5).default(1),
  multiplier: z.number().min(1).max(10).default(2),
  rerolls: z.number().int().min(0).max(10).default(1),
  rollOnWin: z.boolean().default(false),
});
export type BountySettings = z.infer<typeof BountySettings>;

// The weekly Booster's knobs (Settings → Booster; see booster.ts): whether a week close deals a hand at all,
// how many of its cards are picked (each a Booster), and what a Booster adds to every tick of its task.
export const BoosterSettings = z.object({
  enabled: z.boolean().default(true),
  max: z.number().int().min(1).max(3).default(1),
  amount: Points.min(1).max(10_000).default(500),
});
export type BoosterSettings = z.infer<typeof BoosterSettings>;

// The weekend sale's knobs (Settings → Weekend sale): whether it runs, the share it takes off a reward that's
// on sale (a modifier on the price — see modifiers.ts), and when in each week it starts — a weekday and time,
// by default Thursday evening, when the working week is done. It runs until the week is ended.
export const SaleSettings = z.object({
  enabled: z.boolean().default(true),
  percentOff: z.number().int().min(1).max(100).default(50),
  startDay: z.number().int().min(0).max(6).default(4),
  startMinutes: z.number().int().min(0).max(1439).default(17 * 60),
});
export type SaleSettings = z.infer<typeof SaleSettings>;

// The Freezer's knobs (Settings → Freezer; see freezer.ts): how long a Backlog task may wait before a week
// close freezes it, how fast frost grows on a frozen one (a share of its points per week on ice, counted by
// the day) and where it stops, the least a task whose frost is full (Subzero) pays once thawed, and the
// bonus for thawing a task that has frost. Shares are in % of the task's points; amounts in points.
export const FreezerSettings = z.object({
  freezeAfterDays: z.number().int().min(1).max(365).default(7),
  frostPerWeek: z.number().min(0).max(1000).default(20),
  frostCap: z.number().min(1).max(10_000).default(200),
  subzeroMin: Points.default(100_000),
  thawBonus: Points.default(500),
});
export type FreezerSettings = z.infer<typeof FreezerSettings>;

// The rolling database snapshots' knobs (Settings → Backups; see apps/api/src/backup.ts): whether they're
// taken on their own, how often, and how many are kept — the oldest is dropped to make room.
export const BackupSettings = z.object({
  enabled: z.boolean().default(true),
  everyHours: z.number().int().min(1).max(24 * 30).default(48),
  keep: z.number().int().min(1).max(20).default(5),
});
export type BackupSettings = z.infer<typeof BackupSettings>;

export const Settings = z.object({
  timeZone: z.string().trim().min(1).default(DEFAULT_TIME_ZONE),
  // Minutes past local midnight at which a new *day* begins. Defaults to 00:01 (not 00:00) so the
  // boundary reads unambiguously as just after midnight. A late-night session before it still counts
  // as the previous day — "my day starts at 4am" support.
  dayStartMinutes: z.number().int().min(0).max(1439).default(1),
  // Which weekday a new *week* begins on: 0=Sun … 6=Sat. Default Sunday — the Israeli work week.
  weekStartDay: z.number().int().min(0).max(6).default(0),
  // Minutes past midnight of that weekday at which the new week begins. Defaults to 00:01 rather than
  // 00:00 so "starts Saturday" reads unambiguously as just after that day begins, not the stroke of
  // midnight that could be read as the day's end.
  weekStartMinutes: z.number().int().min(0).max(1439).default(1),
  // Optional screen-off nudge. Defaulted so a board with no SettingsChanged event (or a pre-wind-down
  // one) parses unchanged — the nudge is simply off.
  windDown: WindDown.default({}),
  // The time→% conversion formula (rate + effort presets) the points builder uses. Defaulted so a
  // board predating it parses unchanged with today's values (2.5%/hr, Normal ×1 / Challenging ×1.5).
  pointsFormula: PointsFormula,
  // The weekly Bounty (see bounty.ts). Defaulted, so a board predating it parses unchanged.
  bounty: BountySettings.default({}),
  // The Freezer (see freezer.ts). Defaulted, so a board predating it parses unchanged.
  freezer: FreezerSettings.default({}),
  // The weekly Booster (see booster.ts). Defaulted, so a board predating it parses unchanged.
  booster: BoosterSettings.default({}),
  // The shop's weekend sale. Defaulted (and on), so a board predating it gets it at once.
  sale: SaleSettings.default({}),
  // Database backups. Defaulted to how they ran before they were settings (every 2 days, 5 kept).
  backup: BackupSettings.default({}),
});
export type Settings = z.infer<typeof Settings>;
export const DEFAULT_SETTINGS: Settings = Settings.parse({});

// A single box's scheduled time — the "do this at a certain hour" gate. `dayOfWeek` (0=Sun…6=Sat),
// when set, makes it a *weekly* gate: the box unlocks at that weekday within the board's week (at
// `minutes` if given, else from the start of that day — "Friday, any time"). Without a `dayOfWeek`
// it's a *daily* gate that unlocks at `minutes` every day (so a daily box always carries a time).
// A display-only interaction gate (see isBoxLocked), never scoring — duck-typed onto any box, so
// there's no "scheduled task" type. At least one of the two fields is always set (refine below).
export const BoxSchedule = z
  .object({
    minutes: z.number().int().min(0).max(1439).optional(),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
  })
  .refine((e) => e.minutes !== undefined || e.dayOfWeek !== undefined, {
    message: "a scheduled box needs a time or a weekday",
  });
export type BoxSchedule = z.infer<typeof BoxSchedule>;

// One optional schedule per box, indexed by box (a null slot ≡ that box is unscheduled / always
// open). The array may be shorter than the box count; trailing boxes are unscheduled. Cap mirrors the
// domain's QTY_MAX, kept a literal here to avoid a domain→period import cycle.
export const TaskSchedule = z.array(BoxSchedule.nullable()).max(100);
export type TaskSchedule = z.infer<typeof TaskSchedule>;

export type PeriodKind = "day" | "week";

interface Civil {
  y: number;
  m: number; // 1-12
  d: number;
}

// A completion's civil date in the target timezone. en-CA formats as YYYY-MM-DD, so a day key is just
// this string. The formatter is what makes day boundaries local rather than UTC.
const ymdFormatters = new Map<string, Intl.DateTimeFormat>();
function ymdFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = ymdFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    ymdFormatters.set(timeZone, fmt);
  }
  return fmt;
}

function civilOf(ms: number, timeZone: string): Civil {
  const [y, m, d] = ymdFormatter(timeZone).format(new Date(ms)).split("-").map(Number);
  return { y, m, d };
}

// Wall-clock time-of-day (24h) formatter — used to gate scheduled boxes against the board timezone.
const clockFormatters = new Map<string, Intl.DateTimeFormat>();
function clockFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = clockFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
    clockFormatters.set(timeZone, fmt);
  }
  return fmt;
}

/** Minutes past local midnight (0..1439) of an instant in the given timezone. */
function minutesOfDay(ms: number, timeZone: string): number {
  const [h, m] = clockFormatter(timeZone).format(new Date(ms)).split(":").map(Number);
  return (h % 24) * 60 + m; // en-GB can emit "24:00" at midnight in some engines; fold to 0
}

function ymd(c: Civil): string {
  return `${c.y}-${String(c.m).padStart(2, "0")}-${String(c.d).padStart(2, "0")}`;
}

// Day-of-week (0=Sun) of a civil date, computed at UTC noon so the host timezone can't shift it.
function dowOf(c: Civil): number {
  return new Date(Date.UTC(c.y, c.m - 1, c.d, 12)).getUTCDay();
}

// Step whole civil days backward. Anchored at UTC noon so a DST shift can't drop or double a day.
export function stepBackCivil(c: Civil, days: number): Civil {
  const dt = new Date(Date.UTC(c.y, c.m - 1, c.d, 12) - days * 86_400_000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

// The civil date after shifting an instant back by `minutes` — this is what applies the "day starts
// at 4am" / "week starts Saturday 6pm" offset before we ask which calendar day/week we're in.
function shiftedCivil(iso: string, timeZone: string, minutes: number): Civil {
  return civilOf(new Date(iso).getTime() - minutes * 60_000, timeZone);
}

/** The civil date a day or week key names ("2026-10-02"). */
export function civilOfKey(key: string): Civil {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

/** The day-key ("YYYY-MM-DD") an instant belongs to, honouring the configured day-start offset. */
export function dayKeyFor(iso: string, settings: Settings): string {
  return ymd(shiftedCivil(iso, settings.timeZone, settings.dayStartMinutes));
}

/** The week-key an instant belongs to: the anchor date (YYYY-MM-DD) of that week's start day. */
export function weekKeyFor(iso: string, settings: Settings): string {
  const c = shiftedCivil(iso, settings.timeZone, settings.weekStartMinutes);
  const back = (dowOf(c) - settings.weekStartDay + 7) % 7; // days since the week's start weekday
  return ymd(stepBackCivil(c, back));
}

/** The key an instant falls in for either kind — the one entry point the projection/UI use. */
export function periodKeyFor(iso: string, kind: PeriodKind, settings: Settings): string {
  return kind === "day" ? dayKeyFor(iso, settings) : weekKeyFor(iso, settings);
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Whether a scheduled box is still locked at `now` — its scheduled wall-clock moment hasn't arrived
 * yet in the board's timezone. A daily gate (no `dayOfWeek`) unlocks at `minutes` past midnight every
 * day; a weekly gate unlocks at that weekday+time within the current week (week start from settings).
 * `openDay` is the board's open day: one not yet ended is still today, so once the clock is past it every
 * hour of it has come — its daily gates are open, and a weekly gate reads as of its last minute.
 * Pure display gate: it never affects scoring, and the server doesn't reject an early tick.
 */
export function isBoxLocked(entry: BoxSchedule, now: string, settings: Settings, openDay?: string): boolean {
  if (openDay && dayKeyFor(now, settings) > openDay) {
    if (entry.dayOfWeek === undefined) return false;
    const posOpen = ((dowOf(civilOfKey(openDay)) - settings.weekStartDay + 7) % 7) * 1440 + 1439;
    return posOpen < ((entry.dayOfWeek - settings.weekStartDay + 7) % 7) * 1440 + (entry.minutes ?? 0);
  }
  const ms = new Date(now).getTime();
  const mod = minutesOfDay(ms, settings.timeZone);
  // Daily gate: needs a time; a timeless daily entry can't happen (refine), but guard anyway.
  if (entry.dayOfWeek === undefined) return entry.minutes !== undefined && mod < entry.minutes;
  const dow = dowOf(civilOf(ms, settings.timeZone));
  // Position within the week (from its start weekday), in minutes: a pure civil comparison that
  // wraps the week correctly without constructing a timezone-aware instant. A weekly box with no
  // time unlocks from the start of its day (minutes 0) — "unlock on Friday, any time".
  const posNow = ((dow - settings.weekStartDay + 7) % 7) * 1440 + mod;
  const posBox = ((entry.dayOfWeek - settings.weekStartDay + 7) % 7) * 1440 + (entry.minutes ?? 0);
  return posNow < posBox;
}

/** The open week, as the weekend sale reads it: its open day (a day not yet ended is still today), and
 *  whether the sale was started early by hand. */
export interface SaleWeek {
  openDay?: string;
  startedEarly?: boolean;
}

/**
 * Whether the weekend sale is on at `now`: it's enabled, and the open week has reached its start — the same
 * gate as a weekly box's (isBoxLocked), so it follows the board's days: a day not yet ended is still today,
 * and the sale runs until the week is ended, whatever the clock says — or it was started early this week.
 */
export function saleOn(now: string, settings: Settings, week: SaleWeek = {}): boolean {
  if (!settings.sale.enabled) return false;
  if (week.startedEarly) return true;
  return !isBoxLocked({ dayOfWeek: settings.sale.startDay, minutes: settings.sale.startMinutes }, now, settings, week.openDay);
}

export type WindDownPhase = "idle" | "ramp" | "takeover";
export interface WindDownState {
  phase: WindDownPhase;
  /** 0 at the start of the lead window, rising to 1 at the target time. */
  progress: number;
  /** Signed minutes until the target (negative once it's past). */
  minutesToTarget: number;
}

/**
 * How intense the screen-off nudge should be at `now`, from the target time + lead window. Pure civil
 * arithmetic in minute-of-day (board timezone), like isBoxLocked — a display/interaction gate only,
 * never scoring. Resets on its own at local midnight (minute-of-day drops back below the window).
 * Does NOT consult `enabled` — that (and per-day dismissal) is the overlay's concern; this is purely
 * the timing curve. If the window would cross midnight (target < lead) it's clamped to day start.
 */
export function windDownState(now: string, settings: Settings): WindDownState {
  const { targetMinutes } = settings.windDown;
  const leadMinutes = windDownLeadMinutes(settings.windDown);
  const mod = minutesOfDay(new Date(now).getTime(), settings.timeZone);
  const minutesToTarget = targetMinutes - mod;
  if (mod >= targetMinutes) return { phase: "takeover", progress: 1, minutesToTarget };
  const windowStart = Math.max(0, targetMinutes - leadMinutes);
  if (mod < windowStart) return { phase: "idle", progress: 0, minutesToTarget };
  const span = targetMinutes - windowStart || 1;
  return { phase: "ramp", progress: (mod - windowStart) / span, minutesToTarget };
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Human label: "10:00" (daily), "Friday 10:00" (weekly + time), or "Friday" (weekly, any time). */
export function boxScheduleLabel(entry: BoxSchedule): string {
  const time = entry.minutes !== undefined ? hhmm(entry.minutes) : "";
  if (entry.dayOfWeek === undefined) return time;
  return time ? `${WEEKDAY_NAMES[entry.dayOfWeek]} ${time}` : WEEKDAY_NAMES[entry.dayOfWeek];
}

// A settled (closed) period's frozen snapshot: what each task's filled-box level was at close time.
// This is the honest record a streak counts against — a box checked then unchecked before close never
// makes it in, because the snapshot is taken from live state at the moment of close.
export const PeriodSnapshotEntry = z.object({
  taskId: z.string(),
  level: z.number().int().nonnegative(),
});
export type PeriodSnapshotEntry = z.infer<typeof PeriodSnapshotEntry>;

export const PeriodKindSchema = z.enum(["day", "week"]);

// The read shape the API serves for a closed period (used by the recap and settled-period lookup).
export const ClosedPeriod = z.object({
  kind: PeriodKindSchema,
  periodKey: z.string(),
  closedAt: z.string(),
  snapshot: z.array(PeriodSnapshotEntry),
});
export type ClosedPeriod = z.infer<typeof ClosedPeriod>;

// The status of one kind of period: the key currently open, the key `now` falls in, and whether a
// roll is due (they differ). The UI polls this on load to decide whether to prompt.
export const PeriodStatusOne = z.object({
  openKey: z.string().nullable(),
  currentKey: z.string(),
  due: z.boolean(),
});
export const PeriodStatus = z.object({
  day: PeriodStatusOne,
  week: PeriodStatusOne,
  // Points the period rolls have banked from the tasks they unchecked (sum of TasksReset.pointsBanked)
  // — part of the owner's points alongside what the board currently holds.
  banked: Points,
});
export type PeriodStatus = z.infer<typeof PeriodStatus>;
