# Conventions

> **Scope of this file.** How we write code here and how we work together. The rules that keep a hundred-developer codebase clean — applied to a one-developer one.
> **Write here:** code style, the prime directives, component-reuse rules, dependency policy, security coding rules, history/data discipline, and the working process.
> **Don't write here:** system structure or implementation lore (→ `ARCHITECTURE.md`), product rationale (→ `PRODUCT.md`), or future features (→ `BACKLOG.md`).

---

## The mindset

Treat this as a SaaS maintained by a large team. That means: **don't write quickly just to land a feature — bake it carefully**, considering the existing codebase and modern conventions. Reuse components. Write at a senior level. The owner is learning this codebase and cannot audit every line, so clarity and consistency beat cleverness every time.

## Prime directives (these override convenience)

1. **Never hardcode the owner's board.** No task named in code, no `if (task.name === "Workout")`, no `WorkoutStreak` class, no `calories` column. Sections, tasks, task types, and their config are **user configuration over generic primitives**, editable through the UI. If a feature seems to need a name in the code, the primitive is wrong — fix the primitive. This is the single rule that keeps the app from feeling hand-hacked.
2. **History is sacred.** Never mutate history in place, never hard-delete once the append-only model lands. Freeze the resolved values (points earned) onto each event; read classification (tags, type, private flag) live. Keep every timestamp — created, completed, edited, and what changed. If in doubt, store more, not less: we would rather have data we never use than need data we didn't keep. (Full model in `ARCHITECTURE.md`.)
3. **The server is the only authority on points and time.** The client may be optimistic for instant UI; the server recomputes from its own config and clock. Never trust the client for scoring.

## Code style

- **Strict TypeScript, no `any`.** Ever.
- **Match the existing style** rather than your own preference. The repo uses **2-space indentation** and double-quoted strings in TS/TSX — follow that, not the org-wide Java 4-space rule (that rule is for Java repos).
- **Comments explain *why*, never *what*** — and only when the *why* is non-obvious. The codebase is full of good examples: a comment earns its place by capturing a trap or a decision, not by narrating the line below it.
- Keep functions and components focused. If a component is doing two jobs, split it (see `FlyerItem` extracted from a `.map()` body in `ARCHITECTURE.md`).

## Build once — reuse relentlessly

Duplication means something was modelled wrong. One concept, one component, one place:

- **One task-row component** (`TaskItem`), one bracket component (`PointsBracket`, shared by the row *and* the flyer so they're identical *by construction* — not two lookalikes), one inline-form primitive (`Popover`, used by every create/edit form — there is no `Modal`), one confirm primitive (`ConfirmPopover`), one row-actions menu (`ActionMenu`, opened by the `ItemRow` base — a new per-row action is an entry in the row kind's `actions`, never a new button on every row).
- **One base per layer, shared by every tab kind.** Canvases are `CardCanvas`, tabs are `CanvasCard`, tab controls are `SortMenu`/`DisplayMenu`, lists are `ItemList`, rows are `ItemRow` — the board and the shop are both just kinds on these (see `ARCHITECTURE.md` → "Shared bases"). A new tab kind or canvas declares its options and renders its cells; it never re-implements move/resize, sorting UI, reorder or grouping. **What a tab's Sort and Display menus offer is declared in one file, `tabViews.ts`:** each item kind has a catalog (every sort and toggle, its logic written once), and each tab picks what makes sense for it — pinned if it's likely used, unpinned (under "Show more") if only sometimes, left out if it means nothing there, renamed where the catalog's words don't fit. A card never writes a sort of its own. A feature for "tabs" or "lists" goes into the base so every kind gets it — don't add it to one kind's card.
- Before writing a new "create/edit X" surface, a new icon, or a new animated element, check whether the existing primitive already covers it. Extend the shared one; don't fork a one-off.
- **Buttons: there is NO global `<button>` reset.** A bare `<button>` renders as the ugly browser default and will not match the app. Every actionable button must carry a style class: **`.btn-primary`** for the filled/dark affirmative action (a form's `button[type="submit"]` gets the same styling automatically), **`.ghost-btn`** for a secondary/cancel action, `.danger-btn` for destructive. Never ship a classless `<button>` for a user action. (`App.css`, near `.btn-primary`.)
- **Colours come from theme tokens, never literals.** Chrome colours are `var(--…)` tokens from `theme.css` (`--surface`, `--text-2`, `--danger-text`, …), so every theme gets them; a literal `#fff` or `#f1f5f9` looks fine in light mode and breaks every dark theme. Need a colour no token covers? Add a token, with a value in each theme. Tab colours are user data: draw them through `tabInk()` (`palette.ts`). Literals are only for things that look the same in any theme (celebration FX, a red danger fill, paper). See `ARCHITECTURE.md` → "Themes".
- When a rule or magic number needs to exist, give it **one home** (e.g. every flyer magnitude lives in `flyerTiers.ts`, nothing else). Retuning should mean editing one object, not hunting through components.

## In-app text

Every string the owner sees (labels, hints, setting notes, confirms, recap lines) is product copy: it says what the thing *is* or *does for them*, in the board's own words. This is the owner's standing rule, flagged because Claude keeps breaking it.

- **Never echo the request.** The prompt that asked for a feature describes a change; the UI describes the product. Asked to "make the week recap close all the streaks and clear all tasks", the button says "End the week", not "Ends this week, closes all streaks and clears your tasks". The owner knows what ending a week does.
- **Don't narrate the mechanism** ("will prompt the user to…", "recomputes as if…", "rebuilding them fresh"), and never say "the user" or "the app".
- **A hint has to earn its place.** Keep one only if it tells the owner something the label doesn't; a label that's clear on its own gets no hint.

## Modifiers — every point-changing mechanic is one

Anything that changes what a task pays is a **modifier**: the Bounty, frost, and every boost, bonus, penalty or buff the owner adds later. The owner wants these to grow like stats in an MMO (their reference is Hypixel Skyblock), so they have to stack by construction, never by special case.

- **A new mechanic is one entry in the modifier registry**, never its own payout branch, task column, bracket colour or row badge. The entry declares when a task has it, its effect, and how it shows. Nothing else in the code knows a modifier by name.
- **Four kinds of effect, always composed in the same order.**
  - A *share* adds a fraction of the task's own points (frost: +40%).
  - A *flat* adds a fixed amount (the Booster: +0.5% on each tick).
  - A *factor* multiplies (Bounty: ×2).
  - A *floor* is the least the task pays (Subzero: at least 100%) — the whole task: a broken-down one's pieces pay toward it, and its finish pays the rest.

  `pays = max((points × (1 + Σ shares) + Σ flats) × Π factors, highest floor)`, as one composed result, rounded once, half-up (see "History & data discipline"). That's how a Bounty sits on top of frost, and Subzero lifts a task to 100% without lowering one already worth more, with none of them knowing about the others. A new modifier picks one of these kinds; a new kind is a design change to raise with the owner first.
- **Every modifier shows itself the same way:** a tag after the task's name, one line under it in its own colour and icon ("×2 bounty", "+0.12% frost", "=100% subzero"), and a bracket showing what the task pays — black with no modifiers, the modifier's colour with one, a blend of their colours with several. Where a tag would say nothing (frost's in the Freezer, where everything is frozen), the modifier's own entry hides it there; the row never special-cases one. A modifier can also name an **aura**, an always-on look on its row, like a game's enchanted glint (Bounty's embers, Subzero's drifting snow); the row just applies whatever auras its modifiers name.
- **A completion freezes its resolved modifiers and the composed result**, so retuning a modifier never reprices the past (`ARCHITECTURE.md`, ADR 3).
- **Tests cover the composition, not just each modifier:** every kind alone, every pair (a Bounty doubles frost; a floor lifts but never lowers), the single rounding, and that a rebuild from the event log gives identical numbers.
- **A reward's price takes modifiers the same way** (the weekend sale is the first): same four kinds, same composition, frozen on the purchase. A discount, a coupon or a markup is one entry in the price list, never a branch in the shop.
- **Not a modifier:** a payout that doesn't change a task's points or a reward's price, like the thaw bonus (a flat amount paid when a task thaws).

**Built** with the Freezer: the registry, when a task has each modifier and its effect, is `packages/contracts/src/modifiers.ts` (what the server pays with — and, under "Prices", what a reward costs), and how each one shows is `apps/web/src/modifierLooks.ts`. A new modifier is one entry in each, plus its tests. The shape is in `ARCHITECTURE.md` → "Modifiers".

## Dependencies

Few and justified. Supply chain is the realistic security risk (see below), so every dependency is a liability. `framer-motion` was added deliberately for real drag physics and enter/exit animation — **don't reach for a second animation library alongside it.** Prefer the platform (native DnD, CSS, `Intl`, `crypto.randomUUID`) and already-installed deps before adding anything.

## Security (coding rules)

Security is not a phase — see `ARCHITECTURE.md` for the containment architecture. As a coder:

- **Validate every input at the trust boundary** (the API's type guards). Don't trust request bodies.
- **No hard-coded secrets.** Never log credentials, tokens, or key material — log presence/type only.
- **No outbound network calls** — no CDN links, remote fonts, telemetry, or error-reporting services. Nothing that phones home.
- **Future user-defined filters/queries → structured ASTs compiled to parameterised SQL.** Never string interpolation, never `eval`, bounded depth/node count.
- Use HTTPS/encryption for anything over the wire once a deploy exists.

## History & data discipline (coding rules)

- Under the target model: writes are *events appended*, not rows mutated; deletes are soft. State is a projection that must rebuild to identical numbers — protect that invariant.
- **Points will be integer thousandths of a percent** (`1% === 1000`) once persistence lands — never floats. Float addition isn't associative and the rebuild-parity check would fail randomly. `%` is the only unit the user sees.
- Modifiers **compose into one payout, rounded once (half-up)** — never stepped one at a time (see "Modifiers").

## How we work together

- **The owner dictates changes one at a time and reviews each before the next.** Don't build ahead of what's asked. Don't add scope unprompted. Don't generate speculative specs or docs.
- **Show approaches before acting.** For any significant task with multiple valid paths, present 2–3 options with trade-offs and wait for a choice. State assumptions explicitly; if something's unclear, stop and ask rather than guess.
- **Before changing owner-created content or doing anything destructive**, describe exactly what will change and why, and wait for confirmation. "I think this is better" is not permission.
- **Suggest from `BACKLOG.md`, never build ahead of it.** When something the owner asks for is close to a parked idea, offer it concretely ("this is close to the Streak idea in the backlog — want that?") as a suggestion they approve — never as something you start building wholesale. That wholesale-generation is exactly what soured the last attempt.
- **After any editing task, end with a short status update** — what changed, what was left untouched, what needs attention.
- **Building an approved plan: one feature, verified, then stop.** When the owner hands over an approved build order (today: `BACKLOG.md` → "Next up"), act as tech lead: build exactly one feature, get it working 100% *in the running app*, then stop and report in two parts — how it works (≤2 sentences) and how to test it (≤1 sentence), plus a line on anything genuinely noteworthy. Don't start the next feature until the owner signs off; then suggest the next one from the order. Bugs the owner reports mid-way are fixed first, the same way.
- **"Works" means seen working.** Types, lint and tests come first, but then drive the real UI in a browser and *look at the screenshots* — real visual bugs here (a dim overridden by framer's inline opacity, a label wrapping a name onto two lines) only showed up that way. Always on an isolated instance, never the owner's data or their running dev servers — see `ARCHITECTURE.md` → "Verifying in an isolated instance".
- **A failing test is checked before it's blamed.** Run it on the untouched code (`git stash` the change) first; report pre-existing failures honestly instead of chasing or hiding them.
- **Keep these docs current.** They are the durable memory that survives a cleared chat. When the design genuinely changes, update the relevant doc in the same breath — don't let it drift stale.
