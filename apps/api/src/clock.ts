// A debug-only overridable clock. In normal operation `now()` is just `new Date()`; the Settings
// "Debug" panel can pin it to a fixed instant to simulate opening the app at another time — the
// projection reads it wherever it needs "now" (period-roll status, streak lit/grace states) and
// stamps new events with it, so a faked time flows through the whole board coherently.
//
// One per board: each account's board is handed its own (see boards.ts), so one person pinning a time
// never stamps it onto another person's events. Not persisted — it lives in memory, so a server restart
// returns to real time (and clearing it does the same).
export class Clock {
  private fixed: Date | null = null;

  /** The current instant — the pinned debug time if one is set, otherwise the real clock. */
  now(): Date {
    return this.fixed ? new Date(this.fixed) : new Date();
  }

  /** Pin the clock to an ISO instant, or pass null to return to real time. */
  set(iso: string | null): void {
    if (iso === null) {
      this.fixed = null;
      return;
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) throw new Error("invalid debug time");
    this.fixed = d;
  }

  /** The pinned instant as ISO, or null when running on the real clock. */
  pinned(): string | null {
    return this.fixed ? this.fixed.toISOString() : null;
  }
}

// The clock a board gets when it isn't handed one of its own: the tests' boards and a backup's preview.
// The server never runs a board on it.
export const sharedClock = new Clock();

export function setDebugNow(iso: string | null): void {
  sharedClock.set(iso);
}
