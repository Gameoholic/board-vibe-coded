// A task's time as the board writes it ("45m", "1h 30m", "2h") and as it can be typed into the points builder.

// The builder's shortest and longest times.
export const MIN_MINUTES = 2;
export const MAX_MINUTES = 24 * 60;

/** Minutes as a compact "1h 30m" / "45m" / "2h". 2m is the builder's smallest bucket, shown "<2m". */
export function formatMinutes(total: number): string {
  if (total === MIN_MINUTES) return "<2m";
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
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
