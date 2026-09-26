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

- **One task-row component** (`TaskItem`), one bracket component (`PointsBracket`, shared by the row *and* the flyer so they're identical *by construction* — not two lookalikes), one inline-form primitive (`Popover`, used by every create/edit form — there is no `Modal`), one confirm primitive (`ConfirmPopover`).
- **One base per layer, shared by every tab kind.** Canvases are `CardCanvas`, tabs are `CanvasCard`, tab controls are `SortMenu`/`DisplayMenu`, lists are `ItemList`, rows are `ItemRow` — the board and the shop are both just kinds on these (see `ARCHITECTURE.md` → "Shared bases"). A new tab kind or canvas declares its options and renders its cells; it never re-implements move/resize, sorting UI, reorder or grouping. A feature for "tabs" or "lists" goes into the base so every kind gets it — don't add it to one kind's card.
- Before writing a new "create/edit X" surface, a new icon, or a new animated element, check whether the existing primitive already covers it. Extend the shared one; don't fork a one-off.
- **Buttons: there is NO global `<button>` reset.** A bare `<button>` renders as the ugly browser default and will not match the app. Every actionable button must carry a style class: **`.btn-primary`** for the filled/dark affirmative action (a form's `button[type="submit"]` gets the same styling automatically), **`.ghost-btn`** for a secondary/cancel action, `.danger-btn` for destructive. Never ship a classless `<button>` for a user action. (`App.css`, near `.btn-primary`.)
- When a rule or magic number needs to exist, give it **one home** (e.g. every flyer magnitude lives in `flyerTiers.ts`, nothing else). Retuning should mean editing one object, not hunting through components.

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
- Multipliers (when they exist) **compose into one factor, applied once, rounded once (half-up)** — never stepped one at a time.

## How we work together

- **The owner dictates changes one at a time and reviews each before the next.** Don't build ahead of what's asked. Don't add scope unprompted. Don't generate speculative specs or docs.
- **Show approaches before acting.** For any significant task with multiple valid paths, present 2–3 options with trade-offs and wait for a choice. State assumptions explicitly; if something's unclear, stop and ask rather than guess.
- **Before changing owner-created content or doing anything destructive**, describe exactly what will change and why, and wait for confirmation. "I think this is better" is not permission.
- **Suggest from `BACKLOG.md`, never build ahead of it.** When something the owner asks for is close to a parked idea, offer it concretely ("this is close to the Streak idea in the backlog — want that?") as a suggestion they approve — never as something you start building wholesale. That wholesale-generation is exactly what soured the last attempt.
- **After any editing task, end with a short status update** — what changed, what was left untouched, what needs attention.
- **Keep these docs current.** They are the durable memory that survives a cleared chat. When the design genuinely changes, update the relevant doc in the same breath — don't let it drift stale.
