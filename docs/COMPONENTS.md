# Components

> **Scope of this file.** What already exists to build the web app's UI with — every shared component, hook and "one home" file, and what each is for. It is imported by `CLAUDE.md`, so it is in context every session.
> **Write here:** one line per shared piece — what to reach for, and what never to hand-roll instead. Add the line in the same change that adds the piece.
> **Don't write here:** how a piece works inside or the traps around it (→ `ARCHITECTURE.md`), why the app looks the way it does (→ `PRODUCT.md`), or the reuse rules themselves (→ `CONVENTIONS.md`).

**Look here before building anything.** If what you need is on this page, use it — extend it if it falls short. A second thing that does the same job (another tooltip, another menu, another bubble) is exactly the mess this project exists to avoid. Everything lives in `apps/web/src/`.

## Never the browser's own

The owner's standing rule, repeated here because it keeps being broken: **nothing the browser draws by itself belongs on the board.**

| Never | Always |
| --- | --- |
| `title="…"` on anything (Chrome's grey hover box) | `<Tooltip label="…">` around it |
| a hover bubble drawn by hand (a `::before` with `attr(data-label)`, a hidden `<span>` shown on `:hover`) | `<Tooltip>` — every hint in the app is this one component |
| a bare `<form>` (Chrome's "Please fill out this field." bubble) | `<Form>` — same field rules, said in the app's bubble |
| `alert()` / `confirm()` / `prompt()` | `ConfirmPopover`, or a `Popover` form |
| a classless `<button>` | `.btn-primary` / `.ghost-btn` / `.danger-btn` / `.icon-btn` |
| a centred modal over a dark backdrop | `Popover`, anchored to what opened it |
| a colour literal (`#fff`) | a token from `theme.css` (`var(--surface)`); a tab's colour through `tabInk()` |

## Small pieces — hints, forms, menus, panels

| Need | Use | Notes |
| --- | --- | --- |
| A hint on hover / focus | `Tooltip` | `label` (text, or block children for several lines; none ≡ no bubble). `position` top / bottom / left / right; `align` start / end for a trigger at a card's edge; `focusable` when the child can't take focus (plain text, a disabled box); `inline` in a run of text that must wrap; `wrap` for a bubble of running text (a task's description); `className` / `style` when the wrapper stands in for a laid-out element (a grid cell, a row). |
| A form | `Form` | Fields keep native rules (`required`, `min`, `step`, `type="number"`); `Form` says what's wrong under the field in the tooltip's bubble. `data-missing="Give it a name"` gives a field its own words for being empty. `onSubmit` may return `{ field, message }` for a problem only the whole form can tell — said under the element carrying that `data-field`. |
| A form's layout | `.popover-form` > `.field` > `.field-label` (+ `.field-hint`), `.popover-actions` for its buttons | A submit button inside `.popover-actions` is styled primary by itself. |
| Pick one of a few | `.calc-pills` > `.calc-pill` (`.active`) | The type pills, a streak's type, a task's priority. |
| An inline panel (a form, a menu) | `Popover` | Anchored to its `.popover-anchor`, opens in the top layer. `scrollable` for a tall form; `fit` for a menu whose rows mustn't wrap. There is no modal. |
| A yes / no | `ConfirmPopover` | Beside the button that asked. `danger={false}` when nothing is destroyed. A row's delete goes through `RowRemove`. |
| A right-click / long-press menu | `ActionMenu` | Rows get it from `ItemRow` by declaring `actions`. `checked` + `set` make a captioned set of choices (Status, Priority). Edit and Delete come from `rowActions.ts`. |
| An icon | `Icons.tsx` | Inline SVG on `currentColor`; add a new one there, never inline in a component. |
| A colour swatch row | `ColorPicker` | |
| The `[%]` bracket | `PointsBracket` | Shared by the row and the flyer, so they're identical by construction. |
| A % that counts up in a frame | `PointsPlate` | The HUD (`PointsCounter`) is this plus bursts. |
| A stopwatch on a row | `TaskTimer` | Tier-aware only when handed tiers. |
| Link a task by dragging onto it | `usePickWhip` (`pickWhip.tsx`) | The streak form, the Blocked form, Break down's tuck. |

## A task's form fields

| Need | Use |
| --- | --- |
| Time + effort → `%` ("1h at Ugh difficulty = 3.75%") | `PointsBuilder` (`TierBuilderRow` per tier) |
| The folded description | `DescriptionField` |
| Per-box scheduled times | `ScheduleEditor` |
| High / Medium / Low | `PriorityField` |

## Canvases, tabs, lists, rows — the bases

A new tab kind or canvas declares its options and renders its cells. It never re-implements what a base owns.

| Layer | Base | Owns | Kinds on it |
| --- | --- | --- | --- |
| Canvas | `CardCanvas` (over `BoardCanvas`) | pan / zoom, card placement, the corner toolbar (`CanvasToolbar`, `ToolbarGroup`) | the board, the shop |
| Tab | `CanvasCard` (+ `CardTitle`, `CardAdd`) | move, resize, header / body / footer, the title's popover, the `+` | `SectionCard`, `ShopSectionCard` |
| Tab controls | `SortMenu`, `DisplayMenu`, `tabView`, `sortItems` (`TabControls.tsx`) | the two menus, pinning, persisted choices | **what a tab offers is declared in `tabViews.ts`, nowhere else** — a sort has a `compare`, or `parts` (headed parts of a list) |
| List | `ItemList` (+ `GroupBlock`) | reorder, groups, drag into / out of a group, drop on another list | tasks, streaks, rewards |
| Row | `ItemRow` (+ `RowRemove`) | drag + group handles, the trash's confirm, the actions menu | `TaskItem`, `StreakItem`, `RewardItem` |

## On a task row and in a task tab

| Need | Use |
| --- | --- |
| A modifier's tag and line (Bounty, frost, Subzero, Booster, sale) | `ModifierTag`, `ModifierLine` — looks declared in `modifierLooks.ts` |
| How long a task has waited | `AgeChip` |
| The hover pill that moves a task between bands | `StatusPill` |
| One Status band (header, count, fold) | `StatusBand` |
| The header over one part of a split list | `ListPartHead` |
| The count under a tab's title | `TaskCount` |
| A broken-down task's pieces | `Pieces.tsx` (`PieceList`, `PieceStrip`, `PiecesSummary`) |
| Why a task is blocked | `BlockForm` |
| "2 owned · 1 free" chips | `HeldChips` (`RewardItem.tsx`) |

## One home each — words, looks and magnitudes

Retuning any of these is one edit in one file; nothing else repeats them.

| What | File |
| --- | --- |
| Theme colours (every chrome colour is a token) | `theme.css`; themes listed in `useTheme.ts` |
| A tab colour as drawn on this theme | `palette.ts` → `tabInk()` |
| What each tab's Sort and Display menus offer | `tabViews.ts` |
| Status: band words, icons, which band a sort may split | `taskStatus.ts` |
| Priority: words, arrows, colours, which colour a row | `taskPriority.ts` |
| How each modifier looks | `modifierLooks.ts` |
| Flying-points sizes · freeze-effect sizes | `flyerTiers.ts` · `freezeFxTiers.ts` |
| Shop items' names and emoji | `gameItems.ts` |
| A duration as written and as typed | `duration.ts` |
| Day and week keys as words | `periodLabels.ts` |
| Canvas geometry (grid, snap, default placement) | `canvas.ts` |
| List order / group updates the optimistic state applies | `listOps.ts` |
| Types and shared rules | `types.ts` re-exports `@board/contracts` — import from `./types`, never restate a shape |

## Hooks

| Need | Use |
| --- | --- |
| The board's clock, settings and open day | `useBoardClock` |
| Per-device prefs (layouts, canvas settings, tab prefs) | `useLocalConfig` |
| Close on a press elsewhere | `useClickOutside` |
| Open something above everything, anchored | `useTopLayer` / `useAnchoredPanel` |
| The canvas zoom · snap / grid settings | `useCanvasScale` · `useCanvasSettings` |
| A free spot on screen for a floating thing | `useFreeSpot` |
| The theme | `useTheme` |
| The shop's data and edits | `useShop` |

## Moments and screens

Built once each; a new celebration follows `PRODUCT.md` → "Design language" and reuses these effects.

| What | Where |
| --- | --- |
| Points flying to the counter · the counter | `FlyingPoints` · `PointsCounter` |
| Tabs poofing into the shop and back | `Poof` |
| Thaw / finish effects | `freezeFx.ts` |
| The day prompt · the recaps | `PeriodClose` · `Recap` |
| The Bounty reel · the Booster deal | `BountyRoll` / `BountyReveal` · `BoosterDeal` / `BoosterReveal` |
| The wind-down nudge | `WindDownOverlay` |
| Settings · backups list · a still picture of a board | `SettingsView` · `BackupSlots` · `BoardSnapshot` |
| The points-formula reprice confirm | `RebalanceConfirm` |
| The rail · theme switch · login | `AppNav` · `ThemeSwitch` · `AuthGate` |
