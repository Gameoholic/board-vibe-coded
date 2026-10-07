# Backlog & Future Ideas

> **Scope of this file.** Things not built yet — deferred features, deliberate omissions, and ideas worth remembering. A parking lot, not a plan.
> **Write here:** future feature ideas, deferred features, and known next steps.
> **Don't write here:** anything already built (→ `PRODUCT.md` / `ARCHITECTURE.md`). And nothing here is a commitment — the owner steers, one feature at a time.

**Nothing in this file is scheduled or approved — except the "Next up" section right below**, which the owner approved as a build order. It exists so good ideas aren't lost. Do **not** start building any of it without the owner explicitly asking, and never regenerate a whole subsystem wholesale — that's what soured a previous attempt. The owner earns back to this complexity feature by feature, steering it themselves.

---

## Next up — the Tasks rethink (owner-approved, built one feature at a time)

Designed with the owner in the "Tasks Tab Rethink" proposal (a private artifact: https://claude.ai/artifact/KNygqSVAzfGPAc82Cearqg — its "Your calls" section holds the defaulted details). Each step ships alone; the owner confirms one before the next starts. **Built:** the row actions menu (right-click / long-press → Edit, Duplicate, Delete — see `PRODUCT.md` "Forms & interactions"), **Prune** for daily/weekly tasks, **Status** (In progress / Backlog / Blocked bands), **Break down** (pieces inside a one-time task), the **weekly Bounty**, and the **Freezer** — Interest as the owner reimagined it, hot and cold tasks: freezing and thawing, frost, Subzero, the thaw bonus, the Bounty rolled from the Freezer, the Age chip, and **modifiers** under all of it (all in `PRODUCT.md` "Task types"; simulated first at https://claude.ai/artifact/JDE5WPBXaRBkq9ijttx1oH, whose "Decided" list records the owner's calls), and the **weekly Booster** (simulated at https://claude.ai/artifact/GsgGAmpVqneFQJSCQbf6dL, whose "Decided" list records the owner's calls). **Remaining:** nothing in this order — the owner picks what's next.

Dropped by the owner as over-engineering: banking timer sessions for points, and an "It grew" re-estimate action.

---

## Closing the rest of the gap to the target data model

The append-only event log **is built and persisted** (SQLite, `apps/api/src/db.ts` + `projection.ts` — see `ARCHITECTURE.md` "current reality"). What remains of the target data model is still deferred:

- **Frozen point values per scoring event** (points are still recomputed live from current config; the log doesn't yet snapshot what a completion was worth at the time).
- **Integer-thousandths points storage** (still floats today).
- **Versioned definitions** and an "as it was then" read model.
- **Soft-delete read model** — deletes append a `TaskDeleted`/`StreakDeleted` event, but there's no tombstone/`deleted_reason` surface or undo.
- **Rebuild parity check** in CI.
- A future swap of the SQLite driver / target (Postgres on the VPS was the old intended target) behind the existing `EventStore` interface, plus the security/containment posture a real deploy needs.

Each is a large, reviewed change presented as a plan before code — **not** a product feature, and not to be backfilled into unrelated work.

The reasoning behind the data model (append-only, integer points, frozen-values-vs-live-classification) lives in `ARCHITECTURE.md` → "Data & history model" — read it before building any of this.

---

## Deferred product features

Ideas from a much larger earlier vision of this product. None is built; each is a one-line seed, not a spec.

| Idea | What it is |
| --- | --- |
| **Streaks — remaining** | Task-based daily/weekly streaks are **built**, including the "count from created / all time" option and honest counting via period close (see `PRODUCT.md`/`ARCHITECTURE.md`). Still deferred: **filter-driven** streaks (the inert "Filter (debug)" matcher — needs Tags below), editable **milestones** (e.g. 2·5·7·14·30·100), **paused-day protection** ("streaks are real," only a paused day protects one — builds on the now-built `PeriodClosed` + the Day types below), and **tab-stat streaks** (the owner's idea, and how streaks would reach Tasks and the Freezer, whose tasks they never link: the pick-whip lights up a whole tab, and you pick a property and a number — "cleared at least 1 frozen task every week"). |
| **Tags & filters** | Free-form multi-tags on tasks; saveable structured filters ("what counts as a workout") that streaks/counters/charts reuse. Load-bearing for making the streak `filter` matcher real. Filters must be structured ASTs → parameterised SQL (see `CONVENTIONS.md`). |
| **Counters** | Like streaks but counting totals over a filter. |
| **XP / Coins split** | XP = weekly score, resets weekly, never spendable. Coins = spendable, never reset. One check pays both. |
| **Shop / wallet** | Spend coins; spending should visibly "hurt." Negative balance closes the shop. **Built, spending the board's points** (server-backed and event-logged, purchases freeze their cost — see `ARCHITECTURE.md` → "Shop"). Period rolls now **bank** the points of the tasks they uncheck. Still deferred: the XP/Coins split below, and banking *within* a period — until the day/week closes, a spent point can still be "un-earned" by unchecking its task. |
| **Bounties / boosters** | Rolled periodically for extra motivation. The **weekly Bounty is built** — several at a time, rolling another on a win, rolled from the Freezer (see `PRODUCT.md`); the Registry's weekly **Booster** is built too, and so are **rerolls for both as shop items** (item rewards — see `PRODUCT.md` "The shop"). |
| **Weekly target & pace** | Target computed from the week's day types, calibrated from real data — never hardcoded. |
| **Day types** (`WORK`/`NORMAL`/`PAUSED`) | `PAUSED` pauses the whole system (no target contribution, no streak breaks) but still allows logging. Builds directly on the now-built period close: a `dayType` field on `PeriodClosed` (see `ARCHITECTURE.md` → "Settings & period close"). |
| **Dashboards / modules / charts / heatmap** | Composable module system (task list · streak card · counter · target ring · chart · heatmap · calendar · …). |
| **Private items** | Tasks whose label never renders anywhere on screen. Flagged in `PRODUCT.md` too — respect absolutely when built. |
| **Penalties** | Invisible deductions — never in the shop or any list; deduct coins deliberately. |

## Deferred infrastructure

- **Mobile app.** The product is meant for PC + mobile; the mobile client isn't built. Backend-stored state is the prerequisite (done as part of the persistence step).
- **Auth.** Single user, no login today. When it lands, the server stays the sole authority; the client is never trusted for points/time.
- **Deploy story** — Docker, VPS behind existing nginx, containment (non-root, unpublished DB, no host mounts, resource limits, zero outbound). Reasoning: `ARCHITECTURE.md` → "Security architecture."

---

## Loose ideas

- **Points builder — other looks** (not built): the builder is now the Sentence the owner picked (variant B of https://claude.ai/artifact/7wDW7jZPdoapTBu5QJuHov — see `PRODUCT.md` "Points"). Still on that page if wanted later: C, the same sentence with effort *cards* (a line and a price each) in place of the multiplier choices.
- **Live tab icon** (owner-approved, not built yet): the tab icon fills from the bottom as today's points come in, with the points that fill it to the top set in Settings.
- **More items** (the owner asked for ideas; each would be one entry in the shop's item registry — see ARCHITECTURE "Shop"):
  - **Extra Bounty** — roll one more Bounty this week (another ×2 target).
  - **Extra Booster pick** — take one more card from this week's hand.
  - **Coupon** — a share off the next reward you buy (a price modifier, so it stacks with the sale).
  - **Mystery reward** — buy a sealed card and scratch it to reveal one of your rewards (the saved scratch-card reveal).
  - **Streak shield** — would cover one missed day; it cuts against "streaks are real" (only a paused day protects one), so it's the owner's call.
- (Add here as they come up — keep each to a line, with a pointer if the reasoning lives elsewhere.)
