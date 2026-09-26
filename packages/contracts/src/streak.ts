import type { Streak, StreakType } from "./domain.js";
import { DEFAULT_TIME_ZONE, periodKeyFor, type Settings } from "./period.js";

// Streak counts are derived from completion history, never stored. A "completion" is any moment a
// task's box was checked (TaskCompleted / a non-null TaskTierSet). This module is pure (time and
// settings are passed in) so it's identical on rebuild and testable.
//
// Two key regimes:
//  - No `settings` (unit tests, legacy callers): local-day / ISO-week keys, and unchecking does NOT
//    erase the fact a box was checked that day.
//  - With `settings` (production): keys honour the configured day-start / week-start (see period.ts),
//    and once a period is *settled* (closed) its snapshot wins — a box checked then unchecked before
//    close never counts, because the snapshot froze live state at close time.

/** One box-checked moment. `occurredAt` is a UTC ISO string as stored on the event. `count` is the
 *  completion level reached at that moment — 1 for a checkbox/tier, the ticked-box count for a count
 *  task — so a streak can ask "done at least N times this period", not just "done at all". */
export interface CompletionRecord {
  taskId: string;
  occurredAt: string;
  count?: number;
}

interface Civil {
  y: number;
  m: number; // 1-12
  d: number;
}

// A completion's civil date in the target timezone. en-CA formats as YYYY-MM-DD, so daily keys are
// just this string; weekly keys derive from it. The formatter is what makes day boundaries local.
const ymdFormatters = new Map<string, Intl.DateTimeFormat>();
function ymdFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = ymdFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    ymdFormatters.set(timeZone, fmt);
  }
  return fmt;
}

function civilOf(iso: string, timeZone: string): Civil {
  const [y, m, d] = ymdFormatter(timeZone).format(new Date(iso)).split("-").map(Number);
  return { y, m, d };
}

// ISO-8601 week key ("2026-W39"). Anchored at UTC noon of the civil date so it's immune to the
// timezone the host runs in — the civil date already carries the local-day decision.
function isoWeekKey(c: Civil): string {
  const date = new Date(Date.UTC(c.y, c.m - 1, c.d));
  const dow = (date.getUTCDay() + 6) % 7; // Mon=0
  date.setUTCDate(date.getUTCDate() - dow + 3); // Thursday decides the ISO year
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDow = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDow + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

// Bucket key for a completion. Weekly uses the ISO-week key; daily and counter both bucket by local
// day (a counter tallies distinct days per task, so a same-day re-check collapses to one).
function keyOf(c: Civil, type: StreakType): string {
  if (type === "weekly") return isoWeekKey(c);
  return `${c.y}-${String(c.m).padStart(2, "0")}-${String(c.d).padStart(2, "0")}`;
}

// Step whole civil days backward. Anchored at UTC noon so a DST shift can't drop or double a day.
function stepBack(c: Civil, days: number): Civil {
  const dt = new Date(Date.UTC(c.y, c.m - 1, c.d, 12) - days * 86_400_000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

// Cap the backward walk; the loop breaks at the first gap anyway, this only bounds a pathological
// all-completed history (~10 years of days).
const MAX_PERIODS = 4000;

export interface StreakResult {
  count: number;
  /** Whether the current period is already satisfied (lit flame) vs. still open (grace). */
  active: boolean;
  /** The longest consecutive satisfied run ever in the app's history (daily/weekly only), floored by
   *  the `legacyBest` backfill — a personal-best "record" independent of the current run. 0 for a
   *  counter / filter / empty streak (they have no consecutive-run notion). */
  best: number;
}

/**
 * Consecutive satisfied periods ending at (or, via a grace day, just before) `now`. The current
 * period being unsatisfied does NOT break the streak — it's a grace period until it fully elapses.
 */
// Optional production inputs. When `settings` is given, period keys honour the configured day/week
// boundaries and `settled` (periodKey → taskId → frozen level at close) overrides raw completions for
// any closed period. Omitting both keeps the legacy local-day / ISO-week behaviour the tests assert.
export interface StreakOpts {
  settings?: Settings;
  settled?: Map<string, Map<string, number>>;
  // Live filled-box level per task (`behaviorOf(task).filled(task)`). Used for the CURRENT open period
  // only, so a box checked then unchecked the same day reads 0 there instead of the raw max-reached
  // (which never drops). Omitted by pure tests → current period falls back to raw history as before.
  currentLevels?: Map<string, number>;
}

export function computeStreak(
  completions: CompletionRecord[],
  // `createdAt` windows the fold when `since` is "created" (the default): only completions at/after
  // the streak was created count, so it starts from zero rather than inheriting the task's whole past.
  // `since: "all"` drops that window. Both optional so pure tests can omit them.
  streak: Pick<Streak, "type" | "mode" | "matcher"> &
    Partial<Pick<Streak, "createdAt" | "since" | "legacy" | "legacyBest">>,
  now: Date,
  // Current box count per task, so a condition's `required: "all"` resolves to the task's live amount
  // (that's the whole point of "all" — the requirement tracks the amount if it changes). Numeric
  // requirements ignore this map.
  boxCounts: Map<string, number> = new Map(),
  timeZone: string = DEFAULT_TIME_ZONE,
  opts: StreakOpts = {},
): StreakResult {
  // Only the explicit-task matcher is evaluated today; the filter matcher is a deferred UX shell.
  if (streak.matcher.kind !== "tasks") return { count: 0, active: false, best: 0 };
  const conditions = streak.matcher.conditions;
  if (conditions.length === 0) return { count: 0, active: false, best: 0 };

  // The key for an instant: settings-based in production (day-start/week-start aware), else the
  // legacy local-day / ISO-week key. A closure so the fold and the walk-back can't disagree.
  const kind = streak.type === "weekly" ? "week" : "day";
  const keyForInstant = (iso: string): string =>
    opts.settings ? periodKeyFor(iso, kind, opts.settings) : keyOf(civilOf(iso, timeZone), streak.type);
  // A civil date maps to an instant at UTC noon, then to a key — noon is a safe anchor for realistic
  // day/week-start offsets (< ~11h). ponytail: a day-start past ~11:00 would misbucket the walk-back;
  // widen the anchor if that's ever configured.
  const keyForCivil = (c: Civil): string =>
    keyForInstant(new Date(Date.UTC(c.y, c.m - 1, c.d, 12)).toISOString());

  // Resolve each condition to a numeric threshold: "all" → the task's current box count (min 1).
  const reqs = conditions.map((c) => ({
    taskId: c.taskId,
    need: c.required === "all" ? Math.max(1, boxCounts.get(c.taskId) ?? 1) : c.required,
  }));

  // Per required task, the highest completion level reached in each period key (raw history). Two maps:
  // `perTask` honours the "Now" createdAt window (drives the current run + active); `perTaskAll` is
  // unwindowed (drives `best`, the all-app-history record — see below). Built in one pass.
  const wanted = new Set(reqs.map((r) => r.taskId));
  const perTask = new Map<string, Map<string, number>>(reqs.map((r) => [r.taskId, new Map()]));
  const perTaskAll = new Map<string, Map<string, number>>(reqs.map((r) => [r.taskId, new Map()]));
  const windowed = streak.since !== "all"; // "all" ignores the createdAt window
  let earliestMs = Infinity; // earliest completion instant, to bound the best walk-back
  for (const c of completions) {
    if (!wanted.has(c.taskId)) continue;
    const key = keyForInstant(c.occurredAt);
    const level = c.count ?? 1;
    const all = perTaskAll.get(c.taskId)!;
    all.set(key, Math.max(all.get(key) ?? 0, level));
    const ms = Date.parse(c.occurredAt);
    if (ms < earliestMs) earliestMs = ms;
    // Windowed copy: only from streak creation onward (ISO-UTC strings compare lexicographically).
    if (windowed && streak.createdAt && c.occurredAt < streak.createdAt) continue;
    const byKey = perTask.get(c.taskId)!;
    byKey.set(key, Math.max(byKey.get(key) ?? 0, level));
  }

  // The current open period's key — resolved the same way the walk-back does (UTC-noon of now's civil
  // date), so "is this the live period?" and the run's period keys always agree.
  const nowKey = keyForCivil(civilOf(now.toISOString(), timeZone));

  // A settled period's snapshot wins outright — it's the honest close-time state, so an unchecked box
  // there reads as 0 no matter what the raw log shows. The current OPEN period is live (an uncheck now
  // drops it, so a same-day check-then-uncheck doesn't count). Other unsettled periods fall back to the
  // given map's raw max-reached.
  const reachedFrom = (map: Map<string, Map<string, number>>, taskId: string, key: string): number => {
    const settledKey = opts.settled?.get(key);
    if (settledKey) return settledKey.get(taskId) ?? 0;
    if (key === nowKey && opts.currentLevels) return opts.currentLevels.get(taskId) ?? 0;
    return map.get(taskId)?.get(key) ?? 0;
  };
  const satisfiedWith = (map: Map<string, Map<string, number>>, key: string): boolean =>
    streak.mode === "all"
      ? reqs.every((r) => reachedFrom(map, r.taskId, key) >= r.need)
      : reqs.some((r) => reachedFrom(map, r.taskId, key) >= r.need);

  const step = streak.type === "weekly" ? 7 : 1;
  let civil = civilOf(now.toISOString(), timeZone);
  const active = satisfiedWith(perTask, keyForCivil(civil));

  // Current run: consecutive satisfied periods ending at (or, via a grace period, just before) now.
  let count = 0;
  for (let i = 0; i < MAX_PERIODS; i++) {
    if (satisfiedWith(perTask, keyForCivil(civil))) count++;
    else if (i > 0) break; // current period may be unsatisfied (grace); earlier gaps break the run
    civil = stepBack(civil, step);
  }

  // Best: the longest consecutive satisfied run anywhere in the app's history (unwindowed, so it's the
  // real record even for a freshly-created "Now" streak), floored by the legacyBest backfill. Walk back
  // from now, tracking the max run, until we're before the earliest completion (nothing older can
  // satisfy — a settled level only exists where a box was actually ticked, which logged a completion).
  let run = 0;
  let bestRun = 0;
  let bc = civilOf(now.toISOString(), timeZone);
  for (let i = 0; i < MAX_PERIODS; i++) {
    const instMs = Date.UTC(bc.y, bc.m - 1, bc.d, 12);
    if (instMs < earliestMs - 86_400_000) break; // a day's margin past the oldest data, then stop
    if (satisfiedWith(perTaskAll, keyForCivil(bc))) {
      run++;
      if (run > bestRun) bestRun = run;
    } else {
      run = 0;
    }
    bc = stepBack(bc, step);
  }
  const best = Math.max(bestRun, streak.legacyBest ?? 0);

  // The backfilled starting value is added to the run only in "all time" mode (it's the pre-app
  // history); counting from "now" deliberately starts fresh and ignores it. Never affects `active`.
  const legacy = streak.since === "all" ? (streak.legacy ?? 0) : 0;
  return { count: count + legacy, active, best };
}

/**
 * A `counter` streak's number, honouring `since` and the backfilled `legacy` (always added):
 *  - "Now" (`since` !== "all"): the live sum of the linked tasks' currently-ticked boxes. Ticking a
 *    box raises it, unticking lowers it — every tick moves it by one, exactly. `currentLevels` maps
 *    each task to its filled-box count (`behaviorOf(task).filled(task)`), resolved live by the caller.
 *  - "All time" (`since === "all"`): the lifetime tick total — for each linked task, the level reached
 *    on every day of history, summed. Honest via closed-day snapshots: a box checked then unchecked
 *    before close reads its frozen close-time level (so an accidental tick doesn't count), while the
 *    current open day uses the live level so an untick lowers it right now. Needs the history inputs in
 *    `opts` (as the projection has them); without them it degrades to the live sum.
 * Lit while non-zero.
 */
export function computeCounter(
  streak: Pick<Streak, "matcher"> & Partial<Pick<Streak, "since" | "legacy">>,
  currentLevels: Map<string, number>,
  opts: StreakOpts & { completions?: CompletionRecord[]; now?: Date } = {},
): StreakResult {
  // A counter has no consecutive-run notion, so `best` is always 0 (the UI hides it for counters).
  if (streak.matcher.kind !== "tasks") return { count: 0, active: false, best: 0 };
  const conditions = streak.matcher.conditions;
  // Backfill is the pre-app history, so it only applies to "all time"; "now" starts fresh, no legacy.
  const legacy = streak.since === "all" ? (streak.legacy ?? 0) : 0;

  // "Now": the plain live sum (also the fallback when history inputs weren't supplied — then legacy is
  // 0 anyway unless since is "all").
  if (streak.since !== "all" || !opts.completions) {
    let count = legacy;
    for (const c of conditions) count += currentLevels.get(c.taskId) ?? 0;
    return { count, active: count > 0, best: 0 };
  }

  // "All time": sum each linked task's per-day reached level across history. Day-bucketing mirrors the
  // daily-streak path (settings-based keys in production, legacy local-day keys in bare tests).
  const timeZone = opts.settings?.timeZone ?? DEFAULT_TIME_ZONE;
  const dayKeyOf = (iso: string): string =>
    opts.settings ? periodKeyFor(iso, "day", opts.settings) : keyOf(civilOf(iso, timeZone), "daily");
  const now = opts.now ?? new Date();
  const todayKey = dayKeyOf(now.toISOString());

  const wanted = new Set(conditions.map((c) => c.taskId));
  // Raw max level reached per task per day (from the log) — the fallback for unsettled past days.
  const rawByTaskDay = new Map<string, Map<string, number>>();
  for (const rec of opts.completions) {
    if (!wanted.has(rec.taskId)) continue;
    const key = dayKeyOf(rec.occurredAt);
    let m = rawByTaskDay.get(rec.taskId);
    if (!m) rawByTaskDay.set(rec.taskId, (m = new Map()));
    m.set(key, Math.max(m.get(key) ?? 0, rec.count ?? 1));
  }

  let count = legacy;
  for (const taskId of wanted) {
    // Every day this task has any evidence: a raw completion, or an entry in a settled snapshot (the
    // projection freezes every task per closed period, so this reaches back before the streak existed).
    const days = new Set<string>(rawByTaskDay.get(taskId)?.keys() ?? []);
    if (opts.settled) for (const [dayKey] of opts.settled) days.add(dayKey);
    for (const dayKey of days) {
      const settledDay = opts.settled?.get(dayKey);
      if (settledDay) count += settledDay.get(taskId) ?? 0; // closed day: honest frozen level
      else if (dayKey === todayKey) count += currentLevels.get(taskId) ?? 0; // open today: live
      else count += rawByTaskDay.get(taskId)?.get(dayKey) ?? 0; // unsettled past: raw best-effort
    }
    // If today has no completion record yet but boxes are ticked live, still include it.
    if (!days.has(todayKey)) count += currentLevels.get(taskId) ?? 0;
  }
  return { count, active: count > 0, best: 0 };
}
