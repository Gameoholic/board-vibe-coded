# Period Close — Implementation Plan

> **Status:** Plan only — nothing is built. The owner reviews and steers before any code starts.

---

## Problem

Streaks today count the *raw* completion log. An append-only log has no concept of "the day is settled" — checking then unchecking still logged a completion for that day, and that completion counts forever. There's also no way to say "count this streak from all time" without getting garbage from accidental check/uncheck pairs scattered through history.

The physical whiteboard didn't have this problem: at the end of the day you either had ticks or you didn't. We need an equivalent moment in the app.

---

## Solution in one sentence

A **`PeriodClosed` event** — triggered explicitly by the owner when the app prompts them — snapshots every task's live filled-level at that moment. Streak computation uses that snapshot for settled periods, so only what was genuinely done at close time counts. Current (open) period stays live, preserving the existing grace-period behaviour.

---

## What this unlocks

1. **Honest streak counting** — check/uncheck after close doesn't retroactively change a streak.
2. **"Count from all time" option on streaks** — once periods are settled, a streak can look back past its own creation date and trust what it sees (only settled periods = only honest data).
3. **Period recap** — "Yesterday you did X, Y, Z — [0.8%]" right after close.
4. **Foundation for Day Types** (`WORK`/`NORMAL`/`PAUSED` from the backlog) — a `PeriodClosed` event is the prerequisite; the type is just an additional field on it later.

---

## Data model

### New event: `PeriodClosed`

```ts
{
  type: "PeriodClosed",
  kind: "daily" | "weekly",
  periodKey: string,   // "2026-09-24"  or  "2026-W39"
  snapshot: { taskId: string; level: number }[],
  // `level` = behaviorOf(task).filled(task) at close time, server-resolved.
  // Every task is included so a future streak addition can reach back to this period.
}
```

The snapshot is **server-generated** at close time from the live projection. The client never sends task states — it only requests a close with the period key. This holds the "server is the sole authority" rule.

`idempotency_key` on the event as usual — a duplicate close returns the existing event unchanged.

### Streak field: `since`

```ts
since: "created" | "all"   // default "created" = current behaviour
```

Added to `Streak`, `StreakCreated`, `StreakEdited`. Old events read `since` as absent → `"created"`, so pre-existing streaks project unchanged.

- `"created"` — only completions/periods at or after `streak.createdAt` count (today's behaviour).
- `"all"` — no creation-date window; looks at all settled periods, regardless of when the streak was added. Pre-settlement periods (before the feature existed) fall back to raw completions as before — no magic retroactive data.

---

## Computation change (`packages/contracts/src/streak.ts`)

New parameter added to `computeStreak`:

```ts
settledPeriods: Map<string, Map<string, number>>
//              periodKey → taskId → level at close
```

Derived in the projection from all `PeriodClosed` events.

**Per period key in the walk-back:**

| Period state | How level is resolved |
|---|---|
| Settled (`settledPeriods.has(key)`) | `settledPeriods.get(key)?.get(taskId) ?? 0` — snapshot wins entirely |
| Unsettled / old period | Raw completions as today (max level reached) |
| Current open period (grace) | Live state as today |

The `createdAt` window: still applied when `since === "created"`. For `since === "all"`, skipped. Applies to both the raw-completion path and the settled path (for settled: just skip the date-window filter — the period key is already the date).

`computeCounter` (for `counter` streaks) is unchanged — it lives in current state, not history.

---

## API

### `POST /api/periods/close`

Body:
```ts
{ kind: "daily" | "weekly"; periodKey: string }
```

Server:
1. Validates `periodKey` format (`YYYY-MM-DD` or `YYYY-Www`).
2. Idempotency: if a `PeriodClosed` with this key already exists, return it (no new event).
3. Snapshots `behaviorOf(t).filled(t)` for every task in the projection.
4. Appends `PeriodClosed`.
5. Returns: `{ period: ClosedPeriod, streaks: StreakView[] }` — updated streak views so the UI can reconcile immediately.

### `GET /api/periods?kind=daily&limit=N`

Returns the `N` most recent closed periods of the given kind (default 7). Used by the close prompt (needs "what was the last close?") and the recap (needs the snapshot).

---

## UI

### Close prompt

On `App` mount, after loading sections/tasks, also `GET /api/periods?kind=daily&limit=1`. If the most recent daily close is ≤ yesterday's civil date (Israel tz), or no closes exist at all, show a persistent but dismissable prompt banner/badge:

> **Yesterday is still open.**  
> Close it to lock in your streak data.  
> **[Close yesterday]** · Skip

- **"Close yesterday"** — calls `POST /api/periods/close { kind: "daily", periodKey: "yesterday" }`, then shows the recap.
- **"Skip"** — session-scoped flag (`useRef` or a simple module variable), not persisted. Re-prompts on next load. This is intentional — the prompt should nag gently until the owner closes, not silently give up.

Week prompt: same logic on crossing an ISO week boundary.

### Recap overlay

Shown immediately after a close. Reads `snapshot` from the response:

- Tasks where `level > 0`, listed as `[points] Task name` in done-row style.
- Aggregate points earned that period (sum of `points × level` for each snapshot entry, using current task config — a display nicety, not a frozen value).
- Dismiss closes it; accessible again from a small "↩ recap" link for the session.

This is a new component (`PeriodRecap`), shown as a `Popover`-style overlay. Not a modal — consistent with the "no centred modals" rule.

### Streak form

`since` toggle on Daily/Weekly streaks only (counter streaks are stateless — "all time" is meaningless for them). A small pill toggle below the type selector:

> **Count from** [Since created ✓] [All time]

Default: `"created"`. Tooltip or helper text: "All time uses only settled (closed) periods — unchecked tasks won't inflate it."

---

## Files changed

| File | What changes |
|---|---|
| `packages/contracts/src/events.ts` | Add `PeriodClosed` event type |
| `packages/contracts/src/domain.ts` | Add `since` field to `Streak`; add `ClosedPeriod` read type |
| `packages/contracts/src/streak.ts` | Accept `settledPeriods` param; use snapshot for settled keys |
| `packages/contracts/src/requests.ts` | `ClosePeriodBody` |
| `apps/api/src/projection.ts` | `apply(PeriodClosed)`, `listSettledPeriods()` selector, pass into `readStreak` |
| `apps/api/src/routes.ts` | `POST /api/periods/close`, `GET /api/periods` |
| `apps/web/src/App.tsx` | Fetch recent close on mount; prompt logic; session skip flag |
| `apps/web/src/StreakForm.tsx` | `since` toggle for daily/weekly |
| `apps/web/src/PeriodRecap.tsx` | New — recap overlay component |
| `apps/web/src/SectionCard.tsx` / `App.css` | Minor: prompt banner placement and styles |

No migration required. Old events replay unchanged (no settled periods → falls back to raw completions exactly as today). Old streaks default `since: "created"`.

---

## Open questions for the owner

These need answers before any code starts:

1. **Closing missed days**: if you haven't opened the app in 3 days, should closing prompt for each unclosed day in sequence ("Tuesday is open, then Wednesday, then Thursday") — or only offer closing the most recent unclosed day?

2. **Week close**: always explicit (separate prompt), or auto-triggered when you close the last day of the ISO week (Saturday night)?

3. **Recap scope**: tasks only, or also "streaks you kept/broke" as part of the recap? Streaks would be a richer recap but more work.

4. **Prompt placement**: banner at the top of the board, or a badge/indicator on the date display? The board already has a date — a badge there might be less intrusive than a banner.

---

## Relationship to the backlog

- **Day Types** (`WORK`/`NORMAL`/`PAUSED`) from `BACKLOG.md` build directly on this: `PeriodClosed` gains a `dayType` field. That feature comes after this one, not instead of it.
- **`streak.since: "all"`** is only trustworthy once you have a history of closed periods — it won't retroactively fix pre-feature data, and that's correct.
- **Paused-day streak protection** (also in the backlog) also depends on `PeriodClosed` — a `PAUSED` close day would be exempt from streak requirements.
