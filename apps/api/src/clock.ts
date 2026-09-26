// A debug-only overridable clock. In normal operation `now()` is just `new Date()`; the Settings
// "Debug" panel can pin it to a fixed instant to simulate opening the app at another time — the
// projection reads it wherever it needs "now" (period-roll status, streak lit/grace states) and
// stamps new events with it, so a faked time flows through the whole board coherently.
//
// It's a deliberate backdoor: single-user, self-hosted, never exposed publicly. Not persisted — it
// lives in memory, so a server restart returns to real time (and clearing it does the same).

let fixed: Date | null = null;

/** The current instant — the pinned debug time if one is set, otherwise the real clock. */
export function now(): Date {
  return fixed ? new Date(fixed) : new Date();
}

/** Pin the clock to an ISO instant, or pass null to return to real time. */
export function setDebugNow(iso: string | null): void {
  if (iso === null) {
    fixed = null;
    return;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error("invalid debug time");
  fixed = d;
}

/** The pinned instant as ISO, or null when running on the real clock. */
export function getDebugNow(): string | null {
  return fixed ? fixed.toISOString() : null;
}
