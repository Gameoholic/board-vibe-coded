# Product & Design

> **Scope of this file.** Why this exists, who it's for, what it must feel like, and the current product behaviour + visual language. The human side.
> **Write here:** the owner's goals and pain points, product principles, what each current feature *is* from the user's view, deliberate scope decisions, and the design language + its rationale.
> **Don't write here:** how features are implemented (→ `ARCHITECTURE.md`), code style (→ `CONVENTIONS.md`), or unbuilt ideas (→ `BACKLOG.md`).

---

## What this is (and why)

A personal productivity board replacing a physical whiteboard the owner ran for six months: daily/weekly checklists, a tiered "registry" of habits (workouts, instrument practice, language study, a NASA project, trip planning), each task worth points. Single user, self-hosted, built incrementally. Used **primarily on PC, but also as a mobile app** — so the shared truth lives on the backend, reachable from any device.

**Everything is in service of one goal: making the owner more productive and more consistent.** A feature that doesn't do that doesn't belong.

### The pain points it fights

- **Procrastination** (mainly YouTube), avoided-task backlog, and losing structure around hobbies.
- **Consistency** in habits and calisthenics — showing up repeatedly, not once.
- **Friction to log.** This is the big one. *The physical whiteboard stopped working because of access, not design* — the owner wasn't in the room with it most of the day. The tracking concept was sound; the friction killed it. **So anything that reduces the friction of logging something beats anything that adds a feature.** This is *why* the app must be everywhere (PC + mobile) and why instant feedback matters so much.

---

## Owner context (about the person, not the code — this doesn't go stale)

- **Burned by a previous vibe-coded project that came out messy.** That's the whole reason this rebuild started from zero and why "one change at a time, no unprompted scope" (see `CONVENTIONS.md`) is non-negotiable. Quality anxiety here is real — take it literally.
- **Loves configurability, genuinely, as an end in itself — but not everywhere.** When in doubt, expose the knob with good UX rather than hardcoding a choice. That said, the owner has deliberately narrowed some scope (tabs are static once created). Configurability is a value, not an absolute — when the owner narrows scope, respect it; don't re-expand it "for consistency."
- **Streaks and consistency mechanics are the strongest motivator** in the original design — a first version now exists (see below); treat this UI as high-stakes, not an afterthought, as it grows.
- **Wants the satisfaction of the physical object preserved.** Don't let this drift into feeling like a spreadsheet or a bare CRUD form. The checkbox weight, the animation, the whiteboard-style `[%]` notation are all in service of that — the live counter + flying-point animation got real polish *because* instant, satisfying feedback is core to why this beats a whiteboard, not a nice-to-have.
- **Some items may need to be private eventually** — never rendering their label anywhere on screen. Not built yet; flagged so it isn't forgotten when tasks contain anything the owner doesn't want visible.
- **The board conceptually starts empty.** The current seed data (Reset board, Workout A, Immersion, etc.) is placeholder/demo content standing in for the owner's real tasks — not sacred, not a permanent fixture.

---

## Current product shape

What exists today, from the user's point of view. (Implementation details for all of this live in `ARCHITECTURE.md`.)

### Navigation & places

The app is no longer only the board — a slim **icon rail on the left edge** switches between "places." Today: **Board** (home, the whiteboard) and **Settings**, plus a **Shop** button. The Shop isn't a separate page — it happens *on the board*: your tabs vanish, the points counter glides to the top-centre, and your shop tabs appear beneath it (going back plays it in reverse). Shop tabs are your own shelves for organising rewards (no difference between them — just grouping), each listing rewards you define with a cost in **points (%)**; the price tag is the buy button. They're the same kind of tab as the board's: drag them anywhere on the shop's canvas, resize them, sort and toggle what shows, drag rewards to reorder them, and bundle rewards into groups — with the same grid, snap and reset controls in the corner (the shop keeps its own arrangement). New shop tabs come from the `+` in that corner; rename, recolour or delete one from its title. **Buying really spends your points** — the counter drops with a visible sting, on the board and in the shop alike, on every device — and a negative total closes the shop. The currency is simply your board points, not a separate coin balance (that split may come later); every purchase is recorded, so the points you've ever *earned* stay knowable apart from what you've spent. The rail is always visible and shows a small dot on Settings when something's waiting there (a day/week to close).

### Day & week close

The board has a real **end-of-day / end-of-week moment**, like sweeping the physical whiteboard. When you open the app and a new day (or week) has begun, a gentle banner asks **"Has a new day started? Wrap up <date>."** — **Yes** locks that period in, **wipes the board for the new one** (a new day unchecks Daily and Registry, a new week unchecks Weekly; the Tasks tab is never wiped) and shows a **recap** (what you did and what it was worth); the points those tasks held are **banked**, so wiping never costs you anything; **Not yet** defers until you reopen (for late nights before your day-start time). This is what makes streaks honest: a period only counts what was genuinely done when it closed, so a box you ticked then unticked doesn't inflate a streak. When exactly a day and week begin is configurable (see Settings). A **fresh or reset board has no day/week yet**, so it prompts you to *start* your first one (worded "start", not "wrap up") rather than starting silently.

### Settings

A dedicated Settings place (not on the whiteboard, since it's board-wide truth shared across your devices, not a per-screen preference like the canvas layout):

- **Timezone**, and **when a new day starts** (default 00:01; set it to 4am if your day really ends then).
- **When a new week starts** — weekday (default **Sunday**, the Israeli week) and time (default 00:01).
- **Wind-down (optional, off by default)** — a screen-off nudge. Set a time you want to be off your screens by and **when the full message pops up** — an editable list (defaults: **30, 15, 5 min before**, and **on refresh**; delete any or add your own). "On refresh" shows it on any page load once you're already inside the window. Each pop **grows** with how close the target is — bigger the later it is, taking over the whole screen and dimming the board toward black at the deadline, its top line ticking the **live current time** in red — to physically push you to shut down. Two ways out, stacked in the centre: **Acknowledge** (the big one) winds it down (a satisfying collapse) into a **small burning candle** that floats in a free spot on the board — its wax burns lower as the time nears, still showing the current time — out of your way so you can keep going but always in the corner of your eye, **glowing red once the time is past** (the flame gutters to smoke); click it to bring the full alert back. Below it, a smaller red **Dismiss for today** (with a confirm step) clears it until tomorrow. The headline is customizable (blank = a generic default). It's a pure nudge tied to no task — it never touches points or streaks.
- **Reset board** — wipes all tasks, data and history completely, leaving an **empty board** (no tabs/tasks/streaks). Behind a confirm; can't be undone. Destructive and deliberate.

### Sections ("tabs")

- **Static once created** — name and allowed task types can't be edited or deleted from the UI. This was a deliberate scope-narrowing the owner asked for; **don't reintroduce rename/delete/retype UI without being asked again.**
- Two things about a tab stay adjustable: its **color** (click the tab title → inline color popover, applies immediately, no save button) and its **place on the board** — the board is a **free whiteboard-style canvas**, not a fixed row of tiles. Drag the `⠿` handle to move a tab anywhere; drag any corner to resize it. Positions **snap to a light grid** as you go and spring into place on release, and the last tab you touch floats above the others. You can **pan** by dragging the empty canvas with the **middle mouse button** (or scrolling; one-finger drag on touch) — left-click is left free and **zoom out a little** with ⌘/ctrl-scroll or a trackpad pinch — but the camera stays clamped to the tabs' area plus a small margin, so there's no getting lost in empty space; dropping a tab further out simply extends the reachable area. This whiteboard layout is **per-device** (a phone keeps its own arrangement, not a wide monitor's).
- **Canvas controls** float in the **top-right corner inside the board** (not a separate bar — just the buttons, pinned there as you pan): one icon button per settings group, each opening its own inline popover — the same pattern as a tab's own color/sort controls. Today that's a **grid** button (snap to grid on/off — off lets tabs land exactly where dropped; grid size S/M/L, governing both snapping and the dot grid; show grid — a faint dot overlay as a placement guide, off by default) and a **reset** button (restores every tab to its default position, confirmed inside the popover). These are preferences, not board data — they live per-device, same as the layout itself, and the toolbar is the natural home for more canvas-wide knobs as they arrive.
- Creating *new* tabs is still open-ended via the "+ Add tab" tile.
- **The tab title itself is the color swatch** (no separate colored dot). The `+` add-task button is deliberately neutral gray, not tab-tinted — it's used rarely and shouldn't compete visually with the colored title or the task rows.

### Task types

- **`checkbox`** — done/not-done, optionally carrying a freeform `estimate` string (e.g. `"15–30 min"`) shown beneath the name. Used by Daily / Weekly / Tasks.
- **`tiered`** — pick the tier you hit (e.g. 1hr/2hr/3hr of practice). Used by Registry, **uniformly on purpose**: even a single-value item (Max dead hang) is a 1-tier tiered task, not a checkbox — one tier is "just a config with one entry." This was briefly simplified to checkboxes and the owner asked to revert it; **don't re-simplify Registry to checkboxes without being asked.**
- **`count`** — a task you do a set number of times, shown as that many checkboxes (like a mini-registry): "twice this week" is a 2-box count task. **Each box ticked earns the task's points** (so a 2-box, 1% task is worth 2% fully done), and it's only "done" when every box is ticked. The amount is editable through the UI (add form or right-click → Edit amount). Built for weekly tasks that repeat a fixed number of times.
- Tiered and count rows show one checkbox-styled square per tier/box (whiteboard-accurate — the physical board had a row of boxes per level).
- **Timer (per-tab Display toggle).** Turning on **Timer** for a tab shows a small stopwatch under every task in it — start/pause/reset, or type a number of minutes. On a **tiered** task it does more: it can auto-select a tier from elapsed time (only ever *advancing* a tier, never downgrading a manual pick — "never in the way") and offers a **Submit** that locks in the reached tier. On any other task it's just a stopwatch and never touches points. It's off by default and, like the other Display toggles, is a per-screen view choice (resets on reload).
- **Scheduled times ("do this at a certain hour").** Any checkbox task — plain or multi-box — can schedule each box so it only unlocks when its time comes. A locked box shows a **lock** with an "Unlocks …" tooltip and can't be ticked early; it opens on its own when the time arrives (no reload needed). The form adapts to the **tab**: in a **daily** tab each box just takes a time of day (a cream at 10:00 every day); in a **weekly** tab each box takes a weekday and an *optional* time (teeth plates: box 1 Friday, box 2 Saturday; or "unlock on Friday, any time" if you leave the time blank). Daily-vs-weekly is inferred from where the task lives — it's **not** an option you pick per task — and there's deliberately **no separate "scheduled" task type**. The lock is a gentle nudge, never a hard rule: it never affects points.

### Points

- **Every task has a points value (`%`)**, shown whiteboard-style in brackets before the name: `[0.2%] Reset board`. Tiered tasks show one per tier: `[1%/2%/3%] Immersion`. This text is always plain near-black, never tab-colored — the tab color shows on the checkbox and the tab title instead.
- Numbers are trimmed, not fixed-decimal: `0%`, `1%`, `1.5%`, `1.52%`, never `1.50%`.

### The live points counter (the signature feel)

- A red HUD widget that sums every task's current value — a completed checkbox's points, a tiered task's selected-tier points, a count task's ticked boxes × its points. Positioned to sit near where the owner's eyes actually are (it moved from a fixed top-right corner per owner request), and it stays visible while feeling like an object in the scene rather than a sticker on the glass.
- Completing a task **flies the row's `[%]` bracket into the counter** with an arc, a scale-pulse, and a particle burst — and the celebration scales with how much you just earned (a tiny 0.08% tick and a 3-hour block should not feel identical). This whole interaction is meant to feel game-like and satisfying — **keep that spirit if you extend it.**

### Forms & interactions

- **All forms are inline anchored popovers, Notion-style — never a centered modal with a dark backdrop.** Any new "create/edit X" UI uses the shared `Popover`, anchored to the button that opened it.
- **Deleting a task asks for confirmation** via an inline popover, not a browser `confirm()`.
- **A completed task looks "disabled"** (dimmed with a gray hatch overlay), not struck-through or red-tinted.

### Streaks

- A dedicated **Streaks tab** that works like the other tabs (color, reorder, add/edit/delete via the same inline popovers). Each streak tracks how many periods in a row you've kept it up, shown as a **flame + count** badge that reads lit (kept up this period), grace (count holds but this period isn't done yet — not a break), or empty. Daily/weekly streaks also show a small **best** badge — the longest run you've ever reached (your record), which the current run has to beat.
- A streak is **daily or weekly**, and is **mapped to one or more tasks** through a **Notion-style condition builder**: each tracked task is a condition row, and the rows are joined by one shared **AND / OR** connector (the first join is a toggle; the rest mirror it) that decides whether **all** of the tasks or **any** of them counts. Tasks are linked with an **After Effects–style pick-whip**: press the handle in the form and drag a line onto the actual task row anywhere on the board — the target row highlights and the line snaps onto its checkbox, and releasing links it. For a **count** task you can aim the whip at a *specific box* to require that many completions this period (drop on box 2 of 3 → "do it twice"), or at the row as a whole to require **all** of its boxes — the "all" option tracks the amount live, so it stays correct even if you change the count later. Re-dropping an already-linked task (shown amber) updates its required amount. Everything is a knob, per the owner's "everything customizable." **Streaks have no color of their own** — the flame badge takes the Streaks tab's color.
- Every streak has a **"Count from"** toggle: **Now** (default — from when you set it up) or **All time** (reaches back through the linked tasks' whole history, trustworthy because closed days/weeks only count what was actually done at close — see "Day & week close"). For a **counter** this picks between the **live count** of currently-ticked boxes ("Now") and the **lifetime total** of everything ticked across all days ("All time"), where an accidental tick you undid before the day closed doesn't count but a day that genuinely ended with 2 of 3 boxes ticked adds 2.
- **Backfill (Settings).** Each streak can carry values over from **before the app** — e.g. runs you kept on the physical whiteboard. In **Settings → Backfill** each streak has a **Start** (added on top of the current count, but only when it counts from **All time** — a **Now** streak starts fresh and ignores it) and, for daily/weekly, a **Best** (a record floor: the shown best is the higher of it and what you've actually reached in the app — never added, just a starting record to beat).
- Task-based streaks are the only way to match. (An earlier "Filter (debug)" preview mode was removed from the form — it never tracked anything; a future tag-based filter would return through `BACKLOG.md`, not a dead toggle in the UI.)
- Streak counts use the owner's timezone (**Israel**), always.

### What points do (so far)

Your points are what your checked tasks hold, plus what past days/weeks banked when they wiped the board, minus what you've spent in the **Shop** (see above). Within the current day/week they're still live, so unchecking a task takes its points back off, even after you've spent them; once a period closes and banks them, they're yours. The XP/Coins split remains a `BACKLOG.md` item.

---

## Design language

A **clean, modern-SaaS** style — deliberately *not* an earlier warm-linen "Studio"/whiteboard aesthetic the owner tried and moved away from on purpose.

- Light neutral background, white bordered cards, **Urbanist** font.
- Tab identity comes through color (the tab title is the swatch; checkboxes and accents pick it up).
- Motion is intentional and consistent — reuse the existing easing choices and the transform-based animation approach rather than introducing a one-off per feature.
- **The owner cares specifically about code quality and visual style being taken seriously — not just "does it work."** Match existing component structure, CSS-variable usage, and motion choices. A one-off approach for a single feature is a smell here.

If a description-based visual change gets rejected once, **build a live comparison the owner can see rather than guessing again** — this is a learned lesson (see the counter's history in `ARCHITECTURE.md`).

---

## Deliberate scope decisions (don't quietly reverse these)

- Tabs are static once created — no rename/delete/retype UI (narrowed by owner). Only their **color and their free position/size on the canvas** are adjustable.
- Registry stays uniformly `tiered`, including single-value items. — matches the owner's own spec.
- ~~Sort mode is per-session display only, not remembered per-tab.~~ **Reversed by owner:** each tab's sort + row display toggles now persist per-device (localStorage), surviving reloads/restarts, and the Sort menu pins a curated set with the rest under "Show more". See `ARCHITECTURE.md` "Client vs server state".
- Card corner-resize height only floors, never caps. — avoids clipping popovers.
- No cursor-following motion on the HUD. — owner disliked it.
- No origin flash on the flyer. — owner found it noisy.
