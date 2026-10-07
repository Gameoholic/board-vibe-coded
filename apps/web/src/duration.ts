// A time as the board writes it ("45m", "1h 30m", "2h"; a stopwatch's "04:07") and as it can be typed into the
// points builder.

// The builder's shortest and longest times.
export const MIN_MINUTES = 2;
export const MAX_MINUTES = 24 * 60;

/** Minutes as a compact "1h 30m" / "45m" / "2h", exactly as many as there are. */
export function writeMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** A task's time, as its builder buckets it: 2m is the builder's smallest bucket, shown "<2m". */
export function formatMinutes(total: number): string {
  return total === MIN_MINUTES ? "<2m" : writeMinutes(total);
}

/** A stopwatch's reading: "04:07", and "1:04:07" from the hour on. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const tail = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${tail}` : tail;
}

/** The whole minutes a stopwatch's reading counts as: the nearest — and never none once there's time on it,
 *  so a few seconds can still be paid for. */
export function minutesOn(ms: number): number {
  return ms > 0 ? Math.max(1, Math.round(ms / 60_000)) : 0;
}

/**
 * The minutes a typed time means: "45m", "1h30", "1h 30m", "1:30", "1.5h" — a bare number is minutes ("90").
 * Null for an empty field, NaN for text that isn't a time.
 */
export function parseDuration(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(/\s+/g, "").replace(",", ".");
  if (!text) return null;
  const clock = text.match(/^(\d+):([0-5]?\d)$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const hours = text.match(/^(\d+(?:\.\d+)?)(?:h|hr|hrs|hour|hours)(?:(\d+)(?:m|min|mins)?)?$/);
  if (hours) return Math.round(Number(hours[1]) * 60 + (hours[2] ? Number(hours[2]) : 0));
  const minutes = text.match(/^(\d+(?:\.\d+)?)(?:m|min|mins|minutes)?$/);
  if (minutes) return Math.round(Number(minutes[1]));
  return NaN;
}

/** A typed time read for the builder: its minutes when it's one the builder takes, else why not (empty ≡ neither). */
export function readDuration(raw: string): { minutes: number | null; error?: string } {
  const minutes = parseDuration(raw);
  if (minutes === null) return { minutes: null };
  if (Number.isNaN(minutes)) return { minutes: null, error: "Try 45m, 1h30 or 90" };
  if (minutes < MIN_MINUTES) return { minutes: null, error: "2m or more" };
  if (minutes > MAX_MINUTES) return { minutes: null, error: "24h at most" };
  return { minutes };
}
